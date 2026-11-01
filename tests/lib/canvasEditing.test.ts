import { describe, expect, it } from 'vitest'

import { editedTransform } from '@/components/advanced/AdvancedInspector'
import { fillPlacement, fitPlacement, placementChanges } from '@/lib/advanced/canvasPlacement'
import { frameRectForSegment } from '@/lib/advanced/exportLayout'
import { coverCrop } from '@/lib/advanced/fit'
import { snapCandidates, snapResize } from '@/lib/advanced/snapMath'
import { resolveGroupMoveDelta, resolveMoveStart } from '@/lib/timelineSnap'
import type { AdvancedSegment, Transform } from '@/lib/types'

const BOX: Transform = { x: 0, y: 0, width: 160, height: 90 }
const NO_LINES = { vertical: [], horizontal: [] }

function segment(transform: Transform, extra: Partial<AdvancedSegment> = {}): AdvancedSegment {
  return {
    id: 'seg',
    clipId: 'clip',
    trackId: 't1',
    timelineStart: 0,
    sourceStart: 0,
    sourceEnd: 4,
    transform,
    ...extra,
  }
}

describe('snapResize', () => {
  it('keeps the shape on a locked corner and frees it otherwise', () => {
    const locked = snapResize(BOX, 'se', 32, 0, true, NO_LINES, 4).transform
    expect(locked.width / locked.height).toBeCloseTo(16 / 9)
    expect(locked.width).toBeCloseTo(192)
    expect(snapResize(BOX, 'se', 32, 0, false, NO_LINES, 4).transform).toEqual({
      x: 0,
      y: 0,
      width: 192,
      height: 90,
    })
  })

  it('snaps only the edges the handle moves', () => {
    const lines = { vertical: [0, 203], horizontal: [97] }
    const result = snapResize(BOX, 'e', 40, 0, false, lines, 4)
    expect(result.transform).toEqual({ x: 0, y: 0, width: 203, height: 90 })
    expect(result).toMatchObject({ guideX: 203, guideY: null })
    // The south edge snaps on its own; the west edge (at 0) is not moving.
    const south = snapResize(BOX, 's', 0, 5, false, lines, 4)
    expect(south.transform.height).toBe(97)
    expect(south.guideY).toBe(97)
  })

  it('snaps a locked corner on the closer axis and derives the other', () => {
    // Dragging the south-east corner so the bottom edge nears y = 180.
    const result = snapResize(BOX, 'se', 158, 0, true, { vertical: [], horizontal: [180] }, 4)
    expect(result.transform.height).toBeCloseTo(180)
    expect(result.transform.width).toBeCloseTo(320)
    expect(result.guideY).toBe(180)
    expect(result.guideX).toBeNull()
  })

  it('anchors the opposite corner when the north-west corner snaps', () => {
    const result = snapResize(BOX, 'nw', -78, 0, true, { vertical: [-80], horizontal: [] }, 4)
    expect(result.transform.x).toBeCloseTo(-80)
    expect(result.transform.x + result.transform.width).toBeCloseTo(160)
    expect(result.transform.y + result.transform.height).toBeCloseTo(90)
    expect(result.guideX).toBe(-80)
  })
})

describe('snapCandidates with an output frame', () => {
  it('adds the frame edges and center', () => {
    const lines = snapCandidates([], { minX: 100, minY: 50, width: 200, height: 100 })
    expect(lines.vertical).toEqual([0, 100, 200, 300])
    expect(lines.horizontal).toEqual([0, 50, 100, 150])
  })
})

describe('fit and fill', () => {
  const frame = { minX: 100, minY: 100, width: 1920, height: 1080 }

  it('fits a portrait clip inside the frame, centered', () => {
    const portrait = segment({ x: 0, y: 0, width: 540, height: 960 })
    expect(fitPlacement(portrait, frame).transform).toEqual({
      x: 100 + (1920 - 607.5) / 2,
      y: 100,
      width: 607.5,
      height: 1080,
    })
  })

  it('fills the frame by cropping instead of stretching', () => {
    const portrait = segment({ x: 0, y: 0, width: 540, height: 960 })
    const placement = fillPlacement(portrait, frame, { width: 1080, height: 1920 })
    expect(placement.transform).toEqual({ x: 100, y: 100, width: 1920, height: 1080 })
    expect(placement.crop).toEqual({ x: 0, y: (1920 - 607.5) / 2, width: 1080, height: 607.5 })
    expect(placementChanges(portrait, placement)).toBe(true)
  })

  it('reports no change when the clip already sits that way', () => {
    const filled = segment({ x: 100, y: 100, width: 1920, height: 1080 })
    expect(placementChanges(filled, fitPlacement(filled, frame))).toBe(false)
  })

  it('crops within an existing crop', () => {
    expect(coverCrop({ x: 100, y: 0, width: 400, height: 400 }, 2)).toEqual({
      x: 100,
      y: 100,
      width: 400,
      height: 200,
    })
  })

  it('uses the frame of the scene the clip plays in', () => {
    const background = segment({ x: 0, y: 0, width: 1920, height: 1080 }, { id: 'bg' })
    const overlay = segment({ x: 50, y: 50, width: 320, height: 180 }, { id: 'pip' })
    const later = segment(
      { x: 0, y: 0, width: 640, height: 360 },
      { id: 'later', timelineStart: 10 }
    )
    const segments = [background, overlay, later]
    expect(frameRectForSegment(segments, null, 'pip')).toEqual({
      minX: 0,
      minY: 0,
      width: 1920,
      height: 1080,
    })
    expect(frameRectForSegment(segments, null, 'missing')).toBeNull()
  })
})

describe('resolveGroupMoveDelta', () => {
  const options = { thresholdSec: 0.1, snap: true, fps: 30 }

  it('matches a single clip move', () => {
    const single = resolveGroupMoveDelta(2.04, 1, [{ start: 1, end: 3 }], [5], options)
    const reference = resolveMoveStart(3.04, 2, [5], options)
    expect(1 + single.delta).toBeCloseTo(reference.start)
    expect(single.target).toBe(reference.target)
  })

  it('snaps on any member edge and keeps every member at or after 0', () => {
    const members = [
      { start: 2, end: 3 },
      { start: 5, end: 6 },
    ]
    // The second member's end (6 + 1.95) lands near 8.
    const snapped = resolveGroupMoveDelta(1.95, 2, members, [8], options)
    expect(snapped.delta).toBeCloseTo(2)
    expect(snapped.target).toBe(8)
    // Dragged far left, the earliest member stops at 0.
    expect(resolveGroupMoveDelta(-9, 5, [members[1], members[0]], [], options).delta).toBe(-2)
  })
})

describe('inspector box edits', () => {
  it('keeps the shape when the aspect is linked', () => {
    expect(editedTransform(BOX, 'width', 320, true)).toEqual({
      x: 0,
      y: 0,
      width: 320,
      height: 180,
    })
    expect(editedTransform(BOX, 'height', 45, true)).toEqual({ x: 0, y: 0, width: 80, height: 45 })
    expect(editedTransform(BOX, 'width', 320, false)).toEqual({
      x: 0,
      y: 0,
      width: 320,
      height: 90,
    })
    expect(editedTransform(BOX, 'x', -12, true)).toEqual({ ...BOX, x: -12 })
    // Sizes keep a minimum.
    expect(editedTransform(BOX, 'width', 1, false).width).toBe(16)
  })
})
