import { beforeEach, describe, expect, it } from 'vitest'

import {
  beginAdvancedGesture,
  canUndoAdvanced,
  endAdvancedGesture,
  resetAdvancedHistory,
  undoAdvanced,
} from '@/lib/advanced/advancedHistory'
import {
  addClipToTrack,
  clampSegmentProps,
  nudgeSegmentTransforms,
  placeSegment,
  setSegmentProps,
} from '@/lib/advanced/advancedSegmentEditing'
import {
  clearAdvancedSelection,
  setActiveAdvancedTrack,
  setAdvancedSelection,
} from '@/lib/advanced/advancedSelection'
import {
  advancedClipboardSize,
  copyAdvancedSelected,
  cutAdvancedSelected,
  deleteAdvancedSelected,
  duplicateAdvancedSelected,
  nudgeAdvancedSelected,
  pasteAdvanced,
  resetAdvancedClipboard,
  rippleDeleteAdvancedSelected,
  toggleAdvancedMute,
} from '@/lib/advanced/advancedTimelineEditing'
import { collectUnusedClips } from '@/lib/clipPool'
import {
  advancedPlayhead,
  advancedSegments,
  advancedSelectedIds,
  advancedTracks,
  clips,
  framerate,
} from '@/lib/store'
import type { Clip } from '@/lib/types'

function makeClip(id: string): Clip {
  return {
    id,
    file: new File([new Uint8Array([0])], `${id}.mp4`),
    name: id,
    duration: 2,
    width: 1280,
    height: 720,
    frameRate: 25,
    objectUrl: `blob:${id}`,
    waveformPeaks: new Float32Array(0),
  }
}

const starts = () => advancedSegments.value.map((entry) => entry.timelineStart)

function undoCount(): number {
  let count = 0
  while (canUndoAdvanced.value) {
    undoAdvanced()
    count += 1
  }
  return count
}

describe('Advanced clip actions on the selection', () => {
  let first: string
  let second: string

  beforeEach(() => {
    clips.value = []
    advancedSegments.value = []
    advancedTracks.value = [
      { id: 'track-1', name: 'Track 1' },
      { id: 'track-2', name: 'Track 2' },
    ]
    framerate.value = 'original'
    advancedPlayhead.value = 0
    clearAdvancedSelection()
    setActiveAdvancedTrack(null)
    resetAdvancedClipboard()
    first = addClipToTrack(makeClip('a'), 'track-1', 0)
    second = addClipToTrack(makeClip('b'), 'track-1', 2)
    setAdvancedSelection([first, second], first)
    resetAdvancedHistory()
  })

  it('deletes and mutes every selected clip in one step each', () => {
    toggleAdvancedMute()
    expect(advancedSegments.value.every((entry) => entry.muted)).toBe(true)
    toggleAdvancedMute()
    expect(advancedSegments.value.every((entry) => !entry.muted)).toBe(true)
    deleteAdvancedSelected()
    expect(advancedSegments.value).toEqual([])
    expect(advancedSelectedIds.value).toEqual([])
    expect(undoCount()).toBe(3)
    expect(advancedSegments.value).toHaveLength(2)
  })

  it('mutes a mixed selection rather than flipping each clip', () => {
    setAdvancedSelection([first])
    toggleAdvancedMute()
    setAdvancedSelection([first, second])
    toggleAdvancedMute()
    expect(advancedSegments.value.every((entry) => entry.muted)).toBe(true)
  })

  it('duplicates the selection after itself and selects the copies', () => {
    duplicateAdvancedSelected()
    expect(starts()).toEqual([0, 2, 4, 6])
    expect(advancedSelectedIds.value).toEqual(
      advancedSegments.value.slice(2).map((entry) => entry.id)
    )
    expect(undoCount()).toBe(1)
  })

  it('pastes at the playhead on the active track and keeps copied clips in the pool', () => {
    setAdvancedSelection([second])
    expect(copyAdvancedSelected()).toBe(true)
    expect(advancedClipboardSize.value).toBe(1)
    deleteAdvancedSelected()
    // Nothing on the timeline or in history references clip b anymore, but
    // the clipboard does.
    resetAdvancedHistory()
    collectUnusedClips()
    expect(clips.value.map((clip) => clip.id)).toEqual(['a', 'b'])

    advancedPlayhead.value = 5
    setActiveAdvancedTrack('track-2')
    pasteAdvanced()
    const pasted = advancedSegments.value.at(-1)!
    expect(pasted).toMatchObject({ clipId: 'b', trackId: 'track-2', timelineStart: 5 })
    expect(pasted.id).not.toBe(second)
    expect(advancedSelectedIds.value).toEqual([pasted.id])

    resetAdvancedClipboard()
    collectUnusedClips()
    expect(clips.value.map((clip) => clip.id)).toEqual(['a', 'b'])
  })

  it('cuts to the clipboard', () => {
    cutAdvancedSelected()
    expect(advancedSegments.value).toEqual([])
    advancedPlayhead.value = 1
    pasteAdvanced()
    expect(starts()).toEqual([1, 3])
  })

  it('nudges by whole frames of the project grid, one undo step per burst', () => {
    nudgeAdvancedSelected(1)
    nudgeAdvancedSelected(1)
    nudgeAdvancedSelected(10)
    expect(starts()[0]).toBeCloseTo(12 / 25)
    expect(starts()[1]).toBeCloseTo(2 + 12 / 25)
    expect(undoCount()).toBe(1)
    expect(starts()).toEqual([0, 2])
  })

  it('ripple deletes, closing the gap on the track', () => {
    const third = addClipToTrack(makeClip('c'), 'track-1', 4)
    setAdvancedSelection([second])
    rippleDeleteAdvancedSelected()
    expect(advancedSegments.value.map((entry) => [entry.id, entry.timelineStart])).toEqual([
      [first, 0],
      [third, 2],
    ])
  })

  it('nudges transforms on the canvas, one undo step per burst', () => {
    nudgeSegmentTransforms([first, second], 10, -1)
    nudgeSegmentTransforms([first, second], 10, 0)
    expect(advancedSegments.value.map((entry) => [entry.transform.x, entry.transform.y])).toEqual([
      [20, -1],
      [20, -1],
    ])
    expect(undoCount()).toBe(1)
  })
})

