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

// Runtime logging signal (not persisted). Stores recent log entries for the UI.
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogEntry = { id: string; ts: string; level: LogLevel; message: string; meta?: any }
export const logs = signal<LogEntry[]>([])
export const LOG_LIMIT = 1000

export function addLog(entry: LogEntry) {
  const next = [entry, ...logs.value]
  if (next.length > LOG_LIMIT) next.length = LOG_LIMIT
  logs.value = next
}

export function clearLogs() {
  logs.value = []
}

// UI visibility for the log panel. Persisted so user preference survives reloads.
export const logPanelVisible = signal<boolean>(loadFromStorage('logPanelVisible', false))

export const EXPORT_HISTORY_LIMIT = 50

export function addExportRecord(rec: ExportRecord) {
  const next = [rec, ...exportHistory.value]
  if (next.length > EXPORT_HISTORY_LIMIT) next.length = EXPORT_HISTORY_LIMIT
  exportHistory.value = next
}

// Internal map for O(1) clip lookups. Rebuilt whenever `clips` changes.
const clipsMap: Map<string, Clip> = new Map()
effect(() => {
  clipsMap.clear()
  for (const clip of clips.value) clipsMap.set(clip.id, clip)
})

export function getClipById(id: string): Clip | undefined {
  return clipsMap.get(id)
}

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
persistSignal('logPanelVisible', logPanelVisible)

export const ZOOM_MIN = 5
export const ZOOM_MAX = 200
export const GAP_PX = 4
export const PADDING_PX = 12

export const pxPerSec = signal(80)
export const dragState = signal<DragState | null>(null)
export const importing = signal(false)

export function clipColor(clipId: string): string {
  const colors = ['bg-violet-700', 'bg-teal-700', 'bg-cyan-700', 'bg-emerald-700', 'bg-sky-700']
  let hash = 0
  for (let i = 0; i < clipId.length; i++) hash = (hash * 31 + clipId.charCodeAt(i)) | 0
  return colors[Math.abs(hash) % colors.length]
}

export function getSegmentStartX(segId: string): number {
  let x = PADDING_PX
  for (const segment of timeline.value) {
    if (segment.id === segId) return x
    x += (segment.endTime - segment.startTime) * pxPerSec.value + GAP_PX
  }
  return PADDING_PX
}

function getSelectedSegment() {
  return timeline.value.find((segment) => segment.id === selectedSegmentId.value)
}

export function setInPoint() {
  const segment = getSelectedSegment()
  if (!segment) return
  timeline.value = updateSegmentStartTime(timeline.value, segment.id, playheadTime.value)
}

export function setOutPoint() {
  const segment = getSelectedSegment()
  if (!segment) return
  const clipDur =
    clips.value.find((clip) => clip.id === segment.clipId)?.duration ?? playheadTime.value
  timeline.value = updateSegmentEndTime(timeline.value, segment.id, playheadTime.value, clipDur)
}

export function cutAtPlayhead() {
  const segment = getSelectedSegment()
  if (!segment) return
  const split = splitSegmentAtPlayhead(timeline.value, segment.id, playheadTime.value)
  if (!split) return
  timeline.value = split.nextSegments
  selectedSegmentId.value = split.newSegmentId
}

export function toggleMute() {
  const segmentId = selectedSegmentId.value
  if (!segmentId) return
  timeline.value = timeline.value.map((segment) =>
    segment.id === segmentId ? { ...segment, muted: !segment.muted } : segment
  )
}

export function deleteSegment() {
  const segId = selectedSegmentId.value
  if (!segId) return
  const currentIdx = timeline.value.findIndex((segment) => segment.id === segId)
  const removedSegments = timeline.value.filter((segment) => segment.id === segId)
  const next = timeline.value.filter((segment) => segment.id !== segId)
  // push to undo stack
  for (const removedSegment of removedSegments) {
    const relatedClips = clips.value.filter((clip) => clip.id === removedSegment.clipId)
    // store a shallow copy of clip(s) so undo can restore
    const clipsCopy = relatedClips.map((clip) => ({ ...clip }))
    _undoStack.unshift({ segment: removedSegment, clips: clipsCopy, index: currentIdx })
    if (_undoStack.length > UNDO_STACK_LIMIT) _undoStack.length = UNDO_STACK_LIMIT
  }

  timeline.value = next
  selectedSegmentId.value = next[currentIdx]?.id ?? next[currentIdx - 1]?.id ?? null
  // Remove orphaned clips: if the removed segment referenced a clip
  // that is no longer used by any remaining segment, revoke its object URL
  // and remove it from `clips`.
  // Note: scan for clips referenced by remaining segments and remove unreferenced clips.
  const referenced = new Set<string>(timeline.value.map((segment) => segment.clipId))
  const remainingClips = clips.value.filter((clip) => referenced.has(clip.id))
  const removedClips = clips.value.filter((clip) => !referenced.has(clip.id))
  for (const clip of removedClips) {
    try {
      URL.revokeObjectURL(clip.objectUrl)
    } catch {
      // Best-effort
    }
  }
  clips.value = remainingClips
}

// Undo support for recent deletions
const UNDO_STACK_LIMIT = 5
type UndoEntry = { segment: Segment; clips: Clip[]; index: number }
const _undoStack: UndoEntry[] = []

export function undoDelete(): void {
  const entry = _undoStack.shift()
  if (!entry) return
  // restore segment at index
  const segments = [...timeline.value]
  const insertAt = Math.min(Math.max(0, entry.index), segments.length)
  segments.splice(insertAt, 0, entry.segment)
  timeline.value = segments
  // restore clip(s)
  for (const clip of entry.clips) {
    // if the clip already exists, skip
    if (clips.value.find(({ id }) => id === clip.id)) continue
    // recreate objectUrl if missing or revoked
    const restored = { ...clip }
    try {
      // Always recreate the object URL from the original File reference when possible.
      // This avoids using a stale/revoked URL string which can lead to a non-playing video.
      if (restored.file) {
        restored.objectUrl = URL.createObjectURL(restored.file)
      } else if (!restored.objectUrl) {
        restored.objectUrl = ''
      }
    } catch {
      // ignore
    }
    clips.value = [...clips.value, restored]
  }
  selectedSegmentId.value = entry.segment.id
}
