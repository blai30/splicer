import { batch } from '@preact/signals'

import {
  consumeAdvancedGesture,
  recordAdvancedEdit,
  recordAdvancedHistory,
  recordAdvancedHistoryCoalesced,
} from '@/lib/advanced/advancedHistory'
import {
  activeAdvancedTrackId,
  pruneAdvancedSelection,
  setAdvancedSelection,
} from '@/lib/advanced/advancedSelection'
import {
  ADV_MIN_SEGMENT_DURATION,
  segmentDuration,
  trackEndTime,
} from '@/lib/advanced/advancedTimelineDomain'
import { nextTrackName } from '@/lib/advanced/advancedTrackEditing'
import {
  closeTrackGaps,
  duplicateSegments,
  moveSegmentsBy,
  rippleDeleteSegments,
} from '@/lib/advanced/clipEditingDomain'
import { addClipToPool } from '@/lib/clipPool'
import { advancedSegments, advancedTracks, getClipById } from '@/lib/store'
import type { AdvancedSegment, Clip, CropParams, Transform } from '@/lib/types'

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
  setAdvancedSelection([segment.id])
  return segment.id
}

// Imports land after the existing content on the target track (the active
// track by default), so a multi-file import lays out in sequence instead of
// stacking every clip at 0s.
export function appendClipToTrack(clip: Clip, trackId?: string): string | null {
  const targetTrack = trackId ?? activeAdvancedTrackId()
  if (!targetTrack) return null
  return addClipToTrack(clip, targetTrack, trackEndTime(advancedSegments.value, targetTrack))
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

// Drop a clip onto a brand-new track above the top lane or below the bottom
// one. Creating the track and moving the clip is one undo step.
export function moveSegmentToNewTrack(
  id: string,
  position: 'top' | 'bottom',
  timelineStart: number
): string | null {
  if (!advancedSegments.value.some((segment) => segment.id === id)) return null
  recordAdvancedHistory()
  const track = { id: crypto.randomUUID(), name: nextTrackName(advancedTracks.value) }
  batch(() => {
    advancedTracks.value =
      position === 'top' ? [track, ...advancedTracks.value] : [...advancedTracks.value, track]
    advancedSegments.value = advancedSegments.value.map((segment) =>
      segment.id === id
        ? { ...segment, trackId: track.id, timelineStart: Math.max(0, timelineStart) }
        : segment
    )
  })
  return track.id
}

// Move several clips together as one undo step (a group drag).
export function moveSegments(ids: string[], deltaTime: number, laneDelta = 0): void {
  const next = moveSegmentsBy(
    advancedSegments.value,
    advancedTracks.value,
    new Set(ids),
    deltaTime,
    laneDelta
  )
  if (next === advancedSegments.value) return
  recordAdvancedHistory()
  advancedSegments.value = next
}

// Keyboard nudge: a burst of repeated presses is one undo step.
export function nudgeSegments(ids: string[], deltaTime: number): void {
  const next = moveSegmentsBy(advancedSegments.value, advancedTracks.value, new Set(ids), deltaTime)
  if (next === advancedSegments.value) return
  recordAdvancedHistoryCoalesced('timeline-nudge')
  advancedSegments.value = next
}

export function removeAdvancedSegment(id: string): void {
  removeSegments([id])
}

export function removeSegments(ids: string[]): void {
  const doomed = new Set(ids)
  if (!advancedSegments.value.some((segment) => doomed.has(segment.id))) return
  recordAdvancedHistory()
  advancedSegments.value = advancedSegments.value.filter((segment) => !doomed.has(segment.id))
  pruneAdvancedSelection()
}

// Delete and close the holes left on each clip's track.
export function rippleDeleteAdvancedSegments(ids: string[]): void {
  const next = rippleDeleteSegments(advancedSegments.value, new Set(ids))
  if (next === advancedSegments.value) return
  recordAdvancedHistory()
  advancedSegments.value = next
  pruneAdvancedSelection()
}

export function closeGapsOnTrack(trackId: string): void {
  const next = closeTrackGaps(advancedSegments.value, trackId)
  if (next === advancedSegments.value) return
  recordAdvancedHistory()
  advancedSegments.value = next
}

// Copy the clips right after themselves on their tracks; the copies become
// the selection.
export function duplicateAdvancedSegments(ids: string[]): string[] {
  const result = duplicateSegments(advancedSegments.value, new Set(ids), () => crypto.randomUUID())
  if (result.newIds.length === 0) return []
  recordAdvancedHistory()
  advancedSegments.value = result.segments
  setAdvancedSelection(result.newIds)
  return result.newIds
}

// Add already-built clips (a paste); they become the selection.
export function insertAdvancedSegments(segments: AdvancedSegment[]): void {
  if (segments.length === 0) return
  recordAdvancedHistory()
  advancedSegments.value = [...advancedSegments.value, ...segments]
  setAdvancedSelection(segments.map((segment) => segment.id))
}

// Mute every clip, or unmute them all when every one is already muted.
export function toggleSegmentsMuted(ids: string[]): void {
  const targets = new Set(ids)
  const members = advancedSegments.value.filter((segment) => targets.has(segment.id))
  if (members.length === 0) return
  const muted = !members.every((segment) => segment.muted)
  recordAdvancedHistory()
  advancedSegments.value = advancedSegments.value.map((segment) =>
    targets.has(segment.id) ? { ...segment, muted } : segment
  )
}

export type SegmentProps = Pick<AdvancedSegment, 'opacity' | 'volume' | 'fadeIn' | 'fadeOut'>

// Clamp a property edit into its range: opacity and volume 0..1, each fade
// 0..the clip's length.
export function clampSegmentProps(segment: AdvancedSegment, patch: SegmentProps): SegmentProps {
  const unit = (value: number) => Math.min(1, Math.max(0, value))
  const fade = (value: number) => Math.min(segmentDuration(segment), Math.max(0, value))
  const clamped: SegmentProps = {}
  if (patch.opacity !== undefined && Number.isFinite(patch.opacity)) {
    clamped.opacity = unit(patch.opacity)
  }
  if (patch.volume !== undefined && Number.isFinite(patch.volume)) {
    clamped.volume = unit(patch.volume)
  }
  if (patch.fadeIn !== undefined && Number.isFinite(patch.fadeIn)) {
    clamped.fadeIn = fade(patch.fadeIn)
  }
  if (patch.fadeOut !== undefined && Number.isFinite(patch.fadeOut)) {
    clamped.fadeOut = fade(patch.fadeOut)
  }
  return clamped
}

// Inspector edits. A slider drag (an armed gesture) or a run of key presses on
// one control is one undo step.
export function setSegmentProps(id: string, patch: SegmentProps): void {
  const segment = advancedSegments.value.find((entry) => entry.id === id)
  if (!segment) return
  const clamped = clampSegmentProps(segment, patch)
  const keys = Object.keys(clamped) as (keyof SegmentProps)[]
  if (keys.every((key) => segment[key] === clamped[key])) return
  recordAdvancedEdit(`props:${id}:${keys.join(',')}`)
  advancedSegments.value = advancedSegments.value.map((entry) =>
    entry.id === id ? { ...entry, ...clamped } : entry
  )
}

// A typed or one-shot placement (inspector fields, Fit, Fill): one undo step.
export function placeSegment(id: string, transform: Transform, crop?: CropParams): void {
  const segment = advancedSegments.value.find((entry) => entry.id === id)
  if (!segment) return
  const sameBox = (Object.keys(transform) as (keyof Transform)[]).every(
    (key) => segment.transform[key] === transform[key]
  )
  if (sameBox && (crop === undefined || crop === segment.crop)) return
  recordAdvancedHistory()
  advancedSegments.value = advancedSegments.value.map((entry) =>
    entry.id === id ? { ...entry, transform, ...(crop ? { crop } : {}) } : entry
  )
}

// Arrow-key nudge on the canvas, in world pixels; repeats are one undo step.
export function nudgeSegmentTransforms(ids: string[], dx: number, dy: number): void {
  const targets = new Set(ids)
  if (!advancedSegments.value.some((segment) => targets.has(segment.id))) return
  recordAdvancedHistoryCoalesced('canvas-nudge')
  advancedSegments.value = advancedSegments.value.map((segment) =>
    targets.has(segment.id)
      ? {
          ...segment,
          transform: {
            ...segment.transform,
            x: segment.transform.x + dx,
            y: segment.transform.y + dy,
          },
        }
      : segment
  )
}

// A group drag on the canvas: every clip moves from where it started.
export function setSegmentTransforms(transforms: Map<string, Transform>): void {
  consumeAdvancedGesture()
  advancedSegments.value = advancedSegments.value.map((segment) => {
    const transform = transforms.get(segment.id)
    return transform ? { ...segment, transform } : segment
  })
}

// Trim the head. The right edge stays put on the timeline: the left edge moves
// with the new source start. The source start can extend left only as far as
// both the media start (0) and the timeline origin allow.
export function trimSegmentStart(id: string, nextSourceStart: number): void {
  const segment = advancedSegments.value.find((entry) => entry.id === id)
  if (!segment) return
  const minSourceStart = Math.max(0, segment.sourceStart - segment.timelineStart)
  const clamped = Math.max(
    minSourceStart,
    Math.min(segment.sourceEnd - ADV_MIN_SEGMENT_DURATION, nextSourceStart)
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
  // Both pieces must be at least the minimum length (and therefore trimmable).
  if (sourceSplit - segment.sourceStart < ADV_MIN_SEGMENT_DURATION) return null
  if (segment.sourceEnd - sourceSplit < ADV_MIN_SEGMENT_DURATION) return null

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
