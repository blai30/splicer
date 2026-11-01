import clsx from 'clsx/lite'
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Magnet,
  Plus,
  Redo2,
  Scissors,
  Trash2,
  Undo2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-preact'
import { useEffect, useRef } from 'preact/hooks'

import { AdvancedSegmentBlock } from '@/components/advanced/AdvancedSegmentBlock'
import { AdvancedTrackHeaders } from '@/components/advanced/AdvancedTrackHeaders'
import { ZoomSlider } from '@/components/ZoomSlider'
import {
  canRedoAdvanced,
  canUndoAdvanced,
  redoAdvanced,
  undoAdvanced,
} from '@/lib/advanced/advancedHistory'
import { seek } from '@/lib/advanced/advancedPlayback'
import { projectDuration, TIMELINE_PAD_LEFT } from '@/lib/advanced/advancedTimelineDomain'
import {
  cutAdvancedAtPlayhead,
  deleteAdvancedSelected,
  setAdvancedInPoint,
  setAdvancedOutPoint,
  toggleAdvancedMute,
} from '@/lib/advanced/advancedTimelineEditing'
import {
  advancedClipDragActive,
  advancedDragPreviewEnd,
  advancedNewTrackTarget,
  advancedPlayhead,
  advancedSegments,
  advancedSelectedId,
  advancedSnapEnabled,
  advancedSnapLine,
  advancedTracks,
  pxPerSec,
  ZOOM_MAX,
  ZOOM_MIN,
} from '@/lib/store'
import { computeZoomScroll, createEdgeAutoScroller, createRafThrottler } from '@/lib/timelineDomain'

const LANE_HEIGHT = 56
const PAD_LEFT = TIMELINE_PAD_LEFT
const ZOOM_SCALE_FACTOR = 1.25

