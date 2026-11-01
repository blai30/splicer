import { describe, expect, it } from 'vitest'

import {
  adjacentId,
  advancedNeighbourId,
  clipBlockLabel,
  rovingTabStop,
  seekKeyAction,
} from '@/lib/timelineKeyboard'
import type { AdvancedSegment, Track } from '@/lib/types'

const clip = (id: string, trackId: string, timelineStart: number, length = 2): AdvancedSegment => ({
  id,
  clipId: 'c',
  trackId,
  timelineStart,
  sourceStart: 0,
  sourceEnd: length,
  transform: { x: 0, y: 0, width: 10, height: 10 },
})

const tracks: Track[] = [
  { id: 't1', name: 'Track 1' },
  { id: 't2', name: 'Track 2' },
  { id: 't3', name: 'Track 3' },
]

describe('rovingTabStop', () => {
  it('puts the tab stop on the first selected id, else the first id', () => {
    expect(rovingTabStop(['a', 'b', 'c'], (id) => id === 'b' || id === 'c')).toBe('b')
    expect(rovingTabStop(['a', 'b'], () => false)).toBe('a')
    expect(rovingTabStop([], () => true)).toBeNull()
  })
})

describe('adjacentId', () => {
  it('steps within the list and stops at either end', () => {
    expect(adjacentId(['a', 'b', 'c'], 'b', 1)).toBe('c')
    expect(adjacentId(['a', 'b', 'c'], 'b', -1)).toBe('a')
    expect(adjacentId(['a', 'b'], 'b', 1)).toBeNull()
    expect(adjacentId(['a'], 'missing', 1)).toBeNull()
  })
})

describe('advancedNeighbourId', () => {
  // Track 1: a [0,2) and b [5,7); track 2 empty; track 3: c [4,8) and d [10,12).
  const segments = [
    clip('b', 't1', 5),
    clip('a', 't1', 0),
    clip('c', 't3', 4, 4),
    clip('d', 't3', 10),
  ]

  it('moves along a track in time order, not list order', () => {
    expect(advancedNeighbourId(segments, tracks, 'a', 'right')).toBe('b')
    expect(advancedNeighbourId(segments, tracks, 'b', 'left')).toBe('a')
    expect(advancedNeighbourId(segments, tracks, 'b', 'right')).toBeNull()
  })

  it('skips empty tracks and prefers the clip playing at the same time', () => {
    expect(advancedNeighbourId(segments, tracks, 'b', 'down')).toBe('c')
  })

  it('falls back to the nearest start when nothing plays at that time', () => {
    expect(advancedNeighbourId(segments, tracks, 'a', 'down')).toBe('c')
    expect(advancedNeighbourId(segments, tracks, 'd', 'up')).toBe('b')
  })

  it('stops at the outer tracks', () => {
    expect(advancedNeighbourId(segments, tracks, 'a', 'up')).toBeNull()
    expect(advancedNeighbourId(segments, tracks, 'c', 'down')).toBeNull()
  })
})

describe('seekKeyAction', () => {
  const press = (
    key: string,
    modifiers: Partial<Record<'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey', boolean>> = {}
  ) =>
    seekKeyAction({
      key,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      ...modifiers,
    })

  it('steps a frame on arrows and a second with Shift', () => {
    expect(press('ArrowRight')).toEqual({ kind: 'frames', amount: 1 })
    expect(press('ArrowUp')).toEqual({ kind: 'frames', amount: 1 })
    expect(press('ArrowLeft')).toEqual({ kind: 'frames', amount: -1 })
    expect(press('ArrowDown', { shiftKey: true })).toEqual({ kind: 'seconds', amount: -1 })
  })

  it('jumps ten seconds on Page keys and to the ends on Home and End', () => {
    expect(press('PageUp')).toEqual({ kind: 'seconds', amount: 10 })
    expect(press('PageDown')).toEqual({ kind: 'seconds', amount: -10 })
    expect(press('Home')).toEqual({ kind: 'start' })
    expect(press('End')).toEqual({ kind: 'end' })
  })

  it('leaves modified and unrelated keys to the global shortcuts', () => {
    expect(press('ArrowLeft', { altKey: true })).toBeNull()
    expect(press('ArrowLeft', { ctrlKey: true })).toBeNull()
    expect(press('Home', { shiftKey: true })).toBeNull()
    expect(press(' ')).toBeNull()
  })
})

describe('clipBlockLabel', () => {
  it('names the clip, its length, and a mute', () => {
    expect(clipBlockLabel('beach', '0:04')).toBe('beach, 0:04')
    expect(clipBlockLabel('beach', '0:04', true)).toBe('beach, 0:04, muted')
  })
})
