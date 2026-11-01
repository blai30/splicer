import type { MbAudioCodec, MbVideoCodec } from '../exportCodecs'
import {
  coveredSourceBytes,
  fitTargetSize,
  sourceEquivalentBitrate,
  type SizeBasis,
  type SourceSlice,
  type TargetSizeFit,
} from './bitrateModel'
import type { CompositorJob, CompositorLayer } from './compositorProtocol'
import { bitrateModeFor, computeEncodeParams, type BitrateMode } from './editPlan'
import { capShortSide, evenFloor, type Size } from './outputSize'

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
  bitrateMode: BitrateMode
  targetFit: TargetSizeFit | null
}

const OVERLAP_EPSILON_SEC = 1e-6

// The job with every layer placed on an output of `size` instead of the
// project canvas, for a resolution cap or a target size that shrinks it.
export function scaleCompositorJob(job: CompositorJob, size: Size): CompositorJob {
  const scaleX = size.width / Math.max(1, job.canvas.width)
  const scaleY = size.height / Math.max(1, job.canvas.height)
  if (scaleX === 1 && scaleY === 1) return job
  return {
    ...job,
    canvas: { ...size },
    layers: job.layers.map((layer) => ({
      ...layer,
      transform: {
        x: layer.transform.x * scaleX,
        y: layer.transform.y * scaleY,
        width: layer.transform.width * scaleX,
        height: layer.transform.height * scaleY,
      },
    })),
  }
}

// Output size before any target size fit: the canvas, even, with the
// resolution cap applied.
export function compositorOutputSize(job: CompositorJob): Size {
  return capShortSide(
    { width: evenFloor(job.canvas.width), height: evenFloor(job.canvas.height) },
    job.maxShortSide
  )
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

export function buildCompositorPlan(projectJob: CompositorJob): CompositorPlan {
  const sourceAudio = projectJob.audioLayers
    .filter((layer) => projectJob.sources[layer.sourceIndex]?.hasAudio === true)
    .map((layer) => {
      const source = projectJob.sources[layer.sourceIndex]
      return { bitrate: source?.audioBitrate, codec: source?.audioCodec }
    })
  const paramsAt = (size: Size) => {
    const scaled = scaleCompositorJob(projectJob, size)
    const sequentialSlices = sequentialLayerSlices(scaled, size.width, size.height)
    const sourceEquivalent = sequentialSlices
      ? sourceEquivalentBitrate(sequentialSlices, projectJob.videoCodec)
      : null
    const params = computeEncodeParams(
      size.width,
      size.height,
      projectJob.fps,
      projectJob.quality,
      {
        videoCodec: projectJob.videoCodec,
        audioCodec: projectJob.audioCodec,
        sourceEquivalent,
        sourceAudio,
      }
    )
    return { job: scaled, sourceEquivalent, params }
  }

  const hasMixedAudio = projectJob.audioLayers.some(
    (layer) => projectJob.sources[layer.sourceIndex]?.hasAudio === true
  )
  let size = compositorOutputSize(projectJob)
  let fpsGrid =
    projectJob.fps === 'original' ? originalFrameRate(projectJob) : Number(projectJob.fps)
  let { job, sourceEquivalent, params } = paramsAt(size)
  let targetFit: TargetSizeFit | null = null
  if (projectJob.targetBytes) {
    targetFit = fitTargetSize({
      targetBytes: projectJob.targetBytes,
      durationSec: projectJob.durationSec,
      size,
      frameRate: fpsGrid,
      videoCodec: projectJob.videoCodec,
      audioCodec: projectJob.audioCodec,
      sourceAudio,
      hasAudio: hasMixedAudio,
      sourceBitrateBound: layeredSourceBitrate(job, size.width, size.height),
      maxVideoBitrate: (candidate) => paramsAt(candidate).params.videoBitrate,
    })
    size = targetFit.size
    ;({ job, sourceEquivalent, params } = paramsAt(size))
    params = {
      ...params,
      videoBitrate: targetFit.videoBitrate,
      audioBitrate: targetFit.audioBitrate,
    }
    if (targetFit.frameRateLowered) fpsGrid = targetFit.frameRate
  }
  const outputWidth = size.width
  const outputHeight = size.height

  const layers: CompositorLayerPlan[] = job.layers.map((layer) => ({
    ...layer,
    outStartUs: Math.round(layer.timelineStart * 1_000_000),
  }))

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
    bitrateMode: bitrateModeFor(job.videoCodec, targetFit !== null),
    targetFit,
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