export function AdvancedTimeline() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stopScrubRef = useRef<(() => void) | null>(null)

  const tracks = advancedTracks.value
  const segments = advancedSegments.value
  // A dragged clip widens the lanes ahead of itself, so edge auto-scroll can
  // carry it past the committed end with the lanes and drop zones beneath it.
  const duration = Math.max(projectDuration(segments), advancedDragPreviewEnd.value ?? 0)
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
    let lastClientX = event.clientX
    // Scrubbing past an edge keeps scrolling and seeking at the held position.
    const autoScroll = createEdgeAutoScroller(container, () =>
      throttler.queue(() => seek(timeFromClientX(lastClientX)))
    )
    stopScrubRef.current = () => {
      throttler.cancel()
      autoScroll.stop()
    }

    function onMove(moveEvent: PointerEvent) {
      lastClientX = moveEvent.clientX
      throttler.queue(() => seek(timeFromClientX(moveEvent.clientX)))
      autoScroll.update(moveEvent.clientX)
    }
    function onUp(upEvent: PointerEvent) {
      throttler.cancel()
      autoScroll.stop()
      stopScrubRef.current = null
      // Commit a final seek at the release point so a fast flick (whose last
      // throttled move was canceled above) still lands the playhead precisely.
      seek(timeFromClientX(upEvent.clientX))
      container.removeEventListener('pointermove', onMove)
      container.removeEventListener('pointerup', onUp)
      container.removeEventListener('pointercancel', onUp)
    }
    // Clicking empty lane space also clears the clip selection.
    advancedSelectedId.value = null
    container.addEventListener('pointermove', onMove)
    container.addEventListener('pointerup', onUp)
    container.addEventListener('pointercancel', onUp)
  }

  function onTrackPointerDown(event: PointerEvent) {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    // Clip blocks handle their own drag/trim/selection; a press anywhere else
    // (blank lane or the playhead) scrubs the playhead from that point.
    if (target.closest('[data-advanced-segment]')) return
    startScrub(event, event.currentTarget as HTMLElement)
  }

  // Cancel any pending throttled seek or auto-scroll if we unmount mid-drag.
  useEffect(() => () => stopScrubRef.current?.(), [])

  function zoomTo(newPx: number, anchorX?: number) {
    const scroller = scrollRef.current
    if (!scroller) return
    const oldPx = pxPerSec.value
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newPx))
    if (clamped === oldPx) return
    // Apply the anchored scroll after the re-render widens the lanes; set now,
    // the browser would clamp it to the old scroll range.
    const target =
      anchorX === undefined
        ? null
        : computeZoomScroll(oldPx, clamped, anchorX, scroller.scrollLeft, PAD_LEFT)
    pxPerSec.value = clamped
    if (target !== null) requestAnimationFrame(() => (scroller.scrollLeft = Math.max(0, target)))
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
              class="flex items-center justify-center rounded p-1.5 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 hover:duration-0 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100"
              disabled={!canUndoAdvanced.value}
              onClick={undoAdvanced}
              title="Undo (Ctrl+Z)"
              aria-label="Undo"
            >
              <Undo2 class="h-3.5 w-3.5" />
            </button>
            <button
              class="flex items-center justify-center rounded p-1.5 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 hover:duration-0 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100"
              disabled={!canRedoAdvanced.value}
              onClick={redoAdvanced}
              title="Redo (Ctrl+Shift+Z)"
              aria-label="Redo"
            >
              <Redo2 class="h-3.5 w-3.5" />
            </button>
            <button
              class={clsx(
                'flex items-center justify-center rounded p-1.5 transition-colors hover:duration-0',
                advancedSnapEnabled.value
                  ? 'bg-violet-500/10 text-violet-600 hover:bg-violet-500/20 dark:text-violet-300'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100'
              )}
              onClick={() => (advancedSnapEnabled.value = !advancedSnapEnabled.value)}
              aria-pressed={advancedSnapEnabled.value}
              title="Snap clips to edges and the playhead (S, hold Alt while dragging to skip)"
              aria-label="Snapping"
            >
              <Magnet class="h-3.5 w-3.5" />
            </button>
            <span class="mx-0.5 h-4 w-px bg-slate-300 dark:bg-slate-700" aria-hidden="true" />
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
              title="Delete clip (Delete)"
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
          data-advanced-scroller
          onWheel={onWheel}
          class="relative min-h-0 flex-1 scrollbar-thin scrollbar-thumb-slate-400 scrollbar-track-transparent overflow-x-auto dark:scrollbar-thumb-slate-700"
          onPointerDown={onTrackPointerDown}
        >
          {/* spacer matching the headers' Add-track button row */}
          <div style={{ width: `${contentWidth}px` }}>
            <div class="flex h-7 items-stretch py-0.5">
              {advancedClipDragActive.value && (
                <NewTrackDropZone active={advancedNewTrackTarget.value === 'top'} />
              )}
            </div>
            <div data-advanced-lanes>
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
                      />
                    ))}
                </div>
              ))}
            </div>
            {advancedClipDragActive.value && (
              <div class="flex h-7 items-stretch py-0.5">
                <NewTrackDropZone active={advancedNewTrackTarget.value === 'bottom'} />
              </div>
            )}
            {segments.length === 0 && (
              <p class="pointer-events-none absolute top-9 left-4 text-sm text-slate-500 dark:text-slate-400">
                Drop video files anywhere, or use Add video above, to place clips here.
              </p>
            )}
            {advancedSnapLine.value !== null && (
              <div
                data-advanced-snap-line
                class="pointer-events-none absolute top-7 bottom-0 z-35 w-px -translate-x-1/2 bg-amber-400"
                style={{ left: `${PAD_LEFT + advancedSnapLine.value * pxPerSec.value}px` }}
              />
            )}
            <div
              data-advanced-playhead
              class="absolute top-2 bottom-0 z-30 w-3 -translate-x-1/2 cursor-ew-resize touch-none"
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

// Dashed target shown above the first lane and below the last while a clip is
// dragged; dropping there creates a track in that position.
function NewTrackDropZone({ active }: { active: boolean }) {
  return (
    <div
      data-advanced-new-track-zone
      class={clsx(
        'pointer-events-none flex w-full items-center rounded border-2 border-dashed text-sm transition-colors',
        active
          ? 'border-violet-400 bg-violet-400/15 text-violet-700 dark:text-violet-200'
          : 'border-violet-400/60 text-slate-500 dark:text-slate-400'
      )}
    >
      {/* Sticky so the label stays in view however far the lanes are scrolled. */}
      <span class="sticky left-2 flex items-center gap-1 px-2">
        <Plus class="h-3.5 w-3.5" />
        New track
      </span>
    </div>
  )
}
