import clsx from 'clsx/lite'
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Scissors,
  Trash2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-preact'
import { useEffect, useRef } from 'preact/hooks'

import { AdvancedSegmentBlock } from '@/components/advanced/AdvancedSegmentBlock'
import { AdvancedTrackHeaders } from '@/components/advanced/AdvancedTrackHeaders'
import { ZoomSlider } from '@/components/ZoomSlider'
import { seek } from '@/lib/advanced/advancedPlayback'
import { moveSegment } from '@/lib/advanced/advancedSegmentEditing'
import { projectDuration } from '@/lib/advanced/advancedTimelineDomain'
import {
  cutAdvancedAtPlayhead,
  deleteAdvancedSelected,
  setAdvancedInPoint,
  setAdvancedOutPoint,
  toggleAdvancedMute,
} from '@/lib/advanced/advancedTimelineEditing'
import {
  advancedPlayhead,
  advancedSegments,
  advancedSelectedId,
  advancedTracks,
  pxPerSec,
  ZOOM_MAX,
  ZOOM_MIN,
} from '@/lib/store'
import { computeZoomScroll, createRafThrottler } from '@/lib/timelineDomain'

const LANE_HEIGHT = 56
const PAD_LEFT = 8
const ZOOM_SCALE_FACTOR = 1.25

