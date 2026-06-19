import { describe, expect, it } from 'vitest'

import { snapCandidates, snapMove } from '@/lib/advanced/snapMath'
import type { Transform } from '@/lib/types'

describe('snapMath', () => {
  it('builds candidate lines from the world origin and other boxes, no canvas lines', () => {
    const others: Transform[] = [{ x: 100, y: 200, width: 400, height: 200 }]
    const candidates = snapCandidates(others)
    // origin 0 plus the box left/center/right and top/center/bottom.
    expect(candidates.vertical).toEqual([0, 100, 300, 500])
    expect(candidates.horizontal).toEqual([0, 200, 300, 400])
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
