import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearEditNotice, editNotice } from '@/lib/editNotice'
import { clips, playheadTime, selectedSegmentId, timeline } from '@/lib/store'
import {
  appendClipToTimeline,
  beginGesture,
  endGesture,
  redo,
  resetHistory,
  setInPoint,
  setOutPoint,
  trimSegmentStart,
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
    waveformPeaks: new Float32Array(0),
  }
}

function segmentIds() {
  return timeline.value.map((segment) => segment.id)
}

beforeEach(() => {
  clips.value = []
  timeline.value = []
  selectedSegmentId.value = null
  playheadTime.value = 0
  resetHistory()
  clearEditNotice()
  appendClipToTimeline(makeClip('a'))
  appendClipToTimeline(makeClip('b'))
  resetHistory()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('trim gesture history', () => {
  it('records the state from before the gesture changed the selection', () => {
    const [first, second] = segmentIds()
    expect(selectedSegmentId.value).toBe(first)
    // A trim on the second block selects it, then trims it.
    beginGesture()
    selectedSegmentId.value = second
    trimSegmentStart(second, 2)
    trimSegmentStart(second, 3)
    endGesture()

    undo()
    expect(timeline.value[1].startTime).toBe(0)
    expect(selectedSegmentId.value).toBe(first)
    redo()
    expect(timeline.value[1].startTime).toBe(3)
    expect(selectedSegmentId.value).toBe(second)
  })

  it('records nothing for a gesture that never trims', () => {
    const [, second] = segmentIds()
    beginGesture()
    selectedSegmentId.value = second
    endGesture()
    undo()
    // Nothing to undo: the selection change alone is not an edit.
    expect(selectedSegmentId.value).toBe(second)
  })
})

describe('in and out points', () => {
  it('sets the in-point at a playhead inside the segment', () => {
    playheadTime.value = 4
    setInPoint()
    expect(timeline.value[0].startTime).toBe(4)
    expect(editNotice.value).toBeNull()
  })

  it('explains instead of doing nothing when the playhead is on an edge', () => {
    vi.useFakeTimers()
    playheadTime.value = 0
    setInPoint()
    expect(timeline.value[0].startTime).toBe(0)
    expect(editNotice.value).toMatch(/inside the selected segment.*in-point/)

    playheadTime.value = 10
    setOutPoint()
    expect(timeline.value[0].endTime).toBe(10)
    expect(editNotice.value).toMatch(/out-point/)

    // The notice clears itself.
    vi.advanceTimersByTime(3500)
    expect(editNotice.value).toBeNull()
  })

  it('asks for a selection when none is set', () => {
    selectedSegmentId.value = null
    playheadTime.value = 4
    setInPoint()
    expect(editNotice.value).toMatch(/Select a segment/)
  })

  it('stays silent on an empty timeline', () => {
    timeline.value = []
    selectedSegmentId.value = null
    setInPoint()
    expect(editNotice.value).toBeNull()
  })
})
