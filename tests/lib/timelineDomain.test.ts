import { describe, expect, it, vi } from 'vitest'

import {
  buildSegmentLayout,
  createIntervalThrottler,
  cutTimes,
  globalTimeOf,
  segmentAtGlobalTime,
  totalDuration,
  trackXToHit,
} from '@/lib/timelineDomain'
import type { Segment } from '@/lib/types'

function segment(id: string, startTime: number, endTime: number): Segment {
  return { id, clipId: `clip-${id}`, startTime, endTime }
}

// 2 s, 3 s, and 1 s pieces of different clips.
const segments = [segment('a', 10, 12), segment('b', 0, 3), segment('c', 5, 6)]
// At 100 px/s with a 4 px gap and 16 px padding: a 16..216, b 220..520, c 524..624.
const layout = buildSegmentLayout(segments, 100, 4, 16)

describe('global timeline time', () => {
  it('sums segment durations', () => {
    expect(totalDuration(segments)).toBe(6)
    expect(totalDuration([])).toBe(0)
  })

  it('lists every cut from the start through the end', () => {
    expect(cutTimes(segments)).toEqual([0, 2, 5, 6])
    expect(cutTimes([])).toEqual([0])
  })

  it('resolves a time on a cut to the later segment', () => {
    expect(segmentAtGlobalTime(segments, 2)?.segment.id).toBe('b')
    expect(segmentAtGlobalTime(segments, 4.5)).toEqual({
      index: 1,
      segment: segments[1],
      localTime: 2.5,
    })
    expect(segmentAtGlobalTime(segments, 5)?.segment.id).toBe('c')
  })

  it('clamps times before the start and past the end', () => {
    expect(segmentAtGlobalTime(segments, -3)).toEqual({
      index: 0,
      segment: segments[0],
      localTime: 10,
    })
    expect(segmentAtGlobalTime(segments, 99)).toEqual({
      index: 2,
      segment: segments[2],
      localTime: 6,
    })
  })

  it('maps a segment-local time back to global time', () => {
    expect(globalTimeOf(segments, 'a', 11)).toBe(1)
    expect(globalTimeOf(segments, 'b', 2.5)).toBe(4.5)
    expect(globalTimeOf(segments, 'c', 6)).toBe(6)
    // Clamped into the segment: a stale source time never leaks across a cut.
    expect(globalTimeOf(segments, 'b', 50)).toBe(5)
    expect(globalTimeOf(segments, 'c', 0)).toBe(5)
    expect(globalTimeOf(segments, 'missing', 1)).toBeNull()
  })

  it('round-trips through segmentAtGlobalTime', () => {
    for (const time of [0, 0.5, 1.99, 2, 3.25, 5, 5.5]) {
      const hit = segmentAtGlobalTime(segments, time)!
      expect(globalTimeOf(segments, hit.segment.id, hit.localTime)).toBeCloseTo(time)
    }
  })
})

describe('trackXToHit', () => {
  it('returns the source time under a block', () => {
    expect(trackXToHit(layout, 116)).toEqual({ segment: segments[0], time: 11 })
    expect(trackXToHit(layout, 370)).toEqual({ segment: segments[1], time: 1.5 })
  })

  it('resolves a gap to the closer neighbouring edge', () => {
    // Gap between a (ends 216) and b (starts 220).
    expect(trackXToHit(layout, 217)).toEqual({ segment: segments[0], time: 12 })
    expect(trackXToHit(layout, 219)).toEqual({ segment: segments[1], time: 0 })
    // Exactly in the middle goes to the later block, like a time on a cut.
    expect(trackXToHit(layout, 218)).toEqual({ segment: segments[1], time: 0 })
  })

  it('clamps the padding to the first in-point and the last out-point', () => {
    expect(trackXToHit(layout, 0)).toEqual({ segment: segments[0], time: 10 })
    expect(trackXToHit(layout, -50)).toEqual({ segment: segments[0], time: 10 })
    expect(trackXToHit(layout, 640)).toEqual({ segment: segments[2], time: 6 })
    expect(trackXToHit(layout, 5000)).toEqual({ segment: segments[2], time: 6 })
  })

  it('returns null for an empty timeline', () => {
    expect(trackXToHit([], 100)).toBeNull()
  })
})

describe('createIntervalThrottler', () => {
  it('runs the first call now and only the latest queued call per interval', () => {
    vi.useFakeTimers()
    let nowMs = 0
    const throttler = createIntervalThrottler(33, () => nowMs)
    const runs: number[] = []
    throttler.queue(() => runs.push(1))
    expect(runs).toEqual([1])
    nowMs = 10
    throttler.queue(() => runs.push(2))
    throttler.queue(() => runs.push(3))
    expect(runs).toEqual([1])
    nowMs = 33
    vi.advanceTimersByTime(23)
    expect(runs).toEqual([1, 3])
    // Flush runs a waiting call at once; cancel drops it.
    nowMs = 40
    throttler.queue(() => runs.push(4))
    throttler.flush()
    expect(runs).toEqual([1, 3, 4])
    nowMs = 45
    throttler.queue(() => runs.push(5))
    throttler.cancel()
    vi.advanceTimersByTime(100)
    expect(runs).toEqual([1, 3, 4])
    // After a reset the next call runs at once.
    nowMs = 46
    throttler.reset()
    throttler.queue(() => runs.push(6))
    expect(runs).toEqual([1, 3, 4, 6])
    vi.useRealTimers()
  })
})
