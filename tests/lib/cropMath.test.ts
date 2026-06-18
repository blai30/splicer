import { describe, expect, it } from 'vitest'

import { defaultCrop, resizeCrop } from '@/lib/advanced/cropMath'

describe('cropMath', () => {
  it('defaults to the full source frame', () => {
    expect(defaultCrop(1920, 1080)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
  })

  it('drags the west crop edge inward, moving x and shrinking width', () => {
    const crop = { x: 0, y: 0, width: 1920, height: 1080 }
    expect(resizeCrop(crop, 'w', 200, 0, 1920, 1080)).toEqual({ x: 200, y: 0, width: 1720, height: 1080 })
  })

  it('clamps the crop within the source frame', () => {
    const crop = { x: 0, y: 0, width: 1920, height: 1080 }
    const result = resizeCrop(crop, 'e', 1000, 0, 1920, 1080)
    expect(result.x + result.width).toBeLessThanOrEqual(1920)
  })

  it('does not let the crop invert below the minimum', () => {
    const crop = { x: 0, y: 0, width: 1920, height: 1080 }
    const result = resizeCrop(crop, 'e', -5000, 0, 1920, 1080)
    expect(result.width).toBe(8)
  })
})
