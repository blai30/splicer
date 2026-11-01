import type { MbAudioCodec, MbContainer, MbVideoCodec } from '../exportCodecs'
import type { CropParams, ExportFormat, Framerate, Quality, Transform } from '../types'
import type { JobSource, WorkerResponse } from './protocol'

// One placed clip to composite. timelineStart is where it begins on the output
// timeline (seconds); transform is its destination box on the project canvas.
export type CompositorLayer = {
  sourceIndex: number
  sourceStart: number
  sourceEnd: number
  timelineStart: number
  trackId: string
  transform: Transform
  crop?: CropParams
  muted: boolean
  opacity: number
}

export type CompositorAudioLayer = {
  sourceIndex: number
  sourceStart: number
  sourceEnd: number
  timelineStart: number
  volume: number
}

export type CompositorJob = {
  canvas: { width: number; height: number }
  sources: JobSource[]
  layers: CompositorLayer[]
  tracksOrder: string[]
  // Every audible placement, including ones on hidden (video-off) tracks.
  audioLayers: CompositorAudioLayer[]
  // Output length in seconds. Covers all placements, so audio on a hidden
  // track that outlasts the visible clips keeps the video running (black).
  durationSec: number
  quality: Quality
  fps: Framerate
  format: ExportFormat
  container: MbContainer
  videoCodec: MbVideoCodec
  audioCodec: MbAudioCodec
}

export type CompositorWorkerRequest = { type: 'export'; job: CompositorJob } | { type: 'cancel' }

export type { WorkerResponse }
