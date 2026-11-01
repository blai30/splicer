import { batch, computed, effect, signal } from '@preact/signals'

import { resetAdvancedHistory } from '@/lib/advanced/advancedHistory'
import { collectUnusedClips } from '@/lib/clipPool'
import { formatSize } from '@/lib/format'
import { info, warn } from '@/lib/logger'
import {
  indexedDbProjectStorage,
  type MediaWrite,
  type ProjectStorage,
} from '@/lib/project/projectDatabase'
import {
  buildProjectRecord,
  hasProjectContent,
  parseProjectRecord,
  planMediaStorage,
  planRestore,
  projectClips,
  reinsertUnlinked,
  relinkMismatch,
  type ProjectRecord,
  type UnlinkedClip,
} from '@/lib/project/projectSnapshot'
import {
  advancedPlayhead,
  advancedSegments,
  advancedSelection,
  advancedTracks,
  clips,
  playheadTime,
  selectedSegmentId,
  timeline,
} from '@/lib/store'
import { resetHistory } from '@/lib/timelineEditing'
import type { Clip } from '@/lib/types'

// Autosave of both editors into IndexedDB, and the restore offered on the next
// visit. Storage is a convenience: every call is guarded, and a failure only
// means the project is not kept, never that the editor stops working.

// At most this much source media is kept; clips past it are saved as details
// and relinked after a reload.
export const PROJECT_MEDIA_BYTE_LIMIT = 2_000_000_000
const SAVE_DELAY_MS = 600

export type RestoreOffer = {
  savedAt: number
  clipCount: number
  segmentCount: number
}

export type PersistenceStatus = 'starting' | 'unavailable' | 'offering' | 'active'

export const persistenceStatus = signal<PersistenceStatus>('starting')
export const restoreOffer = signal<RestoreOffer | null>(null)
export const restoring = signal(false)
// Clips whose files did not come back, waiting to be relinked.
export const unlinkedClips = signal<UnlinkedClip[]>([])
// Clips saved without their file (over the size budget or out of space).
export const mediaNotKept = signal<{ name: string; size: number }[]>([])
// The last save or restore failure, for the user.
export const persistenceError = signal<string | null>(null)

const changeVersion = signal(0)
const savedVersion = signal(0)
// True when the project as it stands now would come back after a reload.
export const projectSaved = computed(
  () =>
    persistenceStatus.value === 'active' &&
    savedVersion.value === changeVersion.value &&
    mediaNotKept.value.length === 0 &&
    persistenceError.value === null
)

let storage: ProjectStorage | null = null
let pendingRecord: ProjectRecord | null = null
let storedMediaIds = new Set<string>()
let saveTimer: ReturnType<typeof setTimeout> | null = null
let saveRunning: Promise<void> | null = null
let saveQueued = false
let stopWatching: (() => void) | null = null

function currentState() {
  return {
    timeline: timeline.value,
    selectedSegmentId: selectedSegmentId.value,
    advancedTracks: advancedTracks.value,
    advancedSegments: advancedSegments.value,
    clips: clips.value,
    unlinked: unlinkedClips.value,
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function isQuotaError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'QuotaExceededError'
}

async function mediaBudget(): Promise<number> {
  try {
    const estimate = await navigator.storage?.estimate?.()
    // Leave room for other data and the export library sharing the origin.
    if (estimate?.quota) return Math.min(PROJECT_MEDIA_BYTE_LIMIT, estimate.quota * 0.5)
  } catch {
    // No estimate: the fixed limit applies.
  }
  return PROJECT_MEDIA_BYTE_LIMIT
}

async function writeProject(media: Clip[], allowNewMedia: boolean): Promise<Clip[]> {
  const active = storage
  if (!active) return []
  const state = currentState()
  if (!hasProjectContent(state)) {
    await active.clear()
    storedMediaIds = new Set()
    return []
  }
  const { kept, skipped } = planMediaStorage(media, await mediaBudget())
  const keptNow = allowNewMedia ? kept : kept.filter((clip) => storedMediaIds.has(clip.id))
  const notKept = allowNewMedia ? skipped : media.filter((clip) => !keptNow.includes(clip))
  const keptIds = new Set(keptNow.map((clip) => clip.id))
  const writes: MediaWrite[] = keptNow
    .filter((clip) => !storedMediaIds.has(clip.id))
    .map((clip) => ({ id: clip.id, file: clip.file }))
  const deletes = [...storedMediaIds].filter((id) => !keptIds.has(id))
  await active.saveProject(buildProjectRecord(state, Date.now()), writes, deletes)
  storedMediaIds = keptIds
  return notKept
}

async function saveNow(): Promise<void> {
  if (persistenceStatus.value !== 'active' || !storage) return
  const version = changeVersion.peek()
  const media = projectClips(currentState())
  try {
    let notKept: Clip[]
    try {
      notKept = await writeProject(media, true)
    } catch (err) {
      if (!isQuotaError(err)) throw err
      // Out of space: keep what is already stored and save the rest as details.
      notKept = await writeProject(media, false)
    }
    batch(() => {
      mediaNotKept.value = notKept.map((clip) => ({ name: clip.name, size: clip.file.size }))
      persistenceError.value = null
      savedVersion.value = version
    })
  } catch (err) {
    warn('Could not save the project', { message: describeError(err) })
    persistenceError.value = `Could not save the project in this browser (${describeError(err)}). Your work will not survive a reload.`
  }
}

// Saves run one at a time; edits made during one fold into a single next save.
function runSave(): Promise<void> {
  if (saveRunning) {
    saveQueued = true
    return saveRunning
  }
  saveRunning = saveNow().finally(() => {
    saveRunning = null
    if (saveQueued) {
      saveQueued = false
      void runSave()
    }
  })
  return saveRunning
}

function scheduleSave() {
  if (saveTimer !== null) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void runSave()
  }, SAVE_DELAY_MS)
}

