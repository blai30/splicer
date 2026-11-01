import { beforeEach, describe, expect, it } from 'vitest'

import { bringForward, bringToFront, sendBackward, sendToBack } from '@/lib/advanced/zOrder'
import { advancedSegments, advancedTracks } from '@/lib/store'
import type { AdvancedSegment } from '@/lib/types'

function seg(id: string, trackId: string): AdvancedSegment {
  return {
    id,
    clipId: `clip-${id}`,
    trackId,
    timelineStart: 0,
    sourceStart: 0,
    sourceEnd: 2,
    transform: { x: 0, y: 0, width: 10, height: 10 },
  }
}

describe('zOrder', () => {
  beforeEach(() => {
    // tracks ordered top-to-bottom: top, mid, bot.
    advancedTracks.value = [
      { id: 'top', name: 'Top' },
      { id: 'mid', name: 'Mid' },
      { id: 'bot', name: 'Bot' },
    ]
    advancedSegments.value = [seg('a', 'mid')]
  })

  it('brings a segment forward toward the top track', () => {
    bringForward('a')
    expect(advancedSegments.value[0].trackId).toBe('top')
  })

  it('sends a segment backward toward the bottom track', () => {
    sendBackward('a')
    expect(advancedSegments.value[0].trackId).toBe('bot')
  })

  it('brings to front (top track) and clamps at the top', () => {
    bringToFront('a')
    expect(advancedSegments.value[0].trackId).toBe('top')
    bringForward('a')
    expect(advancedSegments.value[0].trackId).toBe('top')
  })

  it('sends to back (bottom track)', () => {
    sendToBack('a')
    expect(advancedSegments.value[0].trackId).toBe('bot')
  })
})

describe('zOrder within one track', () => {
  beforeEach(() => {
    advancedTracks.value = [{ id: 'only', name: 'Only' }]
    advancedSegments.value = [seg('a', 'only'), seg('b', 'only'), seg('c', 'only')]
  })

  const order = () => advancedSegments.value.map((segment) => segment.id).join('')

  it('brings a covered clip to the front of its track', () => {
    bringToFront('a')
    expect(order()).toBe('bca')
  })

  it('sends a clip to the back of its track', () => {
    sendToBack('c')
    expect(order()).toBe('cab')
  })

  it('steps forward and backward one clip at a time', () => {
    bringForward('a')
    expect(order()).toBe('bac')
    sendBackward('c')
    expect(order()).toBe('bca')
  })
})
