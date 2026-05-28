import type { Segment, SegmentLayoutItem } from '@/lib/types'

export const MIN_SEGMENT_DURATION = 0.1

export function clampPlayheadForSegment(segment: Segment, playhead: number): number {
  return Math.min(segment.endTime, Math.max(segment.startTime, playhead))
}

export function clampSegmentStartTime(nextStart: number, currentEnd: number, minStart = 0): number {
  return Math.min(currentEnd - MIN_SEGMENT_DURATION, Math.max(minStart, nextStart))
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
  segId: string,
  nextStart: number,
  minStart = 0
): Segment[] {
  return segments.map((segment) =>
    segment.id === segId
      ? {
          ...segment,
          startTime: clampSegmentStartTime(nextStart, segment.endTime, minStart),
        }
      : segment
  )
}

export function updateSegmentEndTime(
  segments: Segment[],
  segId: string,
  nextEnd: number,
  clipDuration: number
): Segment[] {
  return segments.map((segment) =>
    segment.id === segId
      ? {
          ...segment,
          endTime: clampSegmentEndTime(nextEnd, segment.startTime, clipDuration),
        }
      : segment
  )
}

export function splitSegmentAtPlayhead(
  segments: Segment[],
  segId: string,
  splitTime: number
): { nextSegments: Segment[]; newSegmentId: string } | null {
  const segment = segments.find((segment) => segment.id === segId)
  if (!segment) return null
  if (splitTime <= segment.startTime || splitTime >= segment.endTime) return null

  const first = { ...segment, endTime: splitTime }
  const second = { ...segment, id: crypto.randomUUID(), startTime: splitTime }

  return {
    nextSegments: segments.flatMap((segment) =>
      segment.id === segId ? [first, second] : [segment]
    ),
    newSegmentId: second.id,
  }
}

export function buildSegmentLayout(
  segments: Segment[],
  pxPerSec: number,
  gapPx: number,
  paddingPx: number
): SegmentLayoutItem[] {
  let cursorX = paddingPx
  const layout: SegmentLayoutItem[] = []

  for (const segment of segments) {
    const width = (segment.endTime - segment.startTime) * pxPerSec
    const startX = cursorX
    const endX = startX + width
    layout.push({ segment, startX, endX })
    cursorX = endX + gapPx
  }

  return layout
}

export function findSegmentAtTrackX(
  layout: SegmentLayoutItem[],
  x: number,
  pxPerSec: number
): { segment: Segment; time: number } | null {
  for (const item of layout) {
    if (x >= item.startX && x <= item.endX) {
      return {
        segment: item.segment,
        time: item.segment.startTime + (x - item.startX) / pxPerSec,
      }
    }
  }

  return null
}

export function findDropIndexAtTrackX(
  segments: Segment[],
  x: number,
  pxPerSec: number,
  gapPx: number
): number {
  let accX = 0
  let dropIndex = 0

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    const width = (segment.endTime - segment.startTime) * pxPerSec
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

export function trackXToSegmentTime(
  trackX: number,
  segmentStartX: number,
  pxPerSec: number
): number {
  return (trackX - segmentStartX) / pxPerSec
}

export function createTrackSeekHandler(options: {
  timeline: Segment[]
  pxPerSec: number
  padding: number
  gap: number
  trackEl: HTMLElement
  onSeek: (segmentId: string, time: number) => void
}) {
  const { timeline, pxPerSec, padding, gap, trackEl, onSeek } = options
  const throttler = createRafThrottler()
  const layout = buildSegmentLayout(timeline, pxPerSec, gap, padding)

  return {
    onPointerDown(e: PointerEvent) {
      if (timeline.length === 0) return

      function seekFromPointer(ev: PointerEvent) {
        const rect = trackEl.getBoundingClientRect()
        const trackX = viewportToTrackX(ev.clientX, rect, trackEl.scrollLeft)
        const hit = findSegmentAtTrackX(layout, trackX, pxPerSec)
        if (!hit) return
        onSeek(hit.segment.id, hit.time)
      }

      seekFromPointer(e)
      trackEl.setPointerCapture(e.pointerId)

      function onMove(mv: PointerEvent) {
        throttler.queue(() => seekFromPointer(mv))
      }

      function onUp() {
        throttler.cancel()
        trackEl.removeEventListener('pointermove', onMove)
        trackEl.removeEventListener('pointerup', onUp)
      }

      trackEl.addEventListener('pointermove', onMove)
      trackEl.addEventListener('pointerup', onUp)
    },

    cleanup() {
      throttler.cancel()
    },
  }
}

export function createPlayheadDragHandler(options: {
  segment: Segment
  segmentStartX: number
  pxPerSec: number
  trackEl: HTMLElement
  onUpdate: (time: number) => void
}) {
  const { segment, segmentStartX, pxPerSec, trackEl, onUpdate } = options
  const throttler = createRafThrottler()

  return {
    onPointerDown(e: PointerEvent) {
      e.stopPropagation()
      const el = e.currentTarget as HTMLElement
      el.setPointerCapture(e.pointerId)

      function syncPlayheadFromPointer(mv: PointerEvent) {
        const rect = trackEl.getBoundingClientRect()
        const trackX = viewportToTrackX(mv.clientX, rect, trackEl.scrollLeft)
        const segmentTime = trackXToSegmentTime(trackX, segmentStartX, pxPerSec)
        const clampedTime = clampPlayheadForSegment(segment, segment.startTime + segmentTime)
        onUpdate(clampedTime)
      }

      function onMove(mv: PointerEvent) {
        throttler.queue(() => syncPlayheadFromPointer(mv))
      }

      function onUp() {
        throttler.cancel()
        el.removeEventListener('pointermove', onMove)
        el.removeEventListener('pointerup', onUp)
      }

      el.addEventListener('pointermove', onMove)
      el.addEventListener('pointerup', onUp)
    },

    cleanup() {
      throttler.cancel()
    },
  }
}

export function computeZoomScroll(
  oldPx: number,
  newPx: number,
  anchorX: number,
  currentScroll: number,
  padding: number
): number {
  const timeAtCursor = (anchorX + currentScroll - padding) / oldPx
  return timeAtCursor * newPx + padding - anchorX
}
