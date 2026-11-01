import type { ReadonlySignal } from '@preact/signals'
import { untracked, useSignal, useSignalEffect } from '@preact/signals'
import type { RefObject } from 'preact'
import { useEffect, useMemo, useRef } from 'preact/hooks'

import { importing, pxPerSec } from '@/lib/store'
import {
  clampTimelineZoom,
  createAutoFitTrigger,
  createFollowSuspension,
  followScrollTarget,
  stepZoom,
  zoomAnchorX,
} from '@/lib/timelineNavigation'
import { registerTimelineNavigator } from '@/lib/timelineNavigator'

// The part of the timeline content in view, in content px.
export type ScrollWindow = { left: number; width: number }

// How one timeline maps time to content px at a given zoom. Basic maps through
// the gaps between blocks; Advanced is linear.
export type TimelineGeometry = {
  timeToX: (time: number, zoom: number) => number
  xToTime: (x: number, zoom: number) => number
  // Zoom that shows the whole timeline in a view this wide (null when empty).
  fitZoom: (viewWidth: number) => number | null
}

// Tracks the scroller's visible window. Updated at most once per frame, and
// read only by the components that need it (the ruler), so scrolling does not
// re-render the whole timeline.
export function useScrollWindow(scrollRef: RefObject<HTMLElement>): ReadonlySignal<ScrollWindow> {
  const scrollWindow = useSignal<ScrollWindow>({ left: 0, width: 0 })

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    let frameId: number | null = null
    function measure() {
      frameId = null
      const next = { left: scroller!.scrollLeft, width: scroller!.clientWidth }
      const current = scrollWindow.peek()
      if (next.left !== current.left || next.width !== current.width) scrollWindow.value = next
    }
    function queueMeasure() {
      if (frameId === null) frameId = requestAnimationFrame(measure)
    }
    measure()
    scroller.addEventListener('scroll', queueMeasure, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(queueMeasure)
    observer?.observe(scroller)
    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId)
      scroller.removeEventListener('scroll', queueMeasure)
      observer?.disconnect()
    }
  }, [])

  return scrollWindow
}

// Zoom, fit, and playhead follow for one timeline scroller, shared by both
// editors. Registers itself as the keyboard shortcuts' navigator while mounted.
export function useTimelineNavigation({
  scrollRef,
  geometry,
  playheadX,
  playing,
  isEmpty,
}: {
  scrollRef: RefObject<HTMLElement>
  geometry: TimelineGeometry
  // Playhead position in content px.
  playheadX: ReadonlySignal<number>
  playing: ReadonlySignal<boolean>
  isEmpty: ReadonlySignal<boolean>
}) {
  // The geometry closes over the latest render's segments.
  const geometryRef = useRef(geometry)
  geometryRef.current = geometry
  const suspension = useMemo(() => createFollowSuspension(), [])
  const autoFit = useMemo(() => createAutoFitTrigger(isEmpty.peek()), [])
  // A held pointer means a scrub or drag owns the scroll position.
  const pointerHeld = useRef(false)

  // Every scroll the timeline makes itself goes through here, so the follow
  // suspension can tell it apart from the user's.
  function setScrollLeft(scroller: HTMLElement, left: number) {
    scroller.scrollLeft = Math.max(0, left)
    suspension.noteScrollSet(scroller.scrollLeft)
  }

  function applyScroll(scroller: HTMLElement, left: number) {
    // Applied after the re-render resizes the content; set now, the browser
    // would clamp it to the old scroll range.
    requestAnimationFrame(() => setScrollLeft(scroller, left))
  }

  // Zoom to `nextZoom`, keeping the time under `anchorViewportX` (px from the
  // scroller's left edge) in place; by default the playhead, or the middle of
  // the view when the playhead is off screen.
  function zoomTo(nextZoom: number, anchorViewportX?: number) {
    const scroller = scrollRef.current
    if (!scroller) return
    const oldZoom = pxPerSec.value
    const clamped = clampTimelineZoom(nextZoom)
    if (clamped === oldZoom) return
    const anchor =
      anchorViewportX ?? zoomAnchorX(playheadX.value - scroller.scrollLeft, scroller.clientWidth)
    const { timeToX, xToTime } = geometryRef.current
    const anchorTime = xToTime(scroller.scrollLeft + anchor, oldZoom)
    pxPerSec.value = clamped
    applyScroll(scroller, timeToX(anchorTime, clamped) - anchor)
  }

  function zoomStep(direction: 1 | -1) {
    zoomTo(stepZoom(pxPerSec.value, direction))
  }

  // Show the whole timeline from its start. `zoomOutOnly` (auto-fit) never
  // magnifies content that already fits at the current zoom.
  function fit(zoomOutOnly = false) {
    const scroller = scrollRef.current
    if (!scroller) return
    const zoom = geometryRef.current.fitZoom(scroller.clientWidth)
    if (zoom === null) return
    pxPerSec.value = zoomOutOnly ? Math.min(zoom, pxPerSec.value) : zoom
    setScrollLeft(scroller, 0)
    applyScroll(scroller, 0)
  }

  function revealPlayhead() {
    const scroller = scrollRef.current
    if (!scroller || pointerHeld.current) return
    // Only an actually hidden playhead scrolls; a visible one near the edge stays.
    const target = followScrollTarget(playheadX.value, scroller.scrollLeft, scroller.clientWidth, 1)
    if (target !== null) setScrollLeft(scroller, target)
  }

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    function onWheel() {
      suspension.suspend()
    }
    function onScroll() {
      // A held pointer suspends on release anyway; its edge auto-scroll is
      // part of that gesture.
      if (!pointerHeld.current) suspension.onScroll(scroller!.scrollLeft)
    }
    function onPointerDown() {
      pointerHeld.current = true
      suspension.suspend()
    }
    function onPointerUp() {
      if (!pointerHeld.current) return
      pointerHeld.current = false
      suspension.suspend()
    }
    scroller.addEventListener('wheel', onWheel, { passive: true })
    scroller.addEventListener('scroll', onScroll, { passive: true })
    // Capture phase: clip blocks stop their presses from bubbling.
    scroller.addEventListener('pointerdown', onPointerDown, { capture: true })
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      scroller.removeEventListener('wheel', onWheel)
      scroller.removeEventListener('scroll', onScroll)
      scroller.removeEventListener('pointerdown', onPointerDown, { capture: true })
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [])

  // Page-follow the playhead during playback.
  useSignalEffect(() => {
    const x = playheadX.value
    if (!playing.value) return
    const scroller = scrollRef.current
    if (!scroller || pointerHeld.current || suspension.isSuspended()) return
    const target = followScrollTarget(x, scroller.scrollLeft, scroller.clientWidth)
    if (target !== null) setScrollLeft(scroller, target)
  })

  // Untracked fit: the trigger depends on content and import state, not on zoom.
  useSignalEffect(() => {
    if (autoFit.update(isEmpty.value, importing.value)) untracked(() => fit(true))
  })

  useEffect(() => registerTimelineNavigator({ zoomStep, fit: () => fit(), revealPlayhead }), [])

  return { zoomTo, zoomStep, fit }
}
