import { VideoSample } from 'mediabunny'

import type { CompositorLayerPlan, CompositorPlan } from './compositorPlan'
import type { SourceReader } from './mediabunnyInput'
import type { OutputHandle } from './mediabunnyOutput'

export type LayerDecoder = {
  layer: CompositorLayerPlan
  reader: SourceReader
}

type LayerCursor = {
  layer: CompositorLayerPlan
  iterator: AsyncIterator<import('mediabunny').VideoSample>
  current: import('mediabunny').VideoSample | null
  done: boolean
}

function layerEndSec(layer: CompositorLayerPlan): number {
  return layer.timelineStart + (layer.sourceEnd - layer.sourceStart)
}

// Walk the output timeline at a fixed fps grid. For each frame, advance each
// active layer's decoder to the frame covering the needed source time, draw the
// active layers bottom lane first, and encode the canvas.
export async function encodeCompositedVideo(
  decoders: LayerDecoder[],
  plan: CompositorPlan,
  canvas: OffscreenCanvas,
  ctx: OffscreenCanvasRenderingContext2D,
  out: OutputHandle,
  durationSec: number,
  onFrameEncoded: () => void,
  shouldCancel: () => boolean
): Promise<void> {
  const laneRank = new Map<string, number>()
  plan.tracksOrder.forEach((trackId, index) =>
    laneRank.set(trackId, plan.tracksOrder.length - index)
  )
  const ordered = [...decoders].sort(
    (first, second) =>
      (laneRank.get(first.layer.trackId) ?? 0) - (laneRank.get(second.layer.trackId) ?? 0)
  )

  const cursors: LayerCursor[] = ordered.map((decoder) => ({
    layer: decoder.layer,
    iterator: decoder.reader.videoSink
      .samples(decoder.layer.sourceStart, decoder.layer.sourceEnd)
      [Symbol.asyncIterator](),
    current: null,
    done: false,
  }))

  const frameDurationSec = 1 / plan.fpsGrid
  const totalFrames = Math.max(1, Math.ceil(durationSec * plan.fpsGrid))

  try {
    for (let frame = 0; frame < totalFrames; frame++) {
      if (shouldCancel()) throw new Error('canceled')
      const tSec = frame * frameDurationSec

      ctx.clearRect(0, 0, plan.outputWidth, plan.outputHeight)
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, plan.outputWidth, plan.outputHeight)

      for (const cursor of cursors) {
        const layer = cursor.layer
        const active = tSec >= layer.timelineStart && tSec < layerEndSec(layer)
        if (!active) continue
        const neededSource = layer.sourceStart + (tSec - layer.timelineStart)

        // Advance until the current sample covers neededSource.
        while (!cursor.done) {
          if (cursor.current && cursor.current.timestamp + cursor.current.duration > neededSource) {
            break
          }
          const next = await cursor.iterator.next()
          if (next.done) {
            cursor.done = true
            break
          }
          if (cursor.current) cursor.current.close()
          cursor.current = next.value
        }

        if (!cursor.current) continue
        ctx.globalAlpha = layer.opacity
        const transform = layer.transform
        if (layer.crop) {
          cursor.current.draw(
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
          cursor.current.draw(ctx, transform.x, transform.y, transform.width, transform.height)
        }
        ctx.globalAlpha = 1
      }

      const outSample = new VideoSample(canvas, {
        timestamp: tSec,
        duration: frameDurationSec,
      })
      await out.videoSource.add(outSample)
      outSample.close()
      onFrameEncoded()
    }
  } finally {
    for (const cursor of cursors) {
      if (cursor.current) cursor.current.close()
      await cursor.iterator.return?.(undefined)
    }
  }
}
