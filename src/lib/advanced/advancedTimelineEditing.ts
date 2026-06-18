import {
  removeAdvancedSegment,
  selectAdvancedSegment,
  splitAdvancedSegment,
  toggleSegmentMute,
  trimSegmentEnd,
  trimSegmentStart,
} from '@/lib/advanced/advancedSegmentEditing'
import { segmentDuration } from '@/lib/advanced/advancedTimelineDomain'
import { advancedPlayhead, advancedSegments, advancedSelectedId } from '@/lib/store'
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
  // trimSegmentStart shifts timelineStart by the same delta, so the left edge
  // lands exactly on the playhead.
  trimSegmentStart(segment.id, segment.sourceStart + offset)
}

export function setAdvancedOutPoint(): void {
  const segment = getSelectedSegment()
  if (!segment) return
  const offset = playheadOffsetWithin(segment)
  if (offset === null) return
  trimSegmentEnd(segment.id, segment.sourceStart + offset)
}

export function toggleAdvancedMute(): void {
  const id = advancedSelectedId.value
  if (id) toggleSegmentMute(id)
}

export function deleteAdvancedSelected(): void {
  const id = advancedSelectedId.value
  if (id) removeAdvancedSegment(id)
}
