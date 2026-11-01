import { segmentEndTime } from '@/lib/advanced/advancedTimelineDomain'
import type { AdvancedSegment, Framerate } from '@/lib/types'

// Snap distance on screen. Converted to seconds per zoom level so the pull
// feels the same at every zoom.
export const SNAP_THRESHOLD_PX = 8
export const DEFAULT_SNAP_FPS = 30

export type EdgeSnap = {
  // Shift to apply to every moving edge (0 when nothing is in range).
  delta: number
  // The time the winning edge landed on, or null when nothing snapped.
  target: number | null
}

export type TimeSnap = { time: number; target: number | null }

export function snapThresholdSeconds(pxPerSec: number, thresholdPx = SNAP_THRESHOLD_PX): number {
  return pxPerSec > 0 ? thresholdPx / pxPerSec : 0
}

// Every time a moving edge may cling to: the timeline origin, the playhead,
// and both edges of every clip on every track except the ones being dragged.
// Sorted and deduplicated so lookups can binary-search.
export function timeSnapTargets(
  segments: AdvancedSegment[],
  excludeIds: ReadonlySet<string>,
  playhead: number,
  extra: number[] = []
): number[] {
  const times = [0, playhead, ...extra]
  for (const segment of segments) {
    if (excludeIds.has(segment.id)) continue
    times.push(segment.timelineStart, segmentEndTime(segment))
  }
  const sorted = times
    .filter((time) => Number.isFinite(time) && time >= 0)
    .sort((first, second) => first - second)
  return sorted.filter((time, i) => i === 0 || time - sorted[i - 1] > 1e-9)
}

// The target nearest to `time` in a sorted list, or null for an empty list.
function nearestTarget(time: number, sortedTargets: number[]): number | null {
  if (sortedTargets.length === 0) return null
  let low = 0
  let high = sortedTargets.length - 1
  while (low < high) {
    const middle = (low + high) >> 1
    if (sortedTargets[middle] < time) low = middle + 1
    else high = middle
  }
  const after = sortedTargets[low]
  const before = sortedTargets[low - 1]
  if (before === undefined) return after
  return time - before <= after - time ? before : after
}

// Snap a set of edges that move together (a clip's start and end): the edge
// closest to any target within the threshold wins and sets the shared delta.
// On a tie the earlier edge in `edges` wins, so a clip prefers its start.
export function snapEdges(
  edges: number[],
  sortedTargets: number[],
  thresholdSec: number
): EdgeSnap {
  let best: EdgeSnap = { delta: 0, target: null }
  let bestDistance = Infinity
  for (const edge of edges) {
    const target = nearestTarget(edge, sortedTargets)
    if (target === null) continue
    const distance = Math.abs(target - edge)
    if (distance <= thresholdSec && distance < bestDistance) {
      bestDistance = distance
      best = { delta: target - edge, target }
    }
  }
  return best
}

export function snapTime(time: number, sortedTargets: number[], thresholdSec: number): TimeSnap {
  const { delta, target } = snapEdges([time], sortedTargets, thresholdSec)
  return { time: time + delta, target }
}

// The one frame grid every drag quantizes to: the export rate when it is fixed,
// otherwise what "original" export resolves to (the fastest source, rounded and
// clamped like the compositor does), so clips of different rates still land on
// shared frames.
export function timelineFrameGrid(framerate: Framerate, sourceFrameRates: number[]): number {
  if (framerate !== 'original') return Number(framerate)
  let fastest = 0
  for (const rate of sourceFrameRates) {
    if (Number.isFinite(rate)) fastest = Math.max(fastest, rate)
  }
  if (fastest <= 0) return DEFAULT_SNAP_FPS
  return Math.min(120, Math.max(1, Math.round(fastest)))
}

// Round to the project's frame grid so moves and trims never leave sub-frame
// gaps or overlaps at export.
export function quantizeToFrame(time: number, fps = DEFAULT_SNAP_FPS): number {
  const rate = Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_SNAP_FPS
  return Math.round(time * rate) / rate
}

// The committed time for one dragged edge: a snap target when one is in range
// (kept exact, so edges line up even off the frame grid), otherwise the raw
// time on the frame grid.
export function resolveEdgeTime(
  rawTime: number,
  sortedTargets: number[],
  options: { thresholdSec: number; snap: boolean; fps?: number }
): TimeSnap {
  if (options.snap) {
    const snapped = snapTime(rawTime, sortedTargets, options.thresholdSec)
    if (snapped.target !== null) return snapped
  }
  return { time: quantizeToFrame(rawTime, options.fps), target: null }
}

// The committed start for a dragged clip: both of its edges may snap, and the
// result never goes before the timeline origin.
export function resolveMoveStart(
  rawStart: number,
  duration: number,
  sortedTargets: number[],
  options: { thresholdSec: number; snap: boolean; fps?: number }
): { start: number; target: number | null } {
  const clampedStart = Math.max(0, rawStart)
  if (options.snap) {
    const snap = snapEdges(
      [clampedStart, clampedStart + duration],
      sortedTargets,
      options.thresholdSec
    )
    if (snap.target !== null && clampedStart + snap.delta >= 0) {
      return { start: clampedStart + snap.delta, target: snap.target }
    }
  }
  return { start: Math.max(0, quantizeToFrame(clampedStart, options.fps)), target: null }
}
