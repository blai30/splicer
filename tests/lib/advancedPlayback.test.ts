import { describe, expect, it } from 'vitest'

import {
  createFrameCoalescer,
  frameCacheStale,
  segmentPreviewVolume,
  shouldSeekToFrame,
} from '@/lib/advanced/advancedPlayback'

describe('shouldSeekToFrame', () => {
  it('seeks while playing only when drift exceeds the threshold', () => {
    expect(
      shouldSeekToFrame({ currentTime: 1.0, expected: 1.05, playing: true, lastTarget: 1.0 })
    ).toBe(false)
    expect(
      shouldSeekToFrame({ currentTime: 1.0, expected: 1.4, playing: true, lastTarget: 1.0 })
    ).toBe(true)
  })

  it('seeks while paused on the first sync (no prior target)', () => {
    expect(
      shouldSeekToFrame({ currentTime: 0, expected: 2.0, playing: false, lastTarget: undefined })
    ).toBe(true)
  })

  it('does not re-seek a paused video to the same requested frame (drag case)', () => {
    // currentTime has snapped to the nearest decodable frame and differs from the
    // request, but the requested target is unchanged, so no seek should happen.
    expect(
      shouldSeekToFrame({ currentTime: 1.983, expected: 2.0, playing: false, lastTarget: 2.0 })
    ).toBe(false)
  })

  it('seeks while paused when the requested frame changes (scrub case)', () => {
    expect(
      shouldSeekToFrame({ currentTime: 2.0, expected: 3.5, playing: false, lastTarget: 2.0 })
    ).toBe(true)
  })
})

describe('segmentPreviewVolume', () => {
  it('scales the master preview volume by the clip volume', () => {
    expect(segmentPreviewVolume(0.5, 0.5)).toBe(0.25)
    expect(segmentPreviewVolume(0.8, 0)).toBe(0)
  })

  it('uses the master volume when the clip has none set', () => {
    expect(segmentPreviewVolume(0.6)).toBe(0.6)
  })

  it('clamps to the media element range', () => {
    expect(segmentPreviewVolume(0.8, 2)).toBe(1)
    expect(segmentPreviewVolume(0.5, -1)).toBe(0)
    expect(segmentPreviewVolume(0.5, Number.NaN)).toBe(0)
  })
})

describe('frameCacheStale', () => {
  const video = { currentTime: 1.5, videoWidth: 1920, videoHeight: 1080 }
  const cache = { width: 1920, height: 1080 }

  it('keeps the cache while the video shows the same time at the same size', () => {
    expect(frameCacheStale(1.5, cache, video)).toBe(false)
  })

  it('refreshes after the video moved to another time', () => {
    expect(frameCacheStale(1.4, cache, video)).toBe(true)
  })

  it('refreshes when nothing is cached yet or the size changed', () => {
    expect(frameCacheStale(undefined, undefined, video)).toBe(true)
    expect(frameCacheStale(1.5, { width: 1280, height: 720 }, video)).toBe(true)
  })
})

describe('createFrameCoalescer', () => {
  function fakeFrames() {
    const callbacks = new Map<number, () => void>()
    let nextId = 1
    return {
      request: (callback: () => void) => {
        callbacks.set(nextId, callback)
        return nextId++
      },
      cancel: (id: number) => callbacks.delete(id),
      flush: () => {
        const pending = [...callbacks.values()]
        callbacks.clear()
        for (const callback of pending) callback()
      },
      get pending() {
        return callbacks.size
      },
    }
  }

  it('draws once per frame however many times it is asked', () => {
    const frames = fakeFrames()
    let draws = 0
    const coalescer = createFrameCoalescer(() => draws++, frames.request, frames.cancel)
    coalescer.schedule()
    coalescer.schedule()
    coalescer.schedule()
    expect(frames.pending).toBe(1)
    frames.flush()
    expect(draws).toBe(1)
    coalescer.schedule()
    frames.flush()
    expect(draws).toBe(2)
  })

  it('drops a scheduled draw when canceled', () => {
    const frames = fakeFrames()
    let draws = 0
    const coalescer = createFrameCoalescer(() => draws++, frames.request, frames.cancel)
    coalescer.schedule()
    coalescer.cancel()
    frames.flush()
    expect(draws).toBe(0)
    coalescer.schedule()
    expect(frames.pending).toBe(1)
  })
})
