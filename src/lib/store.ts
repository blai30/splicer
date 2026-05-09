import { signal } from '@preact/signals'
import type { Clip, ExportFormat, ExportRecord, Framerate, Quality, Segment } from '@/lib/types'

export const clips = signal<Clip[]>([])
export const timeline = signal<Segment[]>([])
export const playheadTime = signal<number>(0)
export const selectedSegmentId = signal<string | null>(null)
export const ffmpegReady = signal<boolean>(false)
export const ffmpegProgress = signal<number>(0)
export const exportHistory = signal<ExportRecord[]>([])
export const exportFormat = signal<ExportFormat>('mp4')
export const quality = signal<Quality>('lossless')
export const framerate = signal<Framerate>('original')
export const theme = signal<'light' | 'dark'>(
  typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
    ? 'dark'
    : 'light'
)

export const playing = signal(false)
export const currentPlaybackTime = signal(0)
export const currentSegmentDuration = signal(0)
export const videoEl: { current: HTMLVideoElement | null } = { current: null }
