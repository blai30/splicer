import { useSignal } from '@preact/signals'
import clsx from 'clsx/lite'
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Scissors,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-preact'
import { useEffect, useRef } from 'preact/hooks'

import { SegmentBlock } from '@/components/SegmentBlock'
import { ZoomSlider } from '@/components/ZoomSlider'
import { cutAtPlayhead, deleteSegment, setInPoint, setOutPoint, toggleMute } from '@/lib/actions'
import { playheadTime, selectedSegmentId, timeline, videoEl } from '@/lib/store'
import {
  buildSegmentLayout,
  clampPlayheadForSegment,
  findSegmentAtTrackX,
} from '@/lib/timelineDomain'
import {
  GAP_PX,
  PADDING_PX,
  ZOOM_MAX,
  ZOOM_MIN,
  dragState,
  getSegmentStartX,
  pxPerSec,
} from '@/lib/timelineState'
import { importAndAppend } from '@/lib/videoImport'

export function Timeline() {
  const trackRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const draggingOver = useSignal(false)
  const seekRafRef = useRef<number | null>(null)
  const playheadRafRef = useRef<number | null>(null)

  const activeSegId = selectedSegmentId.value ?? timeline.value[0]?.id
  const activeSeg = timeline.value.find((s) => s.id === activeSegId)
  const playheadLeft = activeSeg
    ? getSegmentStartX(activeSeg.id) + (playheadTime.value - activeSeg.startTime) * pxPerSec.value
    : PADDING_PX

  function onTrackPointerDown(e: PointerEvent) {
    if (!trackRef.current) return
    if (timeline.value.length === 0) return
    if ((e.target as HTMLElement).closest('[data-playhead]')) return
    if ((e.target as HTMLElement).closest('[data-segment]')) return
    const trackEl = trackRef.current
    const layout = buildSegmentLayout(timeline.value, pxPerSec.value, GAP_PX, PADDING_PX)

    function seekFromPointer(ev: PointerEvent) {
      const rect = trackEl.getBoundingClientRect()
      const x = ev.clientX - rect.left + trackEl.scrollLeft
      const hit = findSegmentAtTrackX(layout, x, pxPerSec.value)
      if (!hit) return
      selectedSegmentId.value = hit.seg.id
      playheadTime.value = hit.time
      const v = videoEl.current
      if (v) v.currentTime = hit.time
    }

    function queueSeekFromPointer(ev: PointerEvent) {
      if (seekRafRef.current !== null) cancelAnimationFrame(seekRafRef.current)
      seekRafRef.current = requestAnimationFrame(() => {
        seekRafRef.current = null
        seekFromPointer(ev)
      })
    }

    seekFromPointer(e)
    trackEl.setPointerCapture(e.pointerId)

    function onMove(mv: PointerEvent) {
      queueSeekFromPointer(mv)
    }
    function onUp() {
      if (seekRafRef.current !== null) {
        cancelAnimationFrame(seekRafRef.current)
        seekRafRef.current = null
      }
      trackEl.removeEventListener('pointermove', onMove)
      trackEl.removeEventListener('pointerup', onUp)
    }
    trackEl.addEventListener('pointermove', onMove)
    trackEl.addEventListener('pointerup', onUp)
  }

  function onPlayheadPointerDown(e: PointerEvent) {
    if (!activeSeg || !trackRef.current) return
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const segStartX = getSegmentStartX(activeSeg.id)
    const trackEl = trackRef.current

    function syncPlayheadFromPointer(mv: PointerEvent) {
      const rect = trackEl.getBoundingClientRect()
      const x = mv.clientX - rect.left + trackEl.scrollLeft
      const t = clampPlayheadForSegment(
        activeSeg!,
        activeSeg!.startTime + (x - segStartX) / pxPerSec.value
      )
      playheadTime.value = t
      const v = videoEl.current
      if (v) v.currentTime = t
    }

    function queuePlayheadFromPointer(mv: PointerEvent) {
      if (playheadRafRef.current !== null) cancelAnimationFrame(playheadRafRef.current)
      playheadRafRef.current = requestAnimationFrame(() => {
        playheadRafRef.current = null
        syncPlayheadFromPointer(mv)
      })
    }

    function onMove(mv: PointerEvent) {
      queuePlayheadFromPointer(mv)
    }
    function onUp() {
      if (playheadRafRef.current !== null) {
        cancelAnimationFrame(playheadRafRef.current)
        playheadRafRef.current = null
      }
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }

  function zoomTo(newPx: number, anchorX?: number) {
    const track = trackRef.current
    if (!track) return
    const oldPx = pxPerSec.value
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newPx))
    if (anchorX !== undefined) {
      const timeAtCursor = (anchorX + track.scrollLeft - PADDING_PX) / oldPx
      pxPerSec.value = clamped
      track.scrollLeft = timeAtCursor * clamped + PADDING_PX - anchorX
    } else {
      pxPerSec.value = clamped
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        zoomTo(pxPerSec.value - 10)
      } else if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        zoomTo(pxPerSec.value + 10)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(
    () => () => {
      if (seekRafRef.current !== null) cancelAnimationFrame(seekRafRef.current)
      if (playheadRafRef.current !== null) cancelAnimationFrame(playheadRafRef.current)
    },
    []
  )

  function onWheel(e: WheelEvent) {
    if (!trackRef.current) return
    if (e.ctrlKey) {
      e.preventDefault()
      const rect = trackRef.current.getBoundingClientRect()
      const anchorX = e.clientX - rect.left
      const factor = e.deltaY > 0 ? 1 / 1.25 : 1.25
      zoomTo(pxPerSec.value * factor, anchorX)
    } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault()
      trackRef.current.scrollLeft += e.deltaY
    }
  }

  function onDragOver(e: DragEvent) {
    if ([...(e.dataTransfer?.items ?? [])].some((item) => item.kind === 'file')) {
      e.preventDefault()
      draggingOver.value = true
    }
  }

  function onDragLeave(e: DragEvent) {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      draggingOver.value = false
    }
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault()
    draggingOver.value = false
    const files = Array.from(e.dataTransfer?.files ?? [])
    for (const f of files) await importAndAppend(f)
  }

  async function onFileInputChange(e: Event) {
    const files = Array.from((e.target as HTMLInputElement).files ?? [])
    for (const f of files) await importAndAppend(f)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const isEmpty = timeline.value.length === 0
  const seg = timeline.value.find((s) => s.id === selectedSegmentId.value)
  const disabled = !seg
  const toolBtn =
    'flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100'

  return (
    <div
      class={clsx(
        'relative flex h-64 shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200/60 bg-slate-50/40 backdrop-blur transition-colors md:h-48 dark:border-slate-700/60 dark:bg-slate-900/40',
        draggingOver.value && 'ring-2 ring-violet-400'
      )}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
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
              class={toolBtn}
              disabled={disabled}
              onClick={setInPoint}
              title="Set in-point (I)"
              aria-label="Set segment in-point at current playhead position"
            >
              <ArrowLeftToLine class="h-3.5 w-3.5" />
              In
            </button>

            <button
              class={toolBtn}
              disabled={disabled}
              onClick={setOutPoint}
              title="Set out-point (O)"
              aria-label="Set segment out-point at current playhead position"
            >
              <ArrowRightToLine class="h-3.5 w-3.5" />
              Out
            </button>

            <button
              class={toolBtn}
              disabled={disabled}
              onClick={cutAtPlayhead}
              title="Split at playhead (C)"
              aria-label="Split segment at current playhead position"
            >
              <Scissors class="h-3.5 w-3.5" />
              Cut
            </button>

            <button
              class={toolBtn}
              disabled={disabled}
              onClick={toggleMute}
              title="Toggle mute"
              aria-label={seg?.muted ? 'Unmute segment' : 'Mute segment'}
              aria-pressed={seg?.muted ?? false}
            >
              {seg?.muted ? <VolumeX class="h-3.5 w-3.5" /> : <Volume2 class="h-3.5 w-3.5" />}
              {seg?.muted ? 'Unmute' : 'Mute'}
            </button>

            <button
              class="flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100/50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-900/30 dark:hover:text-red-300"
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
              class="text-slate-400 transition-colors hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
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
              class="text-slate-400 transition-colors hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
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
                onBlur={(e) => zoomTo(Number((e.currentTarget as HTMLInputElement).value))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') zoomTo(Number((e.currentTarget as HTMLInputElement).value))
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
            <div
              class={clsx(
                'flex min-h-24 w-full max-w-lg items-center justify-center gap-2 rounded-lg border-2 border-dashed px-5 py-4 text-center transition-colors',
                draggingOver.value
                  ? 'border-violet-400 bg-violet-50/50 text-violet-600 dark:border-violet-500/50 dark:bg-violet-950/30 dark:text-violet-300'
                  : 'border-slate-300 bg-slate-50/50 text-slate-500 dark:border-slate-600 dark:bg-slate-800/20 dark:text-slate-400'
              )}
            >
              {draggingOver.value ? (
                <p class="text-base font-semibold">Drop to import</p>
              ) : (
                <>
                  <Upload class="h-4 w-4" />
                  <p class="text-base">Click or drop video files to import</p>
                </>
              )}
            </div>
          </div>
        ) : (
          <div class="relative flex h-full items-start gap-1 px-4 pt-12">
            {(() => {
              const ds = dragState.value
              const segs = timeline.value
              const fromIdx = ds ? segs.findIndex((s) => s.id === ds.segId) : -1
              const result = []
              for (let i = 0; i < segs.length; i++) {
                if (ds && ds.dropIndex === i && fromIdx !== i && fromIdx + 1 !== i) {
                  result.push(
                    <div
                      key={`drop-${i}`}
                      class="pointer-events-none w-1 shrink-0 self-stretch rounded-full bg-violet-400"
                    />
                  )
                }
                result.push(
                  <SegmentBlock
                    key={segs[i].id}
                    seg={segs[i]}
                    isDragging={ds?.segId === segs[i].id}
                  />
                )
              }
              if (ds && ds.dropIndex === segs.length && fromIdx !== segs.length - 1) {
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

      {/* Drop overlay when timeline has content */}
      {draggingOver.value && !isEmpty && (
        <div class="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg border-2 border-dashed border-violet-400 bg-violet-50/30 dark:bg-violet-950/20">
          <p class="text-base font-medium text-violet-500">Drop to append</p>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,.mp4,.webm,.mov,.avi,.mkv"
        multiple
        class="hidden"
        onChange={onFileInputChange}
      />
    </div>
  )
}
