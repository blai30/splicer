import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearOutputLock,
  enableAutoCanvas,
  recomputeAutoCanvas,
  setCanvasSize,
  setOutputLock,
} from '@/lib/advanced/advancedEditing'
import { resetAdvancedHistory } from '@/lib/advanced/advancedHistory'
import { addClipToTrack, setSegmentTransform } from '@/lib/advanced/advancedSegmentEditing'
import {
  advancedCanvas,
  advancedCanvasAuto,
  advancedOutputLock,
  advancedSegments,
  advancedSelectedId,
  clips,
  DEFAULT_CANVAS,
} from '@/lib/store'
import type { AdvancedSegment, Transform } from '@/lib/types'

function makeSegment(id: string, transform: Transform): AdvancedSegment {
  return {
    id,
    clipId: id,
    trackId: 'track-1',
    timelineStart: 0,
    sourceStart: 0,
    sourceEnd: 5,
    transform,
  }
}

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

describe('advancedEditing auto canvas', () => {
  beforeEach(() => {
    clips.value = []
    advancedSegments.value = []
    advancedSelectedId.value = null
    advancedCanvas.value = DEFAULT_CANVAS
    advancedCanvasAuto.value = false
    resetAdvancedHistory()
  })

  it('sizes the canvas to the tight bounding box of placed content and shifts it flush', () => {
    advancedSegments.value = [
      makeSegment('a', { x: 100, y: 50, width: 800, height: 400 }),
      makeSegment('b', { x: 300, y: 200, width: 600, height: 500 }),
    ]
    advancedCanvasAuto.value = true
    recomputeAutoCanvas()
    // bbox: minX=100 minY=50 maxX=900 maxY=700 -> 800x650, content shifted flush.
    expect(advancedCanvas.value).toEqual({ width: 800, height: 650 })
    expect(advancedSegments.value[0].transform).toEqual({ x: 0, y: 0, width: 800, height: 400 })
    expect(advancedSegments.value[1].transform).toEqual({ x: 200, y: 150, width: 600, height: 500 })
  })

  it('clamps auto dimensions to even integers', () => {
    advancedSegments.value = [makeSegment('a', { x: 0, y: 0, width: 801, height: 451 })]
    advancedCanvasAuto.value = true
    recomputeAutoCanvas()
    expect(advancedCanvas.value).toEqual({ width: 800, height: 450 })
  })

  it('falls back to the default canvas when no clips are placed', () => {
    advancedCanvas.value = { width: 640, height: 480 }
    advancedCanvasAuto.value = true
    recomputeAutoCanvas()
    expect(advancedCanvas.value).toEqual(DEFAULT_CANVAS)
  })

  it('does nothing when auto is off', () => {
    advancedSegments.value = [makeSegment('a', { x: 100, y: 50, width: 800, height: 400 })]
    advancedCanvas.value = { width: 1920, height: 1080 }
    recomputeAutoCanvas()
    expect(advancedCanvas.value).toEqual({ width: 1920, height: 1080 })
    expect(advancedSegments.value[0].transform).toEqual({ x: 100, y: 50, width: 800, height: 400 })
  })

  it('enableAutoCanvas turns the flag on and recomputes', () => {
    advancedSegments.value = [makeSegment('a', { x: 100, y: 50, width: 800, height: 400 })]
    enableAutoCanvas()
    expect(advancedCanvasAuto.value).toBe(true)
    expect(advancedCanvas.value).toEqual({ width: 800, height: 400 })
    expect(advancedSegments.value[0].transform).toEqual({ x: 0, y: 0, width: 800, height: 400 })
  })

  it('setCanvasSize turns auto off', () => {
    advancedCanvasAuto.value = true
    setCanvasSize(1280, 720)
    expect(advancedCanvasAuto.value).toBe(false)
    expect(advancedCanvas.value).toEqual({ width: 1280, height: 720 })
  })
})

describe('advancedEditing output lock', () => {
  beforeEach(() => {
    advancedOutputLock.value = null
  })

  it('setOutputLock clamps to even integers within bounds', () => {
    setOutputLock(1281, 9999)
    expect(advancedOutputLock.value).toEqual({ width: 1280, height: 7680 })
  })

  it('clearOutputLock resets to Auto (null)', () => {
    setOutputLock(1280, 720)
    clearOutputLock()
    expect(advancedOutputLock.value).toBeNull()
  })
})
