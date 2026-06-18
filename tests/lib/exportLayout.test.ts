import { describe, expect, it } from 'vitest'

import {
  computeContentBounds,
  computeExportBounds,
  computeFrameRect,
} from '@/lib/advanced/exportLayout'
import type { AdvancedSegment, Transform } from '@/lib/types'

function makeSegment(id: string, transform: Transform): AdvancedSegment {
  return { id, clipId: id, trackId: 't', timelineStart: 0, sourceStart: 0, sourceEnd: 5, transform }
}

describe('computeContentBounds', () => {
  it('returns null for no segments', () => {
    expect(computeContentBounds([])).toBeNull()
  })

  it('unions transforms including negative coordinates', () => {
    const bounds = computeContentBounds([
      makeSegment('a', { x: -100, y: -50, width: 200, height: 100 }),
      makeSegment('b', { x: 300, y: 200, width: 100, height: 100 }),
    ])
    expect(bounds).toEqual({ minX: -100, minY: -50, width: 500, height: 350 })
  })
})

describe('computeExportBounds (auto / no lock)', () => {
  it('sizes to the even-clamped bounding box and offsets transforms to origin', () => {
    const segments = [
      makeSegment('a', { x: 101, y: 50, width: 800, height: 401 }),
      makeSegment('b', { x: 300, y: 200, width: 600, height: 500 }),
    ]
    const bounds = computeExportBounds(segments, null)
    expect(bounds).not.toBeNull()
    // bbox: minX=101 minY=50 maxX=901 maxY=700 -> 800 x 650
    expect(bounds!.width).toBe(800)
    expect(bounds!.height).toBe(650)
    expect(bounds!.mapTransform(segments[0].transform)).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 401,
    })
    expect(bounds!.mapTransform(segments[1].transform)).toEqual({
      x: 199,
      y: 150,
      width: 600,
      height: 500,
    })
  })

  it('returns null when there are no segments', () => {
    expect(computeExportBounds([], null)).toBeNull()
  })
})

describe('computeExportBounds (locked size)', () => {
  it('contain-fits and centers the content into the locked size', () => {
    // Content 800x400 (aspect 2.0) into 1000x1000 lock: scale = 1000/800 = 1.25,
    // scaled height = 500, centered vertically by (1000 - 500) / 2 = 250.
    const segments = [makeSegment('a', { x: 0, y: 0, width: 800, height: 400 })]
    const bounds = computeExportBounds(segments, { width: 1000, height: 1000 })
    expect(bounds!.width).toBe(1000)
    expect(bounds!.height).toBe(1000)
    expect(bounds!.mapTransform(segments[0].transform)).toEqual({
      x: 0,
      y: 250,
      width: 1000,
      height: 500,
    })
  })
})

describe('computeFrameRect', () => {
  it('returns the bounding box in auto mode', () => {
    const segments = [makeSegment('a', { x: 10, y: 20, width: 100, height: 50 })]
    expect(computeFrameRect(segments, null)).toEqual({ minX: 10, minY: 20, width: 100, height: 50 })
  })

  it('expands the box to the locked aspect for the indicator', () => {
    // Content 800x400 (2.0) under a 1:1 lock expands height to 800, centered.
    const segments = [makeSegment('a', { x: 0, y: 0, width: 800, height: 400 })]
    expect(computeFrameRect(segments, { width: 1000, height: 1000 })).toEqual({
      minX: 0,
      minY: -200,
      width: 800,
      height: 800,
    })
  })
})
