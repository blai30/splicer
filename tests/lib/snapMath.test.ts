import { describe, expect, it } from 'vitest'

import { snapCandidates, snapMove } from '@/lib/advanced/snapMath'
import type { Transform } from '@/lib/types'

describe('snapMath', () => {
  it('builds candidate lines from canvas edges, center, and other boxes', () => {
    const others: Transform[] = [{ x: 200, y: 0, width: 100, height: 100 }]
    const candidates = snapCandidates({ width: 1000, height: 800 }, others)
    // canvas verticals: 0, 500, 1000; other box: left 200, center 250, right 300
    expect(candidates.vertical).toEqual(expect.arrayContaining([0, 500, 1000, 200, 250, 300]))
    expect(candidates.horizontal).toEqual(expect.arrayContaining([0, 400, 800, 0, 50, 100]))
  })

  it('snaps the left edge to a nearby candidate within threshold', () => {
    const box: Transform = { x: 7, y: 300, width: 100, height: 100 }
    const result = snapMove(box, { vertical: [0], horizontal: [] }, 10)
    expect(result.x).toBe(0)
    expect(result.guideX).toBe(0)
    expect(result.y).toBe(300)
    expect(result.guideY).toBeNull()
  })

  it('snaps the box center to a candidate', () => {
    const box: Transform = { x: 445, y: 0, width: 100, height: 100 }
    // center is 495; canvas center 500 is within threshold 10 -> shift x by 5.
    const result = snapMove(box, { vertical: [500], horizontal: [] }, 10)
    expect(result.x).toBe(450)
    expect(result.guideX).toBe(500)
  })

  it('does not snap when nothing is within threshold', () => {
    const box: Transform = { x: 400, y: 400, width: 100, height: 100 }
    const result = snapMove(box, { vertical: [0], horizontal: [0] }, 10)
    expect(result).toEqual({ x: 400, y: 400, guideX: null, guideY: null })
  })
})
