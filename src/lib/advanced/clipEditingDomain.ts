import { segmentDuration, segmentEndTime } from '@/lib/advanced/advancedTimelineDomain'
import type { AdvancedSegment, Track } from '@/lib/types'

// Pure timeline edits on many clips at once. Each returns the next segment
// list (and new ids where clips are created); the editing actions wrap them
// with one history entry.

export type Interval = { start: number; end: number }

const EPSILON = 1e-9

function laneIndexMap(tracks: Track[]): Map<string, number> {
  return new Map(tracks.map((track, index) => [track.id, index]))
}

// The time shift a group may take: no member may go before 0.
export function clampGroupDelta(members: AdvancedSegment[], deltaTime: number): number {
  if (members.length === 0) return 0
  const earliest = Math.min(...members.map((segment) => segment.timelineStart))
  return Math.max(-earliest, deltaTime)
}

// The lane shift a group may take: every member must stay on an existing lane.
export function clampLaneDelta(
  members: AdvancedSegment[],
  tracks: Track[],
  laneDelta: number
): number {
  const lanes = laneIndexMap(tracks)
  const indices = members.map((segment) => lanes.get(segment.trackId) ?? 0)
  if (indices.length === 0) return 0
  const lowest = Math.min(...indices)
  const highest = Math.max(...indices)
  return Math.max(-lowest, Math.min(tracks.length - 1 - highest, laneDelta))
}

// Move every clip in `ids` by the same time and lane offsets, keeping their
// relative placement. Both offsets clamp as a group, so the layout never
// distorts at the timeline start or the top and bottom lanes.
export function moveSegmentsBy(
  segments: AdvancedSegment[],
  tracks: Track[],
  ids: ReadonlySet<string>,
  deltaTime: number,
  laneDelta = 0
): AdvancedSegment[] {
  const members = segments.filter((segment) => ids.has(segment.id))
  const time = clampGroupDelta(members, deltaTime)
  const lanes = clampLaneDelta(members, tracks, laneDelta)
  if (Math.abs(time) < EPSILON && lanes === 0) return segments
  const laneOf = laneIndexMap(tracks)
  return segments.map((segment) => {
    if (!ids.has(segment.id)) return segment
    const lane = (laneOf.get(segment.trackId) ?? 0) + lanes
    return {
      ...segment,
      timelineStart: Math.max(0, segment.timelineStart + time),
      trackId: tracks[lane]?.id ?? segment.trackId,
    }
  })
}

// Copies of the clips in `ids`, each on its original's track, placed right
// after the selection: the group shifts by its own span, so a single clip
// lands at its own end and a group keeps its arrangement.
export function duplicateSegments(
  segments: AdvancedSegment[],
  ids: ReadonlySet<string>,
  makeId: () => string
): { segments: AdvancedSegment[]; newIds: string[] } {
  const members = segments.filter((segment) => ids.has(segment.id))
  if (members.length === 0) return { segments, newIds: [] }
  const groupStart = Math.min(...members.map((segment) => segment.timelineStart))
  const groupEnd = Math.max(...members.map(segmentEndTime))
  const shift = groupEnd - groupStart
  const clones = members.map((segment) => ({
    ...segment,
    id: makeId(),
    timelineStart: segment.timelineStart + shift,
  }))
  return { segments: [...segments, ...clones], newIds: clones.map((clone) => clone.id) }
}

// Place copied clips with the earliest at `atTime` and the topmost on lane
// `targetLane`; the rest keep their time and lane offsets from those two,
// clamped to the last lane.
export function pasteSegments(
  copied: { segment: AdvancedSegment; laneOffset: number }[],
  tracks: Track[],
  atTime: number,
  targetLane: number,
  makeId: () => string
): AdvancedSegment[] {
  if (copied.length === 0 || tracks.length === 0) return []
  const earliest = Math.min(...copied.map(({ segment }) => segment.timelineStart))
  const start = Math.max(0, atTime)
  return copied.map(({ segment, laneOffset }) => {
    const lane = Math.min(tracks.length - 1, Math.max(0, targetLane + laneOffset))
    return {
      ...segment,
      id: makeId(),
      trackId: tracks[lane].id,
      timelineStart: start + (segment.timelineStart - earliest),
    }
  })
}

// Merge overlapping or touching intervals.
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals]
    .filter((interval) => interval.end > interval.start)
    .sort((first, second) => first.start - second.start)
  const merged: Interval[] = []
  for (const interval of sorted) {
    const last = merged.at(-1)
    if (last && interval.start <= last.end + EPSILON) last.end = Math.max(last.end, interval.end)
    else merged.push({ ...interval })
  }
  return merged
}

