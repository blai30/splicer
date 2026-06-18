import { describe, expect, it } from 'vitest'

import { resizeTransform } from '@/lib/advanced/transformMath'
import type { Transform } from '@/lib/types'

const base: Transform = { x: 100, y: 100, width: 200, height: 100 }

describe('resizeTransform', () => {
  it('drags the east edge to widen, keeping x', () => {
    expect(resizeTransform(base, 'e', 50, 0, false)).toEqual({
      x: 100,
      y: 100,
      width: 250,
      height: 100,
    })
  })

  it('drags the west edge to move x and shrink width', () => {
    expect(resizeTransform(base, 'w', 40, 0, false)).toEqual({
      x: 140,
      y: 100,
      width: 160,
      height: 100,
    })
  })

  it('drags the south-east corner moving both dimensions', () => {
    expect(resizeTransform(base, 'se', 20, 30, false)).toEqual({
      x: 100,
      y: 100,
      width: 220,
      height: 130,
    })
  })

  it('clamps to a minimum size instead of inverting', () => {
    const result = resizeTransform(base, 'e', -1000, 0, false)
    expect(result.width).toBe(16)
    expect(result.x).toBe(100)
  })

  it('locks aspect ratio on a corner drag', () => {
    // base aspect is 2:1; an se drag of dx=100 keeps height = width/2.
    const result = resizeTransform(base, 'se', 100, 10, true)
    expect(result.width / result.height).toBeCloseTo(2)
    expect(result.x).toBe(100)
    expect(result.y).toBe(100)
  })
})
