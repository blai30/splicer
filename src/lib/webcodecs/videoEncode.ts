import { VideoSample } from 'mediabunny'

import type { EditPlan, EditSlice } from './editPlan'
import { isPassThroughFrame } from './framePassthrough'
import type { SourceReader } from './mediabunnyInput'
import type { OutputHandle } from './mediabunnyOutput'

export type VideoEncodeOptions = {
  reader: SourceReader
  slice: EditSlice
  plan: EditPlan
  out: OutputHandle
  // Called with the output time (seconds) reached after each encoded frame.
  onFrameEncoded: (outTimeSec: number) => void
  shouldCancel: () => boolean
  // The slice passed canPassThrough: frames that also pass the per-frame
  // check skip the canvas.
  passThrough?: boolean
}

// Fallback frame length when a decoded sample reports no duration.
const FALLBACK_FRAME_SEC = 1 / 30

export type FrameSpan = { start: number; end: number }

// Map a source frame [timestamp, timestamp + duration) onto the slice's output
// span, clipped to [sourceStart, sourceEnd). Returns null when it does not
// overlap the slice. Times are seconds; outStart is the slice's output origin.
export function frameOutputSpan(
  timestamp: number,
  duration: number,
  sourceStart: number,
  sourceEnd: number,
  outStart: number
): FrameSpan | null {
  const frameEnd = timestamp + (duration > 0 ? duration : FALLBACK_FRAME_SEC)
  const start = Math.max(timestamp, sourceStart)
  const end = Math.min(frameEnd, sourceEnd)
  if (end <= start) return null
  return { start: outStart + (start - sourceStart), end: outStart + (end - sourceStart) }
}

// Encode one timeline slice's video. Each source frame overlapping the slice is
// drawn contain-fitted (crop applied, rotation honored) onto a fixed-size black
// canvas and emitted at its retimed output position; frames that already match
// the output (see framePassthrough.ts) are retimed and sent as decoded. The
// slice is gap-free on the output timeline: the first frame is stretched back
// to the slice start and the last frame forward to the slice end, so
// concatenated slices stay in sync with audio. Constant frame rate output is
// handled by the video source.
export async function encodeVideoSlice(options: VideoEncodeOptions): Promise<void> {
  const { reader, slice, plan, out, onFrameEncoded, shouldCancel } = options
  const outWidth = plan.outputWidth
  const outHeight = plan.outputHeight
  const sliceCanPassThrough = options.passThrough ?? false

  // Created on the first frame that needs drawing, so passthrough slices never
  // allocate one.
  let drawing: { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } | null = null
  function blackCanvas() {
    if (!drawing) {
      const canvas = new OffscreenCanvas(outWidth, outHeight)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('No 2D canvas context available for video encoding')
      drawing = { canvas, ctx }
    }
    drawing.ctx.fillStyle = '#000'
    drawing.ctx.fillRect(0, 0, outWidth, outHeight)
    return drawing
  }

  const outStart = slice.outStartTimestampUs / 1_000_000
  const outEnd = outStart + (slice.sourceEnd - slice.sourceStart)
  // A frame held back until we know where the next one starts. It owns its
  // sample: a canvas snapshot, or a decoded frame handed over by the loop.
  let pending: VideoSample | null = null
  let emittedAny = false

  async function flush(nextStart: number) {
    if (!pending) return
    const sample = pending
    pending = null
    emittedAny = true
    sample.setDuration(Math.max(0, nextStart - sample.timestamp))
    try {
      if (sample.duration > 0) {
        await out.videoSource.add(sample)
        onFrameEncoded(nextStart)
      }
    } finally {
      sample.close()
    }
  }

  try {
    for await (const sample of reader.videoSink.samples(slice.sourceStart, slice.sourceEnd)) {
      // Cleared when ownership moves to `pending`, so the frame is closed once.
      let owned: VideoSample | null = sample
      try {
        if (shouldCancel()) throw new Error('canceled')
        const span = frameOutputSpan(
          sample.timestamp,
          sample.duration,
          slice.sourceStart,
          slice.sourceEnd,
          outStart
        )
        if (!span) continue
        const frameStart: number = pending ? span.start : outStart

        if (sliceCanPassThrough && isPassThroughFrame(sample, plan)) {
          await flush(frameStart)
          sample.setTimestamp(frameStart)
          sample.setDuration(0)
          pending = sample
          owned = null
          continue
        }

        const { canvas, ctx } = blackCanvas()
        sample.drawWithFit(ctx, {
          fit: 'contain',
          crop: slice.crop
            ? {
                left: slice.crop.x,
                top: slice.crop.y,
                width: slice.crop.width,
                height: slice.crop.height,
              }
            : undefined,
        })
        await flush(frameStart)
        pending = new VideoSample(canvas, { timestamp: frameStart, duration: 0 })
      } finally {
        owned?.close()
      }
    }
    if (!pending && !emittedAny) {
      // The source has no frames in this range (e.g. its audio outlasts its
      // video): hold black so the output timeline stays continuous.
      pending = new VideoSample(blackCanvas().canvas, { timestamp: outStart, duration: 0 })
    }
    await flush(outEnd)
  } finally {
    pending?.close()
  }
}
