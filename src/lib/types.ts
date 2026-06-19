export type Clip = {
  id: string
  file: File
  name: string
  duration: number
  width: number
  height: number
  objectUrl: string
  waveformPeaks: number[]
  // Set after waveform extraction; undefined means not yet probed.
  hasAudio?: boolean
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
