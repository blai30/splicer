import { describe, expect, it } from 'vitest'

import {
  pointInTransform,
  screenDeltaToCanvas,
  screenDeltaToWorld,
} from '@/lib/advanced/canvasCoords'

describe('canvasCoords', () => {
  it('scales a screen delta into canvas space', () => {
    // 50 screen px across a 500px display of a 1000px canvas -> 100 canvas px.
    expect(screenDeltaToCanvas(50, 500, 1000)).toBe(100)
  })

  it('returns the delta unchanged when the display size is zero', () => {
    expect(screenDeltaToCanvas(50, 0, 1000)).toBe(50)
  })

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
