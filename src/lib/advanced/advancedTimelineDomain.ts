import type { AdvancedSegment, Track } from '@/lib/types'

export const ADV_MIN_SEGMENT_DURATION = 0.1
// Left padding of the lanes, in px: time 0 sits this far from the lane edge.
// Clip blocks, the playhead, and pointer-to-time math all use it.
export const TIMELINE_PAD_LEFT = 8

export function segmentDuration(segment: AdvancedSegment): number {
  return segment.sourceEnd - segment.sourceStart
}

export function segmentEndTime(segment: AdvancedSegment): number {
  return segment.timelineStart + segmentDuration(segment)
}

export function projectDuration(segments: AdvancedSegment[]): number {
  let max = 0
  for (const segment of segments) max = Math.max(max, segmentEndTime(segment))
  return max
}

// Where the content on one track ends (0 for an empty track).
export function trackEndTime(segments: AdvancedSegment[], trackId: string): number {
  return projectDuration(segments.filter((segment) => segment.trackId === trackId))
}

// Segments covering `time` on the output timeline (start inclusive, end exclusive).
export function segmentsActiveAt(segments: AdvancedSegment[], time: number): AdvancedSegment[] {
  return segments.filter(
    (segment) => time >= segment.timelineStart && time < segmentEndTime(segment)
  )
}

// Render order: lowest lane first (drawn underneath). Tracks are ordered
// top-to-bottom in the UI, so the bottom lane is the last track. Within a lane,
// array order breaks ties.
export function orderedForRender(segments: AdvancedSegment[], tracks: Track[]): AdvancedSegment[] {
  const laneRank = new Map<string, number>()
  tracks.forEach((track, index) => laneRank.set(track.id, tracks.length - index))
  return [...segments].sort((first, second) => {
    const firstRank = laneRank.get(first.trackId) ?? 0
    const secondRank = laneRank.get(second.trackId) ?? 0
    return firstRank - secondRank
  })
}

export type LaneDropTarget =
  | { kind: 'lane'; index: number }
  | { kind: 'new'; position: 'top' | 'bottom' }

// Which lane a dragged clip lands in, from the pointer's offset below the top
// of the first lane. Above the first lane or below the last one means a new
// track there.
export function laneDropTarget(
  offsetY: number,
  laneHeight: number,
  laneCount: number
): LaneDropTarget {
  if (offsetY < 0) return { kind: 'new', position: 'top' }
  const index = Math.floor(offsetY / laneHeight)
  if (index >= laneCount) return { kind: 'new', position: 'bottom' }
  return { kind: 'lane', index }
}

// The scroller's visible window in content pixels, so the readout chip can
// stay on screen however far the clip has travelled.
export type VisibleWindow = { left: number; width: number }

const READOUT_INSET_PX = 4

// Keeps the readout chip inside the visible scroller: it hangs from the clip's
// start, or from its end once the clip sits in the right half of the view, and
// is clamped and truncated at the view edges.
export function placeReadout(
  clipLeft: number,
  clipWidth: number,
  view: VisibleWindow | null
): { edge: number; alignEnd: boolean; maxWidth: number | null } {
  if (!view) return { edge: clipLeft, alignEnd: false, maxWidth: null }
  const viewStart = view.left + READOUT_INSET_PX
  const viewEnd = view.left + view.width - READOUT_INSET_PX
  const clamp = (value: number) => Math.min(viewEnd, Math.max(viewStart, value))
  const alignEnd = clipLeft - view.left > view.width / 2
  if (alignEnd) {
    const edge = clamp(clipLeft + clipWidth)
    return { edge, alignEnd, maxWidth: Math.max(0, edge - viewStart) }
  }
  const edge = clamp(clipLeft)
  return { edge, alignEnd, maxWidth: Math.max(0, viewEnd - edge) }
}

export type WheelAction = 'zoom' | 'horizontal' | 'native'

// What a wheel over the lanes does. Ctrl zooms. Shift scrolls through time.
// A plain vertical wheel scrolls the page (native) while the lanes do not fit
// in the window, so every track stays reachable; once they all fit it scrolls
// through time like Basic. Horizontal trackpad swipes stay native.
export function advancedWheelAction(input: {
  ctrlKey: boolean
  shiftKey: boolean
  deltaX: number
  deltaY: number
  lanesOverflowView: boolean
}): WheelAction {
  if (input.ctrlKey) return 'zoom'
  if (input.shiftKey) return 'horizontal'
  if (Math.abs(input.deltaX) >= Math.abs(input.deltaY)) return 'native'
  return input.lanesOverflowView ? 'native' : 'horizontal'
}

export type BlockSpan = { width: number; raised: boolean }

// Drawn width of every clip block, keyed by segment id. Lanes are laid out
// linearly, so a block widened to `minWidthPx` would run under the clip after
// it; widened blocks are therefore raised above their full-width neighbours,
// and capped at the start of the next widened block on the same track so a run
// of short clips still shows a piece of each one.
export function advancedBlockSpans(
  segments: AdvancedSegment[],
  pxPerSec: number,
  minWidthPx: number
): Map<string, BlockSpan> {
  const spans = new Map<string, BlockSpan>()
  const byTrack = new Map<string, AdvancedSegment[]>()
  for (const segment of segments) {
    const lane = byTrack.get(segment.trackId) ?? []
    lane.push(segment)
    byTrack.set(segment.trackId, lane)
  }
  for (const lane of byTrack.values()) {
    const ordered = [...lane].sort((first, second) => first.timelineStart - second.timelineStart)
    let nextRaisedStart = Infinity
    for (let i = ordered.length - 1; i >= 0; i--) {
      const segment = ordered[i]
      const naturalWidth = segmentDuration(segment) * pxPerSec
      if (naturalWidth >= minWidthPx) {
        spans.set(segment.id, { width: naturalWidth, raised: false })
        continue
      }
      const roomPx = (nextRaisedStart - segment.timelineStart) * pxPerSec
      const width = Math.max(naturalWidth, Math.min(minWidthPx, roomPx))
      spans.set(segment.id, { width, raised: true })
      nextRaisedStart = segment.timelineStart
    }
  }
  return spans
}
