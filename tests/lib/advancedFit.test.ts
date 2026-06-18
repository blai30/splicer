import { describe, expect, it } from 'vitest'

import { fitRect } from '@/lib/advanced/fit'

describe('fitRect', () => {
  it('fills exactly when aspect ratios match', () => {
    const rect = fitRect(1920, 1080, 1280, 720)
    expect(rect).toEqual({ x: 0, y: 0, width: 1280, height: 720 })
  })

  it('letterboxes a wide source into a square canvas, centered', () => {
    const rect = fitRect(1920, 1080, 1000, 1000)
    expect(rect.width).toBeCloseTo(1000)
    expect(rect.height).toBeCloseTo(562.5)
    expect(rect.x).toBeCloseTo(0)
    expect(rect.y).toBeCloseTo((1000 - 562.5) / 2)
  })

  it('pillarboxes a tall source into a wide canvas, centered', () => {
    const rect = fitRect(1080, 1920, 1920, 1080)
    expect(rect.height).toBeCloseTo(1080)
    expect(rect.width).toBeCloseTo(607.5)
    expect(rect.y).toBeCloseTo(0)
    expect(rect.x).toBeCloseTo((1920 - 607.5) / 2)
  })

  it('falls back to the full canvas for degenerate source dimensions', () => {
    expect(fitRect(0, 0, 800, 600)).toEqual({ x: 0, y: 0, width: 800, height: 600 })
  })
})
