/**
 * Timeline pointer event handlers and utilities for readability and testability.
 *
 * Coordinate systems:
 * - Viewport: clientX/clientY from browser events
 * - Track: pixel position within the scrollable track container
 * - Timeline: time offset within the active segment (seconds)
 *
 * Conversions:
 * viewport → track: x = clientX - rect.left + scrollLeft
 * track → timeline: time = (x - segmentStartX) / pxPerSec
 */

import {
  clampPlayheadForSegment,
  findSegmentAtTrackX,
  buildSegmentLayout,
} from '@/lib/timelineDomain'
import type { Segment } from '@/lib/types'

/**
 * Utility to throttle pointer moves to animation frame boundaries.
 * Prevents excessive signal writes during drag operations.
 */
export function createRafThrottler() {
  let pendingId: number | null = null

  return {
    /**
     * Cancel any pending callback
     */
    cancel() {
      if (pendingId !== null) {
        cancelAnimationFrame(pendingId)
        pendingId = null
      }
    },
    /**
     * Queue a callback to run at the next animation frame
     */
    queue(callback: () => void) {
      if (pendingId !== null) cancelAnimationFrame(pendingId)
      pendingId = requestAnimationFrame(() => {
        pendingId = null
        callback()
      })
    },
  }
}

/**
 * Convert viewport pointer position to track pixel coordinate.
 * @param clientX - Browser event clientX
 * @param trackRect - Track element's bounding rectangle
 * @param trackScrollLeft - Track element's scroll position
 * @returns Pixel position within track (accounting for scroll)
 */
export function viewportToTrackX(
  clientX: number,
  trackRect: DOMRect,
  trackScrollLeft: number
): number {
  return clientX - trackRect.left + trackScrollLeft
}

/**
 * Convert track pixel position to timeline time within a segment.
 * @param trackX - Pixel position within track
 * @param segmentStartX - Pixel position where segment begins on track
 * @param pxPerSec - Current zoom level (pixels per second)
 * @returns Time offset from segment start (seconds)
 */
export function trackXToSegmentTime(
  trackX: number,
  segmentStartX: number,
  pxPerSec: number
): number {
  return (trackX - segmentStartX) / pxPerSec
}

/**
 * Create a handler for timeline track clicks/drags to seek playhead.
 * Includes rAF throttling to prevent excessive updates during drag.
 */
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
    /**
     * Handle pointer down event on track - initiate seek drag
     */
    onPointerDown(e: PointerEvent) {
      if (timeline.length === 0) return

      function seekFromPointer(ev: PointerEvent) {
        const rect = trackEl.getBoundingClientRect()
        const trackX = viewportToTrackX(ev.clientX, rect, trackEl.scrollLeft)
        const hit = findSegmentAtTrackX(layout, trackX, pxPerSec)
        if (!hit) return
        onSeek(hit.seg.id, hit.time)
      }

      // Immediate seek on initial click
      seekFromPointer(e)

      // Set up drag capture
      trackEl.setPointerCapture(e.pointerId)

      function onMove(mv: PointerEvent) {
        // Throttle move handler to animation frame
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

    /**
     * Cancel any pending operations and cleanup
     */
    cleanup() {
      throttler.cancel()
    },
  }
}

/**
 * Create a handler for playhead drag to move within active segment.
 * Includes rAF throttling and segment bounds clamping.
 */
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
    /**
     * Handle pointer down event on playhead - initiate drag
     */
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
        // Throttle move handler to animation frame
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

    /**
     * Cancel any pending operations and cleanup
     */
    cleanup() {
      throttler.cancel()
    },
  }
}

/**
 * Compute new scroll position after zoom to keep anchor point under cursor.
 * @param oldPx - Previous zoom level (pixels per second)
 * @param newPx - New zoom level (pixels per second)
 * @param anchorX - Viewport pixel of zoom anchor (cursor position)
 * @param currentScroll - Current scroll position
 * @param padding - Track left padding
 * @returns New scroll position to maintain cursor anchor
 */
export function computeZoomScroll(
  oldPx: number,
  newPx: number,
  anchorX: number,
  currentScroll: number,
  padding: number
): number {
  // Time at cursor position before zoom (track coordinates)
  const timeAtCursor = (anchorX + currentScroll - padding) / oldPx
  // New scroll position to keep same time under cursor after zoom
  return timeAtCursor * newPx + padding - anchorX
}
