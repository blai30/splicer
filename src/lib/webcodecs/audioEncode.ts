import { AudioSample } from 'mediabunny'

import { StereoResampler, toStereo } from './audioNormalize'
import type { EditSlice } from './editPlan'
import type { SourceReader } from './mediabunnyInput'
import { OUTPUT_CHANNELS, OUTPUT_SAMPLE_RATE, type OutputHandle } from './mediabunnyOutput'

export type AudioEncodeOptions = {
  reader: SourceReader | null
  slice: EditSlice
  out: OutputHandle
  // Output frame (at OUTPUT_SAMPLE_RATE) where this slice's audio begins: the
  // previous slice's returned end frame, so slices join without gaps.
  startFrame: number
  shouldCancel: () => boolean
}

// Frames of silence per generated chunk.
const SILENCE_CHUNK_FRAMES = OUTPUT_SAMPLE_RATE / 2
// Source timestamp jitter tolerated before treating a jump as a real gap or
// overlap in the source's audio.
const CONTINUITY_TOLERANCE_SEC = 0.005

export type FrameRange = { startFrame: number; endFrame: number }

// Which frames of a decoded sample fall inside [windowStart, windowEnd).
// Returns null when none do.
export function audioFrameRange(
  timestamp: number,
  numberOfFrames: number,
  sampleRate: number,
  windowStart: number,
  windowEnd: number
): FrameRange | null {
  const startFrame = Math.max(0, Math.ceil((windowStart - timestamp) * sampleRate - 1e-6))
  const endFrame = Math.min(numberOfFrames, Math.floor((windowEnd - timestamp) * sampleRate + 1e-6))
  if (endFrame <= startFrame) return null
  return { startFrame, endFrame }
}

// Writes stereo audio on an integer output-frame grid, never past `endFrame`.
class FrameWriter {
  constructor(
    private out: OutputHandle,
    public frame: number,
    private readonly endFrame: number
  ) {}

  get remaining(): number {
    return Math.max(0, this.endFrame - this.frame)
  }

  async write(data: Float32Array, frames: number): Promise<void> {
    const count = Math.min(frames, this.remaining)
    if (count <= 0 || !this.out.audioSource) return
    const planar =
      count === frames
        ? data
        : (() => {
            const trimmed = new Float32Array(count * 2)
            trimmed.set(data.subarray(0, count), 0)
            trimmed.set(data.subarray(frames, frames + count), count)
            return trimmed
          })()
    const sample = new AudioSample({
      format: 'f32-planar',
      sampleRate: OUTPUT_SAMPLE_RATE,
      numberOfChannels: OUTPUT_CHANNELS,
      timestamp: this.frame / OUTPUT_SAMPLE_RATE,
      data: planar,
    })
    try {
      await this.out.audioSource.add(sample)
    } finally {
      sample.close()
    }
    this.frame += count
  }

  async silenceUntil(targetFrame: number): Promise<void> {
    const target = Math.min(targetFrame, this.endFrame)
    while (this.frame < target) {
      const frames = Math.min(SILENCE_CHUNK_FRAMES, target - this.frame)
      await this.write(new Float32Array(frames * OUTPUT_CHANNELS), frames)
    }
  }
}

// Encode one timeline slice's audio so it exactly covers the slice's output
// span on the shared frame grid. Decoded samples are trimmed at the cut points
// and resampled as one continuous stream; any gap (muted slice, source without
// audio, audio that starts late or ends early) is filled with silence. Returns
// the end frame, which the next slice starts from.
export async function encodeAudioSlice(options: AudioEncodeOptions): Promise<number> {
  const { reader, slice, out, startFrame, shouldCancel } = options
  const durationFrames = Math.round((slice.sourceEnd - slice.sourceStart) * OUTPUT_SAMPLE_RATE)
  const endFrame = startFrame + durationFrames
  if (!out.audioSource) return endFrame

  const writer = new FrameWriter(out, startFrame, endFrame)
  const sink = reader?.audioSink

  if (slice.muted || !sink) {
    await writer.silenceUntil(endFrame)
    return endFrame
  }

  let resampler: StereoResampler | null = null
  let resamplerRate = 0
  // Source time up to which audio has been consumed.
  let sourceCursor = slice.sourceStart

  for await (const sample of sink.samples(slice.sourceStart, slice.sourceEnd)) {
    try {
      if (shouldCancel()) throw new Error('canceled')
      if (writer.remaining <= 0) continue

      // Skip source audio that overlaps what was already consumed.
      const overlapStart = sample.timestamp < sourceCursor - CONTINUITY_TOLERANCE_SEC
      const windowStart = overlapStart ? sourceCursor : slice.sourceStart
      const range = audioFrameRange(
        sample.timestamp,
        sample.numberOfFrames,
        sample.sampleRate,
        windowStart,
        slice.sourceEnd
      )
      if (!range) continue

      const pieceStart = sample.timestamp + range.startFrame / sample.sampleRate
      if (pieceStart - sourceCursor > CONTINUITY_TOLERANCE_SEC) {
        // A real hole in the source audio: pad it and restart resampling.
        const gapFrames = Math.round((pieceStart - slice.sourceStart) * OUTPUT_SAMPLE_RATE)
        await writer.silenceUntil(startFrame + gapFrames)
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
      await writer.write(resampled.data, resampled.frames)
      sourceCursor = pieceStart + frameCount / sample.sampleRate
    } finally {
      sample.close()
    }
  }
  await writer.silenceUntil(endFrame)
  return endFrame
}
