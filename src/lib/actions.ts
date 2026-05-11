import { clips, playheadTime, selectedSegmentId, timeline } from '@/lib/store'
import {
  splitSegmentAtPlayhead,
  updateSegmentEndTime,
  updateSegmentStartTime,
} from '@/lib/timelineDomain'

/**
 * Get the currently selected segment, or undefined if none is selected.
 */
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
  // Select next segment in order, or previous if at end, or clear if empty
  selectedSegmentId.value = next[currentIdx]?.id ?? next[currentIdx - 1]?.id ?? null
}
