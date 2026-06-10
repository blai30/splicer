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

export type ExportFormat = 'mp4' | 'mkv' | 'mov' | 'avi' | 'webm'
export type Quality = 'lossless' | 'high' | 'medium' | 'low'
export type Framerate = 'original' | '60' | '30' | '24'
export type WebmCodec = 'vp9' | 'vp8'

// MIME type map for exported container formats
export const MIME_TYPES: Record<ExportFormat, string> = {
  mp4: 'video/mp4',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  webm: 'video/webm',
}
