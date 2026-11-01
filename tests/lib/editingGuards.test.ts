import { beforeEach, describe, expect, it } from 'vitest'

import {
  beginAdvancedGesture,
  endAdvancedGesture,
  resetAdvancedHistory,
  undoAdvanced,
} from '@/lib/advanced/advancedHistory'
import {
  addClipToTrack,
  moveSegment,
  trimSegmentStart,
} from '@/lib/advanced/advancedSegmentEditing'
import { addTrack, removeTrack } from '@/lib/advanced/advancedTrackEditing'
import {
  advancedSegments,
  advancedTracks,
  clips,
  playheadTime,
  selectedSegmentId,
  timeline,
} from '@/lib/store'
import {
  appendClipToTimeline,
  canUndo,
  resetHistory,
  setInPoint,
  undo,
} from '@/lib/timelineEditing'
import type { Clip } from '@/lib/types'

function makeClip(id: string, duration = 10): Clip {
  return {
    id,
    file: new File([new Uint8Array([0])], `${id}.mp4`),
    name: id,
    duration,
    width: 640,
    height: 360,
    objectUrl: `blob:${id}`,
    waveformPeaks: [],
  }
}

describe('editing guards', () => {
  beforeEach(() => {
    clips.value = []
    timeline.value = []
    selectedSegmentId.value = null
    advancedSegments.value = []
    advancedTracks.value = [{ id: 'track-1', name: 'Track 1' }]
    resetHistory()
    resetAdvancedHistory()
  })

  it('keeps at least one Advanced track', () => {
    removeTrack('track-1')
    expect(advancedTracks.value).toHaveLength(1)
  })

  it('names new tracks uniquely after removals', () => {
    const second = addTrack()
    addTrack()
    removeTrack(second)
    addTrack()
    const names = advancedTracks.value.map((track) => track.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('does not shift content when trimming the head past the timeline origin', () => {
    const id = addClipToTrack(makeClip('a'), 'track-1', 0)
    trimSegmentStart(id, 5)
    moveSegment(id, 'track-1', 2)
    // Head at source 5, placed at timeline 2. Extending the head further left
    // than the timeline origin would shift the clip's content; it stops at 0.
    trimSegmentStart(id, -100)
    const segment = advancedSegments.value[0]
    expect(segment.timelineStart).toBe(0)
    expect(segment.sourceStart).toBe(3)
    // The right edge never moved.
    expect(segment.timelineStart + segment.sourceEnd - segment.sourceStart).toBe(7)
  })

  it('treats an in-point outside the segment as a no-op without history', () => {
    appendClipToTimeline(makeClip('b'))
    resetHistory()
    playheadTime.value = 0
    setInPoint()
    expect(canUndo.value).toBe(false)
    playheadTime.value = 3
    setInPoint()
    expect(timeline.value[0].startTime).toBe(3)
    undo()
    expect(timeline.value[0].startTime).toBe(0)
  })

  it('undo restores an Advanced trim', () => {
    const id = addClipToTrack(makeClip('c'), 'track-1', 0)
    resetAdvancedHistory()
    beginAdvancedGesture()
    trimSegmentStart(id, 2)
    // Undo waits while the drag is still in progress.
    undoAdvanced()
    expect(advancedSegments.value[0].sourceStart).toBe(2)
    trimSegmentStart(id, 3)
    endAdvancedGesture()
    undoAdvanced()
    expect(advancedSegments.value[0].sourceStart).toBe(0)
  })
})
