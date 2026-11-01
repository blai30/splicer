import type { MbAudioCodec, MbVideoCodec } from '../exportCodecs'
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
}

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

export function buildCompositorPlan(job: CompositorJob): CompositorPlan {
  const outputWidth = evenFloor(job.canvas.width)
  const outputHeight = evenFloor(job.canvas.height)
  const params = computeEncodeParams(outputWidth, outputHeight, job.fps, job.quality)

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
  }
}
