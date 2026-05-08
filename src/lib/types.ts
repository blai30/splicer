export interface Clip {
  id: string
  file: File
  name: string
  duration: number
  width: number
  height: number
  objectUrl: string
  thumbnail: string
}

export interface CropParams {
  x: number
  y: number
  width: number
  height: number
}

export interface Segment {
  id: string
  clipId: string
  startTime: number
  endTime: number
  muted: boolean
  crop?: CropParams
}

export interface ExportRecord {
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

export type ExportFormat = 'mp4' | 'webm' | 'mkv'
export type Quality = 'lossless' | 'high' | 'medium' | 'low'
export type Framerate = 'original' | '60' | '30' | '24'
