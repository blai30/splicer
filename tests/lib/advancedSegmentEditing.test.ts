import { beforeEach, describe, expect, it } from 'vitest'

import {
  addClipToTrack,
  moveSegment,
  removeAdvancedSegment,
  setSegmentCrop,
  setSegmentTransform,
  splitAdvancedSegment,
  trimSegmentEnd,
  trimSegmentStart,
} from '@/lib/advanced/advancedSegmentEditing'
import {
  advancedCanvas,
  advancedCanvasAuto,
  advancedSegments,
  advancedSelectedId,
  clips,
  DEFAULT_CANVAS,
} from '@/lib/store'
import type { Clip } from '@/lib/types'

function makeClip(id: string): Clip {
  return {
    id,
    file: new File([new Uint8Array([0])], `${id}.mp4`),
    name: id,
    duration: 6,
    width: 1280,
    height: 720,
    objectUrl: `blob:${id}`,
    waveformPeaks: [],
  }
}

describe('advancedSegmentEditing', () => {
  beforeEach(() => {
    clips.value = []
    advancedSegments.value = []
    advancedSelectedId.value = null
    advancedCanvas.value = DEFAULT_CANVAS
  })

  it('adds multiple clips as separate segments with fit transforms', () => {
    const first = addClipToTrack(makeClip('a'), 'track-1', 0)
    addClipToTrack(makeClip('b'), 'track-1', 6)
    expect(advancedSegments.value).toHaveLength(2)
    expect(advancedSelectedId.value).toBe(advancedSegments.value[1].id)
    const segment = advancedSegments.value.find((entry) => entry.id === first)
    expect(segment?.transform).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
    expect(segment?.timelineStart).toBe(0)
  })

  it('moves a segment to another track and time, clamping start to zero', () => {
    const id = addClipToTrack(makeClip('a'), 'track-1', 0)
    moveSegment(id, 'track-2', -3)
    const segment = advancedSegments.value[0]
    expect(segment.trackId).toBe('track-2')
    expect(segment.timelineStart).toBe(0)
  })

  it('removes a segment', () => {
    const id = addClipToTrack(makeClip('a'), 'track-1', 0)
    removeAdvancedSegment(id)
    expect(advancedSegments.value).toHaveLength(0)
  })
})

describe('advancedSegmentEditing auto canvas recompute', () => {
  beforeEach(() => {
    clips.value = []
    advancedSegments.value = []
    advancedSelectedId.value = null
    advancedCanvas.value = DEFAULT_CANVAS
    advancedCanvasAuto.value = false
  })

  it('resizes the canvas to wrap a newly added clip when auto is on', () => {
    advancedCanvasAuto.value = true
    const portrait: Clip = {
      id: 'p',
      file: new File([new Uint8Array([0])], 'p.mp4'),
      name: 'p',
      duration: 6,
      width: 480,
      height: 640,
      objectUrl: 'blob:p',
      waveformPeaks: [],
    }
    addClipToTrack(portrait, 'track-1', 0)
    // fitRect(480x640 into 1920x1080) -> {555,0,810,1080}; auto shifts flush.
    expect(advancedCanvas.value).toEqual({ width: 810, height: 1080 })
    expect(advancedSegments.value[0].transform).toEqual({ x: 0, y: 0, width: 810, height: 1080 })
  })

  it('resizes the canvas to the remaining content when a clip is removed', () => {
    advancedCanvasAuto.value = true
    advancedSegments.value = [
      {
        id: 'a',
        clipId: 'a',
        trackId: 'track-1',
        timelineStart: 0,
        sourceStart: 0,
        sourceEnd: 5,
        transform: { x: 0, y: 0, width: 800, height: 400 },
      },
      {
        id: 'b',
        clipId: 'b',
        trackId: 'track-1',
        timelineStart: 0,
        sourceStart: 0,
        sourceEnd: 5,
        transform: { x: 1000, y: 500, width: 600, height: 300 },
      },
    ]
    removeAdvancedSegment('b')
    expect(advancedSegments.value).toHaveLength(1)
    expect(advancedCanvas.value).toEqual({ width: 800, height: 400 })
  })
})

describe('advancedSegmentEditing trim and split', () => {
  beforeEach(() => {
    clips.value = []
    advancedSegments.value = []
    advancedSelectedId.value = null
    advancedCanvas.value = DEFAULT_CANVAS
  })

  it('trims the end without moving timelineStart', () => {
    const id = addClipToTrack(makeClip('a'), 'track-1', 2)
    trimSegmentEnd(id, 4)
    const segment = advancedSegments.value[0]
    expect(segment.sourceEnd).toBe(4)
    expect(segment.timelineStart).toBe(2)
  })

  it('trims the start and shifts timelineStart by the same delta', () => {
    const id = addClipToTrack(makeClip('a'), 'track-1', 2)
    trimSegmentStart(id, 1)
    const segment = advancedSegments.value[0]
    expect(segment.sourceStart).toBe(1)
    expect(segment.timelineStart).toBe(3)
  })

  it('splits a segment at a global time into two abutting segments', () => {
    const id = addClipToTrack(makeClip('a'), 'track-1', 0) // 0..6 on timeline, source 0..6
    const newId = splitAdvancedSegment(id, 2)
    expect(newId).not.toBeNull()
    const sorted = [...advancedSegments.value].sort((a, b) => a.timelineStart - b.timelineStart)
    expect(sorted[0]).toMatchObject({ sourceStart: 0, sourceEnd: 2, timelineStart: 0 })
    expect(sorted[1]).toMatchObject({ sourceStart: 2, sourceEnd: 6, timelineStart: 2 })
  })
})

describe('advancedSegmentEditing transform and crop', () => {
  beforeEach(() => {
    clips.value = []
    advancedSegments.value = []
    advancedSelectedId.value = null
  })

  it('sets a segment transform', () => {
    const id = addClipToTrack(makeClip('a'), 'track-1', 0)
    setSegmentTransform(id, { x: 10, y: 20, width: 300, height: 200 })
    expect(advancedSegments.value[0].transform).toEqual({ x: 10, y: 20, width: 300, height: 200 })
  })

  it('sets and clears a segment crop', () => {
    const id = addClipToTrack(makeClip('a'), 'track-1', 0)
    setSegmentCrop(id, { x: 5, y: 5, width: 100, height: 50 })
    expect(advancedSegments.value[0].crop).toEqual({ x: 5, y: 5, width: 100, height: 50 })
    setSegmentCrop(id, undefined)
    expect(advancedSegments.value[0].crop).toBeUndefined()
  })
})
