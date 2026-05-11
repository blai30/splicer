import { useSignalEffect } from '@preact/signals'
import { useSignal } from '@preact/signals'
import clsx from 'clsx/lite'
import { Pause, Play, StepBack, StepForward } from 'lucide-preact'
import { useEffect, useRef } from 'preact/hooks'

import { VolumeControl } from '@/components/VolumeControl'
import { deleteSegment, setInPoint, setOutPoint, toggleMute } from '@/lib/actions'
import { formatTimecode } from '@/lib/format'
import {
  clips,
  currentPlaybackTime,
  currentSegmentDuration,
  playing,
  playheadTime,
  previewMuted,
  previewVolume,
  selectedSegmentId,
  timeline,
  videoEl,
} from '@/lib/store'

const FRAME_STEP = 1 / 30
const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]
const DEFAULT_PREVIEW_HEIGHT = 600
const DEFAULT_PREVIEW_MAX_WIDTH = 1600

export function VideoPreview() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<HTMLDivElement>(null)
  const previewMaxWidth = useSignal(Math.round(DEFAULT_PREVIEW_HEIGHT * (16 / 9)))
  const previewAspectRatio = useSignal(16 / 9)
  const playbackSpeed = useSignal(1)
  const resumeAfterSwitch = useRef(false)
  const hasManualResize = useRef(false)
  const rafId = useRef(0)

  function getTimelineAspectRatio(): number {
    const ratios = timeline.value
      .map((seg) => {
        if (seg.crop && seg.crop.width > 0 && seg.crop.height > 0) {
          return seg.crop.width / seg.crop.height
        }

        const clip = clips.value.find((c) => c.id === seg.clipId)
        if (clip && clip.width > 0 && clip.height > 0) {
          return clip.width / clip.height
        }

        return null
      })
      .filter((ratio): ratio is number => ratio !== null)

    if (ratios.length === 0) return 16 / 9

    const min = Math.min(...ratios)
    const max = Math.max(...ratios)
    const isMixed = max - min > 0.01

    if (isMixed) {
      // Mixed aspect clips: use the smallest ratio as the common preview canvas.
      return min
    }

    return ratios[0]
  }

  function getActiveSegInfo() {
    const segId = selectedSegmentId.value ?? timeline.value[0]?.id
    if (!segId) return null
    const seg = timeline.value.find((s) => s.id === segId)
    if (!seg) return null
    const clip = clips.value.find((c) => c.id === seg.clipId)
    if (!clip) return null
    return { url: clip.objectUrl, start: seg.startTime, end: seg.endTime, seg, clip }
  }

  useSignalEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.volume = previewVolume.value
    v.muted = previewMuted.value
  })

  useSignalEffect(() => {
    const v = videoRef.current
    if (!v) return
    videoEl.current = v
    v.playbackRate = playbackSpeed.value
    const nextAspectRatio = getTimelineAspectRatio()
    previewAspectRatio.value = nextAspectRatio
    if (!hasManualResize.current) {
      const defaultWidth = Math.min(
        DEFAULT_PREVIEW_MAX_WIDTH,
        Math.max(320, Math.round(DEFAULT_PREVIEW_HEIGHT * nextAspectRatio))
      )
      previewMaxWidth.value = defaultWidth
    }
    const info = getActiveSegInfo()
    if (!info) {
      v.removeAttribute('src')
      v.load()
      currentSegmentDuration.value = 0
      currentPlaybackTime.value = 0
      playing.value = false
      return
    }

    v.muted = info.seg.muted || previewMuted.value

    const resume = resumeAfterSwitch.current
    resumeAfterSwitch.current = false

    if (v.src !== info.url) {
      v.src = info.url
      v.load()
      v.onloadedmetadata = () => {
        v.currentTime = info.start
        currentSegmentDuration.value = info.end - info.start
        currentPlaybackTime.value = 0
        if (resume) v.play()
      }
    } else {
      currentSegmentDuration.value = info.end - info.start
      if (v.currentTime < info.start || v.currentTime >= info.end) {
        v.currentTime = info.start
        currentPlaybackTime.value = 0
      }
      if (resume && v.paused) v.play()
    }
  })

  function tickPlayhead() {
    const v = videoRef.current
    if (!v) return
    const info = getActiveSegInfo()
    const segStart = info?.start ?? 0
    playheadTime.value = v.currentTime
    currentPlaybackTime.value = Math.max(0, v.currentTime - segStart)
    rafId.current = requestAnimationFrame(tickPlayhead)
  }

  function onTimeUpdate() {
    const v = videoRef.current
    if (!v) return
    const info = getActiveSegInfo()
    const segEnd = info?.end ?? v.duration

    if (v.currentTime >= segEnd) {
      const segs = timeline.value
      const currentIdx = segs.findIndex((s) => s.id === info?.seg.id)
      const nextSeg = segs[currentIdx + 1]
      if (nextSeg && playing.value) {
        resumeAfterSwitch.current = true
        selectedSegmentId.value = nextSeg.id
      } else {
        v.pause()
        playing.value = false
        currentPlaybackTime.value = 0
        if (segs.length > 0) {
          selectedSegmentId.value = segs[0].id
        }
      }
    }
  }

  function togglePlay() {
    const v = videoRef.current
    if (!v) return
    const info = getActiveSegInfo()
    if (v.paused) {
      if (info && v.currentTime >= info.end) v.currentTime = info.start
      v.play()
    } else {
      v.pause()
    }
  }

  function stepBack() {
    const v = videoRef.current
    if (!v) return
    const info = getActiveSegInfo()
    const segStart = info?.start ?? 0
    const t = Math.max(segStart, v.currentTime - FRAME_STEP)
    v.currentTime = t
    playheadTime.value = t
    currentPlaybackTime.value = Math.max(0, t - segStart)
  }

  function stepForward() {
    const v = videoRef.current
    if (!v) return
    const info = getActiveSegInfo()
    const segEnd = info?.end ?? v.duration
    const segStart = info?.start ?? 0
    const t = Math.min(segEnd, v.currentTime + FRAME_STEP)
    v.currentTime = t
    playheadTime.value = t
    currentPlaybackTime.value = Math.max(0, t - segStart)
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      switch (e.key) {
        case ' ':
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowLeft':
        case ',':
          e.preventDefault()
          stepBack()
          break
        case 'ArrowRight':
        case '.':
          e.preventDefault()
          stepForward()
          break
        case 'i':
          setInPoint()
          break
        case 'o':
          setOutPoint()
          break
        case 'm':
          toggleMute()
          break
        case 'Delete':
        case 'Backspace':
          deleteSegment()
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      cancelAnimationFrame(rafId.current)
    }
  }, [])

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
      <div
        class={clsx(
          'group/preview relative flex flex-1 items-center justify-center overflow-hidden',
          hasContent ? 'bg-slate-950 dark:bg-slate-950' : 'bg-slate-200 dark:bg-slate-950'
        )}
      >
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
          <video
            ref={videoRef}
            class="absolute inset-0 h-full w-full object-contain"
            onTimeUpdate={onTimeUpdate}
            onPlay={() => {
              playing.value = true
              rafId.current = requestAnimationFrame(tickPlayhead)
            }}
            onPause={() => {
              playing.value = false
              cancelAnimationFrame(rafId.current)
            }}
          />

          {/* Resize handle */}
          <div
            class="absolute right-0 bottom-0 z-10 flex h-12 w-12 cursor-nwse-resize items-end justify-end p-2 opacity-0 transition-opacity group-hover/preview:opacity-100"
            onPointerDown={onResizePointerDown}
            title="Drag to resize video player"
          >
            <svg
              class="h-3.5 w-3.5 text-slate-500 dark:text-slate-400"
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
              onClick={stepBack}
              disabled={!hasContent}
              class="flex h-9 w-9 items-center justify-center rounded text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100"
              title="Step back one frame (←)"
            >
              <StepBack class="h-5 w-5" />
            </button>
            <button
              onClick={togglePlay}
              disabled={!hasContent}
              class="flex h-9 w-9 items-center justify-center rounded text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100"
            >
              {playing.value ? <Pause class="h-5 w-5" /> : <Play class="ml-0.5 h-5 w-5" />}
            </button>
            <button
              onClick={stepForward}
              disabled={!hasContent}
              class="flex h-9 w-9 items-center justify-center rounded text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100"
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
                playbackSpeed.value = Number((e.currentTarget as HTMLSelectElement).value)
              }}
              class="rounded border border-slate-300 bg-white px-2 py-1 text-sm font-semibold text-slate-700 transition-colors outline-none focus:border-violet-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              title="Playback speed"
            >
              {SPEED_OPTIONS.map((speed) => (
                <option key={speed} value={speed}>
                  {speed}×
                </option>
              ))}
            </select>
            <span class="hidden text-sm text-slate-500 tabular-nums sm:inline dark:text-slate-400">
              {formatTimecode(currentPlaybackTime.value)} /{' '}
              {formatTimecode(
                timeline.value.reduce((acc, seg) => acc + (seg.endTime - seg.startTime), 0)
              )}
            </span>
          </div>
        </div>
        <div class="pb-2 text-center text-sm text-slate-500 tabular-nums sm:hidden dark:text-slate-400">
          {formatTimecode(currentPlaybackTime.value)} /{' '}
          {formatTimecode(
            timeline.value.reduce((acc, seg) => acc + (seg.endTime - seg.startTime), 0)
          )}
        </div>
      </div>
    </div>
  )
}
