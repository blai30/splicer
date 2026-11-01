// @vitest-environment happy-dom
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { advancedPlayhead, advancedSegments, playheadTime, timeline } from '@/lib/store'
import type { AdvancedSegment, Segment } from '@/lib/types'

// Count how often each timeline re-renders its blocks: a block renders exactly
// when its parent does, since these stand-ins read no signals of their own.
const blockRenders = vi.hoisted(() => ({ basic: 0, advanced: 0 }))

vi.mock('@/components/SegmentBlock', () => ({
  SegmentBlock: () => {
    blockRenders.basic += 1
    return null
  },
}))
vi.mock('@/components/advanced/AdvancedSegmentBlock', () => ({
  AdvancedSegmentBlock: () => {
    blockRenders.advanced += 1
    return null
  },
}))

const { Timeline } = await import('@/components/Timeline')
const { AdvancedTimeline } = await import('@/components/advanced/AdvancedTimeline')

const basicSegment: Segment = { id: 'segment-1', clipId: 'clip-1', startTime: 0, endTime: 10 }
const advancedSegment = {
  id: 'placed-1',
  clipId: 'clip-1',
  trackId: 'track-1',
  timelineStart: 0,
  sourceStart: 0,
  sourceEnd: 10,
  transform: { x: 0, y: 0, width: 320, height: 180 },
} as AdvancedSegment

let host: HTMLElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  blockRenders.basic = 0
  blockRenders.advanced = 0
})

afterEach(() => {
  act(() => render(null, host))
  host.remove()
  timeline.value = []
  advancedSegments.value = []
  playheadTime.value = 0
  advancedPlayhead.value = 0
})

function playheadLeft(selector: string): string {
  return (host.querySelector(selector) as HTMLElement).style.left
}

describe('playhead render isolation', () => {
  it('moves the Basic playhead without re-rendering the timeline', () => {
    timeline.value = [basicSegment]
    act(() => render(h(Timeline, {}), host))
    const rendersAfterMount = blockRenders.basic
    const leftBefore = playheadLeft('[data-playhead]')

    for (let frame = 1; frame <= 5; frame++) {
      act(() => {
        playheadTime.value = frame
      })
    }

    expect(blockRenders.basic).toBe(rendersAfterMount)
    expect(playheadLeft('[data-playhead]')).not.toBe(leftBefore)
  })

  it('moves the Advanced playhead without re-rendering the lanes', () => {
    advancedSegments.value = [advancedSegment]
    act(() => render(h(AdvancedTimeline, {}), host))
    const rendersAfterMount = blockRenders.advanced
    const leftBefore = playheadLeft('[data-advanced-playhead]')

    for (let frame = 1; frame <= 5; frame++) {
      act(() => {
        advancedPlayhead.value = frame
      })
    }

    expect(blockRenders.advanced).toBe(rendersAfterMount)
    expect(playheadLeft('[data-advanced-playhead]')).not.toBe(leftBefore)
  })
})
