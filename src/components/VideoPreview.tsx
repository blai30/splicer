import { useSignalEffect } from '@preact/signals'
import { useSignal } from '@preact/signals'
import clsx from 'clsx/lite'
import { FastForward, Pause, Play, Rewind, StepBack, StepForward } from 'lucide-preact'
import { useEffect, useRef } from 'preact/hooks'

import { VolumeControl } from '@/components/VolumeControl'
import { formatTimecode } from '@/lib/format'
import { attachVideo, detachVideo, setPlaybackSpeed, stepFrame, togglePlay } from '@/lib/playback'
import {
  PLAYBACK_SPEED_OPTIONS,
  currentPlaybackTime,
  getClipById,
  playbackRate,
  selectedSegmentId,
  shuttleRate,
  timeline,
  transportRunning,
} from '@/lib/store'

const DEFAULT_PREVIEW_HEIGHT = 600
const DEFAULT_PREVIEW_MAX_WIDTH = 1600

export function VideoPreview() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<HTMLDivElement>(null)
  const previewMaxWidth = useSignal(Math.round(DEFAULT_PREVIEW_HEIGHT * (16 / 9)))
  const previewAspectRatio = useSignal(16 / 9)
  const hasManualResize = useRef(false)

  // Match the export frame: the first segment sets the aspect ratio, and every
  // other segment is letterboxed into it (object-contain on the video).
  function getTimelineAspectRatio(): number {
    const first = timeline.value[0]
    if (!first) return 16 / 9
    if (first.crop && first.crop.width > 0 && first.crop.height > 0) {
      return first.crop.width / first.crop.height
    }
    const clip = getClipById(first.clipId)
    if (clip && clip.width > 0 && clip.height > 0) return clip.width / clip.height
    return 16 / 9
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

  function onResizePointerDown(event: PointerEvent) {
    event.stopPropagation()
    const element = event.currentTarget as HTMLElement
    element.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startY = event.clientY
    const startWidth = playerRef.current?.offsetWidth ?? previewMaxWidth.value ?? 400

    function onMove(moveEvent: PointerEvent) {
      const deltaX = moveEvent.clientX - startX
      const deltaY = moveEvent.clientY - startY
      const delta = deltaX + deltaY
      const newWidth = Math.max(320, startWidth + delta)
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
      element.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerup', onUp)
      element.removeEventListener('pointercancel', onUp)
    }

    element.addEventListener('pointermove', onMove)
    element.addEventListener('pointerup', onUp)
    element.addEventListener('pointercancel', onUp)
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
            class="absolute right-0 bottom-0 z-10 flex h-14 w-14 cursor-nwse-resize touch-none items-end justify-end rounded-tl-md bg-linear-to-br from-transparent via-transparent to-black/20 p-2.5 opacity-0 transition-opacity group-hover/preview:opacity-100"
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
              title={transportRunning.value ? 'Pause (Space)' : 'Play (Space)'}
            >
              {transportRunning.value ? <Pause class="h-5 w-5" /> : <Play class="ml-0.5 h-5 w-5" />}
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
            <ShuttleIndicator />
            <select
              id="playback-speed"
              value={playbackRate.value}
              onChange={(event) =>
                setPlaybackSpeed(Number((event.currentTarget as HTMLSelectElement).value))
              }
              aria-label="Playback speed"
              class="rounded border border-slate-300 bg-white px-2 py-1 text-sm font-semibold text-slate-700 transition-colors outline-none hover:duration-0 focus:border-violet-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              title="Playback speed"
            >
              {PLAYBACK_SPEED_OPTIONS.map((speed) => (
                <option key={speed} value={speed}>
                  {speed}×
                </option>
              ))}
            </select>
            <PlaybackTimecode class="hidden sm:inline" />
          </div>
        </div>
        <PlaybackTimecode class="block pb-2 text-center sm:hidden" />
      </div>
    </div>
  )
}

// Position on the whole edited timeline: every segment before the active one,
// plus the offset inside it. A leaf, so the per-frame playback time re-renders
// only this text and not the preview around it.
function PlaybackTimecode({ class: className }: { class: string }) {
  const activeId = selectedSegmentId.value ?? timeline.value[0]?.id
  let elapsedBefore = 0
  let totalDuration = 0
  let passedActive = false
  for (const segment of timeline.value) {
    const length = segment.endTime - segment.startTime
    if (segment.id === activeId) passedActive = true
    else if (!passedActive) elapsedBefore += length
    totalDuration += length
  }
  const position = Math.min(totalDuration, elapsedBefore + currentPlaybackTime.value)
  return (
    <span class={clsx('text-sm text-slate-500 tabular-nums dark:text-slate-400', className)}>
      {formatTimecode(position)} / {formatTimecode(totalDuration)}
    </span>
  )
}

// J/K/L shuttle feedback: direction and speed while shuttling.
function ShuttleIndicator() {
  const rate = shuttleRate.value
  return (
    <span role="status" class="text-sm font-semibold text-violet-600 dark:text-violet-300">
      {rate !== null && (
        <span class="flex items-center gap-1" title="Shuttle speed (J/K/L)">
          {rate < 0 ? (
            <Rewind class="h-4 w-4" aria-hidden="true" />
          ) : (
            <FastForward class="h-4 w-4" aria-hidden="true" />
          )}
          <span class="sr-only">{rate < 0 ? 'Reverse' : 'Forward'}</span>
          {Math.abs(rate)}×
        </span>
      )}
    </span>
  )
}
