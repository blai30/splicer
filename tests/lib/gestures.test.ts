// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'

import {
  beginAdvancedGesture,
  resetAdvancedHistory,
  undoAdvanced,
} from '@/lib/advanced/advancedHistory'
import { addClipToTrack, trimSegmentStart } from '@/lib/advanced/advancedSegmentEditing'
import { advancedSegments, advancedTracks, clips } from '@/lib/store'
import type { Clip } from '@/lib/types'

const clip: Clip = {
  id: 'c',
  file: new File([new Uint8Array([0])], 'c.mp4'),
  name: 'c',
  duration: 10,
  width: 640,
  height: 360,
  objectUrl: 'blob:c',
  waveformPeaks: [],
}

describe('drag gestures', () => {
  beforeEach(() => {
    clips.value = []
    advancedSegments.value = []
    advancedTracks.value = [{ id: 'track-1', name: 'Track 1' }]
    resetAdvancedHistory()
  })

  it('ends when the pointer is released anywhere, even if the dragged element is gone', () => {
    const id = addClipToTrack(clip, 'track-1', 0)
    resetAdvancedHistory()
    beginAdvancedGesture()
    trimSegmentStart(id, 2)
    // The handle unmounted mid-drag; only the window sees the release.
    window.dispatchEvent(new Event('pointerup'))
    undoAdvanced()
    expect(advancedSegments.value[0].sourceStart).toBe(0)
  })
})
