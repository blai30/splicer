import { batch, signal } from '@preact/signals'

import { collectUnusedClips, registerClipReferences } from '@/lib/clipPool'
import {
  advancedOutputLock,
  advancedSegments,
  advancedSelectedId,
  advancedTracks,
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
  selectedId: string | null
  outputLock: CanvasSize | null
}

const history: AdvancedHistoryEntry[] = []
const redoHistory: AdvancedHistoryEntry[] = []

export const canUndoAdvanced = signal(false)
export const canRedoAdvanced = signal(false)

function syncHistoryFlags() {
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
    selectedId: advancedSelectedId.value,
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

export function beginAdvancedGesture() {
  gesturePending = true
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
}

function restoreEntry(entry: AdvancedHistoryEntry) {
  batch(() => {
    advancedSegments.value = entry.segments
    advancedTracks.value = entry.tracks
    advancedOutputLock.value = entry.outputLock
    advancedSelectedId.value =
      entry.selectedId && entry.segments.some((segment) => segment.id === entry.selectedId)
        ? entry.selectedId
        : null
  })
}

export function undoAdvanced() {
  const entry = history.shift()
  if (!entry) return
  gesturePending = false
  redoHistory.unshift(captureEntry())
  if (redoHistory.length > HISTORY_LIMIT) redoHistory.length = HISTORY_LIMIT
  restoreEntry(entry)
  syncHistoryFlags()
  collectUnusedClips()
}

export function redoAdvanced() {
  const entry = redoHistory.shift()
  if (!entry) return
  gesturePending = false
  history.unshift(captureEntry())
  if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT
  restoreEntry(entry)
  syncHistoryFlags()
  collectUnusedClips()
}

// Clears both stacks and any armed gesture. Used by tests for isolation.
export function resetAdvancedHistory() {
  history.length = 0
  redoHistory.length = 0
  gesturePending = false
  syncHistoryFlags()
}
