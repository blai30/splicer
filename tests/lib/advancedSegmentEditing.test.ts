import { beforeEach, describe, expect, it } from 'vitest'

import {
  addClipToTrack,
  moveSegment,
  removeAdvancedSegment,
} from '@/lib/advanced/advancedSegmentEditing'
import { advancedCanvas, advancedSegments, advancedSelectedId, clips, DEFAULT_CANVAS } from '@/lib/store'
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
