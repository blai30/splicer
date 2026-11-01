import type { MbAudioCodec, MbVideoCodec } from '../exportCodecs'
import {
  coveredSourceBytes,
  sourceEquivalentBitrate,
  type SizeBasis,
  type SourceSlice,
} from './bitrateModel'
import type { CompositorJob, CompositorLayer } from './compositorProtocol'
import { computeEncodeParams } from './editPlan'

export type CompositorLayerPlan = CompositorLayer & {
  // Where this layer begins on the output timeline (microseconds).
  outStartUs: number
}

export type CompositorPlan = {
  outputWidth: number
  outputHeight: number
  frameDurationUs: number | null
  frameRate: number | null
  videoBitrate: number
  audioBitrate: number
  keyFrameIntervalUs: number
  videoCodec: MbVideoCodec
  audioCodec: MbAudioCodec
  hasAudioOutput: boolean
  hasMixedAudio: boolean
  fpsGrid: number
  tracksOrder: string[]
  layers: CompositorLayerPlan[]
  // Frames are emitted on the fps grid, so the encoder sees exactly this rate.
  nominalFrameRate: number
  sizeBasis: SizeBasis
}

const OVERLAP_EPSILON_SEC = 1e-6

// Codecs reject odd dimensions for yuv420; floor to even.
function evenFloor(value: number): number {
  const floored = Math.floor(value)
  return floored % 2 === 0 ? floored : floored - 1
}

// "Original" for a composition: the fastest source frame rate (so no source
// drops frames), rounded and clamped to a sane range; 30 when unknown.
export function originalFrameRate(job: CompositorJob): number {
  let fastest = 0
  for (const layer of job.layers) {
    const rate = job.sources[layer.sourceIndex]?.frameRate ?? 0
    if (Number.isFinite(rate)) fastest = Math.max(fastest, rate)
  }
  if (fastest <= 0) return 30
  return Math.min(120, Math.max(1, Math.round(fastest)))
}

function layerDuration(layer: CompositorLayer): number {
  return Math.max(0, layer.sourceEnd - layer.sourceStart)
}

function visibleArea(layer: CompositorLayer, width: number, height: number): number {
  const { x, y, width: layerWidth, height: layerHeight } = layer.transform
  const overlapWidth = Math.min(width, x + layerWidth) - Math.max(0, x)
  const overlapHeight = Math.min(height, y + layerHeight) - Math.max(0, y)
  return Math.max(0, overlapWidth) * Math.max(0, overlapHeight)
}

function layerSlice(
  job: CompositorJob,
  layer: CompositorLayer,
  width: number,
  height: number
): SourceSlice {
  const source = job.sources[layer.sourceIndex]
  return {
    durationSec: layerDuration(layer),
    displayedPixels: visibleArea(layer, width, height),
    sourceWidth: source?.width ?? 0,
    sourceHeight: source?.height ?? 0,
    videoBitrate: source?.videoBitrate,
    videoCodec: source?.videoCodec,
  }
}

function visibleLayers(job: CompositorJob): CompositorLayer[] {
  return job.layers
    .filter((layer) => layer.opacity > 0 && layerDuration(layer) > 0)
    .sort((first, second) => first.timelineStart - second.timelineStart)
}

// Source slices for a composition that shows one layer at a time (a plain
// sequence, possibly with gaps). Each slice is scaled by the area it covers,
// so a smaller scene centered or letterboxed in the output asks for its share
// of the bits, as Basic does for a fitted clip. Layers shown together
// (picture-in-picture, side by side) mix sources in ways a bitrate mean
// cannot describe, so that returns null and the codec-adjusted table applies.
export function sequentialLayerSlices(
  job: CompositorJob,
  width: number,
  height: number
): SourceSlice[] | null {
  const layers = visibleLayers(job)
  if (layers.length === 0) return null
  let previousEnd = -Infinity
  for (const layer of layers) {
    if (layer.timelineStart < previousEnd - OVERLAP_EPSILON_SEC) return null
    previousEnd = Math.max(previousEnd, layer.timelineStart + layerDuration(layer))
  }
  return layers.map((layer) => layerSlice(job, layer, width, height))
}