// Save right away (a pending debounce included), e.g. when the tab is hidden.
export function flushProjectSave(): Promise<void> {
  if (saveTimer === null) return saveRunning ?? Promise.resolve()
  clearTimeout(saveTimer)
  saveTimer = null
  return runSave()
}

function onPageHidden() {
  if (document.visibilityState === 'hidden') void flushProjectSave()
}

function startAutosave() {
  persistenceStatus.value = 'active'
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onPageHidden)
  }
  stopWatching?.()
  let first = true
  stopWatching = effect(() => {
    void timeline.value
    void selectedSegmentId.value
    void advancedTracks.value
    void advancedSegments.value
    void clips.value
    void unlinkedClips.value
    // The first run only subscribes: it is the state the session started with.
    if (first) {
      first = false
      return
    }
    changeVersion.value = changeVersion.peek() + 1
    scheduleSave()
  })
  // An empty project at start is already "saved"; content is saved right away
  // so the stored copy matches what the user sees.
  if (hasProjectContent(currentState())) {
    changeVersion.value = changeVersion.peek() + 1
    scheduleSave()
  }
}

// Open storage and offer the saved project, if there is one. Autosave waits
// for the user's choice, so the stored project is never overwritten unseen.
export async function initProjectPersistence(
  provided: ProjectStorage | null = indexedDbProjectStorage()
): Promise<void> {
  if (persistenceStatus.peek() !== 'starting') return
  storage = provided
  if (!storage) {
    persistenceStatus.value = 'unavailable'
    return
  }
  try {
    const [raw, mediaIds] = await Promise.all([storage.loadProject(), storage.loadMediaIds()])
    storedMediaIds = new Set(mediaIds)
    const record = parseProjectRecord(raw)
    if (record && hasProjectContent(record)) {
      pendingRecord = record
      restoreOffer.value = {
        savedAt: record.savedAt,
        clipCount: record.clips.length + record.unlinked.length,
        segmentCount:
          record.timeline.length +
          record.advancedSegments.length +
          record.unlinked.reduce(
            (count, entry) => count + entry.basic.length + entry.advanced.length,
            0
          ),
      }
      persistenceStatus.value = 'offering'
      return
    }
  } catch (err) {
    warn('Project storage is unavailable', { message: describeError(err) })
    storage = null
    persistenceStatus.value = 'unavailable'
    return
  }
  startAutosave()
}

