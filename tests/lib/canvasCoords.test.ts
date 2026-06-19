import { describe, expect, it } from 'vitest'

import { pointInTransform, screenDeltaToWorld } from '@/lib/advanced/canvasCoords'

describe('canvasCoords', () => {
  it('converts a screen delta to a world delta by zoom', () => {
    expect(screenDeltaToWorld(100, 2)).toBe(50)
    expect(screenDeltaToWorld(100, 0.5)).toBe(200)
  })

  it('falls back to the raw delta when zoom is non-positive', () => {
    expect(screenDeltaToWorld(100, 0)).toBe(100)
  })

  it('hit-tests a point inside a transform box', () => {
    const box = { x: 100, y: 100, width: 200, height: 100 }
    expect(pointInTransform(150, 150, box)).toBe(true)
    expect(pointInTransform(350, 150, box)).toBe(false)
  })
})
