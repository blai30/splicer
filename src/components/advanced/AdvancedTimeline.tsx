import { useComputed, useSignal } from '@preact/signals'
import clsx from 'clsx/lite'
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Magnet,
  Maximize2,
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

import { AdvancedClipMenu } from '@/components/advanced/AdvancedClipMenu'
import { AdvancedSegmentBlock } from '@/components/advanced/AdvancedSegmentBlock'
import { AdvancedTrackHeaders } from '@/components/advanced/AdvancedTrackHeaders'
import { TimelinePlayhead } from '@/components/TimelinePlayhead'
import { TimeRuler } from '@/components/TimeRuler'
import { useScrollWindow, useTimelineNavigation } from '@/components/useTimelineNavigation'
import { ZoomSlider } from '@/components/ZoomSlider'
import {
  canRedoAdvanced,
  canUndoAdvanced,
  redoAdvanced,
  undoAdvanced,
} from '@/lib/advanced/advancedHistory'
import { seek } from '@/lib/advanced/advancedPlayback'
import {
  clearAdvancedSelection,
  segmentsInRegion,
  setAdvancedSelection,
} from '@/lib/advanced/advancedSelection'
import {
  advancedBlockSpans,
  advancedWheelAction,
  projectDuration,
  TIMELINE_PAD_LEFT,
} from '@/lib/advanced/advancedTimelineDomain'
import {
  cutAdvancedAtPlayhead,
  deleteAdvancedSelected,
  setAdvancedInPoint,
  setAdvancedOutPoint,
  toggleAdvancedMute,
} from '@/lib/advanced/advancedTimelineEditing'
import { laneOverlaps } from '@/lib/advanced/clipEditingDomain'
import {
  advancedActiveTrackId,
  advancedClipDragActive,
  advancedDragPreviewEnd,
  advancedNewTrackTarget,
  advancedPlayhead,
  advancedPlaying,
  advancedSegments,
  advancedSelectedIds,
  advancedSelection,
  advancedSnapEnabled,
  advancedSnapLine,
  advancedTracks,
  pxPerSec,
} from '@/lib/store'
import { createEdgeAutoScroller, createRafThrottler } from '@/lib/timelineDomain'
import { fitZoom, MIN_BLOCK_WIDTH_PX, ZOOM_STEP_FACTOR } from '@/lib/timelineNavigation'

const LANE_HEIGHT = 56
const PAD_LEFT = TIMELINE_PAD_LEFT
// Room kept after the project end when fitting, so the last clip's edge is
// clear of the scroller edge.
const FIT_TRAILING_PX = 24
// A modifier press that moves less than this is a click, not a marquee.
const MARQUEE_MIN_PX = 4

// The marquee rectangle in lane-content pixels (left/top of the lanes box).
type Marquee = { left: number; top: number; width: number; height: number }

