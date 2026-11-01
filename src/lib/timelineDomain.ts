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

// Total length of the edited (concatenated) timeline.
export function totalDuration(segments: Segment[]): number {
  let total = 0
  for (const segment of segments) total += segment.endTime - segment.startTime
  return total
}

// The segment playing at a concatenated-timeline time, with its index and the
// source time inside it. A time on a cut resolves to the later segment; the
// very end (and past it) to the last segment's out-point, and before the
// start to the first segment's in-point.
export function segmentAtGlobalTime(
  segments: Segment[],
  globalTime: number
): { index: number; segment: Segment; localTime: number } | null {
  if (segments.length === 0) return null
  let elapsed = 0
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    const duration = segment.endTime - segment.startTime
    if (globalTime < elapsed + duration) {
      return {
        index: i,
        segment,
        localTime: segment.startTime + Math.max(0, globalTime - elapsed),
      }
    }
    elapsed += duration
  }
  const index = segments.length - 1
  return { index, segment: segments[index], localTime: segments[index].endTime }
}

// Concatenated-timeline time of a source time inside one segment, clamped to
// that segment. Null when the segment is not on the timeline.
export function globalTimeOf(
  segments: Segment[],
  segmentId: string,
  localTime: number
): number | null {
  let elapsed = 0
  for (const segment of segments) {
    if (segment.id === segmentId) {
      return elapsed + (clampPlayheadForSegment(segment, localTime) - segment.startTime)
    }
    elapsed += segment.endTime - segment.startTime
  }
  return null
}

// Concatenated-timeline times of every cut, from 0 through the timeline end.
export function cutTimes(segments: Segment[]): number[] {
  const times = [0]
  let elapsed = 0
  for (const segment of segments) {
    elapsed += segment.endTime - segment.startTime
    times.push(elapsed)
  }
  return times
}

// The segment and source time a press at track x points to. Inside a block
// that is the time under the pointer; a gap resolves to whichever neighbouring
// edge is closer, and the padding (or anything past the blocks) to the first
// in-point or the last out-point. Null only for an empty timeline.
export function trackXToHit(
  layout: SegmentLayoutItem[],
  x: number
): { segment: Segment; time: number } | null {
  if (layout.length === 0) return null
  for (let i = 0; i < layout.length; i++) {
    const item = layout[i]
    if (x < item.startX) {
      const previous = layout[i - 1]
      // Ties go to the later block, matching a time on a cut.
      if (previous && x - previous.endX < item.startX - x) {
        return { segment: previous.segment, time: previous.segment.endTime }
      }
      return { segment: item.segment, time: item.segment.startTime }
    }
    if (x <= item.endX) {
      return {
        segment: item.segment,
        time: clampPlayheadForSegment(item.segment, segmentXToTime(item, x)),
      }
    }
  }
  const last = layout[layout.length - 1]
  return { segment: last.segment, time: last.segment.endTime }
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

// One pointer gesture that moves the Basic playhead: presses on the ruler, the
// playhead itself, or the empty track all scrub through here. Each position
// resolves with trackXToHit, so a drag crosses cuts (selecting the segment
// under the pointer) and presses in gaps or padding land on the nearest edge.
// Holding the pointer past a scroller edge keeps scrolling and scrubbing.
export function createScrubHandler(options: {
  trackElement: HTMLElement
  // Read on every move, so edits or zoom during the gesture are respected.
  getLayout: () => SegmentLayoutItem[]
  onSeek: (segmentId: string, time: number) => void
  onEnd?: () => void
}) {
  const { trackElement, getLayout, onSeek, onEnd } = options
  const throttler = createRafThrottler()
  let stopActive: (() => void) | null = null

  function seekAtClientX(clientX: number) {
    const x = viewportToTrackX(
      clientX,
      trackElement.getBoundingClientRect(),
      trackElement.scrollLeft
    )
    const hit = trackXToHit(getLayout(), x)
    if (hit) onSeek(hit.segment.id, hit.time)
  }

  return {
    // `seekOnPress` is false when grabbing the playhead itself: the press
    // must not nudge it to the pointer before the drag moves.
    onPointerDown(event: PointerEvent, seekOnPress = true) {
      stopActive?.()
      if (seekOnPress) seekAtClientX(event.clientX)
      trackElement.setPointerCapture(event.pointerId)
      let lastClientX = event.clientX
      let moved = seekOnPress
      const autoScroll = createEdgeAutoScroller(trackElement, () =>
        throttler.queue(() => seekAtClientX(lastClientX))
      )

      function stop() {
        throttler.cancel()
        autoScroll.stop()
        stopActive = null
        trackElement.removeEventListener('pointermove', onMove)
        trackElement.removeEventListener('pointerup', onUp)
        trackElement.removeEventListener('pointercancel', onCancel)
        onEnd?.()
      }
      function onMove(moveEvent: PointerEvent) {
        lastClientX = moveEvent.clientX
        moved = true
        throttler.queue(() => seekAtClientX(moveEvent.clientX))
        autoScroll.update(moveEvent.clientX)
      }
      function onUp(upEvent: PointerEvent) {
        // Land exactly where the pointer was released.
        if (moved) seekAtClientX(upEvent.clientX)
        stop()
      }
      function onCancel() {
        stop()
      }

      stopActive = stop
      trackElement.addEventListener('pointermove', onMove)
      trackElement.addEventListener('pointerup', onUp)
      trackElement.addEventListener('pointercancel', onCancel)
    },

    cleanup() {
      stopActive?.()
    },
  }
}
