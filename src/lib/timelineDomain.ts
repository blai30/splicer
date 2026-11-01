import type { Segment, SegmentLayoutItem } from '@/lib/types'

export const MIN_SEGMENT_DURATION = 0.1

export function clampPlayheadForSegment(segment: Segment, playhead: number): number {
  return Math.min(segment.endTime, Math.max(segment.startTime, playhead))
}

// The lower bound wins over the minimum-length rule, so a start can never move
// before the media origin even for a segment already shorter than the minimum.
export function clampSegmentStartTime(nextStart: number, currentEnd: number, minStart = 0): number {
  return Math.max(minStart, Math.min(currentEnd - MIN_SEGMENT_DURATION, nextStart))
}

export function clampSegmentEndTime(
  nextEnd: number,
  currentStart: number,
  clipDuration: number
): number {
  return Math.min(clipDuration, Math.max(currentStart + MIN_SEGMENT_DURATION, nextEnd))
}

export function updateSegmentStartTime(
  segments: Segment[],
  segmentId: string,
  nextStart: number,
  minStart = 0
): Segment[] {
  return segments.map((segment) =>
    segment.id === segmentId
      ? {
          ...segment,
          startTime: clampSegmentStartTime(nextStart, segment.endTime, minStart),
        }
      : segment
  )
}

export function updateSegmentEndTime(
  segments: Segment[],
  segmentId: string,
  nextEnd: number,
  clipDuration: number
): Segment[] {
  return segments.map((segment) =>
    segment.id === segmentId
      ? {
          ...segment,
          endTime: clampSegmentEndTime(nextEnd, segment.startTime, clipDuration),
        }
      : segment
  )
}

export function splitSegmentAtPlayhead(
  segments: Segment[],
  segmentId: string,
  splitTime: number
): { nextSegments: Segment[]; newSegmentId: string } | null {
  const segment = segments.find((segment) => segment.id === segmentId)
  if (!segment) return null
  // Both pieces must be at least the minimum length (and therefore trimmable).
  if (splitTime - segment.startTime < MIN_SEGMENT_DURATION) return null
  if (segment.endTime - splitTime < MIN_SEGMENT_DURATION) return null

  const first = { ...segment, endTime: splitTime }
  const second = { ...segment, id: crypto.randomUUID(), startTime: splitTime }

  return {
    nextSegments: segments.flatMap((segment) =>
      segment.id === segmentId ? [first, second] : [segment]
    ),
    newSegmentId: second.id,
  }
}

// Block positions on the Basic track. Each block spans its duration at the
// current zoom, but never less than `minWidthPx`, so positions inside a block
// map to time proportionally (see segmentTimeToX) rather than by pxPerSec.
export function buildSegmentLayout(
  segments: Segment[],
  pxPerSec: number,
  gapPx: number,
  paddingPx: number,
  minWidthPx = 0
): SegmentLayoutItem[] {
  let cursorX = paddingPx
  const layout: SegmentLayoutItem[] = []

  for (const segment of segments) {
    const width = Math.max(minWidthPx, (segment.endTime - segment.startTime) * pxPerSec)
    const startX = cursorX
    const endX = startX + width
    layout.push({ segment, startX, endX })
    cursorX = endX + gapPx
  }

  return layout
}

function itemDuration(item: SegmentLayoutItem): number {
  return item.segment.endTime - item.segment.startTime
}

// Track x of a source time inside one block.
export function segmentTimeToX(item: SegmentLayoutItem, sourceTime: number): number {
  const duration = itemDuration(item)
  if (duration <= 0) return item.startX
  return (
    item.startX + ((sourceTime - item.segment.startTime) / duration) * (item.endX - item.startX)
  )
}

// Source time under a track x inside one block (unclamped).
export function segmentXToTime(item: SegmentLayoutItem, x: number): number {
  const width = item.endX - item.startX
  if (width <= 0) return item.segment.startTime
  return item.segment.startTime + ((x - item.startX) / width) * itemDuration(item)
}

export function findSegmentAtTrackX(
  layout: SegmentLayoutItem[],
  x: number
): { segment: Segment; time: number } | null {
  for (const item of layout) {
    if (x >= item.startX && x <= item.endX) {
      return { segment: item.segment, time: segmentXToTime(item, x) }
    }
  }

  return null
}

// Total length of the edited (concatenated) timeline.
export function layoutDuration(layout: SegmentLayoutItem[]): number {
  let total = 0
  for (const item of layout) total += itemDuration(item)
  return total
}

