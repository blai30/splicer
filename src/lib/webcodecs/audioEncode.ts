import { AudioSample } from 'mediabunny'

import { StereoResampler, toStereo } from './audioNormalize'
import type { EditSlice } from './editPlan'
import type { SourceReader } from './mediabunnyInput'
import { OUTPUT_CHANNELS, OUTPUT_SAMPLE_RATE, type OutputHandle } from './mediabunnyOutput'

export type AudioEncodeOptions = {
  reader: SourceReader | null
  slice: EditSlice
  out: Pick<OutputHandle<unknown>, 'audioSource'>
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
    private out: Pick<OutputHandle<unknown>, 'audioSource'>,
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

// Encodes one timeline slice's audio so it exactly covers the slice's output
// span on the shared frame grid. Decoded samples are trimmed at the cut points
// and resampled as one continuous stream; any gap (muted slice, source without
// audio, audio that starts late or ends early) is filled with silence.
//
// It is pulled forward in steps (advanceTo) while the slice's video encodes,
// so the muxer, which interleaves tracks by time, never has to hold a whole
// slice of video waiting for its audio.
export class AudioSliceWriter {
  readonly endFrame: number
  private readonly writer: FrameWriter | null
  private samples: AsyncIterator<AudioSample> | null = null
  private exhausted = false
  private resampler: StereoResampler | null = null
  private resamplerRate = 0
  // Source time up to which audio has been consumed.
  private sourceCursor: number

  constructor(private readonly options: AudioEncodeOptions) {
    const { slice, out, startFrame, reader } = options
    const durationFrames = Math.round((slice.sourceEnd - slice.sourceStart) * OUTPUT_SAMPLE_RATE)
    this.endFrame = startFrame + durationFrames
    this.writer = out.audioSource ? new FrameWriter(out, startFrame, this.endFrame) : null
    this.sourceCursor = slice.sourceStart
    const sink = reader?.audioSink
    if (slice.muted || !sink || !out.audioSource) this.exhausted = true
    else this.samples = sink.samples(slice.sourceStart, slice.sourceEnd)[Symbol.asyncIterator]()
  }

  // Output frame written so far.
  get frame(): number {
    return this.writer?.frame ?? this.endFrame
  }

  // Write audio at least up to `outFrame` (clamped to the slice end). The last
  // decoded chunk may run past it; that is fine, the muxer only needs audio not
  // to lag the video.
  async advanceTo(outFrame: number): Promise<void> {
    const writer = this.writer
    if (!writer) return
    const target = Math.min(outFrame, this.endFrame)
    while (writer.frame < target && !this.exhausted) await this.pull(writer)
    // Past the source's audio everything left is silence.
    if (this.exhausted) await writer.silenceUntil(target)
  }

  // Write the rest of the slice and release the decoder. Returns the end
  // frame, which the next slice starts from.
  async finish(): Promise<number> {
    await this.advanceTo(this.endFrame)
    await this.dispose()
    return this.endFrame
  }

  async dispose(): Promise<void> {
    const samples = this.samples
    this.samples = null
    this.exhausted = true
    await samples?.return?.()
  }

  private async pull(writer: FrameWriter): Promise<void> {
    const next = await this.samples!.next()
    if (next.done) {
      this.exhausted = true
      return
    }
    const sample = next.value
    try {
      if (this.options.shouldCancel()) throw new Error('canceled')
      if (writer.remaining <= 0) return
      const { slice, startFrame } = this.options

      // Skip source audio that overlaps what was already consumed.
      const overlapStart = sample.timestamp < this.sourceCursor - CONTINUITY_TOLERANCE_SEC
      const windowStart = overlapStart ? this.sourceCursor : slice.sourceStart
      const range = audioFrameRange(
        sample.timestamp,
        sample.numberOfFrames,
        sample.sampleRate,
        windowStart,
        slice.sourceEnd
      )
      if (!range) return

      const pieceStart = sample.timestamp + range.startFrame / sample.sampleRate
      if (pieceStart - this.sourceCursor > CONTINUITY_TOLERANCE_SEC) {
        // A real hole in the source audio: pad it and restart resampling.
        const gapFrames = Math.round((pieceStart - slice.sourceStart) * OUTPUT_SAMPLE_RATE)
        await writer.silenceUntil(startFrame + gapFrames)
        this.resampler = null
      }

      if (!this.resampler || this.resamplerRate !== sample.sampleRate) {
        this.resampler = new StereoResampler(sample.sampleRate, OUTPUT_SAMPLE_RATE)
        this.resamplerRate = sample.sampleRate
      }

      const frameCount = range.endFrame - range.startFrame
      const [left, right] = toStereo(readPlanes(sample, range.startFrame, frameCount))
      const resampled = this.resampler.process(left, right)
      await writer.write(resampled.data, resampled.frames)
      this.sourceCursor = pieceStart + frameCount / sample.sampleRate
    } finally {
      sample.close()
    }
  }
}

// Copy up to two channels of `frameCount` frames, from `frameOffset`, as planes.
export function readPlanes(
  sample: Pick<AudioSample, 'numberOfChannels' | 'copyTo'>,
  frameOffset: number,
  frameCount: number
): Float32Array[] {
  const channels: Float32Array[] = []
  for (let channel = 0; channel < Math.min(2, sample.numberOfChannels); channel++) {
    const plane = new Float32Array(frameCount)
    sample.copyTo(plane, { planeIndex: channel, format: 'f32-planar', frameOffset, frameCount })
    channels.push(plane)
  }
  return channels
}

// Encode a whole slice's audio in one go.
export async function encodeAudioSlice(options: AudioEncodeOptions): Promise<number> {
  const writer = new AudioSliceWriter(options)
  try {
    return await writer.finish()
  } finally {
    await writer.dispose()
  }
}
