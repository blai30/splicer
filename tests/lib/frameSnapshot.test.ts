import { describe, expect, it } from 'vitest'

import { snapshotFilename, snapshotSourceRect } from '@/lib/frameSnapshot'

describe('snapshotSourceRect', () => {
  it('keeps the whole frame without a crop', () => {
    expect(
      snapshotSourceRect({ width: 1920, height: 1080 }, { width: 1920, height: 1080 })
    ).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
  })

  it('scales the crop from the probed size to the decoded size', () => {
    const rect = snapshotSourceRect(
      { width: 960, height: 540 },
      { width: 1920, height: 1080 },
      { x: 100, y: 50, width: 800, height: 400 }
    )
    expect(rect).toEqual({ x: 50, y: 25, width: 400, height: 200 })
  })

  it('keeps a crop that runs past the edge inside the frame', () => {
    const rect = snapshotSourceRect(
      { width: 100, height: 100 },
      { width: 100, height: 100 },
      { x: 80, y: 90, width: 50, height: 50 }
    )
    expect(rect).toEqual({ x: 80, y: 90, width: 20, height: 10 })
  })

  it('ignores an empty crop', () => {
    const rect = snapshotSourceRect(
      { width: 640, height: 360 },
      { width: 640, height: 360 },
      { x: 10, y: 10, width: 0, height: 0 }
    )
    expect(rect).toEqual({ x: 0, y: 0, width: 640, height: 360 })
  })
})

describe('snapshotFilename', () => {
  it('names the frame after the clip and its source time', () => {
    expect(snapshotFilename('holiday.mp4', 62.5)).toBe('holiday-1m02.500s.png')
  })

  it('pads seconds under ten and rounds to the millisecond', () => {
    expect(snapshotFilename('clip.webm', 3.14159)).toBe('clip-0m03.142s.png')
  })

  it('replaces characters that file systems reject', () => {
    expect(snapshotFilename('a:b/c?.mov', 0)).toBe('a-b-c-0m00.000s.png')
  })

  it('falls back to a generic name for an empty clip name', () => {
    expect(snapshotFilename('.mp4', 1)).toBe('frame-0m01.000s.png')
  })
})
