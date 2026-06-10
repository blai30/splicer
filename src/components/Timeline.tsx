import { useSignal } from '@preact/signals'
import clsx from 'clsx/lite'
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Scissors,
  Trash2,
  Upload,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-preact'
import { useEffect, useRef } from 'preact/hooks'

import { SegmentBlock } from '@/components/SegmentBlock'
import { ZoomSlider } from '@/components/ZoomSlider'
import { seek } from '@/lib/playback'
import {
  GAP_PX,
  PADDING_PX,
  ZOOM_MAX,
  ZOOM_MIN,
  dragState,
  playheadTime,
  pxPerSec,
  selectedSegmentId,
  timeline,
} from '@/lib/store'
import {
  computeZoomScroll,
  createPlayheadDragHandler,
  buildSegmentLayout,
  createTrackSeekHandler,
} from '@/lib/timelineDomain'
import {
  cutAtPlayhead,
  deleteSegment,
  setInPoint,
  setOutPoint,
  toggleMute,
} from '@/lib/timelineEditing'
import { importAndAppend } from '@/lib/videoImport'

const ZOOM_SCALE_FACTOR = 1.25

export function Timeline() {
  const trackRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const draggingOver = useSignal(false)
  const dragDepthRef = useRef(0)
  const trackSeekHandlerRef = useRef<ReturnType<typeof createTrackSeekHandler> | null>(null)
  const playheadDragHandlerRef = useRef<ReturnType<typeof createPlayheadDragHandler> | null>(null)

  const activeSegmentId = selectedSegmentId.value ?? timeline.value[0]?.id
  const segments = timeline.value
  // Build layout once per render to avoid repeated O(n) scans.
  const layout = buildSegmentLayout(segments, pxPerSec.value, GAP_PX, PADDING_PX)
  const activeLayout = layout.find((layoutItem) => layoutItem.segment.id === activeSegmentId)
  const playheadLeft = activeLayout
    ? activeLayout.startX + (playheadTime.value - activeLayout.segment.startTime) * pxPerSec.value
    : PADDING_PX

  function onTrackPointerDown(event: PointerEvent) {
    if (!trackRef.current) return
    if (timeline.value.length === 0) return
    // Ignore clicks on playhead and segment containers
    if ((event.target as HTMLElement).closest('[data-playhead]')) return
    if ((event.target as HTMLElement).closest('[data-segment]')) return

    // Create and cache handler for this drag session
    trackSeekHandlerRef.current = createTrackSeekHandler({
      timeline: timeline.value,
      pxPerSec: pxPerSec.value,
      padding: PADDING_PX,
      gap: GAP_PX,
      trackElement: trackRef.current,
      onSeek(segmentId, time) {
        selectedSegmentId.value = segmentId
        seek(time)
      },
    })

    trackSeekHandlerRef.current.onPointerDown(event)
  }

  function onPlayheadPointerDown(event: PointerEvent) {
    if (!activeLayout || !trackRef.current) return

    // Create and cache handler for this drag session using precomputed layout
    playheadDragHandlerRef.current = createPlayheadDragHandler({
      segment: activeLayout.segment,
      segmentStartX: activeLayout.startX,
      pxPerSec: pxPerSec.value,
      trackElement: trackRef.current,
      onUpdate(time) {
        seek(time)
      },
    })

    playheadDragHandlerRef.current.onPointerDown(event)
  }

  function zoomTo(newPx: number, anchorX?: number) {
    const track = trackRef.current
    if (!track) return
    const oldPx = pxPerSec.value
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newPx))

    if (anchorX !== undefined) {
      // Keep cursor position fixed while zooming: scroll offset adjusted by scale ratio
      track.scrollLeft = computeZoomScroll(oldPx, clamped, anchorX, track.scrollLeft, PADDING_PX)
    }

    pxPerSec.value = clamped
  }

  // Cleanup any pending drag handlers on unmount
  useEffect(
    () => () => {
      trackSeekHandlerRef.current?.cleanup()
      playheadDragHandlerRef.current?.cleanup()
    },
    []
  )

  function onWheel(event: WheelEvent) {
    if (!trackRef.current) return
    if (event.ctrlKey) {
      event.preventDefault()
      const rect = trackRef.current.getBoundingClientRect()
      const anchorX = event.clientX - rect.left
      const factor = event.deltaY > 0 ? 1 / ZOOM_SCALE_FACTOR : ZOOM_SCALE_FACTOR
      zoomTo(pxPerSec.value * factor, anchorX)
    } else if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      event.preventDefault()
      trackRef.current.scrollLeft += event.deltaY
    }
  }

  // Make the whole window a drop target for video import. A depth counter
  // tracks nested dragenter/dragleave pairs so the overlay does not flicker
  // when the cursor moves between child elements.
  useEffect(() => {
    function hasFiles(event: DragEvent) {
      return [...(event.dataTransfer?.items ?? [])].some((item) => item.kind === 'file')
    }

    function onDragEnter(event: DragEvent) {
      if (!hasFiles(event)) return
      dragDepthRef.current += 1
      draggingOver.value = true
    }

    function onDragOver(event: DragEvent) {
      if (!hasFiles(event)) return
      // Allow drop by cancelling the default handling of the dragover event.
      event.preventDefault()
    }

    function onDragLeave() {
      if (dragDepthRef.current === 0) return
      dragDepthRef.current -= 1
      if (dragDepthRef.current === 0) draggingOver.value = false
    }

    async function onDrop(event: DragEvent) {
      event.preventDefault()
      dragDepthRef.current = 0
      draggingOver.value = false
      const files = Array.from(event.dataTransfer?.files ?? [])
      for (const file of files) await importAndAppend(file)
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  async function onFileInputChange(event: Event) {
    const files = Array.from((event.target as HTMLInputElement).files ?? [])
    for (const file of files) await importAndAppend(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const isEmpty = timeline.value.length === 0
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
              title="Delete segment"
              aria-label="Delete selected segment"
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
            <div class="relative hidden sm:block">
              <input
                type="number"
                min={ZOOM_MIN}
                max={ZOOM_MAX}
                value={Math.round(pxPerSec.value)}
                onBlur={(event) => zoomTo(Number((event.currentTarget as HTMLInputElement).value))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter')
                    zoomTo(Number((event.currentTarget as HTMLInputElement).value))
                }}
                class="w-14 rounded border border-slate-300 bg-white px-1.5 py-0.5 pr-5 text-sm text-slate-700 outline-none focus:border-violet-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 [&]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                title="Zoom level (px/sec)"
              />
              <span class="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-xs text-slate-500 dark:text-slate-500">
                %
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
        {isEmpty ? (
          <div
            class="flex h-full cursor-pointer items-center justify-center gap-2 px-4 md:pb-5"
            onClick={() => fileInputRef.current?.click()}
          >
            <div class="flex min-h-24 w-full max-w-lg items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50/50 px-5 py-4 text-center text-slate-500 transition-colors hover:duration-0 dark:border-slate-600 dark:bg-slate-800/20 dark:text-slate-400">
              <Upload class="h-4 w-4" />
              <p class="text-base">Click or drop video files to import</p>
            </div>
          </div>
        ) : (
          <div class="relative flex h-full items-start gap-1 px-4 pt-12">
            {(() => {
              const dragStateValue = dragState.value
              const segments = timeline.value
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
            <div
              data-playhead
              class="absolute top-0 bottom-0 z-30 w-3 -translate-x-1/2 cursor-ew-resize"
              style={{ left: `${playheadLeft}px` }}
              onPointerDown={onPlayheadPointerDown}
            >
              <div class="pointer-events-none absolute inset-x-0 top-0 bottom-0 flex justify-center">
                <div class="h-full w-0.5 bg-violet-400" />
              </div>
              <div class="pointer-events-none absolute top-0 left-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1 rounded-full bg-violet-400" />
            </div>
          </div>
        )}
      </div>

      {/* Full-window drop overlay: the entire window is a drop target for import */}
      {draggingOver.value && (
        <div class="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-sm">
          <div class="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-violet-400 bg-white/80 px-10 py-8 text-center shadow-xl dark:bg-slate-900/80">
            <Upload class="h-7 w-7 text-violet-500" />
            <p class="text-lg font-semibold text-violet-600 dark:text-violet-300">
              Drop video files to import
            </p>
          </div>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,.mp4,.mkv,.mov,.webm"
        multiple
        class="hidden"
        onChange={onFileInputChange}
        aria-label="Select video files to import into timeline"
      />
    </div>
  )
}
