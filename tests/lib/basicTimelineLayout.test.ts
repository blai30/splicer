import { describe, expect, it } from 'vitest'

import {
  buildSegmentLayout,
  cutMarkerXs,
  findDropIndexAtTrackX,
  findSegmentAtTrackX,
  globalTimeToSegment,
  globalTimeToX,
  layoutDuration,
  playheadXInLayout,
  xToGlobalTime,
} from '@/lib/timelineDomain'
import type { Segment } from '@/lib/types'

const GAP = 4
const PADDING = 16

function segment(id: string, startTime: number, endTime: number): Segment {
  return { id, clipId: `clip-${id}`, startTime, endTime }
}

// Two segments: 2 s from 10 s into its clip, then 3 s from the start of another.
const segments = [segment('a', 10, 12), segment('b', 0, 3)]
const layout = buildSegmentLayout(segments, 100, GAP, PADDING)

describe('Basic layout mapping across cuts', () => {
  it('lays blocks out with the gap between them', () => {
    expect(layout.map((item) => [item.startX, item.endX])).toEqual([
      [16, 216],
      [220, 520],
    ])
    expect(layoutDuration(layout)).toBe(5)
  })

  it('maps concatenated time to x through the gaps', () => {
    expect(globalTimeToX(layout, 0)).toBe(16)
    expect(globalTimeToX(layout, 1)).toBe(116)
    // A cut belongs to the later block, past the gap.
    expect(globalTimeToX(layout, 2)).toBe(220)
    expect(globalTimeToX(layout, 3.5)).toBe(370)
    expect(globalTimeToX(layout, 5)).toBe(520)
    expect(globalTimeToX(layout, 99)).toBe(520)
  })

  it('maps x back to concatenated time, resolving padding and gaps', () => {
    expect(xToGlobalTime(layout, 0)).toBe(0)
    expect(xToGlobalTime(layout, 116)).toBe(1)
    expect(xToGlobalTime(layout, 218)).toBe(2)
    expect(xToGlobalTime(layout, 370)).toBe(3.5)
    expect(xToGlobalTime(layout, 900)).toBe(5)
    for (const time of [0.25, 1.9, 2.4, 4.75]) {
      expect(xToGlobalTime(layout, globalTimeToX(layout, time))).toBeCloseTo(time)
    }
  })

  it('finds the segment and source time at a concatenated time', () => {
    expect(globalTimeToSegment(layout, 1.5)).toEqual({ segment: segments[0], time: 11.5 })
    expect(globalTimeToSegment(layout, 2)).toEqual({ segment: segments[1], time: 0 })
    // The very end is the last segment's out-point.
    expect(globalTimeToSegment(layout, 5)).toEqual({ segment: segments[1], time: 3 })
    expect(globalTimeToSegment([], 1)).toBeNull()
  })

  it('marks cuts at the middle of each gap', () => {
    expect(cutMarkerXs(layout, GAP)).toEqual([218])
    expect(cutMarkerXs(layout.slice(0, 1), GAP)).toEqual([])
  })

  it('places the playhead inside the active block', () => {
    expect(playheadXInLayout(layout, 'a', 11, PADDING)).toBe(116)
    expect(playheadXInLayout(layout, 'b', 1.5, PADDING)).toBe(370)
    expect(playheadXInLayout(layout, undefined, 0, PADDING)).toBe(PADDING)
  })
})

describe('minimum block width', () => {
  // At 1 px/s a 2 s segment would be 2 px wide; it is drawn 8 px wide instead.
  const narrow = buildSegmentLayout(segments, 1, GAP, PADDING, 8)

  it('widens short blocks and keeps positions proportional inside them', () => {
    expect(narrow.map((item) => [item.startX, item.endX])).toEqual([
      [16, 24],
      [28, 36],
    ])
    expect(playheadXInLayout(narrow, 'a', 11, PADDING)).toBe(20)
    expect(findSegmentAtTrackX(narrow, 20)).toEqual({ segment: segments[0], time: 11 })
    expect(globalTimeToX(narrow, 3.5)).toBe(32)
  })

  it('computes drop slots from the drawn widths', () => {
    // x is measured from the first block's start (padding excluded).
    expect(findDropIndexAtTrackX(segments, 3, 1, GAP, 8)).toBe(0)
    expect(findDropIndexAtTrackX(segments, 5, 1, GAP, 8)).toBe(1)
    expect(findDropIndexAtTrackX(segments, 17, 1, GAP, 8)).toBe(2)
  })
})
