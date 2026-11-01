import type { Signal } from '@preact/signals'
import { computed, effect, signal } from '@preact/signals'

import {
  STAGE_DEFAULT_HEIGHT,
  STAGE_MAX_HEIGHT,
  STAGE_MIN_HEIGHT,
} from '@/lib/advanced/stageHeight'
import type {
  AdvancedSegment,
  CanvasSize,
  Clip,
  DragState,
  ExportFormat,
  ExportRecord,
  Framerate,
  MkvCodec,
  Quality,
  Segment,
  Track,
  Viewport,
  WebmCodec,
} from '@/lib/types'

const PERSIST_KEY = 'splicer_state'

// Load a persisted value, falling back to the default when it is missing,
// unparseable, or no longer valid (e.g. an option removed in a later version).
function loadFromStorage<T>(key: string, defaultValue: T, isValid: (value: unknown) => boolean): T {
  if (typeof localStorage === 'undefined') return defaultValue
  try {
    const stored = localStorage.getItem(`${PERSIST_KEY}:${key}`)
    if (stored === null) return defaultValue
    const parsed: unknown = JSON.parse(stored)
    return isValid(parsed) ? (parsed as T) : defaultValue
  } catch {
    return defaultValue
  }
}

const oneOf =
  (...allowed: readonly unknown[]) =>
  (value: unknown) =>
    allowed.includes(value)
const isBoolean = (value: unknown) => typeof value === 'boolean'
const isNumberIn = (min: number, max: number) => (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const isOutputLock = (value: unknown) =>
  value === null ||
  (typeof value === 'object' &&
    isNumberIn(16, 7680)((value as CanvasSize).width) &&
    isNumberIn(16, 7680)((value as CanvasSize).height))

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
// True while an export worker is running (either editor).
export const exporting = signal(false)
export const exportProgress = signal<number>(0)

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
export const logPanelVisible = signal<boolean>(loadFromStorage('logPanelVisible', false, isBoolean))

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

export const exportFormat = signal<ExportFormat>(
  loadFromStorage('exportFormat', 'mp4', oneOf('mp4', 'mkv', 'mov', 'webm'))
)
export const quality = signal<Quality>(
  loadFromStorage('quality', 'lossless', oneOf('lossless', 'high', 'medium', 'low'))
)
export const framerate = signal<Framerate>(
  loadFromStorage('framerate', 'original', oneOf('original', '60', '30', '24'))
)
// VP9 is the default: the WebCodecs engine (primary path for WebM) encodes VP9
// natively without the OOM problems of the old ffmpeg.wasm path, and it produces
// smaller files at similar quality. VP8 stays available for faster encoding or
// browsers that lack WebCodecs.
export const webmCodec = signal<WebmCodec>(loadFromStorage('webmCodec', 'vp9', oneOf('vp9', 'vp8')))
// MKV can carry H.264/AAC (broadest compatibility) or VP9/Opus (reuses the WebM
// encoder path). H.264 is the default.
export const mkvCodec = signal<MkvCodec>(loadFromStorage('mkvCodec', 'h264', oneOf('h264', 'vp9')))

export const previewVolume = signal(loadFromStorage('previewVolume', 0.5, isNumberIn(0, 1)))
export const previewMuted = signal(loadFromStorage('previewMuted', false, isBoolean))

export const theme = signal<'light' | 'dark'>(
  typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
    ? 'dark'
    : 'light'
)

// Which editor mode is active. Basic is today's single-track editor; Advanced
// is the multi-track compositor. Persisted so the app reopens in the last-used
// mode (Basic on first visit).
export const appMode = signal<'basic' | 'advanced'>(
  loadFromStorage('appMode', 'basic', oneOf('basic', 'advanced'))
)

// Advanced (multi-track compositor) project state, kept separate from Basic's
// `timeline`. Only the output lock persists; placed clips reference Files that
// cannot be rehydrated across reloads (same as Basic's in-memory timeline).
// Output-size lock for the Advanced infinite canvas. null = Auto (export the
// bounding box of placed clips). A CanvasSize locks the output to that size,
// contain-fitting and letterboxing the content at export.
export const advancedOutputLock = signal<CanvasSize | null>(
  loadFromStorage('advancedOutputLock', null, isOutputLock)
)
// Pan/zoom of the infinite-canvas viewport. View state only (not persisted);
// reset to fit-content when the preview mounts.
export const advancedViewport = signal<Viewport>({ panX: 0, panY: 0, zoom: 1 })
// Height of the resizable Advanced preview work area (CSS px). Persisted as a
// workspace preference; the user drags the stage's bottom edge to change it.
export const advancedStageHeight = signal<number>(
  loadFromStorage(
    'advancedStageHeight',
    STAGE_DEFAULT_HEIGHT,
    isNumberIn(STAGE_MIN_HEIGHT, STAGE_MAX_HEIGHT)
  )
)
// Magnetic snapping of timeline moves and trims. A workspace preference.
export const advancedSnapEnabled = signal<boolean>(
  loadFromStorage('advancedSnapEnabled', true, isBoolean)
)
// Transient timeline gesture feedback (not persisted): the time a dragged edge
// snapped to, and whether a clip drag is active and aiming at a new track.
export const advancedSnapLine = signal<number | null>(null)
export const advancedClipDragActive = signal(false)
// Timeline end of the clip being dragged, so the lanes widen ahead of a move
// that edge auto-scroll carries past the committed content.
export const advancedDragPreviewEnd = signal<number | null>(null)
export const advancedNewTrackTarget = signal<'top' | 'bottom' | null>(null)
export const advancedTracks = signal<Track[]>([{ id: 'track-1', name: 'Track 1' }])
export const advancedSegments = signal<AdvancedSegment[]>([])
export const advancedSelectedId = signal<string | null>(null)
export const advancedPlayhead = signal<number>(0)
export const advancedPlaying = signal<boolean>(false)

// Preview speed chosen in either editor's speed selector. Shared and persisted,
// so the two selectors agree and the choice survives remounts and reloads.
export const PLAYBACK_SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]
export const playbackRate = signal<number>(
  loadFromStorage('playbackRate', 1, oneOf(...PLAYBACK_SPEED_OPTIONS))
)

