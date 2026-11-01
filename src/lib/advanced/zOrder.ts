import { recordAdvancedHistory } from '@/lib/advanced/advancedHistory'
import { advancedSegments, advancedTracks } from '@/lib/store'
import type { AdvancedSegment } from '@/lib/types'

// Stacking order: tracks are ordered top-to-bottom (index 0 is front-most), and
// within a track later array entries draw on top (see orderedForRender). These
// actions move a clip through both levels, so they also work when every clip
// sits on one track.

type Placement = { trackId: string; position: 'top' | 'bottom' }

// Move `id` onto `trackId`, as the top-most or bottom-most clip within it.
function place(id: string, placement: Placement): void {
  const segments = advancedSegments.value
  const segment = segments.find((entry) => entry.id === id)
  if (!segment) return
  const moved: AdvancedSegment = { ...segment, trackId: placement.trackId }
  const rest = segments.filter((entry) => entry.id !== id)
  const next = placement.position === 'top' ? [...rest, moved] : [moved, ...rest]
  if (next.every((entry, index) => sameEntry(entry, segments[index]))) return
  recordAdvancedHistory()
  advancedSegments.value = next
}

function sameEntry(first: AdvancedSegment, second: AdvancedSegment | undefined): boolean {
  return second !== undefined && first.id === second.id && first.trackId === second.trackId
}

function trackIndex(segment: AdvancedSegment): number {
  return advancedTracks.value.findIndex((track) => track.id === segment.trackId)
}

function laneMates(segment: AdvancedSegment): AdvancedSegment[] {
  return advancedSegments.value.filter((entry) => entry.trackId === segment.trackId)
}

// Swap two clips' positions in the array (both on the same track).
function swap(firstId: string, secondId: string): void {
  const segments = [...advancedSegments.value]
  const first = segments.findIndex((entry) => entry.id === firstId)
  const second = segments.findIndex((entry) => entry.id === secondId)
  if (first === -1 || second === -1) return
  recordAdvancedHistory()
  ;[segments[first], segments[second]] = [segments[second], segments[first]]
  advancedSegments.value = segments
}

function find(id: string): AdvancedSegment | undefined {
  return advancedSegments.value.find((entry) => entry.id === id)
}

// One step up: above the next clip on its track, else onto the track above
// (at the bottom of that track's stack).
export function bringForward(id: string): void {
  const segment = find(id)
  if (!segment) return
  const mates = laneMates(segment)
  const index = mates.findIndex((entry) => entry.id === id)
  if (index < mates.length - 1) {
    swap(id, mates[index + 1].id)
    return
  }
  const above = advancedTracks.value[trackIndex(segment) - 1]
  if (above) place(id, { trackId: above.id, position: 'bottom' })
}

// One step down: below the previous clip on its track, else onto the track
// below (at the top of that track's stack).
export function sendBackward(id: string): void {
  const segment = find(id)
  if (!segment) return
  const mates = laneMates(segment)
  const index = mates.findIndex((entry) => entry.id === id)
  if (index > 0) {
    swap(id, mates[index - 1].id)
    return
  }
  const below = advancedTracks.value[trackIndex(segment) + 1]
  if (below) place(id, { trackId: below.id, position: 'top' })
}

export function bringToFront(id: string): void {
  const top = advancedTracks.value[0]
  if (top) place(id, { trackId: top.id, position: 'top' })
}

export function sendToBack(id: string): void {
  const bottom = advancedTracks.value[advancedTracks.value.length - 1]
  if (bottom) place(id, { trackId: bottom.id, position: 'bottom' })
}
