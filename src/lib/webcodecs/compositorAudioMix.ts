import { AudioSample } from 'mediabunny'

import { hasFades, segmentGainAt } from '../advanced/segmentGain'
import { audioFrameRange, readPlanes } from './audioEncode'
import { StereoResampler, toStereo } from './audioNormalize'
import type { CompositorAudioLayer } from './compositorProtocol'
import type { SourceReader } from './mediabunnyInput'
import { OUTPUT_CHANNELS, OUTPUT_SAMPLE_RATE, type OutputHandle } from './mediabunnyOutput'
import { UnsupportedSourceError } from './protocol'

const ENCODE_CHUNK_FRAMES = 4096
// Source timestamp jitter tolerated before a jump counts as a gap.
const CONTINUITY_TOLERANCE_SEC = 0.005

export type MixBuffer = { left: Float32Array; right: Float32Array }

export function createMixBuffer(durationSec: number): MixBuffer {
  const frames = Math.max(0, Math.round(durationSec * OUTPUT_SAMPLE_RATE))
  return { left: new Float32Array(frames), right: new Float32Array(frames) }
}

// A constant gain, or one per mix frame (a fade envelope).
export type MixGain = number | ((mixFrame: number) => number)

// Add the first `count` frames of planar stereo `data` (each plane `stride`
// frames long) into the mix at frame `at`, scaled by `gain`.
export function addToMix(
  mix: MixBuffer,
  data: Float32Array,
  stride: number,
  count: number,
  at: number,
  gain: MixGain
): void {
  const end = Math.min(mix.left.length, at + count)
  for (let frame = Math.max(0, at); frame < end; frame++) {
    const offset = frame - at
    const frameGain = typeof gain === 'number' ? gain : gain(frame)
    mix.left[frame] += data[offset] * frameGain
    mix.right[frame] += data[stride + offset] * frameGain
  }
}

// The layer's gain for a mix whose first frame is output frame `mixStartFrame`:
// its volume, shaped by its fades (the same envelope the preview uses).
export function layerMixGain(layer: CompositorAudioLayer, mixStartFrame = 0): MixGain {
  if (!hasFades(layer)) return layer.volume
  return (mixFrame) =>
    layer.volume *
    segmentGainAt(layer, (mixStartFrame + mixFrame) / OUTPUT_SAMPLE_RATE - layer.timelineStart)
}

// A run of resampled planar stereo for the mix: the first `count` frames of
// `data` (each plane `stride` frames long), placed at output frame `at`.
export type MixPiece = { at: number; data: Float32Array; stride: number; count: number }

// Decode only the layer's trimmed source range and yield it in timeline order
// as pieces placed at its timeline position. Throws when the source has audio
// the browser cannot decode, rather than silently exporting without it.
export async function* layerAudioPieces(
  layer: CompositorAudioLayer,
  reader: SourceReader,
  fileName: string,
  shouldCancel: () => boolean
): AsyncGenerator<MixPiece> {
  if (!reader.audioSink) {
    throw new UnsupportedSourceError(`The audio in "${fileName}" cannot be decoded in this browser`)
  }
  let resampler: StereoResampler | null = null
  let resamplerRate = 0
  let sourceCursor = layer.sourceStart
  let writeFrame = Math.round(layer.timelineStart * OUTPUT_SAMPLE_RATE)
  const layerEndFrame = Math.round(
    (layer.timelineStart + layer.sourceEnd - layer.sourceStart) * OUTPUT_SAMPLE_RATE
  )

  for await (const sample of reader.audioSink.samples(layer.sourceStart, layer.sourceEnd)) {
    let piece: MixPiece | null = null
    try {
      if (shouldCancel()) throw new Error('canceled')
      const overlap = sample.timestamp < sourceCursor - CONTINUITY_TOLERANCE_SEC
      const range = audioFrameRange(
        sample.timestamp,
        sample.numberOfFrames,
        sample.sampleRate,
        overlap ? sourceCursor : layer.sourceStart,
        layer.sourceEnd
      )
      if (!range) continue
      const pieceStart = sample.timestamp + range.startFrame / sample.sampleRate
      if (pieceStart - sourceCursor > CONTINUITY_TOLERANCE_SEC) {
        // A hole in the source: jump ahead (the mix is already silent there).
        writeFrame = Math.round(
          (layer.timelineStart + pieceStart - layer.sourceStart) * OUTPUT_SAMPLE_RATE
        )
        resampler = null
      }
      if (!resampler || resamplerRate !== sample.sampleRate) {
        resampler = new StereoResampler(sample.sampleRate, OUTPUT_SAMPLE_RATE)
        resamplerRate = sample.sampleRate
      }
      const frameCount = range.endFrame - range.startFrame
      const [left, right] = toStereo(readPlanes(sample, range.startFrame, frameCount))
      const resampled = resampler.process(left, right)
      const frames = Math.min(resampled.frames, Math.max(0, layerEndFrame - writeFrame))
      piece = { at: writeFrame, data: resampled.data, stride: resampled.frames, count: frames }
      writeFrame += frames
      sourceCursor = pieceStart + frameCount / sample.sampleRate
    } finally {
      sample.close()
    }
    yield piece
  }
}

