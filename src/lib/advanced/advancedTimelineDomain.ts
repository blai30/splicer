import type { AdvancedSegment, Track } from '@/lib/types'

export const ADV_MIN_SEGMENT_DURATION = 0.1

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

// Segments covering `time` on the output timeline (start inclusive, end exclusive).
export function segmentsActiveAt(segments: AdvancedSegment[], time: number): AdvancedSegment[] {
  return segments.filter(
    (segment) => time >= segment.timelineStart && time < segmentEndTime(segment)
  )
}

// Render order: lowest lane first (drawn underneath). Tracks are ordered
// top-to-bottom in the UI, so the bottom lane is the last track. Within a lane,
// array order breaks ties.
export function orderedForRender(
  segments: AdvancedSegment[],
  tracks: Track[]
): AdvancedSegment[] {
  const laneRank = new Map<string, number>()
  tracks.forEach((track, index) => laneRank.set(track.id, tracks.length - index))
  return [...segments].sort((first, second) => {
    const firstRank = laneRank.get(first.trackId) ?? 0
    const secondRank = laneRank.get(second.trackId) ?? 0
    return firstRank - secondRank
  })
}
