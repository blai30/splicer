import { beforeEach, describe, expect, it } from 'vitest'

import {
  addTrack,
  moveTrack,
  removeTrack,
  renameTrack,
  setTrackHidden,
  setTrackMuted,
} from '@/lib/advanced/advancedTrackEditing'
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

describe('advancedTrackEditing', () => {
  beforeEach(() => {
    advancedTracks.value = [{ id: 'track-1', name: 'Track 1' }]
    advancedSegments.value = []
  })

  it('adds a track at the top', () => {
    const id = addTrack()
    expect(advancedTracks.value[0].id).toBe(id)
    expect(advancedTracks.value).toHaveLength(2)
  })

  it('renames, mutes, and hides a track', () => {
    renameTrack('track-1', 'Voiceover')
    setTrackMuted('track-1', true)
    setTrackHidden('track-1', true)
    expect(advancedTracks.value[0]).toMatchObject({ name: 'Voiceover', muted: true, hidden: true })
  })

  it('removes a track and its segments', () => {
    const id = addTrack()
    advancedSegments.value = [seg('a', id), seg('b', 'track-1')]
    removeTrack(id)
    expect(advancedTracks.value.some((track) => track.id === id)).toBe(false)
    expect(advancedSegments.value.map((segment) => segment.id)).toEqual(['b'])
  })

  it('moves a track up and down within bounds', () => {
    const top = advancedTracks.value[0].id
    const added = addTrack() // added is now index 0, top is index 1
    moveTrack(top, -1) // top moves up to index 0
    expect(advancedTracks.value[0].id).toBe(top)
    moveTrack(added, 1) // no-op variants stay in bounds
    expect(advancedTracks.value).toHaveLength(2)
  })
})
