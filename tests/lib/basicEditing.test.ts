import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearEditNotice, editNotice } from '@/lib/editNotice'
import { clips, playheadTime, selectedSegmentId, timeline } from '@/lib/store'
import {
  appendClipToTimeline,
  beginGesture,
  deleteSegment,
  duplicateSegment,
  endGesture,
  isSegmentTrimmed,
  moveSegment,
  redo,
  resetSegmentTrim,
  resetHistory,
  setInPoint,
  setOutPoint,
  toggleMute,
  trimSegmentEnd,
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

describe('segment menu commands', () => {
  it('duplicates a segment right after itself and selects the copy', () => {
    const [first, second] = segmentIds()
    trimSegmentStart(first, 2)
    duplicateSegment(first)
    const ids = segmentIds()
    expect(ids).toHaveLength(3)
    expect(ids[0]).toBe(first)
    expect(ids[2]).toBe(second)
    expect(ids[1]).not.toBe(first)
    expect(timeline.value[1]).toMatchObject({ clipId: 'a', startTime: 2, endTime: 10 })
    expect(selectedSegmentId.value).toBe(ids[1])

    undo()
    expect(segmentIds()).toEqual([first, second])
    expect(selectedSegmentId.value).toBe(first)
  })

  it('duplicates the selected segment by default', () => {
    const [, second] = segmentIds()
    selectedSegmentId.value = second
    duplicateSegment()
    expect(timeline.value.map((segment) => segment.clipId)).toEqual(['a', 'b', 'b'])
  })

  it('resets a trim to the full clip as one undoable step', () => {
    const [first] = segmentIds()
    trimSegmentStart(first, 2)
    trimSegmentEnd(first, 7)
    expect(isSegmentTrimmed(timeline.value[0])).toBe(true)
    resetSegmentTrim(first)
    expect(timeline.value[0]).toMatchObject({ startTime: 0, endTime: 10 })
    expect(isSegmentTrimmed(timeline.value[0])).toBe(false)
    undo()
    expect(timeline.value[0]).toMatchObject({ startTime: 2, endTime: 7 })
  })

  it('moves a segment one place and ignores moves past the ends', () => {
    const [first, second] = segmentIds()
    moveSegment(first, 1)
    expect(segmentIds()).toEqual([second, first])
    moveSegment(first, 1)
    moveSegment(second, -1)
    expect(segmentIds()).toEqual([second, first])
    moveSegment(first, -1)
    expect(segmentIds()).toEqual([first, second])
    undo()
    expect(segmentIds()).toEqual([second, first])
  })

  it('mutes and deletes the segment it is given, not only the selected one', () => {
    const [first, second] = segmentIds()
    toggleMute(second)
    expect(timeline.value[1].muted).toBe(true)
    expect(timeline.value[0].muted).toBeFalsy()
    deleteSegment(second)
    expect(segmentIds()).toEqual([first])
    undo()
    undo()
    expect(timeline.value[1].muted).toBeFalsy()
  })
})
