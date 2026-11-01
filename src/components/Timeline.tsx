import { useComputed } from '@preact/signals'
import clsx from 'clsx/lite'
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Maximize2,
  Scissors,
  Plus,
  Redo2,
  Trash2,
  Undo2,
  Upload,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-preact'
import { useEffect, useRef } from 'preact/hooks'

import { SegmentBlock } from '@/components/SegmentBlock'
import { TimelinePlayhead } from '@/components/TimelinePlayhead'
import { TimeRuler } from '@/components/TimeRuler'
import { useScrollWindow, useTimelineNavigation } from '@/components/useTimelineNavigation'
import { ZoomSlider } from '@/components/ZoomSlider'
import { seek } from '@/lib/playback'
import {
  GAP_PX,
  PADDING_PX,
  ZOOM_MAX,
  ZOOM_MIN,
  dragState,
  playheadTime,
  playing,
  pxPerSec,
  selectedSegmentId,
  timeline,
} from '@/lib/store'
import {
  buildSegmentLayout,
  createEdgeAutoScroller,
  createPlayheadDragHandler,
  createRafThrottler,
  createTrackSeekHandler,
  cutMarkerXs,
  globalTimeToSegment,
  globalTimeToX,
  layoutDuration,
  playheadXInLayout,
  viewportToTrackX,
  xToGlobalTime,
} from '@/lib/timelineDomain'
import {
  canRedo,
  canUndo,
  cutAtPlayhead,
  deleteSegment,
  redo,
  setInPoint,
  setOutPoint,
  toggleMute,
  undo,
} from '@/lib/timelineEditing'
import { fitZoom, MIN_BLOCK_WIDTH_PX, ZOOM_STEP_FACTOR } from '@/lib/timelineNavigation'
import type { Segment } from '@/lib/types'
import { FILE_INPUT_ACCEPT, importFiles } from '@/lib/videoImport'

function layoutAt(segments: Segment[], zoom: number) {
  return buildSegmentLayout(segments, zoom, GAP_PX, PADDING_PX, MIN_BLOCK_WIDTH_PX)
}

// The zoom box shows a decimal only where it matters (below 10 px/s).
function formatZoom(zoom: number): string {
  return zoom < 10 ? String(Math.round(zoom * 10) / 10) : String(Math.round(zoom))
}