// Track x of a time on the concatenated timeline. A time on a cut maps to the
// start of the later block, past the gap.
export function globalTimeToX(layout: SegmentLayoutItem[], globalTime: number): number {
  let elapsed = 0
  for (const item of layout) {
    const duration = itemDuration(item)
    if (globalTime < elapsed + duration) {
      return segmentTimeToX(item, item.segment.startTime + Math.max(0, globalTime - elapsed))
    }
    elapsed += duration
  }
  return layout.at(-1)?.endX ?? 0
}

// Concatenated-timeline time under a track x. The padding before the first
// block reads as 0, a gap as the start of the block after it, and anything
// past the last block as the end.
export function xToGlobalTime(layout: SegmentLayoutItem[], x: number): number {
  let elapsed = 0
  for (const item of layout) {
    const duration = itemDuration(item)
    if (x < item.startX) return elapsed
    if (x <= item.endX) return elapsed + (segmentXToTime(item, x) - item.segment.startTime)
    elapsed += duration
  }
  return elapsed
}

// The segment and source time playing at a concatenated-timeline time. The
// very end resolves to the last segment's out-point.
export function globalTimeToSegment(
  layout: SegmentLayoutItem[],
  globalTime: number
): { segment: Segment; time: number } | null {
  let elapsed = 0
  for (const item of layout) {
    const duration = itemDuration(item)
    if (globalTime < elapsed + duration) {
      return {
        segment: item.segment,
        time: item.segment.startTime + Math.max(0, globalTime - elapsed),
      }
    }
    elapsed += duration
  }
  const last = layout.at(-1)
  return last ? { segment: last.segment, time: last.segment.endTime } : null
}

// Centers of the gaps between blocks: where the cuts sit on the ruler.
export function cutMarkerXs(layout: SegmentLayoutItem[], gapPx: number): number[] {
  return layout.slice(1).map((item) => item.startX - gapPx / 2)
}

// Track x of the Basic playhead: the playhead time inside the active block,
// or `fallbackX` when no block is active. The time is clamped to the block
// because it can briefly belong to the previous segment's source (e.g. right
// after playback crosses a cut, before the next file reports its position).
export function playheadXInLayout(
  layout: SegmentLayoutItem[],
  activeSegmentId: string | undefined,
  playheadTime: number,
  fallbackX: number
): number {
  const item = layout.find((entry) => entry.segment.id === activeSegmentId)
  return item
    ? segmentTimeToX(item, clampPlayheadForSegment(item.segment, playheadTime))
    : fallbackX
}

export function findDropIndexAtTrackX(
  segments: Segment[],
  x: number,
  pxPerSec: number,
  gapPx: number,
  minWidthPx = 0
): number {
  let accX = 0
  let dropIndex = 0

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    const width = Math.max(minWidthPx, (segment.endTime - segment.startTime) * pxPerSec)
    if (x < accX + width / 2) {
      dropIndex = i
      break
    }
    accX += width + gapPx
    dropIndex = i + 1
  }

  return dropIndex
}

export function createRafThrottler() {
  let pendingId: number | null = null

  return {
    cancel() {
      if (pendingId !== null) {
        cancelAnimationFrame(pendingId)
        pendingId = null
      }
    },
    queue(callback: () => void) {
      if (pendingId !== null) cancelAnimationFrame(pendingId)
      pendingId = requestAnimationFrame(() => {
        pendingId = null
        callback()
      })
    },
  }
}

export function viewportToTrackX(
  clientX: number,
  trackRect: DOMRect,
  trackScrollLeft: number
): number {
  return clientX - trackRect.left + trackScrollLeft
}

export function createTrackSeekHandler(options: {
  layout: SegmentLayoutItem[]
  trackElement: HTMLElement
  onSeek: (segmentId: string, time: number) => void
}) {
  const { layout, trackElement, onSeek } = options
  const throttler = createRafThrottler()

  return {
    onPointerDown(event: PointerEvent) {
      if (layout.length === 0) return

      function seekFromPointer(pointerEvent: PointerEvent) {
        const rect = trackElement.getBoundingClientRect()
        const trackX = viewportToTrackX(pointerEvent.clientX, rect, trackElement.scrollLeft)
        const hit = findSegmentAtTrackX(layout, trackX)
        if (!hit) return
        onSeek(hit.segment.id, hit.time)
      }

      seekFromPointer(event)
      trackElement.setPointerCapture(event.pointerId)

      function onMove(moveEvent: PointerEvent) {
        throttler.queue(() => seekFromPointer(moveEvent))
      }

      function onUp() {
        throttler.cancel()
        trackElement.removeEventListener('pointermove', onMove)
        trackElement.removeEventListener('pointerup', onUp)
        trackElement.removeEventListener('pointercancel', onUp)
      }

      trackElement.addEventListener('pointermove', onMove)
      trackElement.addEventListener('pointerup', onUp)
      trackElement.addEventListener('pointercancel', onUp)
    },

    cleanup() {
      throttler.cancel()
    },
  }
}

