import { useSignal, useSignalEffect } from '@preact/signals'
import { Pause, Play, StepBack, StepForward } from 'lucide-preact'
import { useEffect, useRef } from 'preact/hooks'

import { AdvancedSelectionToolbar } from '@/components/advanced/AdvancedSelectionToolbar'
import { AdvancedTransformOverlay } from '@/components/advanced/AdvancedTransformOverlay'
import { VolumeControl } from '@/components/VolumeControl'
import {
  attachAdvancedPreview,
  projectDuration,
  seek,
  setPlaybackRate,
  stepFrame,
  togglePlay,
} from '@/lib/advanced/advancedPlayback'
import { formatTimecode } from '@/lib/format'
import { advancedCanvas, advancedPlayhead, advancedPlaying, advancedSegments } from '@/lib/store'

const PLAYBACK_SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]

// Work-area sizing for the resizable canvas frame. The default width is derived
// from a target height and the canvas aspect, so a fresh project gets a sensible
// size; the user can drag the corner handle to enlarge the work area.
const DEFAULT_PREVIEW_HEIGHT = 480
const MIN_PREVIEW_WIDTH = 320
const MAX_PREVIEW_WIDTH = 1600

const TRANSPORT_BUTTON =
  'flex h-9 w-9 items-center justify-center rounded text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 hover:duration-0 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100'

export function AdvancedPreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const hasManualResize = useRef(false)
  const playbackSpeed = useSignal(1)
  const cropMode = useSignal(false)
  const previewWidth = useSignal(
    Math.round(DEFAULT_PREVIEW_HEIGHT * (advancedCanvas.value.width / advancedCanvas.value.height))
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    return attachAdvancedPreview(canvas)
  }, [])

  // Keep the default work-area width in step with the canvas aspect, until the
  // user manually resizes the work area.
  useSignalEffect(() => {
    const current = advancedCanvas.value
    if (hasManualResize.current) return
    const aspect = current.width / current.height
    previewWidth.value = Math.min(
      MAX_PREVIEW_WIDTH,
      Math.max(MIN_PREVIEW_WIDTH, Math.round(DEFAULT_PREVIEW_HEIGHT * aspect))
    )
  })

  function onResizePointerDown(event: PointerEvent) {
    event.stopPropagation()
    const handle = event.currentTarget as HTMLElement
    handle.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startY = event.clientY
    const startWidth = wrapperRef.current?.offsetWidth ?? previewWidth.value

    function onMove(moveEvent: PointerEvent) {
      const delta = moveEvent.clientX - startX + (moveEvent.clientY - startY)
      const newWidth = Math.max(MIN_PREVIEW_WIDTH, startWidth + delta)
      if (wrapperRef.current) wrapperRef.current.style.width = `${newWidth}px`
    }
    function onUp() {
      const finalWidth = wrapperRef.current?.offsetWidth
      if (finalWidth) {
        hasManualResize.current = true
        previewWidth.value = finalWidth
      }
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
  }

  const canvas = advancedCanvas.value
  const segments = advancedSegments.value
  const hasContent = segments.length > 0
  const totalDuration = projectDuration(segments)
  const progress = totalDuration > 0 ? Math.min(1, advancedPlayhead.value / totalDuration) : 0

  function onSeekClick(event: MouseEvent) {
    if (!totalDuration) return
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    seek(ratio * totalDuration)
  }

  return (
    <div class="flex w-full shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200/60 bg-slate-50/40 backdrop-blur dark:border-slate-700/60 dark:bg-slate-900/40">
      {/* Canvas stage */}
      <div class="group/preview relative flex flex-1 items-center justify-center overflow-hidden bg-slate-200 p-4 dark:bg-slate-950">
        <div
          ref={wrapperRef}
          data-canvas-wrapper
          class="relative max-w-full shrink-0 bg-black ring-1 ring-slate-500/60"
          style={{
            width: `${previewWidth.value}px`,
            aspectRatio: `${canvas.width} / ${canvas.height}`,
          }}
        >
          <canvas
            ref={canvasRef}
            width={canvas.width}
            height={canvas.height}
            class="absolute inset-0 h-full w-full object-contain"
          />
          <AdvancedTransformOverlay cropMode={cropMode.value} />
          {/* Drag the corner to resize the work area (like the Basic preview). */}
          <div
            class="absolute right-0 bottom-0 z-20 flex h-12 w-12 cursor-nwse-resize items-end justify-end rounded-tl-md bg-linear-to-br from-transparent via-transparent to-black/30 p-2 opacity-0 transition-opacity group-hover/preview:opacity-100"
            onPointerDown={onResizePointerDown}
            title="Drag to resize the work area"
          >
            <svg
              class="h-4 w-4 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            >
              <path d="M2 10L10 2M6 10L10 6" />
            </svg>
          </div>
        </div>
      </div>

      <AdvancedSelectionToolbar
        cropMode={cropMode.value}
        onToggleCrop={() => {
          cropMode.value = !cropMode.value
        }}
      />

      {/* Seek bar */}
      <button
        type="button"
        onClick={onSeekClick}
        disabled={!hasContent}
        aria-label="Seek"
        class="h-1.5 w-full cursor-pointer bg-slate-200 disabled:cursor-default dark:bg-slate-800"
      >
        <div class="h-full bg-violet-500" style={{ width: `${progress * 100}%` }} />
      </button>

      {/* Controls */}
      <div class="flex flex-col border-t border-slate-200/60 dark:border-slate-700/60">
        <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 py-2">
          <VolumeControl />
          <div class="flex items-center gap-0.5">
            <button
              onClick={() => stepFrame(-1)}
              disabled={!hasContent}
              class={TRANSPORT_BUTTON}
              title="Step back one frame"
            >
              <StepBack class="h-5 w-5" />
            </button>
            <button
              onClick={togglePlay}
              disabled={!hasContent}
              class={TRANSPORT_BUTTON}
              title={advancedPlaying.value ? 'Pause' : 'Play'}
            >
              {advancedPlaying.value ? <Pause class="h-5 w-5" /> : <Play class="ml-0.5 h-5 w-5" />}
            </button>
            <button
              onClick={() => stepFrame(1)}
              disabled={!hasContent}
              class={TRANSPORT_BUTTON}
              title="Step forward one frame"
            >
              <StepForward class="h-5 w-5" />
            </button>
          </div>
          <div class="flex items-center justify-end gap-2 sm:gap-4">
            <select
              value={playbackSpeed.value}
              onChange={(event) => {
                const nextSpeed = Number((event.currentTarget as HTMLSelectElement).value)
                playbackSpeed.value = nextSpeed
                setPlaybackRate(nextSpeed)
              }}
              class="rounded border border-slate-300 bg-white px-2 py-1 text-sm font-semibold text-slate-700 transition-colors outline-none hover:duration-0 focus:border-violet-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              title="Playback speed"
            >
              {PLAYBACK_SPEED_OPTIONS.map((speed) => (
                <option key={speed} value={speed}>
                  {speed}×
                </option>
              ))}
            </select>
            <span class="hidden text-sm text-slate-500 tabular-nums sm:inline dark:text-slate-400">
              {formatTimecode(advancedPlayhead.value)} / {formatTimecode(totalDuration)}
            </span>
          </div>
        </div>
        <div class="pb-2 text-center text-sm text-slate-500 tabular-nums sm:hidden dark:text-slate-400">
          {formatTimecode(advancedPlayhead.value)} / {formatTimecode(totalDuration)}
        </div>
      </div>
    </div>
  )
}
