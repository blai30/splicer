import { beforeEach, describe, expect, it } from 'vitest'

import { redoAdvanced, resetAdvancedHistory, undoAdvanced } from '@/lib/advanced/advancedHistory'
import { addClipToTrack, toggleSegmentMute } from '@/lib/advanced/advancedSegmentEditing'
import { deleteAdvancedSelected, setAdvancedInPoint } from '@/lib/advanced/advancedTimelineEditing'
import { addTrack } from '@/lib/advanced/advancedTrackEditing'
import {
  advancedCanvas,
  advancedPlayhead,
  advancedSegments,
  advancedSelectedId,
  advancedTracks,
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

describe('advancedHistory', () => {
  beforeEach(() => {
    clips.value = []
    advancedSegments.value = []
    advancedTracks.value = []
    advancedSelectedId.value = null
    advancedPlayhead.value = 0
    advancedCanvas.value = DEFAULT_CANVAS
    resetAdvancedHistory()
  })

  it('undoes and redoes a mute toggle', () => {
    addClipToTrack(makeClip('a'), 'track-1', 0)
    toggleSegmentMute(advancedSegments.value[0].id)
    expect(advancedSegments.value[0].muted).toBe(true)
    undoAdvanced()
    expect(advancedSegments.value[0].muted).toBeFalsy()
    redoAdvanced()
    expect(advancedSegments.value[0].muted).toBe(true)
  })

  it('undoes a delete by restoring the segment and selection', () => {
    const id = addClipToTrack(makeClip('a'), 'track-1', 0)
    deleteAdvancedSelected()
    expect(advancedSegments.value).toHaveLength(0)
    undoAdvanced()
    expect(advancedSegments.value).toHaveLength(1)
    expect(advancedSelectedId.value).toBe(id)
  })

  it('undoes an in-point trim as a single entry', () => {
    addClipToTrack(makeClip('a'), 'track-1', 0)
    advancedPlayhead.value = 2
    setAdvancedInPoint()
    expect(advancedSegments.value[0].sourceStart).toBe(2)
    undoAdvanced()
    expect(advancedSegments.value[0].sourceStart).toBe(0)
  })

  it('undoes an import: removes the clip and its segment', () => {
    addClipToTrack(makeClip('a'), 'track-1', 0)
    expect(advancedSegments.value).toHaveLength(1)
    expect(clips.value).toHaveLength(1)
    undoAdvanced()
    expect(advancedSegments.value).toHaveLength(0)
    expect(clips.value).toHaveLength(0)
  })

  it('undoes a track add', () => {
    addTrack()
    expect(advancedTracks.value).toHaveLength(1)
    undoAdvanced()
    expect(advancedTracks.value).toHaveLength(0)
  })

  it('a new edit clears the redo stack', () => {
    addClipToTrack(makeClip('a'), 'track-1', 0)
    const id = advancedSegments.value[0].id
    toggleSegmentMute(id)
    undoAdvanced()
    expect(advancedSegments.value[0].muted).toBeFalsy()
    // New edit invalidates the redo branch.
    toggleSegmentMute(id)
    expect(advancedSegments.value[0].muted).toBe(true)
    redoAdvanced()
    expect(advancedSegments.value[0].muted).toBe(true)
  })
})
