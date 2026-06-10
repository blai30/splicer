import { VideoSample } from 'mediabunny'

import type { EditPlan, EditSlice } from './editPlan'
import type { SourceReader } from './mediabunnyInput'
import type { OutputHandle } from './mediabunnyOutput'

export type VideoEncodeOptions = {
  reader: SourceReader
  slice: EditSlice
  plan: EditPlan
  out: OutputHandle
  onFrameEncoded: () => void
  shouldCancel: () => boolean
}

// Encode one timeline slice's video: read the slice's source time range, retime
// each frame onto the output timeline, crop/scale through a fixed-size canvas so
// every output frame is uniform, and feed it to the mediabunny video source
// (which encodes and muxes). FPS resampling drops frames that fall in the same
// output slot. mediabunny handles keyframe cadence and encoder backpressure.
export async function encodeVideoSlice(options: VideoEncodeOptions): Promise<void> {
  const { reader, slice, plan, out, onFrameEncoded, shouldCancel } = options
  const outWidth = plan.outputWidth
  const outHeight = plan.outputHeight

  const canvas = new OffscreenCanvas(outWidth, outHeight)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No 2D canvas context available for video encoding')

  const sliceStartUs = slice.sourceStart * 1_000_000
  let lastEmittedUs = Number.NEGATIVE_INFINITY

  for await (const sample of reader.videoSink.samples(slice.sourceStart, slice.sourceEnd)) {
    if (shouldCancel()) {
      sample.close()
      throw new Error('canceled')
    }

    // samples() may yield a leading frame outside the requested range (needed for
    // decode); only emit frames whose presentation time is inside the slice.
    if (sample.timestamp < slice.sourceStart || sample.timestamp >= slice.sourceEnd) {
      sample.close()
      continue
    }

    const outTsUs = slice.outStartTimestampUs + (sample.microsecondTimestamp - sliceStartUs)

    if (plan.frameDurationUs) {
      if (outTsUs - lastEmittedUs < plan.frameDurationUs) {
        sample.close()
        continue
      }
      lastEmittedUs = outTsUs
    }

    const outDurationUs = plan.frameDurationUs ?? Math.round(sample.duration * 1_000_000)

    ctx.clearRect(0, 0, outWidth, outHeight)
    if (slice.crop) {
      const { x, y, width, height } = slice.crop
      sample.draw(ctx, x, y, width, height, 0, 0, outWidth, outHeight)
    } else {
      sample.draw(ctx, 0, 0, outWidth, outHeight)
    }
    sample.close()

    const outSample = new VideoSample(canvas, {
      timestamp: outTsUs / 1_000_000,
      duration: outDurationUs / 1_000_000,
    })
    await out.videoSource.add(outSample)
    outSample.close()
    onFrameEncoded()
  }
}
