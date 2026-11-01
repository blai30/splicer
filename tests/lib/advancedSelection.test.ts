import { beforeEach, describe, expect, it } from 'vitest'

import { resetAdvancedHistory, undoAdvanced, redoAdvanced } from '@/lib/advanced/advancedHistory'
import {
  addClipToTrack,
  removeSegments,
  toggleSegmentsMuted,
} from '@/lib/advanced/advancedSegmentEditing'
import {
  activeAdvancedTrackId,
  clearAdvancedSelection,
  EMPTY_SELECTION,
  liveSelection,
  nextSelection,
  segmentsInRegion,
  selectAdvancedSegment,
  selectAllAdvanced,
  setActiveAdvancedTrack,
  setAdvancedSelection,
} from '@/lib/advanced/advancedSelection'
import { addTrack, removeTrack } from '@/lib/advanced/advancedTrackEditing'
import {
  advancedSegments,
  advancedSelectedId,
  advancedSelectedIds,
  advancedSelection,
  advancedTracks,
  clips,
} from '@/lib/store'
import type { AdvancedSegment, Clip, Track } from '@/lib/types'

const TRACKS: Track[] = [
  { id: 't1', name: 'Track 1' },
  { id: 't2', name: 'Track 2' },
  { id: 't3', name: 'Track 3' },
]

function segment(id: string, trackId: string, start: number, duration = 2): AdvancedSegment {
  return {
    id,
    clipId: 'clip',
    trackId,
    timelineStart: start,
    sourceStart: 0,
    sourceEnd: duration,
    transform: { x: 0, y: 0, width: 100, height: 100 },
  }
}

function makeClip(id: string): Clip {
  return {
    id,
    file: new File([new Uint8Array([0])], `${id}.mp4`),
    name: id,
    duration: 4,
    width: 640,
    height: 360,
    objectUrl: `blob:${id}`,
    waveformPeaks: new Float32Array(0),
  }
}

// a b on t1 at 0 and 3; c on t2 at 1; d on t3 at 6.
const SEGMENTS = [
  segment('a', 't1', 0),
  segment('b', 't1', 3),
  segment('c', 't2', 1),
  segment('d', 't3', 6),
]

describe('nextSelection', () => {
  const current = { ids: ['a'], primary: 'a' }

  it('replaces on a plain click and clears on empty space', () => {
    expect(nextSelection(current, 'b', 'replace', SEGMENTS, TRACKS)).toEqual({
      ids: ['b'],
      primary: 'b',
    })
    expect(nextSelection(current, null, 'replace', SEGMENTS, TRACKS)).toEqual(EMPTY_SELECTION)
    expect(nextSelection(current, null, 'toggle', SEGMENTS, TRACKS)).toBe(current)
  })

  it('toggles a clip in and out, moving the primary to what is left', () => {
    const both = nextSelection(current, 'c', 'toggle', SEGMENTS, TRACKS)
    expect(both).toEqual({ ids: ['a', 'c'], primary: 'c' })
    expect(nextSelection(both, 'c', 'toggle', SEGMENTS, TRACKS)).toEqual({
      ids: ['a'],
      primary: 'a',
    })
    expect(nextSelection(both, 'a', 'toggle', SEGMENTS, TRACKS)).toEqual({
      ids: ['c'],
      primary: 'c',
    })
  })

  it('adds without duplicating and makes the added clip primary', () => {
    expect(nextSelection({ ids: ['a', 'b'], primary: 'a' }, 'b', 'add', SEGMENTS, TRACKS)).toEqual({
      ids: ['a', 'b'],
      primary: 'b',
    })
  })

  it('selects a range across the lanes and time between the primary and the click', () => {
    // a (t1, 0-2) to d (t3, 6-8) spans every clip.
    expect(nextSelection(current, 'd', 'range', SEGMENTS, TRACKS)).toEqual({
      ids: ['a', 'b', 'c', 'd'],
      primary: 'a',
    })
    // a to c stays on t1-t2 and 0-3: b starts exactly at 3, so it is left out.
    expect(nextSelection(current, 'c', 'range', SEGMENTS, TRACKS).ids).toEqual(['a', 'c'])
    // With nothing selected a range click is a plain click.
    expect(nextSelection(EMPTY_SELECTION, 'b', 'range', SEGMENTS, TRACKS)).toEqual({
      ids: ['b'],
      primary: 'b',
    })
  })
})