describe('inspector edits', () => {
  let id: string

  beforeEach(() => {
    clips.value = []
    advancedSegments.value = []
    advancedTracks.value = [{ id: 'track-1', name: 'Track 1' }]
    clearAdvancedSelection()
    id = addClipToTrack(makeClip('a'), 'track-1', 0)
    resetAdvancedHistory()
  })

  it('clamps opacity, volume, and fades into range', () => {
    const segment = advancedSegments.value[0]
    expect(clampSegmentProps(segment, { opacity: 2, volume: -1, fadeIn: 9, fadeOut: -3 })).toEqual({
      opacity: 1,
      volume: 0,
      fadeIn: 2,
      fadeOut: 0,
    })
    expect(clampSegmentProps(segment, { opacity: Number.NaN })).toEqual({})
  })

  it('records a slider drag as one undo step', () => {
    beginAdvancedGesture()
    setSegmentProps(id, { opacity: 0.9 })
    setSegmentProps(id, { opacity: 0.5 })
    endAdvancedGesture()
    expect(advancedSegments.value[0].opacity).toBe(0.5)
    expect(undoCount()).toBe(1)
    expect(advancedSegments.value[0].opacity).toBeUndefined()
  })

  it('coalesces repeated key presses on one control but not across controls', () => {
    setSegmentProps(id, { volume: 0.9 })
    setSegmentProps(id, { volume: 0.8 })
    setSegmentProps(id, { fadeIn: 1 })
    expect(undoCount()).toBe(2)
  })

  it('skips edits that change nothing', () => {
    setSegmentProps(id, { opacity: 0.5 })
    resetAdvancedHistory()
    setSegmentProps(id, { opacity: 0.5 })
    expect(canUndoAdvanced.value).toBe(false)
  })

  it('places a clip exactly in one step', () => {
    placeSegment(id, { x: 10, y: 20, width: 640, height: 360 })
    placeSegment(id, { x: 10, y: 20, width: 640, height: 360 })
    expect(advancedSegments.value[0].transform).toEqual({ x: 10, y: 20, width: 640, height: 360 })
    expect(undoCount()).toBe(1)
  })
})
