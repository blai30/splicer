import { describe, expect, it } from 'vitest'

import {
  closeTrackGaps,
  duplicateSegments,
  laneOverlaps,
  mergeIntervals,
  moveSegmentsBy,
  pasteSegments,
  rippleDeleteSegments,
  subtractIntervals,
  trackHasGaps,
} from '@/lib/advanced/clipEditingDomain'
import type { AdvancedSegment, Track } from '@/lib/types'

const TRACKS: Track[] = [
  { id: 't1', name: 'Track 1' },
  { id: 't2', name: 'Track 2' },
  { id: 't3', name: 'Track 3' },
]

function segment(id: string, trackId: string, start: number, duration = 2): AdvancedSegment {
  return {
    id,
    clipId: `clip-${id}`,
    trackId,
    timelineStart: start,
    sourceStart: 1,
    sourceEnd: 1 + duration,
    transform: { x: 0, y: 0, width: 100, height: 100 },
  }
}

const startsOf = (segments: AdvancedSegment[]) =>
  Object.fromEntries(segments.map((entry) => [entry.id, entry.timelineStart]))

let counter = 0
const makeId = () => `new-${++counter}`

describe('moveSegmentsBy', () => {
  const segments = [segment('a', 't1', 1), segment('b', 't2', 4), segment('c', 't3', 0)]

  it('moves the group by the same offsets and leaves the rest', () => {
    const moved = moveSegmentsBy(segments, TRACKS, new Set(['a', 'b']), 2, 1)
    expect(moved.map((entry) => [entry.id, entry.trackId, entry.timelineStart])).toEqual([
      ['a', 't2', 3],
      ['b', 't3', 6],
      ['c', 't3', 0],
    ])
  })

  it('clamps the group at time 0 and at the edge lanes without distorting it', () => {
    const moved = moveSegmentsBy(segments, TRACKS, new Set(['a', 'b']), -5, 3)
    // a can only go back 1s and b only down 1 lane, so both stop there.
    expect(moved.map((entry) => [entry.trackId, entry.timelineStart])).toEqual([
      ['t2', 0],
      ['t3', 3],
      ['t3', 0],
    ])
  })

  it('returns the same list when nothing moves', () => {
    expect(moveSegmentsBy(segments, TRACKS, new Set(['c']), -1, 0)).toBe(segments)
  })
})

describe('duplicateSegments', () => {
  it('places one copy right after its original on the same track', () => {
    const { segments, newIds } = duplicateSegments([segment('a', 't1', 1)], new Set(['a']), makeId)
    expect(newIds).toHaveLength(1)
    const copy = segments.find((entry) => entry.id === newIds[0])!
    expect(copy).toMatchObject({ trackId: 't1', timelineStart: 3, sourceStart: 1, sourceEnd: 3 })
  })

  it('shifts a group by its own span so the copies keep their arrangement', () => {
    const original = [segment('a', 't1', 0), segment('b', 't2', 1, 3)]
    const { segments, newIds } = duplicateSegments(original, new Set(['a', 'b']), makeId)
    const copies = segments.filter((entry) => newIds.includes(entry.id))
    expect(copies.map((entry) => [entry.trackId, entry.timelineStart])).toEqual([
      ['t1', 4],
      ['t2', 5],
    ])
  })
})

describe('pasteSegments', () => {
  it('puts the earliest clip at the time and the topmost on the target lane', () => {
    const copied = [
      { segment: segment('a', 't1', 2), laneOffset: 0 },
      { segment: segment('b', 't2', 5), laneOffset: 1 },
    ]
    const pasted = pasteSegments(copied, TRACKS, 10, 1, makeId)
    expect(pasted.map((entry) => [entry.trackId, entry.timelineStart])).toEqual([
      ['t2', 10],
      ['t3', 13],
    ])
    expect(new Set(pasted.map((entry) => entry.id)).size).toBe(2)
    expect(pasted.every((entry) => entry.id.startsWith('new-'))).toBe(true)
  })

  it('clamps lanes past the bottom track', () => {
    const copied = [
      { segment: segment('a', 't1', 0), laneOffset: 0 },
      { segment: segment('b', 't2', 0), laneOffset: 2 },
    ]
    const pasted = pasteSegments(copied, TRACKS, 0, 2, makeId)
    expect(pasted.map((entry) => entry.trackId)).toEqual(['t3', 't3'])
  })
})

describe('intervals', () => {
  it('merges touching intervals and subtracts covered parts', () => {
    expect(
      mergeIntervals([
        { start: 3, end: 4 },
        { start: 0, end: 1 },
        { start: 1, end: 2 },
      ])
    ).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 4 },
    ])
    expect(
      subtractIntervals(
        [{ start: 0, end: 10 }],
        [
          { start: 2, end: 3 },
          { start: 8, end: 12 },
        ]
      )
    ).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 8 },
    ])
  })
})

describe('rippleDeleteSegments', () => {
  it('closes the hole on the deleted clip track only', () => {
    const segments = [
      segment('a', 't1', 0),
      segment('b', 't1', 2),
      segment('c', 't1', 5),
      segment('d', 't2', 6),
    ]
    const next = rippleDeleteSegments(segments, new Set(['b']))
    expect(startsOf(next)).toEqual({ a: 0, c: 3, d: 6 })
  })

  it('does not count time another clip still covers as a hole', () => {
    // b (2-4) is deleted, but c (3-5) overlaps it, so only 2-3 empties.
    const segments = [
      segment('a', 't1', 0),
      segment('b', 't1', 2),
      segment('c', 't1', 3),
      segment('e', 't1', 7),
    ]
    expect(startsOf(rippleDeleteSegments(segments, new Set(['b'])))).toEqual({ a: 0, c: 2, e: 6 })
  })

  it('closes several holes at once', () => {
    const segments = [
      segment('a', 't1', 0),
      segment('b', 't1', 2),
      segment('c', 't1', 4),
      segment('d', 't1', 6),
    ]
    expect(startsOf(rippleDeleteSegments(segments, new Set(['a', 'c'])))).toEqual({ b: 0, d: 2 })
  })
})

describe('closeTrackGaps', () => {
  it('pulls clips together while keeping the time before the first clip', () => {
    const segments = [
      segment('a', 't1', 1),
      segment('b', 't1', 4),
      segment('c', 't1', 9),
      segment('d', 't2', 20),
    ]
    expect(trackHasGaps(segments, 't1')).toBe(true)
    const next = closeTrackGaps(segments, 't1')
    expect(startsOf(next)).toEqual({ a: 1, b: 3, c: 5, d: 20 })
    expect(trackHasGaps(next, 't1')).toBe(false)
  })

  it('keeps overlapping clips overlapping by the same amount', () => {
    const segments = [segment('a', 't1', 0, 4), segment('b', 't1', 3), segment('c', 't1', 8)]
    expect(startsOf(closeTrackGaps(segments, 't1'))).toEqual({ a: 0, b: 3, c: 5 })
  })
})

describe('laneOverlaps', () => {
  it('finds where two or more clips on a track play at once', () => {
    const segments = [
      segment('a', 't1', 0, 4),
      segment('b', 't1', 3, 2),
      segment('c', 't1', 5, 2), // touches b's end: no overlap
      segment('d', 't2', 0, 10),
    ]
    expect(laneOverlaps(segments, 't1')).toEqual([{ start: 3, end: 4 }])
    expect(laneOverlaps(segments, 't2')).toEqual([])
  })
})
