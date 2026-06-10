import type { Signal } from '@preact/signals'
import { effect, signal } from '@preact/signals'

import type { CoreMode } from '@/lib/ffmpegCapabilities'
import type {
  Clip,
  DragState,
  ExportFormat,
  ExportRecord,
  Framerate,
  MkvCodec,
  Quality,
  Segment,
  WebmCodec,
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

function persistSignal<T>(key: string, targetSignal: Signal<T>) {
  effect(() => saveToStorage(key, targetSignal.value))
}

export const clips = signal<Clip[]>([])
export const timeline = signal<Segment[]>([])
export const playheadTime = signal<number>(0)
export const selectedSegmentId = signal<string | null>(null)
export const ffmpegReady = signal<boolean>(false)
export const ffmpegProgress = signal<number>(0)

// Which ffmpeg core is in use this session, and why single-thread was forced
// (empty when multithread or not yet decided).
export const coreMode = signal<CoreMode | null>(null)
export const coreModeReason = signal<string>('')

// Which engine produced the most recent export: 'webcodecs' or 'ffmpeg'.
export const exportEngineUsed = signal<'webcodecs' | 'ffmpeg' | null>(null)

// ETA in seconds during an active export (null when unknown).
export const exportEtaSeconds = signal<number | null>(null)

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

export function addExportRecord(record: ExportRecord) {
  const next = [record, ...exportHistory.value]
  if (next.length > EXPORT_HISTORY_LIMIT) {
    // Release blob memory held by evicted records.
    for (const evicted of next.slice(EXPORT_HISTORY_LIMIT)) {
      URL.revokeObjectURL(evicted.url)
    }
    next.length = EXPORT_HISTORY_LIMIT
  }
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
// VP9 is the default: the WebCodecs engine (primary path for WebM) encodes VP9
// natively without the OOM problems of the old ffmpeg.wasm path, and it produces
// smaller files at similar quality. VP8 stays available for faster encoding or
// browsers that lack WebCodecs.
export const webmCodec = signal<WebmCodec>(loadFromStorage('webmCodec', 'vp9'))
// MKV can carry H.264/AAC (broadest compatibility) or VP9/Opus (reuses the WebM
// encoder path). H.264 is the default.
export const mkvCodec = signal<MkvCodec>(loadFromStorage('mkvCodec', 'h264'))

export const previewVolume = signal(loadFromStorage('previewVolume', 0.5))
export const previewMuted = signal(loadFromStorage('previewMuted', false))

export const theme = signal<'light' | 'dark'>(
  typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
    ? 'dark'
    : 'light'
)

// Playback output signals. Written only by the playback module (lib/playback.ts).
export const playing = signal(false)
export const currentPlaybackTime = signal(0)
export const currentSegmentDuration = signal(0)

persistSignal('exportFormat', exportFormat)
persistSignal('quality', quality)
persistSignal('framerate', framerate)
persistSignal('webmCodec', webmCodec)
persistSignal('mkvCodec', mkvCodec)
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

export function getSegmentStartX(segmentId: string): number {
  let x = PADDING_PX
  for (const segment of timeline.value) {
    if (segment.id === segmentId) return x
    x += (segment.endTime - segment.startTime) * pxPerSec.value + GAP_PX
  }
  return PADDING_PX
}