// Parts of `from` not covered by any interval in `cover`.
export function subtractIntervals(from: Interval[], cover: Interval[]): Interval[] {
  const covered = mergeIntervals(cover)
  const result: Interval[] = []
  for (const interval of mergeIntervals(from)) {
    let cursor = interval.start
    for (const block of covered) {
      if (block.end <= cursor || block.start >= interval.end) continue
      if (block.start > cursor) result.push({ start: cursor, end: block.start })
      cursor = Math.max(cursor, block.end)
    }
    if (cursor < interval.end - EPSILON) result.push({ start: cursor, end: interval.end })
  }
  return result
}

function intervalOf(segment: AdvancedSegment): Interval {
  return { start: segment.timelineStart, end: segmentEndTime(segment) }
}

// Shift each clip left by how much of `gaps` lies before it.
function shiftPastGaps(segment: AdvancedSegment, gaps: Interval[]): AdvancedSegment {
  let shift = 0
  for (const gap of gaps) {
    shift += Math.max(0, Math.min(gap.end, segment.timelineStart) - gap.start)
  }
  return shift > EPSILON
    ? { ...segment, timelineStart: Math.max(0, segment.timelineStart - shift) }
    : segment
}

// Delete the clips in `ids` and close the holes they leave on their own
// tracks: later clips on each track slide left by the empty time the delete
// created. Time still covered by another clip is not a hole, and other tracks
// stay put.
export function rippleDeleteSegments(
  segments: AdvancedSegment[],
  ids: ReadonlySet<string>
): AdvancedSegment[] {
  const removed = segments.filter((segment) => ids.has(segment.id))
  if (removed.length === 0) return segments
  const remaining = segments.filter((segment) => !ids.has(segment.id))
  const gapsByTrack = new Map<string, Interval[]>()
  for (const trackId of new Set(removed.map((segment) => segment.trackId))) {
    const onTrack = (segment: AdvancedSegment) => segment.trackId === trackId
    gapsByTrack.set(
      trackId,
      subtractIntervals(
        removed.filter(onTrack).map(intervalOf),
        remaining.filter(onTrack).map(intervalOf)
      )
    )
  }
  return remaining.map((segment) => {
    const gaps = gapsByTrack.get(segment.trackId)
    return gaps ? shiftPastGaps(segment, gaps) : segment
  })
}

// Pull every clip on a track left so no empty time is left between clips.
// Time before the first clip is kept, since an offset track start is often
// deliberate (B-roll that enters later).
export function closeTrackGaps(segments: AdvancedSegment[], trackId: string): AdvancedSegment[] {
  const onTrack = segments
    .filter((segment) => segment.trackId === trackId)
    .sort((first, second) => first.timelineStart - second.timelineStart)
  if (onTrack.length < 2) return segments
  const nextStart = new Map<string, number>()
  let shift = 0
  let cursor = onTrack[0].timelineStart
  for (const segment of onTrack) {
    let start = segment.timelineStart - shift
    if (start > cursor + EPSILON) {
      shift += start - cursor
      start = cursor
    }
    nextStart.set(segment.id, start)
    cursor = Math.max(cursor, start + segmentDuration(segment))
  }
  let changed = false
  const next = segments.map((segment) => {
    const start = nextStart.get(segment.id)
    if (start === undefined || Math.abs(start - segment.timelineStart) < EPSILON) return segment
    changed = true
    return { ...segment, timelineStart: start }
  })
  return changed ? next : segments
}

export function trackHasGaps(segments: AdvancedSegment[], trackId: string): boolean {
  return closeTrackGaps(segments, trackId) !== segments
}

// Time spans where two or more clips on a track play at once. Clips that only
// touch do not overlap.
export function laneOverlaps(segments: AdvancedSegment[], trackId: string): Interval[] {
  const events: { time: number; change: 1 | -1 }[] = []
  for (const segment of segments) {
    if (segment.trackId !== trackId || segmentDuration(segment) <= 0) continue
    events.push({ time: segment.timelineStart, change: 1 })
    events.push({ time: segmentEndTime(segment), change: -1 })
  }
  // Ends before starts at the same time, so touching clips never count.
  events.sort((first, second) => first.time - second.time || first.change - second.change)
  const overlaps: Interval[] = []
  let active = 0
  let overlapStart = 0
  for (const event of events) {
    const before = active
    active += event.change
    if (before < 2 && active >= 2) overlapStart = event.time
    if (before >= 2 && active < 2 && event.time > overlapStart + EPSILON) {
      overlaps.push({ start: overlapStart, end: event.time })
    }
  }
  return mergeIntervals(overlaps)
}
