import { batch, signal } from '@preact/signals'

import { addClipToPool, collectUnusedClips, registerClipReferences } from '@/lib/clipPool'
import { getClipById, playheadTime, selectedSegmentId, timeline } from '@/lib/store'
import {
  splitSegmentAtPlayhead,
  updateSegmentEndTime,
  updateSegmentStartTime,
} from '@/lib/timelineDomain'
import type { Clip, Segment } from '@/lib/types'

// Every Basic timeline mutation goes through this module so the undo history
// sees all edits: imports, trims, reorders, cuts, mutes, in/out points, deletes.

const HISTORY_LIMIT = 50

type HistoryEntry = {
  timeline: Segment[]
  selectedSegmentId: string | null
}

const history: HistoryEntry[] = []
const redoHistory: HistoryEntry[] = []

// Reactive flags for undo/redo buttons.
export const canUndo = signal(false)
export const canRedo = signal(false)

function syncHistoryFlags() {
  canUndo.value = history.length > 0
  canRedo.value = redoHistory.length > 0
}

// The Basic editor can reach every clip in its live timeline and in any
// snapshot on its undo/redo stacks.
registerClipReferences(function* () {
  for (const segment of timeline.value) yield segment.clipId
  for (const entry of history) for (const segment of entry.timeline) yield segment.clipId
  for (const entry of redoHistory) for (const segment of entry.timeline) yield segment.clipId
})

function captureEntry(): HistoryEntry {
  return { timeline: timeline.value, selectedSegmentId: selectedSegmentId.value }
}

function recordHistory() {
  history.unshift(captureEntry())
  if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT
  // A new edit invalidates the redo branch.
  redoHistory.length = 0
  syncHistoryFlags()
}

// Apply a timeline change as one undoable step. No-op changes (same array
// contents) do not pollute the history.
function commit(next: Segment[], nextSelected: string | null = selectedSegmentId.value) {
  if (sameSegments(next, timeline.value) && nextSelected === selectedSegmentId.value) return
  recordHistory()
  batch(() => {
    timeline.value = next
    selectedSegmentId.value = nextSelected
  })
  collectUnusedClips()
}

function sameSegments(first: Segment[], second: Segment[]): boolean {
  if (first.length !== second.length) return false
  for (let i = 0; i < first.length; i++) {
    const a = first[i]
    const b = second[i]
    if (
      a.id !== b.id ||
      a.startTime !== b.startTime ||
      a.endTime !== b.endTime ||
      a.muted !== b.muted ||
      a.clipId !== b.clipId
    ) {
      return false
    }
  }
  return true
}

// Continuous gestures (trim drags) record one history entry for the whole
// gesture: beginGesture() arms the flag and the first mutation consumes it.
let gesturePending = false
// True from beginGesture() until endGesture(). Undo/redo wait for the drag to
// finish: undoing mid-drag would leave the rest of it unrecorded and a stale
// mid-drag snapshot on the redo stack.
let gestureActive = false

// End the gesture when the pointer is released anywhere. The dragged element's
// own pointerup handler runs first (this listens in the bubble phase on
// window), and this also covers an element removed mid-drag (e.g. Delete
// pressed while trimming), whose own listeners never fire. Without it the
// gesture would stay active and block undo for the rest of the session.
function onGlobalPointerEnd() {
  endGesture()
}

export function beginGesture() {
  gesturePending = true
  gestureActive = true
  if (typeof window !== 'undefined') {
    window.addEventListener('pointerup', onGlobalPointerEnd)
    window.addEventListener('pointercancel', onGlobalPointerEnd)
  }
}

// Disarm a gesture that ended without mutating anything.
export function endGesture() {
  gesturePending = false
  gestureActive = false
  if (typeof window !== 'undefined') {
    window.removeEventListener('pointerup', onGlobalPointerEnd)
    window.removeEventListener('pointercancel', onGlobalPointerEnd)
  }
}

function consumeGesturePending() {
  if (gesturePending) {
    gesturePending = false
    recordHistory()
  }
}

function getSelectedSegment() {
  return timeline.value.find((segment) => segment.id === selectedSegmentId.value)
}

export function appendClipToTimeline(clip: Clip) {
  addClipToPool(clip)
  const segment: Segment = {
    id: crypto.randomUUID(),
    clipId: clip.id,
    startTime: 0,
    endTime: clip.duration,
  }
  const wasEmpty = timeline.value.length === 0
  commit([...timeline.value, segment], wasEmpty ? segment.id : selectedSegmentId.value)
}

