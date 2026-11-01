import { computed, signal } from '@preact/signals'

import { beginAdvancedGesture, endAdvancedGesture } from '@/lib/advanced/advancedHistory'
import {
  closeGapsOnTrack,
  duplicateAdvancedSegments,
  insertAdvancedSegments,
  nudgeSegments,
  removeSegments,
  rippleDeleteAdvancedSegments,
  splitAdvancedSegment,
  toggleSegmentsMuted,
  trimSegmentEnd,
  trimSegmentStart,
} from '@/lib/advanced/advancedSegmentEditing'
import {
  activeAdvancedTrackId,
  selectAdvancedSegment,
  selectedAdvancedSegments,
} from '@/lib/advanced/advancedSelection'
import { segmentDuration } from '@/lib/advanced/advancedTimelineDomain'
import { pasteSegments } from '@/lib/advanced/clipEditingDomain'
import { registerClipReferences } from '@/lib/clipPool'
import {
  advancedPlayhead,
  advancedSegments,
  advancedSelectedId,
  advancedSelectedIds,
  advancedTracks,
  framerate,
  getClipById,
} from '@/lib/store'
import { timelineFrameGrid } from '@/lib/timelineSnap'
import type { AdvancedSegment } from '@/lib/types'

function getSelectedSegment(): AdvancedSegment | null {
  const id = advancedSelectedId.value
  if (!id) return null
  return advancedSegments.value.find((segment) => segment.id === id) ?? null
}

// Offset of the playhead within the segment, or null when the playhead sits on
// or outside an edge (where a trim/cut would be a no-op).
function playheadOffsetWithin(segment: AdvancedSegment): number | null {
  const offset = advancedPlayhead.value - segment.timelineStart
  if (offset <= 0 || offset >= segmentDuration(segment)) return null
  return offset
}

// Cut, in, and out act on the primary clip only: they are aimed at the
// playhead, which crosses one clip in particular.
export function cutAdvancedAtPlayhead(): void {
  const segment = getSelectedSegment()
  if (!segment) return
  const newId = splitAdvancedSegment(segment.id, advancedPlayhead.value)
  if (newId) selectAdvancedSegment(newId)
}

export function setAdvancedInPoint(): void {
  const segment = getSelectedSegment()
  if (!segment) return
  const offset = playheadOffsetWithin(segment)
  if (offset === null) return
  // Arm a one-shot gesture so the single trim below records exactly one history
  // entry. trimSegmentStart shifts timelineStart by the same delta, so the left
  // edge lands exactly on the playhead.
  beginAdvancedGesture()
  trimSegmentStart(segment.id, segment.sourceStart + offset)
  endAdvancedGesture()
}

export function setAdvancedOutPoint(): void {
  const segment = getSelectedSegment()
  if (!segment) return
  const offset = playheadOffsetWithin(segment)
  if (offset === null) return
  beginAdvancedGesture()
  trimSegmentEnd(segment.id, segment.sourceStart + offset)
  endAdvancedGesture()
}

export function toggleAdvancedMute(): void {
  toggleSegmentsMuted(advancedSelectedIds.value)
}

export function deleteAdvancedSelected(): void {
  removeSegments(advancedSelectedIds.value)
}

export function rippleDeleteAdvancedSelected(): void {
  rippleDeleteAdvancedSegments(advancedSelectedIds.value)
}

export function duplicateAdvancedSelected(): void {
  duplicateAdvancedSegments(advancedSelectedIds.value)
}

// The track of the primary clip, or the active track with nothing selected.
export function closeGapsOnSelectedTrack(): void {
  const trackId = getSelectedSegment()?.trackId ?? activeAdvancedTrackId()
  if (trackId) closeGapsOnTrack(trackId)
}

// One frame on the timeline's shared frame grid, so nudged clips stay on it.
export function timelineFrameSeconds(): number {
  const rates = advancedSegments.value.map((segment) => getClipById(segment.clipId)?.frameRate ?? 0)
  return 1 / timelineFrameGrid(framerate.value, rates)
}

export function nudgeAdvancedSelected(frames: number): void {
  nudgeSegments(advancedSelectedIds.value, frames * timelineFrameSeconds())
}

// The in-app clipboard. It holds copies of the clips, not the system
// clipboard: the media lives in the clip pool, which must keep every clip
// a copied entry references, so the clipboard registers its clip ids.
type ClipboardEntry = { segment: AdvancedSegment; laneOffset: number }
const clipboard = signal<ClipboardEntry[]>([])
export const advancedClipboardSize = computed(() => clipboard.value.length)

registerClipReferences(function* () {
  for (const entry of clipboard.value) yield entry.segment.clipId
})

export function copyAdvancedSelected(): boolean {
  const selected = selectedAdvancedSegments()
  if (selected.length === 0) return false
  const tracks = advancedTracks.value
  const laneOf = (segment: AdvancedSegment) =>
    Math.max(
      0,
      tracks.findIndex((track) => track.id === segment.trackId)
    )
  const topLane = Math.min(...selected.map(laneOf))
  clipboard.value = selected.map((segment) => ({
    segment,
    laneOffset: laneOf(segment) - topLane,
  }))
  return true
}

export function cutAdvancedSelected(): void {
  if (copyAdvancedSelected()) deleteAdvancedSelected()
}

// Paste at the playhead with the topmost copied clip on the active track.
export function pasteAdvanced(): void {
  const tracks = advancedTracks.value
  const activeId = activeAdvancedTrackId()
  const targetLane = Math.max(
    0,
    tracks.findIndex((track) => track.id === activeId)
  )
  // Clips whose media is gone (released before this clipboard existed) are
  // skipped rather than pasted as blanks.
  const entries = clipboard.value.filter((entry) => getClipById(entry.segment.clipId))
  insertAdvancedSegments(
    pasteSegments(entries, tracks, advancedPlayhead.value, targetLane, () => crypto.randomUUID())
  )
}

// Clears the clipboard. Used by tests for isolation.
export function resetAdvancedClipboard(): void {
  clipboard.value = []
}
