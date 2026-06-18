import { beforeEach, describe, expect, it } from 'vitest'

import { clearAdvancedClip, setAdvancedClip, setCanvasSize } from '@/lib/advanced/advancedEditing'
import {
  advancedCanvas,
  advancedSegments,
  advancedSelectedId,
  clips,
  DEFAULT_CANVAS,
} from '@/lib/store'
import type { Clip } from '@/lib/types'

function makeClip(id: string, width: number, height: number): Clip {
  return {
    id,
    file: new File([new Uint8Array([0])], `${id}.mp4`, { type: 'video/mp4' }),
    name: id,
    duration: 12,
    width,
    height,
    objectUrl: `blob:${id}`,
    waveformPeaks: [],
  }
}

describe('advancedEditing', () => {
  beforeEach(() => {
    clips.value = []
    advancedSegments.value = []
    advancedSelectedId.value = null
    advancedCanvas.value = DEFAULT_CANVAS
  })

  it('places a clip as the single segment with a contain-fit transform', () => {
    const clip = makeClip('a', 1920, 1080)
    const id = setAdvancedClip(clip)
    expect(advancedSegments.value).toHaveLength(1)
    expect(advancedSelectedId.value).toBe(id)
    const segment = advancedSegments.value[0]
    expect(segment.clipId).toBe('a')
    expect(segment.sourceStart).toBe(0)
    expect(segment.sourceEnd).toBe(12)
    expect(segment.timelineStart).toBe(0)
    expect(segment.transform).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
    expect(clips.value.some((entry) => entry.id === 'a')).toBe(true)
  })

  it('replaces the existing clip rather than appending', () => {
    setAdvancedClip(makeClip('a', 1920, 1080))
    setAdvancedClip(makeClip('b', 1280, 720))
    expect(advancedSegments.value).toHaveLength(1)
    expect(advancedSegments.value[0].clipId).toBe('b')
  })

  it('recomputes the segment transform when the canvas size changes', () => {
    setAdvancedClip(makeClip('a', 1920, 1080))
    setCanvasSize(1000, 1000)
    expect(advancedCanvas.value).toEqual({ width: 1000, height: 1000 })
    const segment = advancedSegments.value[0]
    expect(segment.transform.width).toBeCloseTo(1000)
    expect(segment.transform.height).toBeCloseTo(562.5)
  })

  it('clamps canvas dimensions to even integers within bounds', () => {
    setCanvasSize(1281, 9999)
    expect(advancedCanvas.value).toEqual({ width: 1280, height: 7680 })
  })

  it('clears the placed clip', () => {
    setAdvancedClip(makeClip('a', 1920, 1080))
    clearAdvancedClip()
    expect(advancedSegments.value).toHaveLength(0)
    expect(advancedSelectedId.value).toBeNull()
  })
})