describe('segmentsInRegion', () => {
  it('returns clips overlapping the time span on the enclosed lanes', () => {
    const region = { startTime: 1.5, endTime: 3.5, firstLane: 0, lastLane: 1 }
    expect(segmentsInRegion(SEGMENTS, TRACKS, region)).toEqual(['a', 'b', 'c'])
    // Reversed corners describe the same region.
    expect(
      segmentsInRegion(SEGMENTS, TRACKS, {
        startTime: 3.5,
        endTime: 1.5,
        firstLane: 1,
        lastLane: 0,
      })
    ).toEqual(['a', 'b', 'c'])
    expect(
      segmentsInRegion(SEGMENTS, TRACKS, { startTime: 2, endTime: 3, firstLane: 0, lastLane: 0 })
    ).toEqual([])
  })
})

describe('liveSelection', () => {
  it('drops removed ids and picks a remaining primary', () => {
    const selection = { ids: ['a', 'x', 'c'], primary: 'x' }
    expect(liveSelection(selection, SEGMENTS)).toEqual({ ids: ['a', 'c'], primary: 'c' })
    const untouched = { ids: ['a'], primary: 'a' }
    expect(liveSelection(untouched, SEGMENTS)).toBe(untouched)
  })
})

describe('selection in the store', () => {
  beforeEach(() => {
    clips.value = []
    advancedSegments.value = []
    advancedTracks.value = [{ id: 'track-1', name: 'Track 1' }]
    clearAdvancedSelection()
    setActiveAdvancedTrack(null)
    resetAdvancedHistory()
  })

  it('keeps the primary inside the selection', () => {
    setAdvancedSelection(['a', 'b'], 'z')
    expect(advancedSelectedId.value).toBe('b')
    setAdvancedSelection(['a', 'b'], 'a')
    expect(advancedSelectedId.value).toBe('a')
    setAdvancedSelection([])
    expect(advancedSelectedId.value).toBeNull()
  })

  it('selects all and clears', () => {
    const first = addClipToTrack(makeClip('a'), 'track-1', 0)
    const second = addClipToTrack(makeClip('b'), 'track-1', 4)
    selectAdvancedSegment(first)
    selectAllAdvanced()
    expect(advancedSelectedIds.value).toEqual([first, second])
    expect(advancedSelectedId.value).toBe(first)
    clearAdvancedSelection()
    expect(advancedSelection.value).toEqual(EMPTY_SELECTION)
  })

  it('restores the whole selection with undo and redo', () => {
    const first = addClipToTrack(makeClip('a'), 'track-1', 0)
    const second = addClipToTrack(makeClip('b'), 'track-1', 4)
    setAdvancedSelection([first, second], first)
    toggleSegmentsMuted([first, second])
    clearAdvancedSelection()
    undoAdvanced()
    expect(advancedSelection.value).toEqual({ ids: [first, second], primary: first })
    expect(advancedSegments.value.every((entry) => !entry.muted)).toBe(true)
    redoAdvanced()
    expect(advancedSegments.value.every((entry) => entry.muted)).toBe(true)
  })

  it('prunes deleted clips from the selection', () => {
    const first = addClipToTrack(makeClip('a'), 'track-1', 0)
    const second = addClipToTrack(makeClip('b'), 'track-1', 4)
    setAdvancedSelection([first, second], second)
    removeSegments([second])
    expect(advancedSelection.value).toEqual({ ids: [first], primary: first })
  })

  it('targets the active track, falling back to the top one', () => {
    expect(activeAdvancedTrackId()).toBe('track-1')
    const added = addTrack()
    // A new track becomes the target for the next import or paste.
    expect(activeAdvancedTrackId()).toBe(added)
    setActiveAdvancedTrack('track-1')
    expect(activeAdvancedTrackId()).toBe('track-1')
    removeTrack('track-1')
    expect(activeAdvancedTrackId()).toBe(added)
  })
})
