import { effect, signal } from '@preact/signals'

import type { Clip, ExportFormat, ExportRecord, Framerate, Quality, Segment } from '@/lib/types'

// Persist keys
const PERSIST_KEY = 'splicer_state'

// Helper to load from localStorage
function loadFromStorage<T>(key: string, defaultValue: T): T {
  if (typeof localStorage === 'undefined') return defaultValue
  try {
    const stored = localStorage.getItem(`${PERSIST_KEY}:${key}`)
    return stored ? JSON.parse(stored) : defaultValue
  } catch {
    return defaultValue
  }
}

// Helper to save to localStorage
function saveToStorage<T>(key: string, value: T) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(`${PERSIST_KEY}:${key}`, JSON.stringify(value))
  } catch {
    // Silently fail if localStorage is unavailable
  }
}

export const clips = signal<Clip[]>([])
export const timeline = signal<Segment[]>([])
export const playheadTime = signal<number>(0)
export const selectedSegmentId = signal<string | null>(null)
export const ffmpegReady = signal<boolean>(false)
export const ffmpegProgress = signal<number>(0)
export const exportHistory = signal<ExportRecord[]>([])

// Export options with localStorage persistence
export const exportFormat = signal<ExportFormat>(loadFromStorage('exportFormat', 'mp4'))
export const quality = signal<Quality>(loadFromStorage('quality', 'lossless'))
export const framerate = signal<Framerate>(loadFromStorage('framerate', 'original'))

// Preview options with localStorage persistence
export const previewVolume = signal(loadFromStorage('previewVolume', 0.5))
export const previewMuted = signal(loadFromStorage('previewMuted', false))

export const theme = signal<'light' | 'dark'>(
  typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
    ? 'dark'
    : 'light'
)

export const playing = signal(false)
export const currentPlaybackTime = signal(0)
export const currentSegmentDuration = signal(0)
export const videoEl: { current: HTMLVideoElement | null } = { current: null }

// Persist export options to localStorage
effect(() => {
  saveToStorage('exportFormat', exportFormat.value)
})
effect(() => {
  saveToStorage('quality', quality.value)
})
effect(() => {
  saveToStorage('framerate', framerate.value)
})

// Persist preview options to localStorage
effect(() => {
  saveToStorage('previewVolume', previewVolume.value)
})
effect(() => {
  saveToStorage('previewMuted', previewMuted.value)
})
