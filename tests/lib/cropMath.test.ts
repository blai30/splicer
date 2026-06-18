import { describe, expect, it } from 'vitest'

import { defaultCrop, resizeCrop, resizeCropWithBox } from '@/lib/advanced/cropMath'

describe('cropMath', () => {
  it('defaults to the full source frame', () => {
    expect(defaultCrop(1920, 1080)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
  })

  it('drags the west crop edge inward, moving x and shrinking width', () => {
    const crop = { x: 0, y: 0, width: 1920, height: 1080 }
    expect(resizeCrop(crop, 'w', 200, 0, 1920, 1080)).toEqual({
      x: 200,
      y: 0,
      width: 1720,
      height: 1080,
    })
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

describe('resizeCropWithBox (true crop)', () => {
  const crop = { x: 0, y: 0, width: 1000, height: 500 }
  const transform = { x: 100, y: 50, width: 200, height: 100 }

  it('clips the east edge: box shrinks, left edge stays fixed', () => {
    const result = resizeCropWithBox(transform, crop, 'e', -500, 0, 1000, 500)
    expect(result.crop).toEqual({ x: 0, y: 0, width: 500, height: 500 })
    expect(result.transform).toEqual({ x: 100, y: 50, width: 100, height: 100 })
  })

  it('clips the west edge: box moves in, right edge stays fixed', () => {
    const result = resizeCropWithBox(transform, crop, 'w', 200, 0, 1000, 500)
    expect(result.crop).toEqual({ x: 200, y: 0, width: 800, height: 500 })
    expect(result.transform).toEqual({ x: 140, y: 50, width: 160, height: 100 })
    // Right edge unchanged: 140 + 160 === 100 + 200.
    expect(result.transform.x + result.transform.width).toBe(transform.x + transform.width)
  })

  it('preserves the source-to-canvas scale (no stretching)', () => {
    const result = resizeCropWithBox(transform, crop, 'se', -400, -200, 1000, 500)
    expect(result.transform.width / result.crop.width).toBeCloseTo(transform.width / crop.width)
    expect(result.transform.height / result.crop.height).toBeCloseTo(transform.height / crop.height)
  })
})
