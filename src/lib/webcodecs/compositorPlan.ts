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

export function buildCompositorPlan(job: CompositorJob): CompositorPlan {
  const outputWidth = evenFloor(job.canvas.width)
  const outputHeight = evenFloor(job.canvas.height)
  const params = computeEncodeParams(outputWidth, outputHeight, job.fps, job.quality)

  const layers: CompositorLayerPlan[] = job.layers.map((layer) => ({
    ...layer,
    outStartUs: Math.round(layer.timelineStart * 1_000_000),
  }))

  const fpsGrid = job.fps === 'original' ? 30 : Number(job.fps)
  const hasMixedAudio = job.mixedAudio != null && job.mixedAudio.channelData.length > 0

  return {
    outputWidth,
    outputHeight,
    frameDurationUs: params.frameDurationUs,
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
