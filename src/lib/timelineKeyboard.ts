import { segmentEndTime } from '@/lib/advanced/advancedTimelineDomain'
import type { AdvancedSegment, Track } from '@/lib/types'

// Keyboard access to the timelines: which clip holds the single tab stop
// (roving tabindex), where arrow keys move it, and what keys do on a playhead.

// The id that is in the tab order: the first selected one in list order, so
// Tab lands on the selection, or else the first.
export function rovingTabStop(
  ids: readonly string[],
  isSelected: (id: string) => boolean
): string | null {
  return ids.find(isSelected) ?? ids[0] ?? null
}

// The neighbour in a list, stopping at either end.
export function adjacentId(ids: readonly string[], currentId: string, step: -1 | 1): string | null {
  const index = ids.indexOf(currentId)
  if (index === -1) return null
  return ids[index + step] ?? null
}

export type ArrowDirection = 'left' | 'right' | 'up' | 'down'

// The clip an arrow key moves to on the multi-track timeline: the previous or
// next clip on the same track, or on the track above or below the clip that
// is playing at the same time (else the nearest one in time).
export function advancedNeighbourId(
  segments: readonly AdvancedSegment[],
  tracks: readonly Track[],
  currentId: string,
  direction: ArrowDirection
): string | null {
  const current = segments.find((segment) => segment.id === currentId)
  if (!current) return null
  const onTrack = (trackId: string) =>
    segments
      .filter((segment) => segment.trackId === trackId)
      .sort((first, second) => first.timelineStart - second.timelineStart)

  if (direction === 'left' || direction === 'right') {
    const ids = onTrack(current.trackId).map((segment) => segment.id)
    return adjacentId(ids, current.id, direction === 'left' ? -1 : 1)
  }

  const step = direction === 'up' ? -1 : 1
  const trackIndex = tracks.findIndex((track) => track.id === current.trackId)
  // Skip empty tracks, so Up/Down always lands on a clip if one exists.
  for (let index = trackIndex + step; index >= 0 && index < tracks.length; index += step) {
    const candidates = onTrack(tracks[index].id)
    if (candidates.length === 0) continue
    const anchor = current.timelineStart
    const playing = candidates.find(
      (segment) => segment.timelineStart <= anchor && anchor < segmentEndTime(segment)
    )
    if (playing) return playing.id
    let nearest = candidates[0]
    for (const candidate of candidates) {
      if (Math.abs(candidate.timelineStart - anchor) < Math.abs(nearest.timelineStart - anchor)) {
        nearest = candidate
      }
    }
    return nearest.id
  }
  return null
}

export type SeekKeyAction =
  | { kind: 'frames'; amount: -1 | 1 }
  | { kind: 'seconds'; amount: number }
  | { kind: 'start' }
  | { kind: 'end' }

// Keys on a playhead or seek bar slider, following the ARIA slider pattern:
// arrows step one frame (Shift for one second), Page Up/Down ten seconds,
// Home and End jump to the ends. Null for keys the slider leaves alone.
export function seekKeyAction(event: {
  key: string
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}): SeekKeyAction | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null
  const forward = event.key === 'ArrowRight' || event.key === 'ArrowUp'
  const backward = event.key === 'ArrowLeft' || event.key === 'ArrowDown'
  if (forward || backward) {
    const sign = forward ? 1 : -1
    return event.shiftKey ? { kind: 'seconds', amount: sign } : { kind: 'frames', amount: sign }
  }
  if (event.shiftKey) return null
  if (event.key === 'PageUp') return { kind: 'seconds', amount: 10 }
  if (event.key === 'PageDown') return { kind: 'seconds', amount: -10 }
  if (event.key === 'Home') return { kind: 'start' }
  if (event.key === 'End') return { kind: 'end' }
  return null
}

// What a screen reader announces for a clip block.
export function clipBlockLabel(name: string, durationText: string, muted?: boolean): string {
  return `${name}, ${durationText}${muted ? ', muted' : ''}`
}
