import { useSignalEffect } from '@preact/signals'
import { useSignal } from '@preact/signals'
import clsx from 'clsx/lite'
import { Pause, Play, StepBack, StepForward } from 'lucide-preact'
import { useEffect, useRef } from 'preact/hooks'

import { VolumeControl } from '@/components/VolumeControl'
import { formatTimecode } from '@/lib/format'
import { attachVideo, detachVideo, setPlaybackRate, stepFrame, togglePlay } from '@/lib/playback'
import { clips, currentPlaybackTime, playing, timeline } from '@/lib/store'

const DEFAULT_PREVIEW_HEIGHT = 600
const DEFAULT_PREVIEW_MAX_WIDTH = 1600
const ASPECT_RATIO_VARIANCE_THRESHOLD = 0.01
const PLAYBACK_SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]

export function VideoPreview() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<HTMLDivElement>(null)
  const previewMaxWidth = useSignal(Math.round(DEFAULT_PREVIEW_HEIGHT * (16 / 9)))
  const previewAspectRatio = useSignal(16 / 9)
  const playbackSpeed = useSignal(1)
  const hasManualResize = useRef(false)

  function getTimelineAspectRatio(): number {
    const ratios = timeline.value
      .map((segment) => {
        if (segment.crop && segment.crop.width > 0 && segment.crop.height > 0) {
          return segment.crop.width / segment.crop.height
        }

        const clip = clips.value.find((clip) => clip.id === segment.clipId)
        if (clip && clip.width > 0 && clip.height > 0) {
          return clip.width / clip.height
        }

        return null
      })
      .filter((ratio): ratio is number => ratio !== null)

    if (ratios.length === 0) return 16 / 9

    const min = Math.min(...ratios)
    const max = Math.max(...ratios)
    const isMixed = max - min > ASPECT_RATIO_VARIANCE_THRESHOLD

    if (isMixed) {
      // Mixed aspect clips: use the smallest ratio as the common preview canvas.
      return min
    }

    return ratios[0]
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    attachVideo(video)
    return () => detachVideo()
  }, [])

  useSignalEffect(() => {
    const nextAspectRatio = getTimelineAspectRatio()
    previewAspectRatio.value = nextAspectRatio
    if (!hasManualResize.current) {
      const defaultWidth = Math.min(
        DEFAULT_PREVIEW_MAX_WIDTH,
        Math.max(320, Math.round(DEFAULT_PREVIEW_HEIGHT * nextAspectRatio))
      )
      previewMaxWidth.value = defaultWidth
    }
  })

  function onResizePointerDown(e: PointerEvent) {
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startY = e.clientY
    const startW = playerRef.current?.offsetWidth ?? previewMaxWidth.value ?? 400

    function onMove(mv: PointerEvent) {
      const deltaX = mv.clientX - startX
      const deltaY = mv.clientY - startY
      const delta = deltaX + deltaY
      const newWidth = Math.max(320, startW + delta)
      if (playerRef.current) {
        playerRef.current.style.width = `${newWidth}px`
      }
    }

    function onUp() {
      const finalWidth = playerRef.current?.offsetWidth
      if (finalWidth) {
        hasManualResize.current = true
        previewMaxWidth.value = finalWidth
      }
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
    }

    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }

  const hasContent = timeline.value.length > 0

  return (
    <div
      ref={containerRef}
      class="flex w-full shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200/60 bg-slate-50/40 backdrop-blur dark:border-slate-700/60 dark:bg-slate-900/40"
    >
      {/* Video Player */}
      <div class="group/preview relative flex flex-1 items-center justify-center overflow-hidden bg-slate-200 dark:bg-slate-950">
        <div
          ref={playerRef}
          class={clsx(
            'relative w-full max-w-full transition-[aspect-ratio] duration-200 ease-out',
            hasContent ? 'bg-black' : 'bg-slate-100 dark:bg-slate-900'
          )}
          style={{
            width: `${previewMaxWidth.value}px`,
            aspectRatio: `${previewAspectRatio.value}`,
          }}
        >
          {!hasContent && (
            <div class="absolute inset-0 flex items-center justify-center">
              <p class="text-base text-slate-500 select-none">Drop video files onto the timeline</p>
            </div>
          )}
          <video ref={videoRef} class="absolute inset-0 h-full w-full object-contain" />

          {/* Resize handle */}
          <div
            class="absolute right-0 bottom-0 z-10 flex h-14 w-14 cursor-nwse-resize items-end justify-end rounded-tl-md bg-linear-to-br from-transparent via-transparent to-black/20 p-2.5 opacity-0 transition-opacity group-hover/preview:opacity-100"
            onPointerDown={onResizePointerDown}
            title="Drag to resize video player"
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

      {/* Controls */}
      <div class="flex flex-col border-t border-slate-200/60 dark:border-slate-700/60">
        <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 py-2">
          <VolumeControl />
          <div class="flex items-center gap-0.5">
            <button
              onClick={() => stepFrame(-1)}
              disabled={!hasContent}
              class="flex h-9 w-9 items-center justify-center rounded text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 hover:duration-0 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100"
              title="Step back one frame (←)"
            >
              <StepBack class="h-5 w-5" />
            </button>
            <button
              onClick={togglePlay}
              disabled={!hasContent}
              class="flex h-9 w-9 items-center justify-center rounded text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 hover:duration-0 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100"
            >
              {playing.value ? <Pause class="h-5 w-5" /> : <Play class="ml-0.5 h-5 w-5" />}
            </button>
            <button
              onClick={() => stepFrame(1)}
              disabled={!hasContent}
              class="flex h-9 w-9 items-center justify-center rounded text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 hover:duration-0 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100"
              title="Step forward one frame (→)"
            >
              <StepForward class="h-5 w-5" />
            </button>
          </div>
          <div class="flex items-center justify-end gap-2 sm:gap-4">
            <select
              id="playback-speed"
              value={playbackSpeed.value}
              onChange={(e) => {
                const nextSpeed = Number((e.currentTarget as HTMLSelectElement).value)
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
              {formatTimecode(currentPlaybackTime.value)} /{' '}
              {formatTimecode(
                timeline.value.reduce(
                  (acc, segment) => acc + (segment.endTime - segment.startTime),
                  0
                )
              )}
            </span>
          </div>
        </div>
        <div class="pb-2 text-center text-sm text-slate-500 tabular-nums sm:hidden dark:text-slate-400">
          {formatTimecode(currentPlaybackTime.value)} /{' '}
          {formatTimecode(
            timeline.value.reduce((acc, segment) => acc + (segment.endTime - segment.startTime), 0)
          )}
        </div>
      </div>
    </div>
  )
}