export function Timeline() {
  const trackRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const trackSeekHandlerRef = useRef<ReturnType<typeof createTrackSeekHandler> | null>(null)
  const playheadDragHandlerRef = useRef<ReturnType<typeof createPlayheadDragHandler> | null>(null)
  const stopRulerScrubRef = useRef<(() => void) | null>(null)

  const layoutSignal = useComputed(() => layoutAt(timeline.value, pxPerSec.value))
  // Read only by the playhead leaf and the follow effect: the timeline itself
  // must not subscribe to the per-frame playhead time.
  const playheadX = useComputed(() =>
    playheadXInLayout(
      layoutSignal.value,
      selectedSegmentId.value ?? timeline.value[0]?.id,
      playheadTime.value,
      PADDING_PX
    )
  )
  const isEmpty = useComputed(() => timeline.value.length === 0)
  const layout = layoutSignal.value
  const segments = timeline.value
  const totalDuration = layoutDuration(layout)
  const scrollWindow = useScrollWindow(trackRef)
  const { zoomTo, zoomStep, fit } = useTimelineNavigation({
    scrollRef: trackRef,
    geometry: {
      timeToX: (time, zoom) => globalTimeToX(layoutAt(segments, zoom), time),
      xToTime: (x, zoom) => xToGlobalTime(layoutAt(segments, zoom), x),
      fitZoom: (viewWidth) =>
        fitZoom(
          viewWidth - 2 * PADDING_PX - GAP_PX * Math.max(0, segments.length - 1),
          totalDuration
        ),
    },
    playheadX,
    playing,
    isEmpty,
  })

  function activeLayoutItem() {
    const activeId = selectedSegmentId.value ?? timeline.value[0]?.id
    return layoutSignal.value.find((entry) => entry.segment.id === activeId)
  }

  // Seek on the concatenated timeline: the ruler spans every segment, so a
  // scrub can cross cuts, selecting whichever segment is under the pointer.
  function seekAtClientX(track: HTMLElement, clientX: number) {
    const current = layoutSignal.value
    const x = viewportToTrackX(clientX, track.getBoundingClientRect(), track.scrollLeft)
    const hit = globalTimeToSegment(current, xToGlobalTime(current, x))
    if (!hit) return
    selectedSegmentId.value = hit.segment.id
    seek(hit.time)
  }

  function startRulerScrub(event: PointerEvent, track: HTMLElement) {
    seekAtClientX(track, event.clientX)
    track.setPointerCapture(event.pointerId)
    const throttler = createRafThrottler()
    let lastClientX = event.clientX
    // Scrubbing past an edge keeps scrolling and seeking at the held position.
    const autoScroll = createEdgeAutoScroller(track, () =>
      throttler.queue(() => seekAtClientX(track, lastClientX))
    )
    function stop() {
      throttler.cancel()
      autoScroll.stop()
      stopRulerScrubRef.current = null
      track.removeEventListener('pointermove', onMove)
      track.removeEventListener('pointerup', onUp)
      track.removeEventListener('pointercancel', stop)
    }
    function onMove(moveEvent: PointerEvent) {
      lastClientX = moveEvent.clientX
      throttler.queue(() => seekAtClientX(track, moveEvent.clientX))
      autoScroll.update(moveEvent.clientX)
    }
    function onUp(upEvent: PointerEvent) {
      stop()
      seekAtClientX(track, upEvent.clientX)
    }
    stopRulerScrubRef.current = stop
    track.addEventListener('pointermove', onMove)
    track.addEventListener('pointerup', onUp)
    track.addEventListener('pointercancel', stop)
  }

  function onTrackPointerDown(event: PointerEvent) {
    if (!trackRef.current) return
    if (timeline.value.length === 0) return
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    // Ignore clicks on playhead and segment containers
    if (target.closest('[data-playhead]')) return
    if (target.closest('[data-segment]')) return
    if (target.closest('[data-time-ruler]')) {
      startRulerScrub(event, trackRef.current)
      return
    }

    // Create and cache handler for this drag session
    trackSeekHandlerRef.current = createTrackSeekHandler({
      layout: layoutSignal.value,
      trackElement: trackRef.current,
      onSeek(segmentId, time) {
        selectedSegmentId.value = segmentId
        seek(time)
      },
    })

    trackSeekHandlerRef.current.onPointerDown(event)
  }

  function onPlayheadPointerDown(event: PointerEvent) {
    const activeLayout = activeLayoutItem()
    if (!activeLayout || !trackRef.current) return

    // Create and cache handler for this drag session using precomputed layout
    playheadDragHandlerRef.current = createPlayheadDragHandler({
      item: activeLayout,
      trackElement: trackRef.current,
      onUpdate(time) {
        seek(time)
      },
    })

    playheadDragHandlerRef.current.onPointerDown(event)
  }

  function applyZoomInput(input: HTMLInputElement) {
    const raw = input.value.trim()
    const value = Number(raw)
    if (raw !== '' && Number.isFinite(value)) zoomTo(value)
    // Always show the zoom actually in effect (clamped, or unchanged on bad input).
    input.value = formatZoom(pxPerSec.value)
  }

  // Cleanup any pending drag handlers on unmount
  useEffect(
    () => () => {
      trackSeekHandlerRef.current?.cleanup()
      playheadDragHandlerRef.current?.cleanup()
      stopRulerScrubRef.current?.()
    },
    []
  )

  function onWheel(event: WheelEvent) {
    if (!trackRef.current) return
    if (event.ctrlKey) {
      event.preventDefault()
      const rect = trackRef.current.getBoundingClientRect()
      const anchorX = event.clientX - rect.left
      const factor = event.deltaY > 0 ? 1 / ZOOM_STEP_FACTOR : ZOOM_STEP_FACTOR
      zoomTo(pxPerSec.value * factor, anchorX)
    } else if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      event.preventDefault()
      trackRef.current.scrollLeft += event.deltaY
    }
  }

  async function onFileInputChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const files = Array.from(input.files ?? [])
    input.value = ''
    await importFiles(files)
  }

  const selectedSegment = timeline.value.find((segment) => segment.id === selectedSegmentId.value)
  const disabled = !selectedSegment

  return (
    <div
      class="relative flex h-64 shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200/60 bg-slate-50/40 backdrop-blur transition-colors hover:duration-0 md:h-48 dark:border-slate-700/60 dark:bg-slate-900/40"
      onWheel={onWheel}
    >
      {/* Header */}
      <div class="flex shrink-0 flex-col gap-y-1.5 px-4 pt-3 pb-2 md:flex-row md:items-start md:gap-x-2.5">
        <span class="text-sm font-semibold tracking-wider text-slate-500 uppercase md:pt-1 dark:text-slate-400">
          Timeline
        </span>
        <div class="flex items-start gap-2.5 md:flex-1">
          <div class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <button
              class="flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-semibold text-violet-600 transition-colors hover:bg-violet-100/60 hover:duration-0 dark:text-violet-300 dark:hover:bg-violet-900/30"
              onClick={() => fileInputRef.current?.click()}
              title="Add video files to the end of the timeline"
            >
              <Plus class="h-3.5 w-3.5" />
              Add
            </button>
            <button
              class="flex items-center justify-center rounded p-1.5 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 hover:duration-0 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100"
              disabled={!canUndo.value}
              onClick={undo}
              title="Undo (Ctrl+Z)"
              aria-label="Undo"
            >
              <Undo2 class="h-3.5 w-3.5" />
            </button>
            <button
              class="flex items-center justify-center rounded p-1.5 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 hover:duration-0 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100"
              disabled={!canRedo.value}
              onClick={redo}
              title="Redo (Ctrl+Shift+Z)"
              aria-label="Redo"
            >
              <Redo2 class="h-3.5 w-3.5" />
            </button>
            <span class="mx-0.5 h-4 w-px bg-slate-300 dark:bg-slate-700" aria-hidden="true" />
            <button
              class="flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 hover:duration-0 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100"
              disabled={disabled}
              onClick={setInPoint}
              title="Set in-point (I)"
              aria-label="Set segment in-point at current playhead position"
            >
              <ArrowLeftToLine class="h-3.5 w-3.5" />
              In
            </button>

            <button
              class="flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 hover:duration-0 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100"
              disabled={disabled}
              onClick={setOutPoint}
              title="Set out-point (O)"
              aria-label="Set segment out-point at current playhead position"
            >
              <ArrowRightToLine class="h-3.5 w-3.5" />
              Out
            </button>

            <button
              class="flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 hover:duration-0 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100"
              disabled={disabled}
              onClick={cutAtPlayhead}
              title="Split at playhead (C)"
              aria-label="Split segment at current playhead position"
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
              disabled={disabled}
              onClick={toggleMute}
              title="Toggle mute on selected segment (M)"
              aria-label="Toggle mute on selected segment"
            >
              <VolumeX class="h-3.5 w-3.5" />
              {selectedSegment?.muted ? 'Unmute' : 'Mute'}
            </button>

            <button
              class="flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100/50 hover:text-red-700 hover:duration-0 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-900/30 dark:hover:text-red-300"
              disabled={disabled}
              onClick={deleteSegment}
              title="Delete segment (Delete)"
              aria-label="Delete selected segment"
            >
              <Trash2 class="h-3.5 w-3.5" />
              Delete
            </button>
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
            <div class="relative hidden sm:block">
              <input
                type="number"
                min={ZOOM_MIN}
                max={ZOOM_MAX}
                step="any"
                value={formatZoom(pxPerSec.value)}
                onBlur={(event) => applyZoomInput(event.currentTarget as HTMLInputElement)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') applyZoomInput(event.currentTarget as HTMLInputElement)
                }}
                class="w-20 rounded border border-slate-300 bg-white px-1.5 py-0.5 pr-8 text-sm text-slate-700 outline-none focus:border-violet-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 [&]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                title="Zoom level (pixels per second)"
                aria-label="Zoom level in pixels per second"
              />
              <span class="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-xs text-slate-500 dark:text-slate-500">
                px/s
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Track */}
      <div
        ref={trackRef}
        data-track
        role="region"
        aria-label="Timeline scrubber - click to seek, drag edges to trim segments"
        class="relative min-h-0 flex-1 scrollbar-thin scrollbar-thumb-slate-400 scrollbar-track-transparent overflow-x-auto overflow-y-hidden dark:scrollbar-thumb-slate-700"
        onPointerDown={onTrackPointerDown}
      >
        {isEmpty.value ? (
          <div class="flex h-full items-center justify-center px-4 md:pb-5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              class="flex min-h-24 w-full max-w-lg items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50/50 px-5 py-4 text-center text-slate-500 transition-colors hover:border-violet-400 hover:text-violet-600 hover:duration-0 focus-visible:border-violet-400 focus-visible:outline-none dark:border-slate-600 dark:bg-slate-800/20 dark:text-slate-400 dark:hover:text-violet-300"
            >
              <Upload class="h-4 w-4" />
              <span class="text-base">Click or drop video files to import</span>
            </button>
          </div>
        ) : (
          <div class="relative flex h-full items-start gap-1 px-4 pt-12">
            <TimeRuler
              class="absolute top-0 left-0 h-7"
              width={(layout.at(-1)?.endX ?? 0) + PADDING_PX}
              pxPerSec={pxPerSec.value}
              endTime={totalDuration}
              timeToX={(time) => globalTimeToX(layout, time)}
              xToTime={(x) => xToGlobalTime(layout, x)}
              scrollWindow={scrollWindow}
              markerXs={cutMarkerXs(layout, GAP_PX)}
            />
            {(() => {
              const dragStateValue = dragState.value
              const fromIndex = dragStateValue
                ? segments.findIndex((segment) => segment.id === dragStateValue.segmentId)
                : -1
              const result = []
              for (let i = 0; i < segments.length; i++) {
                if (
                  dragStateValue &&
                  dragStateValue.dropIndex === i &&
                  fromIndex !== i &&
                  fromIndex + 1 !== i
                ) {
                  result.push(
                    <div
                      key={`drop-${i}`}
                      class="pointer-events-none w-1 shrink-0 self-stretch rounded-full bg-violet-400"
                    />
                  )
                }
                const item = layout[i]
                result.push(
                  <SegmentBlock
                    key={segments[i].id}
                    segment={segments[i]}
                    isDragging={dragStateValue?.segmentId === segments[i].id}
                    startX={item.startX}
                    width={item.endX - item.startX}
                  />
                )
              }
              if (
                dragStateValue &&
                dragStateValue.dropIndex === segments.length &&
                fromIndex !== segments.length - 1
              ) {
                result.push(
                  <div
                    key="drop-last"
                    class="pointer-events-none w-1 shrink-0 self-stretch rounded-full bg-violet-400"
                  />
                )
              }
              return result
            })()}
            <TimelinePlayhead
              data-playhead
              class="top-0"
              x={playheadX}
              onPointerDown={onPlayheadPointerDown}
            />
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={FILE_INPUT_ACCEPT}
        multiple
        class="hidden"
        onChange={onFileInputChange}
        aria-label="Select video files to import into timeline"
      />
    </div>
  )
}
