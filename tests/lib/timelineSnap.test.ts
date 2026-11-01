import { describe, expect, it } from 'vitest'

import {
  quantizeToFrame,
  resolveEdgeTime,
  resolveMoveStart,
  snapEdges,
  snapThresholdSeconds,
  snapTime,
  timeSnapTargets,
} from '@/lib/timelineSnap'
import type { AdvancedSegment } from '@/lib/types'

function segment(id: string, trackId: string, start: number, length: number): AdvancedSegment {
  return {
    id,
    clipId: `clip-${id}`,
    trackId,
    timelineStart: start,
    sourceStart: 0,
    sourceEnd: length,
    transform: { x: 0, y: 0, width: 100, height: 100 },
  }
}

describe('snapThresholdSeconds', () => {
  it('keeps the on-screen distance constant across zoom levels', () => {
    expect(snapThresholdSeconds(80)).toBeCloseTo(0.1)
    expect(snapThresholdSeconds(8)).toBeCloseTo(1)
    expect(snapThresholdSeconds(0)).toBe(0)
  })
})

describe('timeSnapTargets', () => {
  it('collects the origin, playhead, and both edges of clips on every track', () => {
    const segments = [segment('a', 'top', 2, 3), segment('b', 'bottom', 4, 2)]
    expect(timeSnapTargets(segments, new Set(), 1.5)).toEqual([0, 1.5, 2, 4, 5, 6])
  })

  it('excludes the dragged clips and merges duplicates', () => {
    const segments = [segment('a', 'top', 0, 3), segment('b', 'top', 3, 2)]
    expect(timeSnapTargets(segments, new Set(['b']), 3, [3, 7])).toEqual([0, 3, 7])
  })
})

describe('snapEdges', () => {
  const targets = [0, 5, 10]

  it('snaps the nearest edge within the threshold', () => {
    expect(snapEdges([4.95, 6.95], targets, 0.1)).toEqual({
      delta: expect.closeTo(0.05),
      target: 5,
    })
  })

  it('lets the end edge win when it is closer', () => {
    expect(snapEdges([3.8, 9.97], targets, 0.25)).toEqual({
      delta: expect.closeTo(0.03),
      target: 10,
    })
  })

  it('does nothing outside the threshold', () => {
    expect(snapEdges([4.5, 6.5], targets, 0.1)).toEqual({ delta: 0, target: null })
  })

  it('prefers the first edge on a tie', () => {
    expect(snapEdges([4.9, 9.9], targets, 0.2).target).toBe(5)
  })

  it('handles an empty target list', () => {
    expect(snapEdges([1], [], 1)).toEqual({ delta: 0, target: null })
  })
})

describe('snapTime', () => {
  it('pulls a single time onto a target', () => {
    expect(snapTime(9.93, [0, 10], 0.1)).toEqual({ time: 10, target: 10 })
    expect(snapTime(9.5, [0, 10], 0.1)).toEqual({ time: 9.5, target: null })
  })
})

describe('quantizeToFrame', () => {
  it('rounds to the frame grid of the given rate', () => {
    expect(quantizeToFrame(1.01, 30)).toBeCloseTo(1)
    expect(quantizeToFrame(1.02, 30)).toBeCloseTo(31 / 30)
    expect(quantizeToFrame(0.53, 24)).toBeCloseTo(13 / 24)
  })

  it('falls back to 30 fps for a missing or invalid rate', () => {
    expect(quantizeToFrame(1.02)).toBeCloseTo(31 / 30)
    expect(quantizeToFrame(1.02, 0)).toBeCloseTo(31 / 30)
    expect(quantizeToFrame(1.02, Number.NaN)).toBeCloseTo(31 / 30)
  })
})

describe('resolveEdgeTime', () => {
  const options = { thresholdSec: 0.1, snap: true, fps: 30 }

  it('keeps a snap target exact even off the frame grid', () => {
    expect(resolveEdgeTime(5.01, [5.0123], options)).toEqual({ time: 5.0123, target: 5.0123 })
  })

  it('quantizes when nothing is in range or snapping is off', () => {
    expect(resolveEdgeTime(2.51, [5], options).time).toBeCloseTo(2.5)
    expect(resolveEdgeTime(4.95, [5], { ...options, snap: false })).toEqual({
      time: expect.closeTo(4.9667, 3),
      target: null,
    })
  })
})

describe('resolveMoveStart', () => {
  const options = { thresholdSec: 0.1, snap: true, fps: 30 }

  it('aligns the clip end with a target', () => {
    expect(resolveMoveStart(2.96, 2, [0, 5], options)).toEqual({
      start: expect.closeTo(3),
      target: 5,
    })
  })

  it('clamps before the origin and snaps the start to 0', () => {
    expect(resolveMoveStart(-3, 2, [0, 5], options)).toEqual({ start: 0, target: 0 })
  })

  it('never snaps an end edge in a way that pushes the start below 0', () => {
    // 0.05 + (1.98 - 2.05) = -0.02 would be negative: falls back to the grid.
    expect(resolveMoveStart(0.05, 2, [1.98], options)).toEqual({
      start: expect.closeTo(0.0667, 3),
      target: null,
    })
  })

  it('ignores targets when snapping is bypassed', () => {
    expect(resolveMoveStart(2.96, 2, [5], { ...options, snap: false })).toEqual({
      start: expect.closeTo(2.9667, 3),
      target: null,
    })
  })
})
