import { clips, getClipById, playheadTime, selectedSegmentId, timeline } from '@/lib/store'
import {
  splitSegmentAtPlayhead,
  updateSegmentEndTime,
  updateSegmentStartTime,
} from '@/lib/timelineDomain'
import type { Clip, Segment } from '@/lib/types'

// Every timeline mutation goes through this module so the undo history sees
// all edits: imports, trims, reorders, cuts, mutes, in/out points, deletes.

const HISTORY_LIMIT = 20

type HistoryEntry = {
  timeline: Segment[]
  clips: Clip[]
  selectedSegmentId: string | null
}

const history: HistoryEntry[] = []

function recordHistory() {
  history.unshift({
    timeline: timeline.value,
    clips: clips.value,
    selectedSegmentId: selectedSegmentId.value,
  })
  if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT
}

// Continuous gestures (trim drags) record one history entry for the whole
// gesture: beginGesture() arms the flag and the first mutation consumes it.
let gesturePending = false

export function beginGesture() {
  gesturePending = true
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

function removeOrphanedClips() {
  // Remove clips no longer referenced by any segment and revoke their object
  // URLs. Undo recreates the URL from the original File reference.
  const referenced = new Set<string>(timeline.value.map((segment) => segment.clipId))
  const removedClips = clips.value.filter((clip) => !referenced.has(clip.id))
  if (removedClips.length === 0) return
  for (const clip of removedClips) {
    try {
      URL.revokeObjectURL(clip.objectUrl)
    } catch {
      // Best-effort
    }
  }
  clips.value = clips.value.filter((clip) => referenced.has(clip.id))
}

export function appendClipToTimeline(clip: Clip) {
  recordHistory()
  clips.value = [...clips.value, clip]
  const wasEmpty = timeline.value.length === 0
  const segment: Segment = {
    id: crypto.randomUUID(),
    clipId: clip.id,
    startTime: 0,
    endTime: clip.duration,
  }
  timeline.value = [...timeline.value, segment]
  if (wasEmpty) selectedSegmentId.value = segment.id
}

export function setInPoint() {
  const segment = getSelectedSegment()
  if (!segment) return
  recordHistory()
  timeline.value = updateSegmentStartTime(timeline.value, segment.id, playheadTime.value)
}

export function setOutPoint() {
  const segment = getSelectedSegment()
  if (!segment) return
  const clipDur =
    clips.value.find((clip) => clip.id === segment.clipId)?.duration ?? playheadTime.value
  recordHistory()
  timeline.value = updateSegmentEndTime(timeline.value, segment.id, playheadTime.value, clipDur)
}

export function cutAtPlayhead() {
  const segment = getSelectedSegment()
  if (!segment) return
  const split = splitSegmentAtPlayhead(timeline.value, segment.id, playheadTime.value)
  if (!split) return
  recordHistory()
  timeline.value = split.nextSegments
  selectedSegmentId.value = split.newSegmentId
}

export function toggleMute() {
  const segmentId = selectedSegmentId.value
  if (!segmentId) return
  recordHistory()
  timeline.value = timeline.value.map((segment) =>
    segment.id === segmentId ? { ...segment, muted: !segment.muted } : segment
  )
}

export function trimSegmentStart(segmentId: string, nextStart: number) {
  consumeGesturePending()
  timeline.value = updateSegmentStartTime(timeline.value, segmentId, nextStart)
}

export function trimSegmentEnd(segmentId: string, nextEnd: number) {
  const segment = timeline.value.find((segment) => segment.id === segmentId)
  if (!segment) return
  const clipDuration = getClipById(segment.clipId)?.duration ?? segment.endTime
  consumeGesturePending()
  timeline.value = updateSegmentEndTime(timeline.value, segmentId, nextEnd, clipDuration)
}

export function reorderSegment(segmentId: string, dropIndex: number) {
  const fromIndex = timeline.value.findIndex((segment) => segment.id === segmentId)
  if (fromIndex === -1) return
  if (fromIndex === dropIndex || fromIndex + 1 === dropIndex) return
  recordHistory()
  const segments = [...timeline.value]
  const [removed] = segments.splice(fromIndex, 1)
  const adjusted = dropIndex > fromIndex ? dropIndex - 1 : dropIndex
  segments.splice(adjusted, 0, removed)
  timeline.value = segments
}

export function deleteSegment() {
  const segId = selectedSegmentId.value
  if (!segId) return
  const currentIndex = timeline.value.findIndex((segment) => segment.id === segId)
  if (currentIndex === -1) return
  recordHistory()
  const next = timeline.value.filter((segment) => segment.id !== segId)
  timeline.value = next
  selectedSegmentId.value = next[currentIndex]?.id ?? next[currentIndex - 1]?.id ?? null
  removeOrphanedClips()
}

export function undo() {
  const entry = history.shift()
  if (!entry) return

  // Clips that exist now but not in the restored state (e.g. undoing an
  // import) lose their object URLs.
  for (const clip of clips.value) {
    if (!entry.clips.some((entryClip) => entryClip.id === clip.id)) {
      try {
        URL.revokeObjectURL(clip.objectUrl)
      } catch {
        // Best-effort
      }
    }
  }

  const restoredClips = entry.clips.map((entryClip) => {
    // Prefer the live clip when it survived: its object URL is still valid
    // and it may have gained waveform peaks since the snapshot.
    const liveClip = clips.value.find((clip) => clip.id === entryClip.id)
    if (liveClip) return liveClip
    // The clip was removed and its object URL revoked; recreate it from the
    // original File reference so the video plays again.
    return { ...entryClip, objectUrl: URL.createObjectURL(entryClip.file) }
  })

  timeline.value = entry.timeline
  clips.value = restoredClips
  selectedSegmentId.value =
    entry.selectedSegmentId &&
    entry.timeline.some((segment) => segment.id === entry.selectedSegmentId)
      ? entry.selectedSegmentId
      : (entry.timeline[0]?.id ?? null)
}