// Replace the current project with the saved one. Clips whose files did not
// come back stay listed for relinking; everything else is restored.
export async function restoreSavedProject(): Promise<void> {
  const record = pendingRecord
  if (!record || !storage || restoring.peek()) return
  restoring.value = true
  try {
    let files = new Map<string, File>()
    try {
      files = await storage.loadMedia(record.clips.map((clip) => clip.id))
    } catch (err) {
      // Every clip then needs relinking, but the edits themselves come back.
      warn('Could not read saved clips', { message: describeError(err) })
    }
    const plan = planRestore(record, files)
    const restoredClips: Clip[] = plan.restored.map(({ clip, file }) => {
      const { fileName: _fileName, fileSize: _fileSize, fileType: _fileType, ...rest } = clip
      return { ...rest, file, objectUrl: URL.createObjectURL(file) }
    })
    const restoredIds = new Set(restoredClips.map((clip) => clip.id))
    // Undo history belongs to the project being replaced.
    resetHistory()
    resetAdvancedHistory()
    batch(() => {
      clips.value = [...clips.value.filter((clip) => !restoredIds.has(clip.id)), ...restoredClips]
      timeline.value = plan.timeline
      selectedSegmentId.value = plan.selectedSegmentId
      advancedTracks.value = plan.advancedTracks
      advancedSegments.value = plan.advancedSegments
      advancedSelection.value = { ids: [], primary: null }
      unlinkedClips.value = plan.unlinked
      playheadTime.value = 0
      advancedPlayhead.value = 0
      restoreOffer.value = null
    })
    collectUnusedClips()
    pendingRecord = null
    info('Restored the saved project', {
      clips: restoredClips.length,
      unlinked: plan.unlinked.length,
    })
  } catch (err) {
    // Keep the offer and the stored copy, so nothing is overwritten by a
    // half-restored project.
    warn('Could not restore the project', { message: describeError(err) })
    persistenceError.value = `Could not restore the saved project (${describeError(err)}).`
    return
  } finally {
    restoring.value = false
  }
  startAutosave()
}

// Drop the saved project and start saving the current one in its place.
export async function discardSavedProject(): Promise<void> {
  pendingRecord = null
  restoreOffer.value = null
  try {
    await storage?.clear()
    storedMediaIds = new Set()
  } catch (err) {
    warn('Could not clear the saved project', { message: describeError(err) })
  }
  if (persistenceStatus.peek() === 'offering') {
    persistenceError.value = null
    startAutosave()
  }
}

// Point a missing clip at a file the user picked. The file is probed like an
// import and must match the original's length and frame size. Returns the
// reason it was refused, or null once its segments are back.
export async function relinkClip(
  clipId: string,
  file: File,
  probe: (file: File) => Promise<Clip | null>
): Promise<string | null> {
  const entry = unlinkedClips.peek().find((candidate) => candidate.clip.id === clipId)
  if (!entry) return null
  const probed = await probe(file)
  if (!probed) return `"${file.name}" could not be read as a video.`
  const mismatch = relinkMismatch(entry.clip, probed)
  if (mismatch) {
    URL.revokeObjectURL(probed.objectUrl)
    return `"${file.name}" does not match "${entry.clip.name}": ${mismatch}.`
  }
  // Read the list again: another relink may have finished while probing.
  if (!unlinkedClips.peek().includes(entry)) {
    URL.revokeObjectURL(probed.objectUrl)
    return null
  }
  const stored = entry.clip
  const clip: Clip = {
    ...probed,
    id: stored.id,
    name: stored.name,
    waveformPeaks: stored.waveformPeaks.length > 0 ? stored.waveformPeaks : probed.waveformPeaks,
  }
  const placed = reinsertUnlinked(
    entry,
    timeline.peek(),
    advancedSegments.peek(),
    advancedTracks.peek()
  )
  batch(() => {
    clips.value = [...clips.value, clip]
    timeline.value = placed.timeline
    if (!selectedSegmentId.peek()) selectedSegmentId.value = placed.timeline[0]?.id ?? null
    advancedSegments.value = placed.advancedSegments
    unlinkedClips.value = unlinkedClips.value.filter((candidate) => candidate !== entry)
  })
  return null
}

// Give up on a missing clip: its set-aside segments are dropped.
export function removeUnlinkedClip(clipId: string): void {
  unlinkedClips.value = unlinkedClips.value.filter((entry) => entry.clip.id !== clipId)
}

export function mediaNotKeptMessage(entries: readonly { name: string; size: number }[]): string {
  const names = entries.map((entry) => `"${entry.name}" (${formatSize(entry.size)})`).join(', ')
  return entries.length === 1
    ? `${names} is too large to keep in browser storage. After a reload you will be asked to relink it.`
    : `${names} are too large to keep in browser storage. After a reload you will be asked to relink them.`
}

// Test isolation: forget storage and every persistence signal.
export function resetProjectPersistence(): void {
  stopWatching?.()
  stopWatching = null
  if (saveTimer !== null) clearTimeout(saveTimer)
  saveTimer = null
  saveRunning = null
  saveQueued = false
  storage = null
  pendingRecord = null
  storedMediaIds = new Set()
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onPageHidden)
  }
  batch(() => {
    persistenceStatus.value = 'starting'
    restoreOffer.value = null
    restoring.value = false
    unlinkedClips.value = []
    mediaNotKept.value = []
    persistenceError.value = null
    changeVersion.value = 0
    savedVersion.value = 0
  })
}
