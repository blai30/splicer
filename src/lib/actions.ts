import { clips, playheadTime, selectedSegmentId, timeline } from '@/lib/store'
import {
  splitSegmentAtPlayhead,
  updateSegmentEndTime,
  updateSegmentStartTime,
} from '@/lib/timelineDomain'

export function setInPoint() {
  const seg = timeline.value.find((s) => s.id === selectedSegmentId.value)
  if (!seg) return
  timeline.value = updateSegmentStartTime(timeline.value, seg.id, playheadTime.value)
}

export function setOutPoint() {
  const seg = timeline.value.find((s) => s.id === selectedSegmentId.value)
  if (!seg) return
  const clipDur = clips.value.find((c) => c.id === seg.clipId)?.duration ?? playheadTime.value
  timeline.value = updateSegmentEndTime(timeline.value, seg.id, playheadTime.value, clipDur)
}

export function cutAtPlayhead() {
  const seg = timeline.value.find((s) => s.id === selectedSegmentId.value)
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
  const segs = timeline.value
  const idx = segs.findIndex((s) => s.id === segId)
  const next = segs.filter((s) => s.id !== segId)
  timeline.value = next
  selectedSegmentId.value = (next[idx] ?? next[idx - 1] ?? null)?.id ?? null
}