export function AdvancedTimeline() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const lanesRef = useRef<HTMLDivElement>(null)
  const stopScrubRef = useRef<(() => void) | null>(null)
  const marquee = useSignal<Marquee | null>(null)

  const tracks = advancedTracks.value
  const segments = advancedSegments.value
  // A dragged clip widens the lanes ahead of itself, so edge auto-scroll can
  // carry it past the committed end with the lanes and drop zones beneath it.
  const duration = Math.max(projectDuration(segments), advancedDragPreviewEnd.value ?? 0)
  const contentWidth = Math.max(600, duration * pxPerSec.value + 200)
  const blockSpans = advancedBlockSpans(segments, pxPerSec.value, MIN_BLOCK_WIDTH_PX)
  // Read only by the playhead leaf and the follow effect, so playback does not
  // re-render the lanes.
  const playheadX = useComputed(() => PAD_LEFT + advancedPlayhead.value * pxPerSec.value)
  const isEmpty = useComputed(() => advancedSegments.value.length === 0)
  const scrollWindow = useScrollWindow(scrollRef)
  const { zoomTo, zoomStep, fit } = useTimelineNavigation({
    scrollRef,
    geometry: {
      timeToX: (time, zoom) => PAD_LEFT + time * zoom,
      xToTime: (x, zoom) => Math.max(0, (x - PAD_LEFT) / zoom),
      fitZoom: (viewWidth) =>
        fitZoom(viewWidth - PAD_LEFT - FIT_TRAILING_PX, projectDuration(segments)),
    },
    playheadX,
    playing: advancedPlaying,
    isEmpty,
  })

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
  function startScrub(event: PointerEvent, container: HTMLElement, keepSelection: boolean) {
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
    // Clicking empty lane space also clears the clip selection; the ruler only seeks.
    if (!keepSelection) clearAdvancedSelection()
    container.addEventListener('pointermove', onMove)
    container.addEventListener('pointerup', onUp)
    container.addEventListener('pointercancel', onUp)
  }

  // Shift- or Ctrl-drag over empty lanes draws a marquee that adds every clip
  // it touches to the selection (live, as it grows).
  function startMarquee(event: PointerEvent, container: HTMLElement, lanes: HTMLElement) {
    container.setPointerCapture(event.pointerId)
    const base = advancedSelection.value
    const origin = { x: event.clientX, y: event.clientY }
    let drawn = false

    function update(clientX: number, clientY: number) {
      const rect = lanes.getBoundingClientRect()
      const left = Math.min(origin.x, clientX) - rect.left
      const right = Math.max(origin.x, clientX) - rect.left
      const top = Math.max(0, Math.min(origin.y, clientY) - rect.top)
      const bottom = Math.min(rect.height, Math.max(origin.y, clientY) - rect.top)
      marquee.value = { left, top, width: right - left, height: Math.max(0, bottom - top) }
      const laneCount = advancedTracks.value.length
      const laneAt = (y: number) =>
        Math.min(laneCount - 1, Math.max(0, Math.floor(y / LANE_HEIGHT)))
      const hits = segmentsInRegion(advancedSegments.value, advancedTracks.value, {
        startTime: (left - PAD_LEFT) / pxPerSec.value,
        endTime: (right - PAD_LEFT) / pxPerSec.value,
        firstLane: laneAt(top),
        lastLane: laneAt(Math.max(top, bottom - 1)),
      })
      const added = hits.filter((id) => !base.ids.includes(id))
      setAdvancedSelection([...base.ids, ...added], added.at(-1) ?? base.primary)
    }
    function onMove(moveEvent: PointerEvent) {
      if (
        !drawn &&
        Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) < MARQUEE_MIN_PX
      ) {
        return
      }
      drawn = true
      update(moveEvent.clientX, moveEvent.clientY)
    }
    function onUp() {
      marquee.value = null
      container.removeEventListener('pointermove', onMove)
      container.removeEventListener('pointerup', onUp)
      container.removeEventListener('pointercancel', onUp)
    }
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
    const lanes = lanesRef.current
    const onLanes = lanes !== null && lanes.contains(target)
    if (onLanes && (event.shiftKey || event.ctrlKey || event.metaKey)) {
      startMarquee(event, event.currentTarget as HTMLElement, lanes)
      return
    }
    startScrub(
      event,
      event.currentTarget as HTMLElement,
      target.closest('[data-time-ruler]') !== null
    )
  }

  // Cancel any pending throttled seek or auto-scroll if we unmount mid-drag.
  useEffect(() => () => stopScrubRef.current?.(), [])

  function onWheel(event: WheelEvent) {
    const scroller = scrollRef.current
    if (!scroller) return
    const rect = scroller.getBoundingClientRect()
    const action = advancedWheelAction({
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      lanesOverflowView: rect.top < 0 || rect.bottom > window.innerHeight,
    })
    if (action === 'native') return
    event.preventDefault()
    if (action === 'zoom') {
      const factor = event.deltaY > 0 ? 1 / ZOOM_STEP_FACTOR : ZOOM_STEP_FACTOR
      zoomTo(pxPerSec.value * factor, event.clientX - rect.left)
      return
    }
    // Shift+wheel arrives as deltaY or, on some platforms, already as deltaX.
    scroller.scrollLeft +=
      Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX
  }

  const selectedIds = new Set(advancedSelectedIds.value)
  const selectedSegments = segments.filter((segment) => selectedIds.has(segment.id))
  const selectedCount = selectedSegments.length
  const toolbarDisabled = selectedCount === 0
  const allMuted = selectedCount > 0 && selectedSegments.every((segment) => segment.muted)
  const activeTrackId = tracks.some((track) => track.id === advancedActiveTrackId.value)
    ? advancedActiveTrackId.value
    : (tracks[0]?.id ?? null)

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
                allMuted
                  ? 'bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400 dark:hover:bg-amber-900/30'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100'
              )}
              disabled={toolbarDisabled}
              onClick={toggleAdvancedMute}
              title="Toggle mute on the selected clips (M)"
              aria-label="Toggle mute on the selected clips"
            >
              <VolumeX class="h-3.5 w-3.5" />
              {allMuted ? 'Unmute' : 'Mute'}
            </button>
            <button
              class="flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100/50 hover:text-red-700 hover:duration-0 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-900/30 dark:hover:text-red-300"
              disabled={toolbarDisabled}
              onClick={deleteAdvancedSelected}
              title="Delete the selected clips (Delete, Shift+Delete to close the gap)"
              aria-label="Delete the selected clips"
            >
              <Trash2 class="h-3.5 w-3.5" />
              Delete
            </button>
            {selectedCount > 1 && (
              <span
                data-advanced-selection-count
                class="rounded-full bg-violet-500/10 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:text-violet-300"
              >
                {selectedCount} selected
              </span>
            )}
          </div>
          <div class="flex shrink-0 items-center gap-2 md:gap-3">
            <button
              onClick={() => fit()}
              disabled={isEmpty.value}
              class="text-slate-400 transition-colors hover:text-slate-600 hover:duration-0 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-500 dark:hover:text-slate-300"
              title="Fit timeline to view (Shift+Z)"
              aria-label="Fit timeline to view"
            >
              <Maximize2 class="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => zoomStep(-1)}
              class="text-slate-400 transition-colors hover:text-slate-600 hover:duration-0 dark:text-slate-500 dark:hover:text-slate-300"
              title="Zoom out"
              aria-label="Zoom out"
            >
              <ZoomOut class="h-3.5 w-3.5" />
            </button>
            <ZoomSlider
              class="w-16 md:w-28"
              value={pxPerSec.value}
              onChange={(zoom) => zoomTo(zoom)}
            />
            <button
              onClick={() => zoomStep(1)}
              class="text-slate-400 transition-colors hover:text-slate-600 hover:duration-0 dark:text-slate-500 dark:hover:text-slate-300"
              title="Zoom in"
              aria-label="Zoom in"
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
          <div style={{ width: `${contentWidth}px` }}>
            {/* Ruler row, as tall as the headers' Add-track button row. While a
                clip is dragged, the new-track drop zone covers it. */}
            <div class="relative h-7">
              <TimeRuler
                class="absolute inset-y-0 left-0"
                width={contentWidth}
                pxPerSec={pxPerSec.value}
                endTime={(contentWidth - PAD_LEFT) / pxPerSec.value}
                timeToX={(time) => PAD_LEFT + time * pxPerSec.value}
                xToTime={(x) => (x - PAD_LEFT) / pxPerSec.value}
                scrollWindow={scrollWindow}
              />
              {advancedClipDragActive.value && (
                <div class="absolute inset-0 flex items-stretch bg-slate-50 py-0.5 dark:bg-slate-900">
                  <NewTrackDropZone active={advancedNewTrackTarget.value === 'top'} />
                </div>
              )}
            </div>
            <div ref={lanesRef} data-advanced-lanes class="relative">
              {tracks.map((track) => (
                <div
                  key={track.id}
                  class={clsx(
                    'relative border-b border-slate-200/40 dark:border-slate-700/40',
                    track.id === activeTrackId && 'bg-violet-500/5'
                  )}
                  style={{ height: `${LANE_HEIGHT}px` }}
                >
                  {/* Hatched where clips on this track play over each other; the
                      later clip draws on top. */}
                  {laneOverlaps(segments, track.id).map((overlap) => (
                    <div
                      key={overlap.start}
                      data-advanced-overlap
                      title="Clips overlap here; the later one in the track draws on top"
                      class="pointer-events-none absolute top-1 bottom-1 z-26 rounded-sm bg-[repeating-linear-gradient(135deg,rgb(0_0_0/0.35)_0_0.25rem,transparent_0.25rem_0.5rem)] ring-1 ring-amber-300/70"
                      style={{
                        left: `${PAD_LEFT + overlap.start * pxPerSec.value}px`,
                        width: `${(overlap.end - overlap.start) * pxPerSec.value}px`,
                      }}
                    />
                  ))}
                  {segments
                    .filter((segment) => segment.trackId === track.id)
                    .map((segment) => {
                      const span = blockSpans.get(segment.id)
                      return (
                        <AdvancedSegmentBlock
                          key={segment.id}
                          segment={segment}
                          laneHeight={LANE_HEIGHT}
                          width={span?.width ?? 0}
                          raised={span?.raised ?? false}
                          scrollWindow={scrollWindow}
                        />
                      )
                    })}
                </div>
              ))}
              {marquee.value && (
                <div
                  data-advanced-marquee
                  class="pointer-events-none absolute z-45 rounded-sm border border-violet-400 bg-violet-400/10"
                  style={{
                    left: `${marquee.value.left}px`,
                    top: `${marquee.value.top}px`,
                    width: `${marquee.value.width}px`,
                    height: `${marquee.value.height}px`,
                  }}
                />
              )}
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
            <TimelinePlayhead data-advanced-playhead class="top-2" x={playheadX} />
          </div>
        </div>
      </div>
      <AdvancedClipMenu />
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
