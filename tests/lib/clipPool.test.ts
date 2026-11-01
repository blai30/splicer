import { beforeEach, describe, expect, it } from 'vitest'

import { resetAdvancedHistory, undoAdvanced } from '@/lib/advanced/advancedHistory'
import { addClipToTrack, removeAdvancedSegment } from '@/lib/advanced/advancedSegmentEditing'
import { clearAdvancedSelection } from '@/lib/advanced/advancedSelection'
import { collectUnusedClips } from '@/lib/clipPool'
import { advancedSegments, advancedTracks, clips, selectedSegmentId, timeline } from '@/lib/store'
import {
  appendClipToTimeline,
  deleteSegment,
  redo,
  resetHistory,
  undo,
} from '@/lib/timelineEditing'
import type { Clip } from '@/lib/types'

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

describe('shared clip pool', () => {
  beforeEach(() => {
    clips.value = []
    timeline.value = []
    selectedSegmentId.value = null
    advancedSegments.value = []
    advancedTracks.value = [{ id: 'track-1', name: 'Track 1' }]
    clearAdvancedSelection()
    resetHistory()
    resetAdvancedHistory()
  })

  it('keeps a clip used by Advanced when Basic deletes its own segment of it', () => {
    const clip = makeClip('shared')
    appendClipToTimeline(clip)
    addClipToTrack(clip, 'track-1', 0)
    resetHistory()
    resetAdvancedHistory()

    deleteSegment()
    expect(timeline.value).toHaveLength(0)
    expect(clips.value.map((entry) => entry.id)).toEqual(['shared'])
  })

  it('keeps Basic clips when Advanced undoes past their import', () => {
    addClipToTrack(makeClip('adv'), 'track-1', 0)
    appendClipToTimeline(makeClip('basic'))
    undoAdvanced()
    collectUnusedClips()
    expect(clips.value.map((entry) => entry.id)).toContain('basic')
  })

  it('releases a clip only once no history entry can bring it back', () => {
    appendClipToTimeline(makeClip('a'))
    deleteSegment()
    // Undo can restore the segment, so the clip must survive.
    expect(clips.value).toHaveLength(1)
    undo()
    expect(timeline.value).toHaveLength(1)
    redo()
    expect(timeline.value).toHaveLength(0)
    resetHistory()
    collectUnusedClips()
    expect(clips.value).toHaveLength(0)
  })

  it('does not record history for a no-op removal', () => {
    removeAdvancedSegment('missing')
    undoAdvanced()
    expect(advancedSegments.value).toHaveLength(0)
  })
})