export function createPlayheadDragHandler(options: {
  item: SegmentLayoutItem
  trackElement: HTMLElement
  onUpdate: (time: number) => void
}) {
  const { item, trackElement, onUpdate } = options
  const { segment } = item
  const throttler = createRafThrottler()

  return {
    onPointerDown(event: PointerEvent) {
      event.stopPropagation()
      const element = event.currentTarget as HTMLElement
      element.setPointerCapture(event.pointerId)

      function syncPlayheadFromPointer(moveEvent: PointerEvent) {
        const rect = trackElement.getBoundingClientRect()
        const trackX = viewportToTrackX(moveEvent.clientX, rect, trackElement.scrollLeft)
        const clampedTime = clampPlayheadForSegment(segment, segmentXToTime(item, trackX))
        onUpdate(clampedTime)
      }

      function onMove(moveEvent: PointerEvent) {
        throttler.queue(() => syncPlayheadFromPointer(moveEvent))
      }

      function onUp() {
        throttler.cancel()
        element.removeEventListener('pointermove', onMove)
        element.removeEventListener('pointerup', onUp)
        element.removeEventListener('pointercancel', onUp)
      }

      element.addEventListener('pointermove', onMove)
      element.addEventListener('pointerup', onUp)
      element.addEventListener('pointercancel', onUp)
    },

    cleanup() {
      throttler.cancel()
    },
  }
}

export const EDGE_SCROLL_ZONE_PX = 40
export const EDGE_SCROLL_MAX_PX_PER_FRAME = 20
// Share of a narrow view each edge zone may take, so a phone-width timeline
// keeps a usable calm middle.
export const EDGE_SCROLL_ZONE_SHARE = 0.15

// Horizontal auto-scroll speed while a gesture holds the pointer near (or past)
// a scroller edge: negative scrolls left, positive right, scaled linearly by how
// deep the pointer is in the edge zone and capped beyond the edge. Narrow views
// get proportionally smaller zones and a matching lower top speed.
export function edgeScrollVelocity(
  pointerX: number,
  viewLeft: number,
  viewRight: number,
  zonePx = EDGE_SCROLL_ZONE_PX,
  maxPxPerFrame = EDGE_SCROLL_MAX_PX_PER_FRAME
): number {
  const viewWidth = viewRight - viewLeft
  if (viewWidth <= zonePx * 2 || zonePx <= 0) return 0
  const scaledZonePx = Math.min(zonePx, viewWidth * EDGE_SCROLL_ZONE_SHARE)
  const scaledMax = maxPxPerFrame * (scaledZonePx / zonePx)
  const leftDepth = viewLeft + scaledZonePx - pointerX
  if (leftDepth > 0) return -Math.round(scaledMax * Math.min(1, leftDepth / scaledZonePx))
  const rightDepth = pointerX - (viewRight - scaledZonePx)
  if (rightDepth > 0) return Math.round(scaledMax * Math.min(1, rightDepth / scaledZonePx))
  return 0
}

// Drives edge auto-scroll for one pointer gesture. update() records the latest
// pointer X and starts a frame loop while it sits in an edge zone; each frame
// that actually scrolls calls onScroll so the gesture can re-apply itself at
// the unchanged pointer position (no pointermove fires while it holds still).
// The loop parks once the scroller is pinned at a limit; the next update()
// restarts it.
export function createEdgeAutoScroller(scroller: HTMLElement, onScroll: () => void) {
  let pointerX = 0
  let frameId: number | null = null

  function step() {
    frameId = null
    const rect = scroller.getBoundingClientRect()
    const velocity = edgeScrollVelocity(pointerX, rect.left, rect.right)
    if (velocity === 0) return
    const before = scroller.scrollLeft
    scroller.scrollLeft = Math.max(0, before + velocity)
    if (scroller.scrollLeft === before) return
    onScroll()
    frameId = requestAnimationFrame(step)
  }

  return {
    update(clientX: number) {
      pointerX = clientX
      if (frameId === null) frameId = requestAnimationFrame(step)
    },
    stop() {
      if (frameId !== null) cancelAnimationFrame(frameId)
      frameId = null
    },
  }
}