// Mix one layer into a whole-project buffer in one pass.
export async function mixLayer(
  mix: MixBuffer,
  layer: CompositorAudioLayer,
  reader: SourceReader,
  fileName: string,
  shouldCancel: () => boolean
): Promise<void> {
  for await (const piece of layerAudioPieces(layer, reader, fileName, shouldCancel)) {
    addToMix(mix, piece.data, piece.stride, piece.count, piece.at, layerMixGain(layer))
  }
}

export type MixInput = {
  layer: CompositorAudioLayer
  fileName: string
  // Opens a fresh reader for this layer; the mixer disposes it.
  open: () => Promise<SourceReader>
}

type LayerMixState = {
  input: MixInput
  startFrame: number
  endFrame: number
  reader: SourceReader | null
  pieces: AsyncGenerator<MixPiece> | null
  // Decoded pieces that reach into a later window.
  pending: MixPiece[]
  finished: boolean
}

// Mixes the project's audio one window at a time instead of into one
// full-length buffer (384 KB per second of output). Each layer keeps its own
// decoder and resampler state across windows, opened when the first window
// reaches the layer and released when it ends, so the output equals a
// one-shot mix while memory stays at about one window.
export class WindowedMixer {
  private readonly layers: LayerMixState[]

  constructor(
    inputs: MixInput[],
    private readonly shouldCancel: () => boolean
  ) {
    this.layers = inputs.map((input) => ({
      input,
      startFrame: Math.round(input.layer.timelineStart * OUTPUT_SAMPLE_RATE),
      endFrame: Math.round(
        (input.layer.timelineStart + input.layer.sourceEnd - input.layer.sourceStart) *
          OUTPUT_SAMPLE_RATE
      ),
      reader: null,
      pieces: null,
      pending: [],
      finished: false,
    }))
  }

  // The mix of output frames [startFrame, endFrame). Windows must be asked
  // for in order without gaps; a decoded run that starts before the current
  // window (which only rounding at a source gap can produce) loses that part.
  async mixWindow(startFrame: number, endFrame: number): Promise<MixBuffer> {
    const mix: MixBuffer = {
      left: new Float32Array(Math.max(0, endFrame - startFrame)),
      right: new Float32Array(Math.max(0, endFrame - startFrame)),
    }
    for (const state of this.layers) {
      if (state.finished || state.startFrame >= endFrame) continue
      if (!state.pieces) {
        state.reader = await state.input.open()
        state.pieces = layerAudioPieces(
          state.input.layer,
          state.reader,
          state.input.fileName,
          this.shouldCancel
        )
      }
      let decodedUntil = state.pending.at(-1)
      let exhausted = false
      while (!decodedUntil || decodedUntil.at + decodedUntil.count < endFrame) {
        const next = await state.pieces.next()
        if (next.done) {
          exhausted = true
          break
        }
        state.pending.push(next.value)
        decodedUntil = next.value
      }
      const gain = layerMixGain(state.input.layer, startFrame)
      for (const piece of state.pending) {
        addToMix(mix, piece.data, piece.stride, piece.count, piece.at - startFrame, gain)
      }
      state.pending = state.pending.filter((piece) => piece.at + piece.count > endFrame)
      if (exhausted || state.endFrame <= endFrame) await this.release(state)
    }
    return mix
  }

  private async release(state: LayerMixState): Promise<void> {
    if (state.finished) return
    state.finished = true
    state.pending = []
    const pieces = state.pieces
    const reader = state.reader
    state.pieces = null
    state.reader = null
    await pieces?.return(undefined)
    reader?.dispose()
  }

  async dispose(): Promise<void> {
    for (const state of this.layers) await this.release(state)
  }
}

// Encode a finished mix whose first frame is output frame `startFrame`,
// clamped to [-1, 1] so overlapping loud layers clip cleanly instead of
// wrapping in the encoder.
export async function encodeMix(
  mix: MixBuffer,
  out: OutputHandle,
  shouldCancel: () => boolean,
  startFrame = 0
): Promise<void> {
  if (!out.audioSource) return
  const total = mix.left.length
  for (let start = 0; start < total; start += ENCODE_CHUNK_FRAMES) {
    if (shouldCancel()) throw new Error('canceled')
    const frames = Math.min(ENCODE_CHUNK_FRAMES, total - start)
    const planar = new Float32Array(frames * OUTPUT_CHANNELS)
    for (let frame = 0; frame < frames; frame++) {
      planar[frame] = Math.max(-1, Math.min(1, mix.left[start + frame]))
      planar[frames + frame] = Math.max(-1, Math.min(1, mix.right[start + frame]))
    }
    const sample = new AudioSample({
      format: 'f32-planar',
      sampleRate: OUTPUT_SAMPLE_RATE,
      numberOfChannels: OUTPUT_CHANNELS,
      timestamp: (startFrame + start) / OUTPUT_SAMPLE_RATE,
      data: planar,
    })
    try {
      await out.audioSource.add(sample)
    } finally {
      sample.close()
    }
  }
}
