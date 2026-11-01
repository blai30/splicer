import { consumeAdvancedGesture, recordAdvancedHistory } from '@/lib/advanced/advancedHistory'
import { ADV_MIN_SEGMENT_DURATION } from '@/lib/advanced/advancedTimelineDomain'
import { addClipToPool } from '@/lib/clipPool'
import { advancedSegments, advancedSelectedId, getClipById } from '@/lib/store'
import type { Clip, CropParams, Transform } from '@/lib/types'

export function addClipToTrack(clip: Clip, trackId: string, timelineStart: number): string {
  recordAdvancedHistory()
  addClipToPool(clip)
  // Place the clip at its native pixel size with its top-left at the world
  // origin. The infinite canvas has no fixed frame to fit into; the user
  // repositions/resizes from there.
  const segment = {
    id: crypto.randomUUID(),
    clipId: clip.id,
    trackId,
    timelineStart: Math.max(0, timelineStart),
    sourceStart: 0,
    sourceEnd: clip.duration,
    transform: { x: 0, y: 0, width: clip.width, height: clip.height },
  }
  advancedSegments.value = [...advancedSegments.value, segment]
  advancedSelectedId.value = segment.id
  return segment.id
}

export function moveSegment(id: string, trackId: string, timelineStart: number): void {
  const current = advancedSegments.value.find((segment) => segment.id === id)
  if (!current) return
  const nextStart = Math.max(0, timelineStart)
  if (current.trackId === trackId && current.timelineStart === nextStart) return
  recordAdvancedHistory()
  advancedSegments.value = advancedSegments.value.map((segment) =>
    segment.id === id ? { ...segment, trackId, timelineStart: nextStart } : segment
  )
}

export function removeAdvancedSegment(id: string): void {
  if (!advancedSegments.value.some((segment) => segment.id === id)) return
  recordAdvancedHistory()
  advancedSegments.value = advancedSegments.value.filter((segment) => segment.id !== id)
  if (advancedSelectedId.value === id) advancedSelectedId.value = null
}

export function selectAdvancedSegment(id: string | null): void {
  advancedSelectedId.value = id
}

// Trim the head. The right edge stays put on the timeline: the left edge moves
// with the new source start. The source start can extend left only as far as
// both the media start (0) and the timeline origin allow.
export function trimSegmentStart(id: string, nextSourceStart: number): void {
  const segment = advancedSegments.value.find((entry) => entry.id === id)
  if (!segment) return
  const minSourceStart = Math.max(0, segment.sourceStart - segment.timelineStart)
  const clamped = Math.min(
    segment.sourceEnd - ADV_MIN_SEGMENT_DURATION,
    Math.max(minSourceStart, nextSourceStart)
  )
  if (clamped === segment.sourceStart) return
  const delta = clamped - segment.sourceStart
  consumeAdvancedGesture()
  advancedSegments.value = advancedSegments.value.map((entry) =>
    entry.id === id
      ? {
          ...entry,
          sourceStart: clamped,
          timelineStart: Math.max(0, entry.timelineStart + delta),
        }
      : entry
  )
}

export function trimSegmentEnd(id: string, nextSourceEnd: number): void {
  const segment = advancedSegments.value.find((entry) => entry.id === id)
  if (!segment) return
  const maxEnd = getClipById(segment.clipId)?.duration ?? segment.sourceEnd
  const clamped = Math.min(
    maxEnd,
    Math.max(segment.sourceStart + ADV_MIN_SEGMENT_DURATION, nextSourceEnd)
  )
  if (clamped === segment.sourceEnd) return
  consumeAdvancedGesture()
  advancedSegments.value = advancedSegments.value.map((entry) =>
    entry.id === id ? { ...entry, sourceEnd: clamped } : entry
  )
}

// Split at an absolute timeline time. The first part keeps the head; the second
// part starts at the split with the matching source offset.
export function splitAdvancedSegment(id: string, atGlobalTime: number): string | null {
  const segment = advancedSegments.value.find((entry) => entry.id === id)
  if (!segment) return null
  const localTime = atGlobalTime - segment.timelineStart
  const sourceSplit = segment.sourceStart + localTime
  if (sourceSplit <= segment.sourceStart || sourceSplit >= segment.sourceEnd) return null

  recordAdvancedHistory()
  const newId = crypto.randomUUID()
  const first = { ...segment, sourceEnd: sourceSplit }
  const second = {
    ...segment,
    id: newId,
    sourceStart: sourceSplit,
    timelineStart: atGlobalTime,
  }
  advancedSegments.value = advancedSegments.value.flatMap((entry) =>
    entry.id === id ? [first, second] : [entry]
  )
  return newId
}

export function setSegmentTransform(id: string, transform: Transform): void {
  consumeAdvancedGesture()
  advancedSegments.value = advancedSegments.value.map((segment) =>
    segment.id === id ? { ...segment, transform } : segment
  )
}

export function setSegmentCrop(id: string, crop: CropParams | undefined): void {
  consumeAdvancedGesture()
  advancedSegments.value = advancedSegments.value.map((segment) =>
    segment.id === id ? { ...segment, crop } : segment
  )
}

export function toggleSegmentMute(id: string): void {
  if (!advancedSegments.value.some((segment) => segment.id === id)) return
  recordAdvancedHistory()
  advancedSegments.value = advancedSegments.value.map((segment) =>
    segment.id === id ? { ...segment, muted: !segment.muted } : segment
  )
}
