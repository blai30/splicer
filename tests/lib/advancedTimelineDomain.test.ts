import { describe, expect, it } from 'vitest'

import {
  advancedBlockSpans,
  advancedWheelAction,
  laneDropTarget,
  orderedForRender,
  placeReadout,
  projectDuration,
  segmentEndTime,
  segmentsActiveAt,
  trackEndTime,
} from '@/lib/advanced/advancedTimelineDomain'
import { MIN_BLOCK_WIDTH_PX, ZOOM_MIN } from '@/lib/timelineNavigation'
import type { AdvancedSegment, Track } from '@/lib/types'

function seg(id: string, trackId: string, start: number, srcLen: number): AdvancedSegment {
  return {
    id,
    clipId: `clip-${id}`,
    trackId,
    timelineStart: start,
    sourceStart: 0,
    sourceEnd: srcLen,
    transform: { x: 0, y: 0, width: 100, height: 100 },
  }
}

const tracks: Track[] = [
  { id: 'top', name: 'Top' },
  { id: 'bot', name: 'Bot' },
]

describe('advancedTimelineDomain', () => {
  it('computes segment end and project duration', () => {
    expect(segmentEndTime(seg('a', 'top', 2, 3))).toBe(5)
    expect(projectDuration([seg('a', 'top', 2, 3), seg('b', 'bot', 0, 4)])).toBe(5)
  })

  it('maps a pointer offset to a lane or a new track above or below', () => {
    expect(laneDropTarget(-1, 56, 2)).toEqual({ kind: 'new', position: 'top' })
    expect(laneDropTarget(0, 56, 2)).toEqual({ kind: 'lane', index: 0 })
    expect(laneDropTarget(57, 56, 2)).toEqual({ kind: 'lane', index: 1 })
    expect(laneDropTarget(112, 56, 2)).toEqual({ kind: 'new', position: 'bottom' })
  })

  it('computes where one track ends, ignoring other tracks', () => {
    const list = [seg('a', 'top', 2, 3), seg('b', 'bot', 0, 9)]
    expect(trackEndTime(list, 'top')).toBe(5)
    expect(trackEndTime(list, 'empty')).toBe(0)
  })

  it('finds segments active at a time (inclusive start, exclusive end)', () => {
    const list = [seg('a', 'top', 0, 4), seg('b', 'bot', 3, 4)]
    expect(
      segmentsActiveAt(list, 3.5)
        .map((segment) => segment.id)
        .sort()
    ).toEqual(['a', 'b'])
    expect(segmentsActiveAt(list, 4).map((segment) => segment.id)).toEqual(['b'])
  })

  it('orders for render bottom lane first', () => {
    const list = [seg('a', 'top', 0, 4), seg('b', 'bot', 0, 4)]
    expect(orderedForRender(list, tracks).map((segment) => segment.id)).toEqual(['b', 'a'])
  })
})

describe('placeReadout', () => {
  const view = { left: 1000, width: 400 }

  it('hangs from the clip start in the left half of the view', () => {
    expect(placeReadout(1100, 50, view)).toEqual({ edge: 1100, alignEnd: false, maxWidth: 296 })
  })

  it('hangs from the clip end once the clip starts in the right half', () => {
    expect(placeReadout(1250, 100, view)).toEqual({ edge: 1350, alignEnd: true, maxWidth: 346 })
  })

  it('clamps to the view when the clip runs past either edge', () => {
    expect(placeReadout(900, 300, view)).toEqual({ edge: 1004, alignEnd: false, maxWidth: 392 })
    expect(placeReadout(1300, 900, view)).toEqual({ edge: 1396, alignEnd: true, maxWidth: 392 })
  })

  it('stays at the clip start without a scroller', () => {
    expect(placeReadout(120, 40, null)).toEqual({ edge: 120, alignEnd: false, maxWidth: null })
  })
})

describe('advancedWheelAction', () => {
  const wheel = (overrides: Partial<Parameters<typeof advancedWheelAction>[0]> = {}) =>
    advancedWheelAction({
      ctrlKey: false,
      shiftKey: false,
      deltaX: 0,
      deltaY: 100,
      lanesOverflowView: false,
      ...overrides,
    })

  it('zooms with Ctrl, whatever else is held', () => {
    expect(wheel({ ctrlKey: true })).toBe('zoom')
    expect(wheel({ ctrlKey: true, shiftKey: true, lanesOverflowView: true })).toBe('zoom')
  })

  it('scrolls through time with Shift, even when the lanes overflow', () => {
    expect(wheel({ shiftKey: true, lanesOverflowView: true })).toBe('horizontal')
    expect(wheel({ shiftKey: true, deltaX: 100, deltaY: 0 })).toBe('horizontal')
  })

  it('scrolls vertically (natively) while the lanes overflow the window', () => {
    expect(wheel({ lanesOverflowView: true })).toBe('native')
  })

  it('scrolls through time when every lane is in view', () => {
    expect(wheel()).toBe('horizontal')
  })

  it('leaves horizontal trackpad swipes to the browser', () => {
    expect(wheel({ deltaX: 60, deltaY: 10 })).toBe('native')
  })
})

describe('advancedBlockSpans', () => {
  it('keeps every adjacent short clip visible at the lowest zoom', () => {
    // long, short, long, short, short placed back to back on one track.
    const lane = [
      seg('long-1', 'top', 0, 30),
      seg('short-1', 'top', 30, 2),
      seg('long-2', 'top', 32, 30),
      seg('short-2', 'top', 62, 2),
      seg('short-3', 'top', 64, 2),
    ]
    const spans = advancedBlockSpans(lane, 1, MIN_BLOCK_WIDTH_PX)
    expect(spans.get('long-1')).toEqual({ width: 30, raised: false })
    expect(spans.get('long-2')).toEqual({ width: 30, raised: false })
    // A short clip before a long one is drawn full minimum width on top of it.
    expect(spans.get('short-1')).toEqual({ width: MIN_BLOCK_WIDTH_PX, raised: true })
    // One followed by another short clip stops where that one starts.
    expect(spans.get('short-2')).toEqual({ width: 2, raised: true })
    expect(spans.get('short-3')).toEqual({ width: MIN_BLOCK_WIDTH_PX, raised: true })
  })

  it('never draws a block narrower than its duration, even at ZOOM_MIN', () => {
    const lane = [seg('a', 'top', 0, 1), seg('b', 'top', 1, 1)]
    const spans = advancedBlockSpans(lane, ZOOM_MIN, MIN_BLOCK_WIDTH_PX)
    expect(spans.get('a')).toEqual({ width: ZOOM_MIN, raised: true })
    expect(spans.get('b')).toEqual({ width: MIN_BLOCK_WIDTH_PX, raised: true })
  })

  it('caps only against clips on the same track', () => {
    const spans = advancedBlockSpans(
      [seg('a', 'top', 0, 1), seg('b', 'bot', 1, 1)],
      1,
      MIN_BLOCK_WIDTH_PX
    )
    expect(spans.get('a')?.width).toBe(MIN_BLOCK_WIDTH_PX)
  })
})
