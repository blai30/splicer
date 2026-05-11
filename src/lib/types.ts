export type Clip = {
  id: string
  file: File
  name: string
  duration: number
  width: number
  height: number
  objectUrl: string
  waveformPeaks: number[]
}

export type CropParams = {
  x: number
  y: number
  width: number
  height: number
}

export type DragState = {
  segId: string
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
  muted: boolean
  crop?: CropParams
}

export type SegmentLayoutItem = {
  seg: Segment
  startX: number
  endX: number
}

export type ExportFormat = 'mp4' | 'webm' | 'mkv'
export type Quality = 'lossless' | 'high' | 'medium' | 'low'
export type Framerate = 'original' | '60' | '30' | '24'
