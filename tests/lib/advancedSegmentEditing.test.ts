import { beforeEach, describe, expect, it } from 'vitest'

import { canUndoAdvanced, resetAdvancedHistory, undoAdvanced } from '@/lib/advanced/advancedHistory'
import {
  addClipToTrack,
  appendClipToTrack,
  moveSegment,
  moveSegmentToNewTrack,
  removeAdvancedSegment,
  setSegmentCrop,
  setSegmentProps,
  setSegmentTransform,
  splitAdvancedSegment,
  trimSegmentEnd,
  trimSegmentStart,
} from '@/lib/advanced/advancedSegmentEditing'
import { clearAdvancedSelection } from '@/lib/advanced/advancedSelection'
import { segmentGainAt } from '@/lib/advanced/segmentGain'
import { advancedSegments, advancedSelectedId, advancedTracks, clips } from '@/lib/store'
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

describe('advancedSegmentEditing', () => {
  beforeEach(() => {
    clips.value = []
    advancedSegments.value = []
    clearAdvancedSelection()
    advancedTracks.value = [{ id: 'track-1', name: 'Track 1' }]
    resetAdvancedHistory()
  })

  it.each(['top', 'bottom'] as const)(
    'moves a clip onto a new %s track as one undo step',
    (position) => {
      const id = addClipToTrack(makeClip('a'), 'track-1', 0)
      resetAdvancedHistory()
      const trackId = moveSegmentToNewTrack(id, position, 2.5)
      const tracks = advancedTracks.value
      expect(tracks).toHaveLength(2)
      expect(tracks[position === 'top' ? 0 : 1]).toEqual({ id: trackId, name: 'Track 2' })
      expect(advancedSegments.value[0]).toMatchObject({ trackId, timelineStart: 2.5 })

      undoAdvanced()
      expect(advancedTracks.value).toEqual([{ id: 'track-1', name: 'Track 1' }])
      expect(advancedSegments.value[0]).toMatchObject({ trackId: 'track-1', timelineStart: 0 })
      expect(canUndoAdvanced.value).toBe(false)
    }
  )

  it('does not create a track for a missing clip', () => {
    expect(moveSegmentToNewTrack('missing', 'top', 0)).toBeNull()
    expect(advancedTracks.value).toHaveLength(1)
  })

  it('adds multiple clips as separate segments at native size at the world origin', () => {
    const first = addClipToTrack(makeClip('a'), 'track-1', 0)
    addClipToTrack(makeClip('b'), 'track-1', 6)
    expect(advancedSegments.value).toHaveLength(2)
    expect(advancedSelectedId.value).toBe(advancedSegments.value[1].id)
    const segment = advancedSegments.value.find((entry) => entry.id === first)
    expect(segment?.transform).toEqual({ x: 0, y: 0, width: 1280, height: 720 })
    expect(segment?.timelineStart).toBe(0)
  })

  it('appends imported clips one after another on the target track', () => {
    advancedTracks.value = [
      { id: 'track-2', name: 'Track 2' },
      { id: 'track-1', name: 'Track 1' },
    ]
    addClipToTrack(makeClip('existing'), 'track-1', 10)
    appendClipToTrack(makeClip('a'))
    appendClipToTrack(makeClip('b'))
    appendClipToTrack(makeClip('c'), 'track-1')
    const starts = advancedSegments.value.map((segment) => [segment.trackId, segment.timelineStart])
    expect(starts).toEqual([
      ['track-1', 10],
      ['track-2', 0],
      ['track-2', 6],
      ['track-1', 16],
    ])
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

describe('advancedSegmentEditing trim and split', () => {
  beforeEach(() => {
    clips.value = []
    advancedSegments.value = []
    clearAdvancedSelection()
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
    clearAdvancedSelection()
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
  it('keeps the outer fades only, so playback stays at full level across the cut', () => {
    const id = addClipToTrack(makeClip('a'), 'track-1', 0)
    setSegmentProps(id, { fadeIn: 1, fadeOut: 1 })
    splitAdvancedSegment(id, 3)
    const [first, second] = [...advancedSegments.value].sort(
      (a, b) => a.timelineStart - b.timelineStart
    )
    expect(first).toMatchObject({ fadeIn: 1, fadeOut: undefined })
    expect(second).toMatchObject({ fadeIn: undefined, fadeOut: 1 })
    expect(segmentGainAt(first, 3 - 0.001)).toBe(1)
    expect(segmentGainAt(second, 0)).toBe(1)
    expect(segmentGainAt(first, 0)).toBe(0)
    expect(segmentGainAt(second, 3)).toBe(0)
  })
})
