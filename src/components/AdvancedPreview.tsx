import { Pause, Play, StepBack, StepForward } from 'lucide-preact'
import { useEffect, useRef } from 'preact/hooks'

import { VolumeControl } from '@/components/VolumeControl'
import { attachAdvancedPreview, seek, stepFrame, togglePlay } from '@/lib/advanced/advancedPlayback'
import { formatTimecode } from '@/lib/format'
import { advancedCanvas, advancedPlayhead, advancedPlaying, advancedSegments } from '@/lib/store'

export function AdvancedPreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return
    return attachAdvancedPreview(canvas, video)
  }, [])

  const canvas = advancedCanvas.value
  const hasContent = advancedSegments.value.length > 0

  function onSeekClick(event: MouseEvent) {
    const video = videoRef.current
    if (!video || !video.duration) return
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    seek(ratio * video.duration)
  }

  return (
    <div class="flex w-full flex-col gap-2 rounded-lg border border-slate-200/60 bg-slate-50/40 p-3 backdrop-blur dark:border-slate-700/60 dark:bg-slate-900/40">
      <div class="flex items-center justify-center overflow-hidden rounded bg-slate-950">
        <canvas
          ref={canvasRef}
          width={canvas.width}
          height={canvas.height}
          class="max-h-[60vh] w-full object-contain"
          style={{ aspectRatio: `${canvas.width} / ${canvas.height}` }}
        />
        <video ref={videoRef} class="hidden" playsInline />
      </div>

      <div
        class="h-2 w-full cursor-pointer overflow-hidden rounded bg-slate-200 dark:bg-slate-700"
        onClick={onSeekClick}
      >
        <div
          class="h-full bg-violet-500"
          style={{
            width: `${videoRef.current?.duration ? (advancedPlayhead.value / videoRef.current.duration) * 100 : 0}%`,
          }}
        />
      </div>

      <div class="flex items-center gap-2">
        <VolumeControl />
        <div class="flex items-center gap-0.5">
          <button
            onClick={() => stepFrame(-1)}
            disabled={!hasContent}
            class="flex h-9 w-9 items-center justify-center rounded text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700/50"
            title="Step back one frame"
          >
            <StepBack class="h-5 w-5" />
          </button>
          <button
            onClick={togglePlay}
            disabled={!hasContent}
            class="flex h-9 w-9 items-center justify-center rounded text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700/50"
            title={advancedPlaying.value ? 'Pause' : 'Play'}
          >
            {advancedPlaying.value ? <Pause class="h-5 w-5" /> : <Play class="ml-0.5 h-5 w-5" />}
          </button>
          <button
            onClick={() => stepFrame(1)}
            disabled={!hasContent}
            class="flex h-9 w-9 items-center justify-center rounded text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700/50"
            title="Step forward one frame"
          >
            <StepForward class="h-5 w-5" />
          </button>
        </div>
        <span class="text-sm text-slate-500 tabular-nums dark:text-slate-400">
          {formatTimecode(advancedPlayhead.value)}
        </span>
      </div>
    </div>
  )
}
