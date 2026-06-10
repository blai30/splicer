import type { CropParams, Framerate, Quality, WebmCodec } from '../types'

// One distinct source file referenced by the timeline.
export type JobSource = {
  file: File
  width: number
  height: number
  hasAudio: boolean
}

// One timeline segment resolved against its source. sourceStart/sourceEnd are
// in seconds (matching Segment.startTime/endTime).
export type JobSlice = {
  sourceIndex: number
  sourceStart: number
  sourceEnd: number
  crop?: CropParams
  muted: boolean
}

// The serializable job posted to the worker.
export type ExportJob = {
  sources: JobSource[]
  slices: JobSlice[]
  quality: Quality
  fps: Framerate
  webmCodec: WebmCodec
}

export type WorkerRequest = { type: 'export'; job: ExportJob } | { type: 'cancel' }

export type WorkerResponse =
  | { type: 'progress'; progress: number }
  | { type: 'done'; buffer: ArrayBuffer }
  | { type: 'canceled' }
  | { type: 'error'; message: string; unsupported: boolean }

// Thrown by a demuxer when the source uses a shape outside the bounded subset
// this engine handles (lacing, unknown codec, etc.). The worker reports it with
// unsupported: true so the router falls back to ffmpeg.
export class UnsupportedSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedSourceError'
  }
}
