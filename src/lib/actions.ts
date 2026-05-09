import { clips, playheadTime, selectedSegmentId, timeline } from './store'

export function setInPoint() {
  const seg = timeline.value.find((s) => s.id === selectedSegmentId.value)
  if (!seg) return
  const t = playheadTime.value
  timeline.value = timeline.value.map((s) =>
    s.id === seg.id ? { ...s, startTime: Math.max(0, Math.min(t, s.endTime - 0.1)) } : s
  )
}

export function setOutPoint() {
  const seg = timeline.value.find((s) => s.id === selectedSegmentId.value)
  if (!seg) return
  const t = playheadTime.value
  const clipDur = clips.value.find((c) => c.id === seg.clipId)?.duration ?? t
  timeline.value = timeline.value.map((s) =>
    s.id === seg.id ? { ...s, endTime: Math.min(clipDur, Math.max(t, s.startTime + 0.1)) } : s
  )
}

export function cutAtPlayhead() {
  const seg = timeline.value.find((s) => s.id === selectedSegmentId.value)
  if (!seg) return
  const t = playheadTime.value
  if (t <= seg.startTime || t >= seg.endTime) return
  const first = { ...seg, endTime: t }
  const second = { ...seg, id: crypto.randomUUID(), startTime: t }
  timeline.value = timeline.value.flatMap((s) => (s.id === seg.id ? [first, second] : [s]))
  selectedSegmentId.value = second.id
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
