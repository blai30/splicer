import { AudioSample } from 'mediabunny'

import { audioFrameRange } from './audioEncode'
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

// Add the first `count` frames of planar stereo `data` (each plane `stride`
// frames long) into the mix at frame `at`, scaled by `gain`.
export function addToMix(
  mix: MixBuffer,
  data: Float32Array,
  stride: number,
  count: number,
  at: number,
  gain: number
): void {
  const end = Math.min(mix.left.length, at + count)
  for (let frame = Math.max(0, at); frame < end; frame++) {
    const offset = frame - at
    mix.left[frame] += data[offset] * gain
    mix.right[frame] += data[stride + offset] * gain
  }
}

// Decode only the layer's trimmed source range and add it into the mix at its
// timeline position. Throws when the source has audio the browser cannot
// decode, rather than silently exporting without it.
export async function mixLayer(
  mix: MixBuffer,
  layer: CompositorAudioLayer,
  reader: SourceReader,
  fileName: string,
  shouldCancel: () => boolean
): Promise<void> {
  if (!reader.audioSink) {
    throw new UnsupportedSourceError(`The audio in "${fileName}" cannot be decoded in this browser`)
  }
  const gain = layer.volume
  let resampler: StereoResampler | null = null
  let resamplerRate = 0
  let sourceCursor = layer.sourceStart
  let writeFrame = Math.round(layer.timelineStart * OUTPUT_SAMPLE_RATE)
  const layerEndFrame = Math.round(
    (layer.timelineStart + layer.sourceEnd - layer.sourceStart) * OUTPUT_SAMPLE_RATE
  )

  for await (const sample of reader.audioSink.samples(layer.sourceStart, layer.sourceEnd)) {
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
      const channels: Float32Array[] = []
      for (let channel = 0; channel < Math.min(2, sample.numberOfChannels); channel++) {
        const plane = new Float32Array(frameCount)
        sample.copyTo(plane, {
          planeIndex: channel,
          format: 'f32-planar',
          frameOffset: range.startFrame,
          frameCount,
        })
        channels.push(plane)
      }
      const [left, right] = toStereo(channels)
      const resampled = resampler.process(left, right)
      const frames = Math.min(resampled.frames, Math.max(0, layerEndFrame - writeFrame))
      addToMix(mix, resampled.data, resampled.frames, frames, writeFrame, gain)
      writeFrame += frames
      sourceCursor = pieceStart + frameCount / sample.sampleRate
    } finally {
      sample.close()
    }
  }
}

// Encode the finished mix, clamped to [-1, 1] so overlapping loud layers clip
// cleanly instead of wrapping in the encoder.
export async function encodeMix(
  mix: MixBuffer,
  out: OutputHandle,
  shouldCancel: () => boolean
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
      timestamp: start / OUTPUT_SAMPLE_RATE,
      data: planar,
    })
    try {
      await out.audioSource.add(sample)
    } finally {
      sample.close()
    }
  }
}
