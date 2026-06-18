import { moveSegment } from '@/lib/advanced/advancedSegmentEditing'
import { advancedSegments, advancedTracks } from '@/lib/store'

// Tracks are ordered top-to-bottom; index 0 is the front-most lane. Forward
// moves toward index 0; backward toward the last index.
function moveToTrackIndex(id: string, nextIndex: number): void {
  const segment = advancedSegments.value.find((entry) => entry.id === id)
  if (!segment) return
  const tracks = advancedTracks.value
  const clamped = Math.min(tracks.length - 1, Math.max(0, nextIndex))
  const trackId = tracks[clamped]?.id
  if (trackId) moveSegment(id, trackId, segment.timelineStart)
}

function currentIndex(id: string): number {
  const segment = advancedSegments.value.find((entry) => entry.id === id)
  if (!segment) return -1
  return advancedTracks.value.findIndex((track) => track.id === segment.trackId)
}

export function bringForward(id: string): void {
  moveToTrackIndex(id, currentIndex(id) - 1)
}

export function sendBackward(id: string): void {
  moveToTrackIndex(id, currentIndex(id) + 1)
}

export function bringToFront(id: string): void {
  moveToTrackIndex(id, 0)
}

export function sendToBack(id: string): void {
  moveToTrackIndex(id, advancedTracks.value.length - 1)
}