// Playback output signals. Written only by the playback module (lib/playback.ts).
export const playing = signal(false)
// J/K/L shuttle speed in Basic: positive plays forward faster than the chosen
// speed, negative plays in reverse, null is normal playback.
export const shuttleRate = signal<number | null>(null)
// True while the Basic preview moves on its own, forward or in reverse.
export const transportRunning = computed(() => playing.value || (shuttleRate.value ?? 0) < 0)
export const currentPlaybackTime = signal(0)
export const currentSegmentDuration = signal(0)

persistSignal('exportFormat', exportFormat)
persistSignal('quality', quality)
persistSignal('framerate', framerate)
persistSignal('webmCodec', webmCodec)
persistSignal('mkvCodec', mkvCodec)
persistSignal('previewVolume', previewVolume)
persistSignal('previewMuted', previewMuted)
persistSignal('playbackRate', playbackRate)
persistSignal('logPanelVisible', logPanelVisible)
persistSignal('appMode', appMode)
persistSignal('advancedOutputLock', advancedOutputLock)
persistSignal('advancedStageHeight', advancedStageHeight)
persistSignal('advancedSnapEnabled', advancedSnapEnabled)

export { ZOOM_MAX, ZOOM_MIN } from '@/lib/timelineNavigation'
// Must match the timeline track's DOM: gap-1 between blocks, px-4 padding.
export const GAP_PX = 4
export const PADDING_PX = 16

export const pxPerSec = signal(80)
export const dragState = signal<DragState | null>(null)
// The Basic trim drag in progress, for its readout and snap guide (transient).
export const trimFeedback = signal<{
  segmentId: string
  side: 'start' | 'end'
  snapped: boolean
} | null>(null)
export const importing = signal(false)
// User-facing import failures, shown as a dismissible notice.
export const importErrors = signal<string[]>([])

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
