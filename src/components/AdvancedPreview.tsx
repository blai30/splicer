import { useSignal } from '@preact/signals'
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

const TRANSPORT_BUTTON =
  'flex h-9 w-9 items-center justify-center rounded text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 hover:duration-0 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100'

export function AdvancedPreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playbackSpeed = useSignal(1)
  const cropMode = useSignal(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    return attachAdvancedPreview(canvas)
  }, [])

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
      <div class="relative flex flex-1 items-center justify-center overflow-hidden bg-slate-200 p-4 dark:bg-slate-950">
        <div
          data-canvas-wrapper
          class="relative max-h-[60vh] w-full max-w-3xl bg-black ring-1 ring-slate-500/60"
          style={{ aspectRatio: `${canvas.width} / ${canvas.height}` }}
        >
          <canvas
            ref={canvasRef}
            width={canvas.width}
            height={canvas.height}
            class="absolute inset-0 h-full w-full object-contain"
          />
          <AdvancedTransformOverlay cropMode={cropMode.value} />
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
