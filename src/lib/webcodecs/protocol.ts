import type { MbAudioCodec, MbContainer, MbVideoCodec } from '../exportCodecs'
import type { Clip, CropParams, ExportFormat, Framerate, Quality } from '../types'

// One distinct source file referenced by the timeline.
export type JobSource = {
  file: File
  width: number
  height: number
  hasAudio: boolean
  // Average source frame rate, when known.
  frameRate?: number
  // Clockwise container rotation; display width/height already include it.
  rotation?: number
  // Probed source stats, when known. They let the bitrate model aim relative
  // to the source instead of a fixed table, and let the UI compare sizes.
  durationSec?: number
  videoBitrate?: number
  videoCodec?: string
  audioBitrate?: number
  audioCodec?: string
}

export function jobSourceFromClip(clip: Clip): JobSource {
  return {
    file: clip.file,
    width: clip.width,
    height: clip.height,
    hasAudio: clip.hasAudio !== false,
    frameRate: clip.frameRate,
    rotation: clip.rotation,
    durationSec: clip.duration,
    videoBitrate: clip.videoBitrate,
    videoCodec: clip.videoCodec,
    audioBitrate: clip.audioBitrate,
    audioCodec: clip.audioCodec,
  }
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
  format: ExportFormat
  container: MbContainer
  videoCodec: MbVideoCodec
  audioCodec: MbAudioCodec
}

// Where streamed exports live in the origin private file system. Each tab
// writes under its own folder (see exportStorage.ts) so a startup sweep in one
// tab never deletes another tab's files.
export const EXPORTS_DIR = 'exports'

// storageDir names this tab's folder for streamed exports (see
// exportStorage.ts); without it the export is built in memory.
export type WorkerRequest =
  | { type: 'export'; job: ExportJob; storageDir?: string }
  | { type: 'cancel' }

export type WorkerResponse =
  | { type: 'progress'; progress: number }
  // The streamed file an export writes into, sent before any data so the page
  // can delete it if it terminates the worker mid-export.
  | { type: 'storage'; storageName: string }
  // A file streamed to the origin private file system; storageName is its
  // path under the exports folder, for deleting it later.
  | { type: 'done'; file: File; storageName: string }
  | { type: 'done'; buffer: ArrayBuffer }
  | { type: 'canceled' }
  | { type: 'error'; message: string; unsupported: boolean }

// Thrown by a demuxer when the source uses a shape outside the bounded subset
// this engine handles (lacing, unknown codec, etc.). The worker reports it with
// unsupported: true so the export surfaces an honest error.
export class UnsupportedSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedSourceError'
  }
}