export function AdvancedTimeline() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrubThrottlerRef = useRef<ReturnType<typeof createRafThrottler> | null>(null)

  const tracks = advancedTracks.value
  const segments = advancedSegments.value
  const duration = projectDuration(segments)
  const contentWidth = Math.max(600, duration * pxPerSec.value + 200)
  const playheadLeft = PAD_LEFT + advancedPlayhead.value * pxPerSec.value

  // Map a viewport X to a timeline time, accounting for horizontal scroll.
  function timeFromClientX(clientX: number): number {
    const scroller = scrollRef.current
    if (!scroller) return 0
    const rect = scroller.getBoundingClientRect()
    return Math.max(0, (clientX - rect.left + scroller.scrollLeft - PAD_LEFT) / pxPerSec.value)
  }

  // Scrub the playhead: snap it to the cursor and follow until release. Pointer
  // capture is taken on the scroll container (a stable node that survives the
  // re-renders each seek triggers), so every move/up routes here instead of
  // leaking to the clip blocks underneath (which would otherwise start dragging
  // the clip and strand the capture, making the playhead stick to the cursor).
  function startScrub(event: PointerEvent, container: HTMLElement) {
    seek(timeFromClientX(event.clientX))
    container.setPointerCapture(event.pointerId)
    const throttler = createRafThrottler()
    scrubThrottlerRef.current = throttler

    function onMove(moveEvent: PointerEvent) {
      throttler.queue(() => seek(timeFromClientX(moveEvent.clientX)))
    }
    function onUp(upEvent: PointerEvent) {
      throttler.cancel()
      // Commit a final seek at the release point so a fast flick (whose last
      // throttled move was canceled above) still lands the playhead precisely.
      seek(timeFromClientX(upEvent.clientX))
      container.removeEventListener('pointermove', onMove)
      container.removeEventListener('pointerup', onUp)
      container.removeEventListener('pointercancel', onUp)
    }
    container.addEventListener('pointermove', onMove)
    container.addEventListener('pointerup', onUp)
    container.addEventListener('pointercancel', onUp)
  }

  function onTrackPointerDown(event: PointerEvent) {
    const target = event.target as HTMLElement
    // Clip blocks handle their own drag/trim/selection; a press anywhere else
    // (blank lane or the playhead) scrubs the playhead from that point.
    if (target.closest('[data-advanced-segment]')) return
    startScrub(event, event.currentTarget as HTMLElement)
  }

  // Cancel any pending throttled seek if we unmount mid-drag.
  useEffect(() => () => scrubThrottlerRef.current?.cancel(), [])

  function zoomTo(newPx: number, anchorX?: number) {
    const scroller = scrollRef.current
    if (!scroller) return
    const oldPx = pxPerSec.value
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newPx))
    if (anchorX !== undefined) {
      scroller.scrollLeft = computeZoomScroll(
        oldPx,
        clamped,
        anchorX,
        scroller.scrollLeft,
        PAD_LEFT
      )
    }
    pxPerSec.value = clamped
  }

  function onWheel(event: WheelEvent) {
    const scroller = scrollRef.current
    if (!scroller) return
    if (event.ctrlKey) {
      event.preventDefault()
      const rect = scroller.getBoundingClientRect()
      const anchorX = event.clientX - rect.left
      const factor = event.deltaY > 0 ? 1 / ZOOM_SCALE_FACTOR : ZOOM_SCALE_FACTOR
      zoomTo(pxPerSec.value * factor, anchorX)
    } else if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      event.preventDefault()
      scroller.scrollLeft += event.deltaY
    }
  }

  const selectedSegment = segments.find((segment) => segment.id === advancedSelectedId.value)
  const toolbarDisabled = !selectedSegment

  function makeRequestMove(segmentId: string) {
    return (deltaTime: number, deltaLanes: number) => {
      const segment = advancedSegments.value.find((entry) => entry.id === segmentId)
      if (!segment) return
      const laneIndex = tracks.findIndex((track) => track.id === segment.trackId)
      const nextLane = Math.min(tracks.length - 1, Math.max(0, laneIndex + deltaLanes))
      const nextTrackId = tracks[nextLane]?.id ?? segment.trackId
      moveSegment(segmentId, nextTrackId, segment.timelineStart + deltaTime)
    }
  }

  return (
    <div class="relative flex shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200/60 bg-slate-50/40 backdrop-blur dark:border-slate-700/60 dark:bg-slate-900/40">
      {/* Header */}
      <div class="flex shrink-0 flex-col gap-y-1.5 px-4 pt-3 pb-2 md:flex-row md:items-start md:gap-x-2.5">
        <span class="text-sm font-semibold tracking-wider text-slate-500 uppercase md:pt-1 dark:text-slate-400">
          Tracks
        </span>
        <div class="flex items-start gap-2.5 md:flex-1">
          <div class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <button
              class="flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 hover:duration-0 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100"
              disabled={toolbarDisabled}
              onClick={setAdvancedInPoint}
              title="Set in-point (I)"
              aria-label="Set clip in-point at current playhead position"
            >
              <ArrowLeftToLine class="h-3.5 w-3.5" />
              In
            </button>
            <button
              class="flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 hover:duration-0 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100"
              disabled={toolbarDisabled}
              onClick={setAdvancedOutPoint}
              title="Set out-point (O)"
              aria-label="Set clip out-point at current playhead position"
            >
              <ArrowRightToLine class="h-3.5 w-3.5" />
              Out
            </button>
            <button
              class="flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 hover:duration-0 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100"
              disabled={toolbarDisabled}
              onClick={cutAdvancedAtPlayhead}
              title="Split at playhead (C)"
              aria-label="Split clip at current playhead position"
            >
              <Scissors class="h-3.5 w-3.5" />
              Cut
            </button>
            <button
              class={clsx(
                'flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-semibold transition-colors hover:duration-0 disabled:cursor-not-allowed disabled:opacity-40',
                selectedSegment?.muted
                  ? 'bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400 dark:hover:bg-amber-900/30'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100'
              )}
              disabled={toolbarDisabled}
              onClick={toggleAdvancedMute}
              title="Toggle mute on selected clip (M)"
              aria-label="Toggle mute on selected clip"
            >
              <VolumeX class="h-3.5 w-3.5" />
              {selectedSegment?.muted ? 'Unmute' : 'Mute'}
            </button>
            <button
              class="flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100/50 hover:text-red-700 hover:duration-0 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-900/30 dark:hover:text-red-300"
              disabled={toolbarDisabled}
              onClick={deleteAdvancedSelected}
              title="Delete clip"
              aria-label="Delete selected clip"
            >
              <Trash2 class="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
          <div class="flex shrink-0 items-center gap-2 md:gap-3">
            <button
              onClick={() => zoomTo(pxPerSec.value - 10)}
              class="text-slate-400 transition-colors hover:text-slate-600 hover:duration-0 dark:text-slate-500 dark:hover:text-slate-300"
              title="Zoom out"
            >
              <ZoomOut class="h-3.5 w-3.5" />
            </button>
            <ZoomSlider
              class="w-16 md:w-28"
              value={pxPerSec.value}
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              onChange={zoomTo}
            />
            <button
              onClick={() => zoomTo(pxPerSec.value + 10)}
              class="text-slate-400 transition-colors hover:text-slate-600 hover:duration-0 dark:text-slate-500 dark:hover:text-slate-300"
              title="Zoom in"
            >
              <ZoomIn class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Tracks body: headers column + scrollable lanes */}
      <div class="flex">
        <AdvancedTrackHeaders laneHeight={LANE_HEIGHT} />
        <div
          ref={scrollRef}
          onWheel={onWheel}
          class="relative min-h-0 flex-1 scrollbar-thin scrollbar-thumb-slate-400 scrollbar-track-transparent overflow-x-auto dark:scrollbar-thumb-slate-700"
          onPointerDown={onTrackPointerDown}
        >
          {/* spacer matching the headers' Add-track button row */}
          <div style={{ width: `${contentWidth}px` }}>
            <div class="h-7" />
            {tracks.map((track) => (
              <div
                key={track.id}
                class="relative border-b border-slate-200/40 dark:border-slate-700/40"
                style={{ height: `${LANE_HEIGHT}px` }}
              >
                {segments
                  .filter((segment) => segment.trackId === track.id)
                  .map((segment) => (
                    <AdvancedSegmentBlock
                      key={segment.id}
                      segment={segment}
                      laneHeight={LANE_HEIGHT}
                      onRequestMove={makeRequestMove(segment.id)}
                    />
                  ))}
              </div>
            ))}
            <div
              data-advanced-playhead
              class="absolute top-2 bottom-0 z-30 w-3 -translate-x-1/2 cursor-ew-resize"
              style={{ left: `${playheadLeft}px` }}
            >
              <div class="pointer-events-none absolute inset-x-0 top-0 bottom-0 flex justify-center">
                <div class="h-full w-0.5 bg-violet-400" />
              </div>
              <div class="pointer-events-none absolute top-0 left-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1 rounded-full bg-violet-400" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
