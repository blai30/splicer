export interface Clip {
  id: string
  file: File
  name: string
  duration: number
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

export type ExportFormat = 'mp4' | 'webm' | 'mkv'
