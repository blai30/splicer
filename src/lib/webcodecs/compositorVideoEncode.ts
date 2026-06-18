import { VideoSample } from 'mediabunny'

import type { CompositorLayerPlan, CompositorPlan } from './compositorPlan'
import type { SourceReader } from './mediabunnyInput'
import type { OutputHandle } from './mediabunnyOutput'

export type CompositorVideoOptions = {
  reader: SourceReader
  layer: CompositorLayerPlan
  plan: CompositorPlan
  canvas: OffscreenCanvas
  ctx: OffscreenCanvasRenderingContext2D
  out: OutputHandle
  onFrameEncoded: () => void
  shouldCancel: () => boolean
}

// Encode one layer's video onto the project canvas: read its source time range,
// retime each frame onto the output timeline, clear the canvas to black, and
// draw the frame at the layer's transform (honoring crop and opacity). For a
// single layer this produces the full output; Phase 2 replaces this with a
// frame-driven loop that composites multiple active layers per output frame.
export async function encodeCompositedLayerVideo(options: CompositorVideoOptions): Promise<void> {
  const { reader, layer, plan, canvas, ctx, out, onFrameEncoded, shouldCancel } = options
  const outWidth = plan.outputWidth
  const outHeight = plan.outputHeight
  const sliceStartUs = layer.sourceStart * 1_000_000
  let lastEmittedUs = Number.NEGATIVE_INFINITY

  for await (const sample of reader.videoSink.samples(layer.sourceStart, layer.sourceEnd)) {
    if (shouldCancel()) {
      sample.close()
      throw new Error('canceled')
    }
    if (sample.timestamp < layer.sourceStart || sample.timestamp >= layer.sourceEnd) {
      sample.close()
      continue
    }

    const outTsUs = layer.outStartUs + (sample.microsecondTimestamp - sliceStartUs)
    if (plan.frameDurationUs) {
      if (outTsUs - lastEmittedUs < plan.frameDurationUs) {
        sample.close()
        continue
      }
      lastEmittedUs = outTsUs
    }
    const outDurationUs = plan.frameDurationUs ?? Math.round(sample.duration * 1_000_000)

    ctx.clearRect(0, 0, outWidth, outHeight)
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, outWidth, outHeight)

    ctx.globalAlpha = layer.opacity
    const transform = layer.transform
    if (layer.crop) {
      sample.draw(
        ctx,
        layer.crop.x,
        layer.crop.y,
        layer.crop.width,
        layer.crop.height,
        transform.x,
        transform.y,
        transform.width,
        transform.height
      )
    } else {
      sample.draw(ctx, transform.x, transform.y, transform.width, transform.height)
    }
    ctx.globalAlpha = 1
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
