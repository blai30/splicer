import type { Segment, SegmentLayoutItem } from '@/lib/types'

export const MIN_SEGMENT_DURATION = 0.1

export function clampPlayheadForSegment(seg: Segment, playhead: number): number {
  return Math.min(seg.endTime, Math.max(seg.startTime, playhead))
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
  return segments.map((s) =>
    s.id === segId
      ? {
          ...s,
          startTime: clampSegmentStartTime(nextStart, s.endTime, minStart),
        }
      : s
  )
}

export function updateSegmentEndTime(
  segments: Segment[],
  segId: string,
  nextEnd: number,
  clipDuration: number
): Segment[] {
  return segments.map((s) =>
    s.id === segId
      ? {
          ...s,
          endTime: clampSegmentEndTime(nextEnd, s.startTime, clipDuration),
        }
      : s
  )
}

export function splitSegmentAtPlayhead(
  segments: Segment[],
  segId: string,
  splitTime: number
): { nextSegments: Segment[]; newSegmentId: string } | null {
  const seg = segments.find((s) => s.id === segId)
  if (!seg) return null
  if (splitTime <= seg.startTime || splitTime >= seg.endTime) return null

  const first = { ...seg, endTime: splitTime }
  const second = { ...seg, id: crypto.randomUUID(), startTime: splitTime }

  return {
    nextSegments: segments.flatMap((s) => (s.id === seg.id ? [first, second] : [s])),
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

  for (const seg of segments) {
    const width = (seg.endTime - seg.startTime) * pxPerSec
    const startX = cursorX
    const endX = startX + width
    layout.push({ seg, startX, endX })
    cursorX = endX + gapPx
  }

  return layout
}

export function findSegmentAtTrackX(
  layout: SegmentLayoutItem[],
  x: number,
  pxPerSec: number
): { seg: Segment; time: number } | null {
  for (const item of layout) {
    if (x >= item.startX && x <= item.endX) {
      return {
        seg: item.seg,
        time: item.seg.startTime + (x - item.startX) / pxPerSec,
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
  let dropIdx = 0

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const width = (seg.endTime - seg.startTime) * pxPerSec
    if (x < accX + width / 2) {
      dropIdx = i
      break
    }
    accX += width + gapPx
    dropIdx = i + 1
  }

  return dropIdx
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
        onSeek(hit.seg.id, hit.time)
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
