import { beforeEach, describe, expect, it } from 'vitest'

import { setCanvasSize } from '@/lib/advanced/advancedEditing'
import { addClipToTrack, setSegmentTransform } from '@/lib/advanced/advancedSegmentEditing'
import {
  advancedCanvas,
  advancedSegments,
  advancedSelectedId,
  clips,
  DEFAULT_CANVAS,
} from '@/lib/store'

describe('advancedEditing canvas', () => {
  beforeEach(() => {
    clips.value = []
    advancedSegments.value = []
    advancedSelectedId.value = null
    advancedCanvas.value = DEFAULT_CANVAS
  })

  it('clamps canvas dimensions to even integers within bounds', () => {
    setCanvasSize(1281, 9999)
    expect(advancedCanvas.value).toEqual({ width: 1280, height: 7680 })
  })

  it('leaves placed segment transforms unchanged when the canvas changes', () => {
    const id = addClipToTrack(
      {
        id: 'a',
        file: new File([new Uint8Array([0])], 'a.mp4'),
        name: 'a',
        duration: 5,
        width: 1920,
        height: 1080,
        objectUrl: 'blob:a',
        waveformPeaks: [],
      },
      'track-1',
      0
    )
    // Resizing the canvas must not move or resize the placed clips; the user
    // repositions them manually if desired.
    setSegmentTransform(id, { x: 100, y: 200, width: 800, height: 400 })
    setCanvasSize(3840, 1080)
    expect(advancedCanvas.value).toEqual({ width: 3840, height: 1080 })
    expect(advancedSegments.value[0].transform).toEqual({ x: 100, y: 200, width: 800, height: 400 })
  })
})
