import type { Signal } from '@preact/signals'
import { effect, signal } from '@preact/signals'

import {
  splitSegmentAtPlayhead,
  updateSegmentEndTime,
  updateSegmentStartTime,
} from '@/lib/timelineDomain'
import type {
  Clip,
  DragState,
  ExportFormat,
  ExportRecord,
  Framerate,
  Quality,
  Segment,
} from '@/lib/types'

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

export const ZOOM_MIN = 5
export const ZOOM_MAX = 200
export const GAP_PX = 4
export const PADDING_PX = 12

export const pxPerSec = signal(80)
export const dragState = signal<DragState | null>(null)

export function clipColor(clipId: string): string {
  const colors = ['bg-violet-700', 'bg-teal-700', 'bg-cyan-700', 'bg-emerald-700', 'bg-sky-700']
  let hash = 0
  for (let i = 0; i < clipId.length; i++) hash = (hash * 31 + clipId.charCodeAt(i)) | 0
  return colors[Math.abs(hash) % colors.length]
}

export function getSegmentStartX(segId: string): number {
  let x = PADDING_PX
  for (const seg of timeline.value) {
    if (seg.id === segId) return x
    x += (seg.endTime - seg.startTime) * pxPerSec.value + GAP_PX
  }
  return PADDING_PX
}

function getSelectedSegment() {
  return timeline.value.find((s) => s.id === selectedSegmentId.value)
}

export function setInPoint() {
  const seg = getSelectedSegment()
  if (!seg) return
  timeline.value = updateSegmentStartTime(timeline.value, seg.id, playheadTime.value)
}

export function setOutPoint() {
  const seg = getSelectedSegment()
  if (!seg) return
  const clipDur = clips.value.find((c) => c.id === seg.clipId)?.duration ?? playheadTime.value
  timeline.value = updateSegmentEndTime(timeline.value, seg.id, playheadTime.value, clipDur)
}

export function cutAtPlayhead() {
  const seg = getSelectedSegment()
  if (!seg) return
  const split = splitSegmentAtPlayhead(timeline.value, seg.id, playheadTime.value)
  if (!split) return
  timeline.value = split.nextSegments
  selectedSegmentId.value = split.newSegmentId
}

export function toggleMute() {
  const segId = selectedSegmentId.value
  if (!segId) return
  timeline.value = timeline.value.map((s) => (s.id === segId ? { ...s, muted: !s.muted } : s))
}

export function deleteSegment() {
  const segId = selectedSegmentId.value
  if (!segId) return
  const currentIdx = timeline.value.findIndex((s) => s.id === segId)
  const next = timeline.value.filter((s) => s.id !== segId)
  timeline.value = next
  selectedSegmentId.value = next[currentIdx]?.id ?? next[currentIdx - 1]?.id ?? null
}
