import { describe, expect, it } from 'vitest'

import { MIN_TRANSFORM_SIZE, resizeTransform } from '@/lib/advanced/transformMath'
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
  it.each([
    ['se', 0, 50, { x: 100, y: 100, width: 300, height: 150 }],
    ['sw', 0, 50, { x: 0, y: 100, width: 300, height: 150 }],
    ['ne', 0, -50, { x: 100, y: 50, width: 300, height: 150 }],
    ['se', -100, 0, { x: 100, y: 100, width: 100, height: 50 }],
  ] as const)(
    'follows the axis that moved further on a locked %s drag of (%d, %d)',
    (handle, dx, dy, expected) => {
      expect(resizeTransform(base, handle, dx, dy, true)).toEqual(expected)
    }
  )

  it('keeps a locked corner at the minimum size on both axes', () => {
    const result = resizeTransform(base, 'se', -1000, -1000, true)
    expect(result.height).toBe(MIN_TRANSFORM_SIZE)
    expect(result.width).toBe(MIN_TRANSFORM_SIZE * 2)
  })
})
