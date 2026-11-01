import { AudioSample } from 'mediabunny'

import { normalizeAudio } from './audioNormalize'
import type { EditSlice } from './editPlan'
import type { SourceReader } from './mediabunnyInput'
import { OUTPUT_CHANNELS, OUTPUT_SAMPLE_RATE, type OutputHandle } from './mediabunnyOutput'

export type AudioEncodeOptions = {
  reader: SourceReader | null
  slice: EditSlice
  out: OutputHandle
  shouldCancel: () => boolean
}

// Seconds of silence per generated chunk.
const SILENCE_CHUNK_SEC = 0.5
// Ignore sub-sample timing gaps when deciding whether to pad with silence.
const GAP_EPSILON_SEC = 1 / OUTPUT_SAMPLE_RATE

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

async function addSilence(out: OutputHandle, from: number, to: number): Promise<void> {
  if (!out.audioSource) return
  let cursor = from
  while (to - cursor > GAP_EPSILON_SEC) {
    const seconds = Math.min(SILENCE_CHUNK_SEC, to - cursor)
    const frames = Math.round(seconds * OUTPUT_SAMPLE_RATE)
    if (frames <= 0) break
    const silence = new AudioSample({
      format: 'f32-planar',
      sampleRate: OUTPUT_SAMPLE_RATE,
      numberOfChannels: OUTPUT_CHANNELS,
      timestamp: cursor,
      data: new Float32Array(frames * OUTPUT_CHANNELS),
    })
    try {
      await out.audioSource.add(silence)
    } finally {
      silence.close()
    }
    cursor += frames / OUTPUT_SAMPLE_RATE
  }
}

// Encode one timeline slice's audio so it exactly covers the slice's output
// span. Decoded samples are trimmed at the cut points, retimed onto the output
// timeline, and any gap (muted slice, source without audio, audio that starts
// late or ends early) is filled with silence. This keeps every following slice
// in sync with the video.
export async function encodeAudioSlice(options: AudioEncodeOptions): Promise<void> {
  const { reader, slice, out, shouldCancel } = options
  if (!out.audioSource) return

  const outStart = slice.outStartTimestampUs / 1_000_000
  const outEnd = outStart + (slice.sourceEnd - slice.sourceStart)
  const sink = reader?.audioSink

  if (slice.muted || !sink) {
    await addSilence(out, outStart, outEnd)
    return
  }

  // Output time up to which audio has been written.
  let cursor = outStart
  for await (const sample of sink.samples(slice.sourceStart, slice.sourceEnd)) {
    try {
      if (shouldCancel()) throw new Error('canceled')
      // Start no earlier than what is already written, so samples never overlap.
      const windowStart = slice.sourceStart + (cursor - outStart)
      const range = audioFrameRange(
        sample.timestamp,
        sample.numberOfFrames,
        sample.sampleRate,
        windowStart,
        slice.sourceEnd
      )
      if (!range) continue
      const sampleOutStart =
        outStart + (sample.timestamp + range.startFrame / sample.sampleRate - slice.sourceStart)
      if (sampleOutStart - cursor > GAP_EPSILON_SEC) await addSilence(out, cursor, sampleOutStart)

      const frameCount = range.endFrame - range.startFrame
      const channels: Float32Array[] = []
      for (let channel = 0; channel < sample.numberOfChannels; channel++) {
        const plane = new Float32Array(frameCount)
        sample.copyTo(plane, {
          planeIndex: channel,
          format: 'f32-planar',
          frameOffset: range.startFrame,
          frameCount,
        })
        channels.push(plane)
      }
      const normalized = normalizeAudio(
        { sampleRate: sample.sampleRate, channels },
        OUTPUT_SAMPLE_RATE
      )
      if (normalized.frames === 0) continue
      const writeAt = Math.max(cursor, sampleOutStart)
      const piece = new AudioSample({
        format: 'f32-planar',
        sampleRate: OUTPUT_SAMPLE_RATE,
        numberOfChannels: OUTPUT_CHANNELS,
        timestamp: writeAt,
        data: normalized.data,
      })
      try {
        await out.audioSource.add(piece)
      } finally {
        piece.close()
      }
      cursor = writeAt + normalized.frames / OUTPUT_SAMPLE_RATE
    } finally {
      sample.close()
    }
  }
  if (outEnd - cursor > GAP_EPSILON_SEC) await addSilence(out, cursor, outEnd)
}