// Raw source bits per second of everything on screen, each layer scaled by
// the area it covers, summed while layers play together and averaged over the
// time any layer shows. Only bounds the size estimate: it over-counts layers
// hidden under others, which errs toward a larger file. Null when any visible
// layer lacks a measured bitrate.
export function layeredSourceBitrate(
  job: CompositorJob,
  width: number,
  height: number
): number | null {
  const layers = visibleLayers(job)
  let bits = 0
  let coveredDuration = 0
  let coveredUntil = -Infinity
  for (const layer of layers) {
    const slice = layerSlice(job, layer, width, height)
    const sourcePixels = slice.sourceWidth * slice.sourceHeight
    if (!(slice.videoBitrate && slice.videoBitrate > 0) || !(sourcePixels > 0)) return null
    bits += slice.videoBitrate * (slice.displayedPixels / sourcePixels) * slice.durationSec
    // Layers are sorted by start, so the union of their spans grows in order.
    const end = layer.timelineStart + slice.durationSec
    coveredDuration += Math.max(0, end - Math.max(layer.timelineStart, coveredUntil))
    coveredUntil = Math.max(coveredUntil, end)
  }
  return coveredDuration > 0 ? bits / coveredDuration : null
}

export function buildCompositorPlan(job: CompositorJob): CompositorPlan {
  const outputWidth = evenFloor(job.canvas.width)
  const outputHeight = evenFloor(job.canvas.height)
  const sequentialSlices = sequentialLayerSlices(job, outputWidth, outputHeight)
  const sourceEquivalent = sequentialSlices
    ? sourceEquivalentBitrate(sequentialSlices, job.videoCodec)
    : null
  const sourceAudio = job.audioLayers
    .filter((layer) => job.sources[layer.sourceIndex]?.hasAudio === true)
    .map((layer) => {
      const source = job.sources[layer.sourceIndex]
      return { bitrate: source?.audioBitrate, codec: source?.audioCodec }
    })
  const params = computeEncodeParams(outputWidth, outputHeight, job.fps, job.quality, {
    videoCodec: job.videoCodec,
    audioCodec: job.audioCodec,
    sourceEquivalent,
    sourceAudio,
  })

  const layers: CompositorLayerPlan[] = job.layers.map((layer) => ({
    ...layer,
    outStartUs: Math.round(layer.timelineStart * 1_000_000),
  }))

  const fpsGrid = job.fps === 'original' ? originalFrameRate(job) : Number(job.fps)
  const hasMixedAudio = job.audioLayers.some(
    (layer) => job.sources[layer.sourceIndex]?.hasAudio === true
  )

  return {
    outputWidth,
    outputHeight,
    frameDurationUs: params.frameDurationUs,
    // The compositor already emits frames on its own exact fps grid.
    frameRate: null,
    videoBitrate: params.videoBitrate,
    audioBitrate: params.audioBitrate,
    keyFrameIntervalUs: params.keyFrameIntervalUs,
    videoCodec: job.videoCodec,
    audioCodec: job.audioCodec,
    hasAudioOutput: hasMixedAudio,
    hasMixedAudio,
    fpsGrid,
    tracksOrder: job.tracksOrder,
    layers,
    nominalFrameRate: fpsGrid,
    sizeBasis: {
      durationSec: job.durationSec,
      frameRate: fpsGrid,
      sourceEquivalent,
      sourceBitrateBound: layeredSourceBitrate(job, outputWidth, outputHeight),
      sourceBytes: coveredSourceBytes(
        job.layers.map((layer) => {
          const source = job.sources[layer.sourceIndex]
          return {
            durationSec: layerDuration(layer),
            fileBytes: source?.file.size ?? 0,
            sourceDurationSec: source?.durationSec,
          }
        })
      ),
    },
  }
}
