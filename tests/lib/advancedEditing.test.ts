import { beforeEach, describe, expect, it } from 'vitest'

import { addClipToTrack } from '@/lib/advanced/advancedSegmentEditing'
import { setCanvasSize } from '@/lib/advanced/advancedEditing'
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

  it('re-fits placed segments when the canvas changes', () => {
    addClipToTrack(
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
    setCanvasSize(1000, 1000)
    expect(advancedSegments.value[0].transform.width).toBeCloseTo(1000)
    expect(advancedSegments.value[0].transform.height).toBeCloseTo(562.5)
  })
})
