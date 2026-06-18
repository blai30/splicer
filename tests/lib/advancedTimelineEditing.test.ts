import { beforeEach, describe, expect, it } from 'vitest'

import { addClipToTrack } from '@/lib/advanced/advancedSegmentEditing'
import {
  cutAdvancedAtPlayhead,
  deleteAdvancedSelected,
  setAdvancedInPoint,
  setAdvancedOutPoint,
  toggleAdvancedMute,
} from '@/lib/advanced/advancedTimelineEditing'
import {
  advancedCanvas,
  advancedPlayhead,
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

describe('advancedTimelineEditing', () => {
  beforeEach(() => {
    clips.value = []
    advancedSegments.value = []
    advancedSelectedId.value = null
    advancedPlayhead.value = 0
    advancedCanvas.value = DEFAULT_CANVAS
  })

  it('sets the in-point: trims source start and moves the left edge to the playhead', () => {
    addClipToTrack(makeClip('a'), 'track-1', 0) // selects it; 0..6 on timeline
    advancedPlayhead.value = 2
    setAdvancedInPoint()
    const segment = advancedSegments.value[0]
    expect(segment.sourceStart).toBe(2)
    expect(segment.timelineStart).toBe(2)
  })

  it('sets the out-point: trims source end to the playhead, keeping timelineStart', () => {
    addClipToTrack(makeClip('a'), 'track-1', 0)
    advancedPlayhead.value = 4
    setAdvancedOutPoint()
    const segment = advancedSegments.value[0]
    expect(segment.sourceEnd).toBe(4)
    expect(segment.timelineStart).toBe(0)
  })

  it('cuts the selected clip at the playhead and selects the new tail', () => {
    addClipToTrack(makeClip('a'), 'track-1', 0)
    advancedPlayhead.value = 2
    cutAdvancedAtPlayhead()
    expect(advancedSegments.value).toHaveLength(2)
    const sorted = [...advancedSegments.value].sort((a, b) => a.timelineStart - b.timelineStart)
    expect(sorted[1].id).toBe(advancedSelectedId.value)
  })

  it('no-ops In/Out/Cut when the playhead is outside the selected clip', () => {
    addClipToTrack(makeClip('a'), 'track-1', 0)
    advancedPlayhead.value = 6 // at/after the end
    setAdvancedInPoint()
    setAdvancedOutPoint()
    cutAdvancedAtPlayhead()
    expect(advancedSegments.value).toHaveLength(1)
    expect(advancedSegments.value[0]).toMatchObject({
      sourceStart: 0,
      sourceEnd: 6,
      timelineStart: 0,
    })
  })

  it('no-ops when nothing is selected', () => {
    addClipToTrack(makeClip('a'), 'track-1', 0)
    advancedSelectedId.value = null
    advancedPlayhead.value = 2
    setAdvancedInPoint()
    expect(advancedSegments.value[0]).toMatchObject({ sourceStart: 0 })
  })

  it('toggles mute on the selected segment', () => {
    addClipToTrack(makeClip('a'), 'track-1', 0)
    toggleAdvancedMute()
    expect(advancedSegments.value[0].muted).toBe(true)
    toggleAdvancedMute()
    expect(advancedSegments.value[0].muted).toBe(false)
  })

  it('deletes the selected segment', () => {
    addClipToTrack(makeClip('a'), 'track-1', 0)
    deleteAdvancedSelected()
    expect(advancedSegments.value).toHaveLength(0)
  })
})
