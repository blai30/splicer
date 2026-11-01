// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createEdgeAutoScroller, edgeScrollVelocity } from '@/lib/timelineDomain'

describe('edgeScrollVelocity', () => {
  it('is zero away from the edges', () => {
    expect(edgeScrollVelocity(500, 0, 1000)).toBe(0)
    expect(edgeScrollVelocity(40, 0, 1000)).toBe(0)
    expect(edgeScrollVelocity(960, 0, 1000)).toBe(0)
  })

  it('scales with depth into the edge zone', () => {
    expect(edgeScrollVelocity(30, 0, 1000)).toBe(-5)
    expect(edgeScrollVelocity(20, 0, 1000)).toBe(-10)
    expect(edgeScrollVelocity(980, 0, 1000)).toBe(10)
  })

  it('caps at full speed beyond the edge', () => {
    expect(edgeScrollVelocity(-300, 0, 1000)).toBe(-20)
    expect(edgeScrollVelocity(1400, 0, 1000)).toBe(20)
  })

  it('respects the scroller offset on the page', () => {
    expect(edgeScrollVelocity(210, 200, 1200)).toBe(-15)
  })

  it('stays off for a scroller too narrow for two zones', () => {
    expect(edgeScrollVelocity(10, 0, 60)).toBe(0)
  })
})

describe('createEdgeAutoScroller', () => {
  let frames: FrameRequestCallback[] = []

  function runFrame() {
    const pending = frames
    frames = []
    for (const callback of pending) callback(0)
  }

  beforeEach(() => {
    frames = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => (frames = []))
  })
  afterEach(() => vi.unstubAllGlobals())

  function makeScroller() {
    const scroller = document.createElement('div')
    let scrollLeft = 100
    Object.defineProperty(scroller, 'scrollLeft', {
      get: () => scrollLeft,
      set: (value: number) => (scrollLeft = Math.max(0, Math.min(500, value))),
    })
    scroller.getBoundingClientRect = () => ({ left: 0, right: 1000 }) as DOMRect
    return scroller
  }

  it('scrolls every frame while the pointer stays in an edge zone and reports it', () => {
    const scroller = makeScroller()
    const onScroll = vi.fn()
    const autoScroll = createEdgeAutoScroller(scroller, onScroll)
    autoScroll.update(1000)
    runFrame()
    runFrame()
    expect(scroller.scrollLeft).toBe(140)
    expect(onScroll).toHaveBeenCalledTimes(2)
  })

  it('stops when the pointer leaves the zone or the gesture ends', () => {
    const scroller = makeScroller()
    const autoScroll = createEdgeAutoScroller(scroller, () => {})
    autoScroll.update(0)
    runFrame()
    expect(scroller.scrollLeft).toBe(80)
    autoScroll.update(500)
    runFrame()
    expect(frames).toHaveLength(0)
    autoScroll.update(0)
    autoScroll.stop()
    runFrame()
    expect(scroller.scrollLeft).toBe(80)
  })

  it('does not report frames where the scroller is already at its limit', () => {
    const scroller = makeScroller()
    scroller.scrollLeft = 0
    const onScroll = vi.fn()
    createEdgeAutoScroller(scroller, onScroll).update(0)
    runFrame()
    expect(onScroll).not.toHaveBeenCalled()
  })
})
