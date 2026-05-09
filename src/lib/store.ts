import type { Signal } from '@preact/signals'
import { effect, signal } from '@preact/signals'

import type { Clip, ExportFormat, ExportRecord, Framerate, Quality, Segment } from '@/lib/types'

const PERSIST_KEY = 'splicer_state'

function loadFromStorage<T>(key: string, defaultValue: T): T {
  if (typeof localStorage === 'undefined') return defaultValue
  try {
    const stored = localStorage.getItem(`${PERSIST_KEY}:${key}`)
    return stored ? JSON.parse(stored) : defaultValue
  } catch {
    return defaultValue
  }
}

function saveToStorage<T>(key: string, value: T) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(`${PERSIST_KEY}:${key}`, JSON.stringify(value))
  } catch {
    // Silently fail if localStorage is unavailable
  }
}

function persistSignal<T>(key: string, sig: Signal<T>) {
  effect(() => saveToStorage(key, sig.value))
}

export const clips = signal<Clip[]>([])
export const timeline = signal<Segment[]>([])
export const playheadTime = signal<number>(0)
export const selectedSegmentId = signal<string | null>(null)
export const ffmpegReady = signal<boolean>(false)
export const ffmpegProgress = signal<number>(0)
export const exportHistory = signal<ExportRecord[]>([])

export const exportFormat = signal<ExportFormat>(loadFromStorage('exportFormat', 'mp4'))
export const quality = signal<Quality>(loadFromStorage('quality', 'lossless'))
export const framerate = signal<Framerate>(loadFromStorage('framerate', 'original'))

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

persistSignal('exportFormat', exportFormat)
persistSignal('quality', quality)
persistSignal('framerate', framerate)
persistSignal('previewVolume', previewVolume)
persistSignal('previewMuted', previewMuted)
