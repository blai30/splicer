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

// A layer this close to covering the frame stands for the whole picture.
const DOMINANT_COVERAGE = 0.9
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

// Source slices for a composition that is one full-frame clip at a time (a
// plain sequence, possibly with gaps). Anything else (picture-in-picture,
// side-by-side, small clips) mixes sources in ways a bitrate mean cannot
// describe, so it returns null and the codec-adjusted table applies.
export function dominantLayerSlices(
  job: CompositorJob,
  width: number,
  height: number
): SourceSlice[] | null {
  const layers = job.layers
    .filter((layer) => layer.opacity > 0 && layerDuration(layer) > 0)
    .sort((first, second) => first.timelineStart - second.timelineStart)
  if (layers.length === 0) return null
  const frameArea = width * height
  let previousEnd = -Infinity
  const slices: SourceSlice[] = []
  for (const layer of layers) {
    if (layer.timelineStart < previousEnd - OVERLAP_EPSILON_SEC) return null
    previousEnd = Math.max(previousEnd, layer.timelineStart + layerDuration(layer))
    const displayedPixels = visibleArea(layer, width, height)
    if (displayedPixels < frameArea * DOMINANT_COVERAGE) return null
    const source = job.sources[layer.sourceIndex]
    slices.push({
      durationSec: layerDuration(layer),
      displayedPixels,
      sourceWidth: source?.width ?? 0,
      sourceHeight: source?.height ?? 0,
      videoBitrate: source?.videoBitrate,
      videoCodec: source?.videoCodec,
    })
  }
  return slices
}

export function buildCompositorPlan(job: CompositorJob): CompositorPlan {
  const outputWidth = evenFloor(job.canvas.width)
  const outputHeight = evenFloor(job.canvas.height)
  const dominantSlices = dominantLayerSlices(job, outputWidth, outputHeight)
  const sourceEquivalent = dominantSlices
    ? sourceEquivalentBitrate(dominantSlices, job.videoCodec)
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
