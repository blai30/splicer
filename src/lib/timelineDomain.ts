import type { Segment, SegmentLayoutItem } from '@/lib/types'

/**
 * Minimum allowed duration for a segment in seconds.
 * Prevents creation of very short segments that can't be meaningfully worked with.
 */
export const MIN_SEGMENT_DURATION = 0.1

export function clampPlayheadForSegment(seg: Segment, playhead: number): number {
  return Math.min(seg.endTime, Math.max(seg.startTime, playhead))
}

export function clampSegmentStartTime(nextStart: number, currentEnd: number, minStart = 0): number {
  return Math.min(currentEnd - MIN_SEGMENT_DURATION, Math.max(minStart, nextStart))
}

export function clampSegmentEndTime(
  nextEnd: number,
  currentStart: number,
  clipDuration: number
): number {
  return Math.min(clipDuration, Math.max(currentStart + MIN_SEGMENT_DURATION, nextEnd))
}

export function updateSegmentStartTime(
  segments: Segment[],
  segId: string,
  nextStart: number,
  minStart = 0
): Segment[] {
  return segments.map((s) =>
    s.id === segId
      ? {
          ...s,
          startTime: clampSegmentStartTime(nextStart, s.endTime, minStart),
        }
      : s
  )
}

export function updateSegmentEndTime(
  segments: Segment[],
  segId: string,
  nextEnd: number,
  clipDuration: number
): Segment[] {
  return segments.map((s) =>
    s.id === segId
      ? {
          ...s,
          endTime: clampSegmentEndTime(nextEnd, s.startTime, clipDuration),
        }
      : s
  )
}

export function splitSegmentAtPlayhead(
  segments: Segment[],
  segId: string,
  splitTime: number
): { nextSegments: Segment[]; newSegmentId: string } | null {
  const seg = segments.find((s) => s.id === segId)
  if (!seg) return null
  if (splitTime <= seg.startTime || splitTime >= seg.endTime) return null

  const first = { ...seg, endTime: splitTime }
  const second = { ...seg, id: crypto.randomUUID(), startTime: splitTime }

  return {
    nextSegments: segments.flatMap((s) => (s.id === seg.id ? [first, second] : [s])),
    newSegmentId: second.id,
  }
}

export function buildSegmentLayout(
  segments: Segment[],
  pxPerSec: number,
  gapPx: number,
  paddingPx: number
): SegmentLayoutItem[] {
  let cursorX = paddingPx
  const layout: SegmentLayoutItem[] = []

  for (const seg of segments) {
    const width = (seg.endTime - seg.startTime) * pxPerSec
    const startX = cursorX
    const endX = startX + width
    layout.push({ seg, startX, endX })
    cursorX = endX + gapPx
  }

  return layout
}

export function findSegmentAtTrackX(
  layout: SegmentLayoutItem[],
  x: number,
  pxPerSec: number
): { seg: Segment; time: number } | null {
  for (const item of layout) {
    if (x >= item.startX && x <= item.endX) {
      return {
        seg: item.seg,
        time: item.seg.startTime + (x - item.startX) / pxPerSec,
      }
    }
  }

  return null
}

export function findDropIndexAtTrackX(
  segments: Segment[],
  x: number,
  pxPerSec: number,
  gapPx: number
): number {
  let accX = 0
  let dropIdx = 0

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const width = (seg.endTime - seg.startTime) * pxPerSec
    if (x < accX + width / 2) {
      dropIdx = i
      break
    }
    accX += width + gapPx
    dropIdx = i + 1
  }

  return dropIdx
}
