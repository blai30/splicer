import { describe, expect, it } from 'vitest'

import {
  computeContentBounds,
  computeExportBounds,
  computeFrameRect,
  computeFrameScenes,
  findOversizedAutoCanvas,
  groupScenes,
  sceneIndexAt,
} from '@/lib/advanced/exportLayout'
import type { AdvancedSegment, Transform } from '@/lib/types'

function makeSegment(
  id: string,
  transform: Transform,
  timing: { start?: number; duration?: number } = {}
): AdvancedSegment {
  return {
    id,
    clipId: id,
    trackId: 't',
    timelineStart: timing.start ?? 0,
    sourceStart: 0,
    sourceEnd: timing.duration ?? 5,
    transform,
  }
}

const HD = { width: 1920, height: 1080 }

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
    expect(bounds!.mapSegment(segments[0])).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 401,
    })
    expect(bounds!.mapSegment(segments[1])).toEqual({
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
    expect(bounds!.mapSegment(segments[0])).toEqual({
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

describe('auto output above the encoder limit', () => {
  it('scales content down instead of cropping it', () => {
    const wide = (id: string, x: number) => ({
      id,
      clipId: id,
      trackId: 't',
      timelineStart: 0,
      sourceStart: 0,
      sourceEnd: 1,
      transform: { x, y: 0, width: 3840, height: 2160 },
    })
    const bounds = computeExportBounds([wide('a', 0), wide('b', 3940)], null)!
    expect(bounds.width).toBeLessThanOrEqual(7680)
    const right = bounds.mapSegment(wide('b', 3940))
    expect(right.x + right.width).toBeLessThanOrEqual(bounds.width + 1)
  })
})

describe('scenes', () => {
  it('groups clips that share the screen, chaining overlaps', () => {
    const scenes = groupScenes([
      makeSegment('c', { x: 0, y: 0, ...HD }, { start: 20, duration: 5 }),
      makeSegment('a', { x: 0, y: 0, ...HD }, { start: 0, duration: 5 }),
      makeSegment('b', { x: 0, y: 0, ...HD }, { start: 4, duration: 5 }),
    ])
    expect(scenes.map((scene) => scene.segmentIds)).toEqual([['a', 'b'], ['c']])
    expect(scenes[0]).toMatchObject({ start: 0, end: 9 })
  })

  it('treats back-to-back clips as separate scenes', () => {
    const scenes = groupScenes([
      makeSegment('a', { x: 0, y: 0, ...HD }, { start: 0, duration: 5 }),
      makeSegment('b', { x: 0, y: 0, ...HD }, { start: 5, duration: 5 }),
    ])
    expect(scenes).toHaveLength(2)
  })
})

describe('computeExportBounds scene framing (auto)', () => {
  it('frames side-by-side clips that play in turn at one clip size', () => {
    const left = makeSegment('a', { x: 0, y: 0, ...HD }, { start: 0, duration: 5 })
    const right = makeSegment('b', { x: 2000, y: 300, ...HD }, { start: 5, duration: 5 })
    const bounds = computeExportBounds([left, right], null)!
    expect(bounds.width).toBe(1920)
    expect(bounds.height).toBe(1080)
    // Each fills the frame on its own, not half of a double-wide frame.
    expect(bounds.mapSegment(left)).toEqual({ x: 0, y: 0, ...HD })
    expect(bounds.mapSegment(right)).toEqual({ x: 0, y: 0, ...HD })
  })

  it('keeps one framing for clips that share the screen', () => {
    const left = makeSegment('a', { x: 0, y: 0, ...HD }, { start: 0, duration: 5 })
    const right = makeSegment('b', { x: 1920, y: 0, ...HD }, { start: 2, duration: 5 })
    const bounds = computeExportBounds([left, right], null)!
    expect(bounds.width).toBe(3840)
    expect(bounds.mapSegment(right).x).toBe(1920)
  })

  it('sizes to the largest scene and centers smaller ones at 1:1', () => {
    const big = makeSegment('a', { x: 0, y: 0, ...HD }, { start: 0, duration: 5 })
    const small = makeSegment('b', { x: 500, y: 500, width: 640, height: 360 }, { start: 6 })
    const bounds = computeExportBounds([big, small], null)!
    expect(bounds.width).toBe(1920)
    expect(bounds.mapSegment(small)).toEqual({ x: 640, y: 360, width: 640, height: 360 })
  })

  it('scales a scene down only when it does not fit', () => {
    const big = makeSegment('a', { x: 0, y: 0, ...HD }, { start: 0, duration: 5 })
    const tall = makeSegment('b', { x: 0, y: 0, width: 1080, height: 1920 }, { start: 6 })
    const bounds = computeExportBounds([big, tall], null)!
    const mapped = bounds.mapSegment(tall)
    expect(mapped.height).toBeCloseTo(1080)
    expect(mapped.width).toBeCloseTo(607.5)
    expect(mapped.x).toBeCloseTo((1920 - 607.5) / 2)
  })
})

describe('computeExportBounds scene framing (locked)', () => {
  it('contain-fits each scene into the locked size', () => {
    const left = makeSegment('a', { x: 0, y: 0, width: 960, height: 540 }, { start: 0 })
    const right = makeSegment('b', { x: 3000, y: 0, width: 960, height: 540 }, { start: 6 })
    const bounds = computeExportBounds([left, right], HD)!
    expect(bounds.mapSegment(left)).toEqual({ x: 0, y: 0, ...HD })
    expect(bounds.mapSegment(right)).toEqual({ x: 0, y: 0, ...HD })
  })
})

describe('frame indicator per scene', () => {
  const first = makeSegment('a', { x: 0, y: 0, ...HD }, { start: 0, duration: 5 })
  const second = makeSegment('b', { x: 3000, y: 0, width: 640, height: 360 }, { start: 8 })

  it('follows the scene at the given time, holding the last one through gaps', () => {
    expect(computeFrameRect([first, second], null, 1)).toEqual({ minX: 0, minY: 0, ...HD })
    expect(computeFrameRect([first, second], null, 6)).toEqual({ minX: 0, minY: 0, ...HD })
    expect(computeFrameRect([first, second], null, 9)).toEqual({
      minX: 3000,
      minY: 0,
      width: 640,
      height: 360,
    })
  })

  it('indexes scenes by start time', () => {
    const scenes = computeFrameScenes([first, second], null)
    expect(sceneIndexAt(scenes, -1)).toBe(0)
    expect(sceneIndexAt(scenes, 8)).toBe(1)
    expect(sceneIndexAt(scenes, 100)).toBe(1)
  })
})

describe('findOversizedAutoCanvas', () => {
  it('flags clips spread apart while playing together and suggests the largest clip size', () => {
    const left = makeSegment('a', { x: 0, y: 0, ...HD })
    const right = makeSegment('b', { x: 1920, y: 0, width: 1281, height: 720 })
    expect(findOversizedAutoCanvas([left, right])).toEqual({
      canvas: { width: 3200, height: 1080 },
      suggested: HD,
    })
  })

  it('ignores clips that play in turn and overlays inside the main clip', () => {
    const main = makeSegment('a', { x: 0, y: 0, ...HD }, { start: 0, duration: 5 })
    const later = makeSegment('b', { x: 2000, y: 0, ...HD }, { start: 6 })
    const overlay = makeSegment('c', { x: 100, y: 100, width: 320, height: 180 })
    expect(findOversizedAutoCanvas([main, later])).toBeNull()
    expect(findOversizedAutoCanvas([main, overlay])).toBeNull()
    expect(findOversizedAutoCanvas([main])).toBeNull()
  })
})
