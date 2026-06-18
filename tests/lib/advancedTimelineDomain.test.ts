import { describe, expect, it } from 'vitest'

import {
  orderedForRender,
  projectDuration,
  segmentEndTime,
  segmentsActiveAt,
} from '@/lib/advanced/advancedTimelineDomain'
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

  it('finds segments active at a time (inclusive start, exclusive end)', () => {
    const list = [seg('a', 'top', 0, 4), seg('b', 'bot', 3, 4)]
    expect(segmentsActiveAt(list, 3.5).map((segment) => segment.id).sort()).toEqual(['a', 'b'])
    expect(segmentsActiveAt(list, 4).map((segment) => segment.id)).toEqual(['b'])
  })

  it('orders for render bottom lane first', () => {
    const list = [seg('a', 'top', 0, 4), seg('b', 'bot', 0, 4)]
    expect(orderedForRender(list, tracks).map((segment) => segment.id)).toEqual(['b', 'a'])
  })
})
