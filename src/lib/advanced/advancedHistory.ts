import { batch, signal } from '@preact/signals'

import { liveSelection } from '@/lib/advanced/advancedSelection'
import { collectUnusedClips, registerClipReferences } from '@/lib/clipPool'
import { createCoalescingHistory } from '@/lib/coalescingHistory'
import {
  advancedOutputLock,
  advancedSegments,
  advancedSelection,
  advancedTracks,
  type AdvancedSelection,
} from '@/lib/store'
import type { AdvancedSegment, CanvasSize, Track } from '@/lib/types'

// Every advanced edit routes a snapshot through this module so undo/redo see all
// of them: imports, moves, trims, cuts, in/out, mutes, deletes, transforms,
// crops, and track add/remove/reorder/mute/hide. Continuous drags record one
// entry per gesture via beginAdvancedGesture() + consumeAdvancedGesture().

const HISTORY_LIMIT = 50

type AdvancedHistoryEntry = {
  segments: AdvancedSegment[]
  tracks: Track[]
  selection: AdvancedSelection
  outputLock: CanvasSize | null
}

const history: AdvancedHistoryEntry[] = []
const redoHistory: AdvancedHistoryEntry[] = []

export const canUndoAdvanced = signal(false)
export const canRedoAdvanced = signal(false)

// Bumped whenever either stack changes, so coalesced edits can tell whether
// anything else was recorded since their last entry.
let historyGeneration = 0

function syncHistoryFlags() {
  historyGeneration += 1
  canUndoAdvanced.value = history.length > 0
  canRedoAdvanced.value = redoHistory.length > 0
}

// The Advanced editor can reach every clip placed in its live project and in
// any snapshot on its undo/redo stacks.
registerClipReferences(function* () {
  for (const segment of advancedSegments.value) yield segment.clipId
  for (const entry of history) for (const segment of entry.segments) yield segment.clipId
  for (const entry of redoHistory) for (const segment of entry.segments) yield segment.clipId
})

function captureEntry(): AdvancedHistoryEntry {
  return {
    segments: advancedSegments.value,
    tracks: advancedTracks.value,
    selection: advancedSelection.value,
    outputLock: advancedOutputLock.value,
  }
}

export function recordAdvancedHistory() {
  history.unshift(captureEntry())
  if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT
  // A new edit invalidates the redo branch. Clips that only the dropped redo
  // entries (or an evicted undo entry) referenced can now be released.
  redoHistory.length = 0
  syncHistoryFlags()
  queueCollect()
}

// One undo entry per burst of repeated small edits sharing `key` (nudges).
export const recordAdvancedHistoryCoalesced = createCoalescingHistory({
  record: recordAdvancedHistory,
  generation: () => historyGeneration,
})

// Collect after the caller's mutation lands (it runs synchronously right after
// recordAdvancedHistory), so clips the new state references are kept.
let collectQueued = false
function queueCollect() {
  if (collectQueued) return
  collectQueued = true
  queueMicrotask(() => {
    collectQueued = false
    collectUnusedClips()
  })
}

// Continuous gestures (trim/move/resize/crop drags) record one history entry for
// the whole gesture: beginAdvancedGesture() arms the flag and the first mutation
// consumes it. In/Out actions reuse this path with a single armed mutation.
let gesturePending = false
// True from beginAdvancedGesture() until endAdvancedGesture(). Undo/redo wait
// for the gesture to finish: undoing mid-drag would leave the rest of the drag
// unrecorded and a stale mid-drag snapshot on the redo stack.
let gestureActive = false

// End the gesture when the pointer is released anywhere. The dragged element's
// own pointerup handler runs first (this listens in the bubble phase on
// window), and this also covers an element removed mid-drag (e.g. Delete
// pressed while trimming), whose own listeners never fire. Without it the
// gesture would stay active and block undo for the rest of the session.
function onGlobalPointerEnd() {
  endAdvancedGesture()
}

export function beginAdvancedGesture() {
  gesturePending = true
  gestureActive = true
  if (typeof window !== 'undefined') {
    window.addEventListener('pointerup', onGlobalPointerEnd)
    window.addEventListener('pointercancel', onGlobalPointerEnd)
  }
}

// One undo entry for a property edit: the whole drag while a pointer gesture
// is armed (a slider drag), otherwise one per burst of repeats sharing `key`
// (arrow keys on a slider, nudges).
export function recordAdvancedEdit(key: string) {
  if (gestureActive) consumeAdvancedGesture()
  else recordAdvancedHistoryCoalesced(key)
}

export function consumeAdvancedGesture() {
  if (gesturePending) {
    gesturePending = false
    recordAdvancedHistory()
  }
}

// Disarm a gesture that ended without mutating anything (e.g. a click on a
// resize handle), so the next unrelated edit is not folded into it.
export function endAdvancedGesture() {
  gesturePending = false
  gestureActive = false
  if (typeof window !== 'undefined') {
    window.removeEventListener('pointerup', onGlobalPointerEnd)
    window.removeEventListener('pointercancel', onGlobalPointerEnd)
  }
}

function restoreEntry(entry: AdvancedHistoryEntry) {
  batch(() => {
    advancedSegments.value = entry.segments
    advancedTracks.value = entry.tracks
    advancedOutputLock.value = entry.outputLock
    advancedSelection.value = liveSelection(entry.selection, entry.segments)
  })
}

export function undoAdvanced() {
  if (gestureActive) return
  const entry = history.shift()
  if (!entry) return
  redoHistory.unshift(captureEntry())
  if (redoHistory.length > HISTORY_LIMIT) redoHistory.length = HISTORY_LIMIT
  restoreEntry(entry)
  syncHistoryFlags()
  collectUnusedClips()
}

export function redoAdvanced() {
  if (gestureActive) return
  const entry = redoHistory.shift()
  if (!entry) return
  history.unshift(captureEntry())
  if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT
  restoreEntry(entry)
  syncHistoryFlags()
  collectUnusedClips()
}

// Rewrite the segments of every snapshot on both stacks, given each
// snapshot's tracks. A relink uses it: the relinked segments belonged to the
// project all along, so no undo or redo step may drop them again.
export function rebaseAdvancedHistory(
  transform: (segments: AdvancedSegment[], tracks: Track[]) => AdvancedSegment[]
) {
  const rebase = (entry: AdvancedHistoryEntry): AdvancedHistoryEntry => ({
    ...entry,
    segments: transform(entry.segments, entry.tracks),
  })
  history.splice(0, history.length, ...history.map(rebase))
  redoHistory.splice(0, redoHistory.length, ...redoHistory.map(rebase))
}

// Clears both stacks and any armed gesture. Used by tests for isolation.
export function resetAdvancedHistory() {
  history.length = 0
  redoHistory.length = 0
  gesturePending = false
  gestureActive = false
  syncHistoryFlags()
}
