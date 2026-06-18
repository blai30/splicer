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

  it('scales placed segment transforms proportionally when the canvas changes', () => {
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
    // Default canvas is 1920x1080; place an explicit transform, then halve the canvas.
    setSegmentTransform(id, { x: 100, y: 200, width: 800, height: 400 })
    setCanvasSize(960, 540)
    expect(advancedSegments.value[0].transform).toEqual({ x: 50, y: 100, width: 400, height: 200 })
  })
})
