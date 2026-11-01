import { segmentEndTime } from '@/lib/advanced/advancedTimelineDomain'
import {
  advancedActiveTrackId,
  advancedSegments,
  advancedSelection,
  advancedTracks,
  type AdvancedSelection,
} from '@/lib/store'
import type { AdvancedSegment, Track } from '@/lib/types'

// replace: a plain click. toggle: Ctrl/Cmd-click adds or removes one clip.
// add: keep the selection and add (marquee with Shift). range: Shift-click
// selects every clip between the primary and the clicked one, across the lanes
// and time span the two enclose.
export type SelectionMode = 'replace' | 'toggle' | 'add' | 'range'

export const EMPTY_SELECTION: AdvancedSelection = { ids: [], primary: null }

// A region of the timeline in time and lane indices (inclusive), as drawn by
// a marquee or spanned by a range click.
export type TimelineRegion = {
  startTime: number
  endTime: number
  firstLane: number
  lastLane: number
}

function laneIndexOf(tracks: Track[], trackId: string): number {
  return tracks.findIndex((track) => track.id === trackId)
}

// Clips that overlap the region's time span (touching an edge is not enough)
// on any lane inside it.
export function segmentsInRegion(
  segments: AdvancedSegment[],
  tracks: Track[],
  region: TimelineRegion
): string[] {
  const startTime = Math.min(region.startTime, region.endTime)
  const endTime = Math.max(region.startTime, region.endTime)
  const firstLane = Math.min(region.firstLane, region.lastLane)
  const lastLane = Math.max(region.firstLane, region.lastLane)
  return segments
    .filter((segment) => {
      const lane = laneIndexOf(tracks, segment.trackId)
      if (lane < firstLane || lane > lastLane) return false
      return segment.timelineStart < endTime && segmentEndTime(segment) > startTime
    })
    .map((segment) => segment.id)
}

function union(first: string[], second: string[]): string[] {
  const seen = new Set(first)
  return [...first, ...second.filter((id) => !seen.has(id))]
}

// The selection after clicking `id` with `mode`. Pure, so the click rules are
// testable without the store.
export function nextSelection(
  current: AdvancedSelection,
  id: string | null,
  mode: SelectionMode,
  segments: AdvancedSegment[],
  tracks: Track[]
): AdvancedSelection {
  if (id === null) return mode === 'replace' ? EMPTY_SELECTION : current
  if (mode === 'replace') return { ids: [id], primary: id }
  if (mode === 'add') return { ids: union(current.ids, [id]), primary: id }
  if (mode === 'toggle') {
    if (!current.ids.includes(id)) return { ids: [...current.ids, id], primary: id }
    const ids = current.ids.filter((entry) => entry !== id)
    const primary = current.primary === id ? (ids.at(-1) ?? null) : current.primary
    return { ids, primary }
  }
  // Range from the primary; with nothing selected yet it is a plain click.
  const anchor = segments.find((segment) => segment.id === current.primary)
  const target = segments.find((segment) => segment.id === id)
  if (!anchor || !target) return { ids: [id], primary: id }
  const spanned = segmentsInRegion(segments, tracks, {
    startTime: Math.min(anchor.timelineStart, target.timelineStart),
    endTime: Math.max(segmentEndTime(anchor), segmentEndTime(target)),
    firstLane: laneIndexOf(tracks, anchor.trackId),
    lastLane: laneIndexOf(tracks, target.trackId),
  })
  // The anchor stays primary so successive Shift-clicks re-span from it.
  return { ids: union(current.ids, spanned), primary: anchor.id }
}

// Keep only ids that still exist (after an undo, delete, or track removal).
export function liveSelection(
  selection: AdvancedSelection,
  segments: AdvancedSegment[]
): AdvancedSelection {
  const live = new Set(segments.map((segment) => segment.id))
  const ids = selection.ids.filter((id) => live.has(id))
  if (ids.length === selection.ids.length && (!selection.primary || live.has(selection.primary))) {
    return selection
  }
  const primary =
    selection.primary && live.has(selection.primary) ? selection.primary : (ids.at(-1) ?? null)
  return { ids, primary }
}

export function setAdvancedSelection(ids: string[], primary: string | null = ids.at(-1) ?? null) {
  advancedSelection.value = {
    ids,
    primary: primary !== null && ids.includes(primary) ? primary : (ids.at(-1) ?? null),
  }
}

export function selectAdvancedSegment(id: string | null, mode: SelectionMode = 'replace'): void {
  advancedSelection.value = nextSelection(
    advancedSelection.value,
    id,
    mode,
    advancedSegments.value,
    advancedTracks.value
  )
}

export function selectAllAdvanced(): void {
  const ids = advancedSegments.value.map((segment) => segment.id)
  const primary = advancedSelection.value.primary
  setAdvancedSelection(ids, primary && ids.includes(primary) ? primary : (ids[0] ?? null))
}

export function clearAdvancedSelection(): void {
  advancedSelection.value = EMPTY_SELECTION
}

// Drop deleted ids from the selection after a mutation removed clips.
export function pruneAdvancedSelection(): void {
  advancedSelection.value = liveSelection(advancedSelection.value, advancedSegments.value)
}

// The selected clips in timeline order.
export function selectedAdvancedSegments(): AdvancedSegment[] {
  const ids = new Set(advancedSelection.value.ids)
  return advancedSegments.value.filter((segment) => ids.has(segment.id))
}

// The track paste, imports, and drops target: the chosen one while it exists,
// otherwise the top track.
export function activeAdvancedTrackId(): string | null {
  const tracks = advancedTracks.value
  const chosen = advancedActiveTrackId.value
  if (chosen && tracks.some((track) => track.id === chosen)) return chosen
  return tracks[0]?.id ?? null
}

export function setActiveAdvancedTrack(trackId: string | null): void {
  advancedActiveTrackId.value = trackId
}
