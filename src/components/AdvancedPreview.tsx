import { useSignal } from '@preact/signals'
import { Maximize, Minus, Pause, Play, Plus, StepBack, StepForward } from 'lucide-preact'
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
import { computeContentBounds } from '@/lib/advanced/exportLayout'
import { clampZoom, fitToContent, zoomAtPoint } from '@/lib/advanced/viewportMath'
import { formatTimecode } from '@/lib/format'
import { advancedPlayhead, advancedPlaying, advancedSegments, advancedViewport } from '@/lib/store'

const PLAYBACK_SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]
const FIT_PADDING = 40

const TRANSPORT_BUTTON =
  'flex h-9 w-9 items-center justify-center rounded text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 hover:duration-0 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100'

const ZOOM_BUTTON =
  'flex h-7 w-7 items-center justify-center rounded bg-slate-900/70 text-slate-100 transition-colors hover:bg-slate-900 hover:duration-0'

export function AdvancedPreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const didFit = useRef(false)
  const playbackSpeed = useSignal(1)
  const cropMode = useSignal(false)
  const stageSize = useSignal({ width: 0, height: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    return attachAdvancedPreview(canvas)
  }, [])

  // Track the stage size; fit-to-content the first time we have real dimensions.
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect
      stageSize.value = { width: rect.width, height: rect.height }
      if (!didFit.current && rect.width > 0 && rect.height > 0) {
        didFit.current = true
        advancedViewport.value = fitToContent(
          computeContentBounds(advancedSegments.value),
          { width: rect.width, height: rect.height },
          FIT_PADDING
        )
      }
    })
    observer.observe(wrapper)
    return () => observer.disconnect()
  }, [])

  function fitView() {
    advancedViewport.value = fitToContent(
      computeContentBounds(advancedSegments.value),
      stageSize.value,
      FIT_PADDING
    )
  }

  function zoomByFactor(factor: number) {
    const center = { x: stageSize.value.width / 2, y: stageSize.value.height / 2 }
    advancedViewport.value = zoomAtPoint(
      advancedViewport.value,
      center,
      advancedViewport.value.zoom * factor
    )
  }

  function onWheel(event: WheelEvent) {
    if (!(event.ctrlKey || event.metaKey)) return
    event.preventDefault()
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const rect = wrapper.getBoundingClientRect()
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    const factor = Math.exp(-event.deltaY * 0.0015)
    advancedViewport.value = zoomAtPoint(
      advancedViewport.value,
      point,
      clampZoom(advancedViewport.value.zoom * factor)
    )
  }

  const segments = advancedSegments.value
  const hasContent = segments.length > 0
  const totalDuration = projectDuration(segments)
  const progress = totalDuration > 0 ? Math.min(1, advancedPlayhead.value / totalDuration) : 0
  const zoomPercent = Math.round(advancedViewport.value.zoom * 100)

  function onSeekClick(event: MouseEvent) {
    if (!totalDuration) return
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    seek(ratio * totalDuration)
  }

  return (
    <div class="flex w-full shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200/60 bg-slate-50/40 backdrop-blur dark:border-slate-700/60 dark:bg-slate-900/40">
      {/* Infinite canvas stage */}
      <div
        class="group/preview relative flex h-[480px] flex-1 overflow-hidden bg-slate-950"
        onWheel={onWheel}
        style={{
          backgroundImage: 'radial-gradient(rgba(148,163,184,0.18) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      >
        <div ref={wrapperRef} data-canvas-wrapper class="absolute inset-0">
          <canvas ref={canvasRef} class="absolute inset-0 h-full w-full" />
          <AdvancedTransformOverlay cropMode={cropMode.value} />
        </div>
        {/* Zoom controls */}
        <div class="absolute right-3 bottom-3 z-30 flex items-center gap-1">
          <button class={ZOOM_BUTTON} onClick={() => zoomByFactor(1 / 1.2)} title="Zoom out">
            <Minus class="h-4 w-4" />
          </button>
          <span class="min-w-12 rounded bg-slate-900/70 px-2 py-1 text-center text-xs font-medium text-slate-100 tabular-nums">
            {zoomPercent}%
          </span>
          <button class={ZOOM_BUTTON} onClick={() => zoomByFactor(1.2)} title="Zoom in">
            <Plus class="h-4 w-4" />
          </button>
          <button class={ZOOM_BUTTON} onClick={fitView} title="Fit to content">
            <Maximize class="h-4 w-4" />
          </button>
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
                  {speed}x
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
