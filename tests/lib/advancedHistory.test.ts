import { beforeEach, describe, expect, it } from 'vitest'

import { setOutputLock } from '@/lib/advanced/advancedEditing'
import {
  recordAdvancedHistory,
  recordAdvancedHistoryCoalesced,
  redoAdvanced,
  resetAdvancedHistory,
  undoAdvanced,
} from '@/lib/advanced/advancedHistory'
import { addClipToTrack, toggleSegmentMute } from '@/lib/advanced/advancedSegmentEditing'
import { deleteAdvancedSelected, setAdvancedInPoint } from '@/lib/advanced/advancedTimelineEditing'
import { addTrack } from '@/lib/advanced/advancedTrackEditing'
import {
  advancedOutputLock,
  advancedPlayhead,
  advancedSegments,
  advancedSelectedId,
  advancedTracks,
  clips,
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
    waveformPeaks: new Float32Array(0),
  }
}

describe('advancedHistory', () => {
  beforeEach(() => {
    clips.value = []
    advancedSegments.value = []
    advancedTracks.value = []
    advancedSelectedId.value = null
    advancedPlayhead.value = 0
    advancedOutputLock.value = null
    resetAdvancedHistory()
  })

  it('folds a burst of coalesced edits into one entry, but not across other edits', () => {
    addClipToTrack(makeClip('a'), 'track-1', 0)
    const id = advancedSegments.value[0].id
    const shift = (delta: number) => {
      recordAdvancedHistoryCoalesced(`nudge:${id}`)
      advancedSegments.value = advancedSegments.value.map((segment) => ({
        ...segment,
        timelineStart: segment.timelineStart + delta,
      }))
    }
    shift(1)
    shift(1)
    toggleSegmentMute(id)
    shift(1)
    expect(advancedSegments.value[0].timelineStart).toBe(3)
    undoAdvanced()
    expect(advancedSegments.value[0].timelineStart).toBe(2)
    undoAdvanced()
    expect(advancedSegments.value[0].muted).toBeFalsy()
    expect(advancedSegments.value[0].timelineStart).toBe(2)
    undoAdvanced()
    expect(advancedSegments.value[0].timelineStart).toBe(0)
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

  it('undoes an import: removes the segment, keeps the clip for redo, then releases it', async () => {
    addClipToTrack(makeClip('a'), 'track-1', 0)
    expect(advancedSegments.value).toHaveLength(1)
    expect(clips.value).toHaveLength(1)
    undoAdvanced()
    expect(advancedSegments.value).toHaveLength(0)
    // Redo can still bring the segment back, so the clip stays in the pool.
    expect(clips.value).toHaveLength(1)
    redoAdvanced()
    expect(advancedSegments.value).toHaveLength(1)
    undoAdvanced()
    // A new edit drops the redo branch; nothing references the clip anymore.
    addTrack()
    await Promise.resolve()
    expect(clips.value).toHaveLength(0)
  })

  it('undoes a track add', () => {
    addTrack()
    expect(advancedTracks.value).toHaveLength(1)
    undoAdvanced()
    expect(advancedTracks.value).toHaveLength(0)
  })

  it('undo/redo restores the output lock', () => {
    advancedOutputLock.value = null
    recordAdvancedHistory()
    setOutputLock(1280, 720)
    expect(advancedOutputLock.value).toEqual({ width: 1280, height: 720 })

    undoAdvanced()
    expect(advancedOutputLock.value).toBeNull()

    redoAdvanced()
    expect(advancedOutputLock.value).toEqual({ width: 1280, height: 720 })
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