export function setInPoint() {
  const segment = getSelectedSegment()
  if (!segment) return
  const playhead = playheadTime.value
  // A playhead outside the segment would clamp to an edge: do nothing instead.
  if (playhead <= segment.startTime || playhead >= segment.endTime) return
  commit(updateSegmentStartTime(timeline.value, segment.id, playhead))
}

export function setOutPoint() {
  const segment = getSelectedSegment()
  if (!segment) return
  const playhead = playheadTime.value
  if (playhead <= segment.startTime || playhead >= segment.endTime) return
  const clipDuration = getClipById(segment.clipId)?.duration ?? segment.endTime
  commit(updateSegmentEndTime(timeline.value, segment.id, playhead, clipDuration))
}

export function cutAtPlayhead() {
  const segment = getSelectedSegment()
  if (!segment) return
  const split = splitSegmentAtPlayhead(timeline.value, segment.id, playheadTime.value)
  if (!split) return
  commit(split.nextSegments, split.newSegmentId)
}

export function toggleMute() {
  const segmentId = selectedSegmentId.value
  if (!segmentId || !getSelectedSegment()) return
  commit(
    timeline.value.map((segment) =>
      segment.id === segmentId ? { ...segment, muted: !segment.muted } : segment
    )
  )
}

export function trimSegmentStart(segmentId: string, nextStart: number) {
  const next = updateSegmentStartTime(timeline.value, segmentId, nextStart)
  if (sameSegments(next, timeline.value)) return
  consumeGesturePending()
  timeline.value = next
}

export function trimSegmentEnd(segmentId: string, nextEnd: number) {
  const segment = timeline.value.find((entry) => entry.id === segmentId)
  if (!segment) return
  const clipDuration = getClipById(segment.clipId)?.duration ?? segment.endTime
  const next = updateSegmentEndTime(timeline.value, segmentId, nextEnd, clipDuration)
  if (sameSegments(next, timeline.value)) return
  consumeGesturePending()
  timeline.value = next
}

export function reorderSegment(segmentId: string, dropIndex: number) {
  const fromIndex = timeline.value.findIndex((segment) => segment.id === segmentId)
  if (fromIndex === -1) return
  if (fromIndex === dropIndex || fromIndex + 1 === dropIndex) return
  const segments = [...timeline.value]
  const [removed] = segments.splice(fromIndex, 1)
  const adjusted = dropIndex > fromIndex ? dropIndex - 1 : dropIndex
  segments.splice(adjusted, 0, removed)
  commit(segments)
}

export function deleteSegment() {
  const segmentId = selectedSegmentId.value
  if (!segmentId) return
  const currentIndex = timeline.value.findIndex((segment) => segment.id === segmentId)
  if (currentIndex === -1) return
  const next = timeline.value.filter((segment) => segment.id !== segmentId)
  commit(next, next[currentIndex]?.id ?? next[currentIndex - 1]?.id ?? null)
}

export function clearTimeline() {
  if (timeline.value.length === 0) return
  commit([], null)
}

function restoreEntry(entry: HistoryEntry) {
  batch(() => {
    timeline.value = entry.timeline
    selectedSegmentId.value =
      entry.selectedSegmentId &&
      entry.timeline.some((segment) => segment.id === entry.selectedSegmentId)
        ? entry.selectedSegmentId
        : (entry.timeline[0]?.id ?? null)
  })
}

export function undo() {
  if (gestureActive) return
  const entry = history.shift()
  if (!entry) return
  redoHistory.unshift(captureEntry())
  if (redoHistory.length > HISTORY_LIMIT) redoHistory.length = HISTORY_LIMIT
  restoreEntry(entry)
  syncHistoryFlags()
  collectUnusedClips()
}

export function redo() {
  if (gestureActive) return
  const entry = redoHistory.shift()
  if (!entry) return
  history.unshift(captureEntry())
  if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT
  restoreEntry(entry)
  syncHistoryFlags()
  collectUnusedClips()
}

// Clears both stacks and any armed gesture. Used by tests for isolation.
export function resetHistory() {
  history.length = 0
  redoHistory.length = 0
  gesturePending = false
  gestureActive = false
  syncHistoryFlags()
}
