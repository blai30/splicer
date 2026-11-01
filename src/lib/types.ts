export type Clip = {
  id: string
  file: File
  name: string
  duration: number
  width: number
  height: number
  // Average frames per second, used for frame stepping. Absent on clips
  // created before probing recorded it.
  frameRate?: number
  // Clockwise rotation from the container metadata (0, 90, 180, 270). Absent
  // on clips probed before it was recorded.
  rotation?: number
  objectUrl: string
  // Max-abs audio peaks over the whole clip (see lib/waveform.ts); empty
  // until extracted or when the clip has no audio.
  waveformPeaks: Float32Array
  // Set after waveform extraction; undefined means not yet probed.
  hasAudio?: boolean
  // Average bitrates (bits/sec) and codecs from the import probe. Absent when
  // the probe could not measure them; export then falls back to fixed tables.
  videoBitrate?: number
  videoCodec?: string
  audioBitrate?: number
  audioCodec?: string
}

export type CropParams = {
  x: number
  y: number
  width: number
  height: number
}

export type DragState = {
  segmentId: string
  dropIndex: number
}

export type ExportRecord = {
  id: string
  filename: string
  url: string
  size: number
  duration: number
  fps: Framerate
  width: number
  height: number
  format: ExportFormat
  // The pre-export size estimate, kept to compare against the real size.
  estimatedBytes?: number
  // Set when the file lives in the origin private file system rather than in
  // memory; deleted along with the record.
  storageName?: string
}

export type Segment = {
  id: string
  clipId: string
  startTime: number
  endTime: number
  muted?: boolean
  crop?: CropParams
}

export type SegmentLayoutItem = {
  segment: Segment
  startX: number
  endX: number
}

export type CanvasSize = {
  width: number
  height: number
}

export type Transform = {
  x: number
  y: number
  width: number
  height: number
}

export type Viewport = {
  panX: number
  panY: number
  zoom: number
}

export type Track = {
  id: string
  name: string
  hidden?: boolean
  muted?: boolean
}

// A clip placed in the Advanced (multi-track compositor) project. Phase 1 uses
// at most one; later phases place many across tracks and time.
export type AdvancedSegment = {
  id: string
  clipId: string
  trackId: string
  timelineStart: number
  sourceStart: number
  sourceEnd: number
  transform: Transform
  crop?: CropParams
  opacity?: number
  volume?: number
  muted?: boolean
}

export type ExportFormat = 'mp4' | 'mkv' | 'mov' | 'webm'
export type Quality = 'lossless' | 'high' | 'medium' | 'low'
export type Framerate = 'original' | '60' | '30' | '24'
export type WebmCodec = 'vp9' | 'vp8'
export type MkvCodec = 'h264' | 'vp9'

// MIME type map for exported container formats
export const MIME_TYPES: Record<ExportFormat, string> = {
  mp4: 'video/mp4',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  webm: 'video/webm',
}
