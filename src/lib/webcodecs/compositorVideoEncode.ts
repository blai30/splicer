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
  reader: SourceReader
  // Created when the layer first shows and released when it ends, so only
  // layers on screen hold a decoder.
  iterator: AsyncIterator<VideoSample> | null
  current: VideoSample | null
  done: boolean
}

function layerEndSec(layer: CompositorLayerPlan): number {
  return layer.timelineStart + (layer.sourceEnd - layer.sourceStart)
}

export type OcclusionLayer = {
  opacity: number
  transform: { x: number; y: number; width: number; height: number }
  // From the decoded frame; null when unknown.
  hasAlpha: boolean | null
}

// Index of the lowest layer worth drawing, for layers ordered bottom first:
// the topmost one that is opaque and covers the whole canvas hides everything
// under it (and the black background), so those draws can be skipped.
export function firstVisibleLayerIndex(
  layers: OcclusionLayer[],
  width: number,
  height: number
): number {
  for (let index = layers.length - 1; index >= 0; index--) {
    const { opacity, transform, hasAlpha } = layers[index]
    const covers =
      transform.x <= 0 &&
      transform.y <= 0 &&
      transform.x + transform.width >= width &&
      transform.y + transform.height >= height
    if (covers && opacity >= 1 && hasAlpha === false) return index
  }
  return 0
}

async function releaseCursor(cursor: LayerCursor): Promise<void> {
  cursor.done = true
  cursor.current?.close()
  cursor.current = null
  const iterator = cursor.iterator
  cursor.iterator = null
  await iterator?.return?.(undefined)
}

// Advance the cursor until its current sample covers `neededSource`.
async function advanceCursor(cursor: LayerCursor, neededSource: number): Promise<void> {
  const { layer } = cursor
  cursor.iterator ??= cursor.reader.videoSink
    .samples(layer.sourceStart, layer.sourceEnd)
    [Symbol.asyncIterator]()
  while (!cursor.done) {
    if (cursor.current && cursor.current.timestamp + cursor.current.duration > neededSource) {
      return
    }
    const next = await cursor.iterator.next()
    if (next.done) {
      // The last frame stays on screen until the layer ends.
      cursor.done = true
      return
    }
    cursor.current?.close()
    cursor.current = next.value
  }
}

function drawLayer(
  ctx: OffscreenCanvasRenderingContext2D,
  layer: CompositorLayerPlan,
  sample: VideoSample
) {
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
}

// Walk the output timeline at a fixed fps grid. For each frame, advance each
// active layer's decoder to the frame covering the needed source time, draw the
// visible active layers bottom lane first, and encode the canvas.
export async function encodeCompositedVideo(
  decoders: LayerDecoder[],
  plan: CompositorPlan,
  canvas: OffscreenCanvas,
  ctx: OffscreenCanvasRenderingContext2D,
  out: OutputHandle,
  durationSec: number,
  // Awaited with the output time reached, so other tracks can keep pace.
  onFrameEncoded: (outTimeSec: number) => void | Promise<void>,
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
    reader: decoder.reader,
    iterator: null,
    current: null,
    done: false,
  }))

  const frameDurationSec = 1 / plan.fpsGrid
  const totalFrames = Math.max(1, Math.ceil(durationSec * plan.fpsGrid))

  try {
    for (let frame = 0; frame < totalFrames; frame++) {
      if (shouldCancel()) throw new Error('canceled')
      const tSec = frame * frameDurationSec

      // Bottom first; hidden layers still advance so they are in place when
      // the layer above them moves away.
      const shown: LayerCursor[] = []
      for (const cursor of cursors) {
        const layer = cursor.layer
        if (tSec < layer.timelineStart) continue
        if (tSec >= layerEndSec(layer)) {
          if (cursor.iterator || cursor.current) await releaseCursor(cursor)
          continue
        }
        await advanceCursor(cursor, layer.sourceStart + (tSec - layer.timelineStart))
        if (cursor.current) shown.push(cursor)
      }

      // The fill covers the whole canvas, so no clearRect is needed.
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, plan.outputWidth, plan.outputHeight)
      const firstVisible = firstVisibleLayerIndex(
        shown.map((cursor) => ({
          opacity: cursor.layer.opacity,
          transform: cursor.layer.transform,
          hasAlpha: cursor.current!.hasAlpha,
        })),
        plan.outputWidth,
        plan.outputHeight
      )
      for (const cursor of shown.slice(firstVisible)) drawLayer(ctx, cursor.layer, cursor.current!)

      const outSample = new VideoSample(canvas, {
        timestamp: tSec,
        duration: frameDurationSec,
      })
      await out.videoSource.add(outSample)
      outSample.close()
      await onFrameEncoded(tSec + frameDurationSec)
    }
  } finally {
    for (const cursor of cursors) await releaseCursor(cursor)
  }
}
