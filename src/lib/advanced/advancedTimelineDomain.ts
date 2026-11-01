import type { AdvancedSegment, Track } from '@/lib/types'

export const ADV_MIN_SEGMENT_DURATION = 0.1
// Left padding of the lanes, in px: time 0 sits this far from the lane edge.
// Clip blocks, the playhead, and pointer-to-time math all use it.
export const TIMELINE_PAD_LEFT = 8

export function segmentDuration(segment: AdvancedSegment): number {
  return segment.sourceEnd - segment.sourceStart
}

export function segmentEndTime(segment: AdvancedSegment): number {
  return segment.timelineStart + segmentDuration(segment)
}

export function projectDuration(segments: AdvancedSegment[]): number {
  let max = 0
  for (const segment of segments) max = Math.max(max, segmentEndTime(segment))
  return max
}

// Where the content on one track ends (0 for an empty track).
export function trackEndTime(segments: AdvancedSegment[], trackId: string): number {
  return projectDuration(segments.filter((segment) => segment.trackId === trackId))
}

// Segments covering `time` on the output timeline (start inclusive, end exclusive).
export function segmentsActiveAt(segments: AdvancedSegment[], time: number): AdvancedSegment[] {
  return segments.filter(
    (segment) => time >= segment.timelineStart && time < segmentEndTime(segment)
  )
}

// Render order: lowest lane first (drawn underneath). Tracks are ordered
// top-to-bottom in the UI, so the bottom lane is the last track. Within a lane,
// array order breaks ties.
export function orderedForRender(segments: AdvancedSegment[], tracks: Track[]): AdvancedSegment[] {
  const laneRank = new Map<string, number>()
  tracks.forEach((track, index) => laneRank.set(track.id, tracks.length - index))
  return [...segments].sort((first, second) => {
    const firstRank = laneRank.get(first.trackId) ?? 0
    const secondRank = laneRank.get(second.trackId) ?? 0
    return firstRank - secondRank
  })
}

export type LaneDropTarget =
  | { kind: 'lane'; index: number }
  | { kind: 'new'; position: 'top' | 'bottom' }

// Which lane a dragged clip lands in, from the pointer's offset below the top
// of the first lane. Above the first lane or below the last one means a new
// track there.
export function laneDropTarget(
  offsetY: number,
  laneHeight: number,
  laneCount: number
): LaneDropTarget {
  if (offsetY < 0) return { kind: 'new', position: 'top' }
  const index = Math.floor(offsetY / laneHeight)
  if (index >= laneCount) return { kind: 'new', position: 'bottom' }
  return { kind: 'lane', index }
}
