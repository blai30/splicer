import { useSignal, useSignalEffect } from '@preact/signals'
import { Pause, Play, StepBack, StepForward, Volume2, VolumeX } from 'lucide-preact'
import { useEffect, useRef } from 'preact/hooks'

import { deleteSegment, setInPoint, setOutPoint, toggleMute } from '@/lib/actions'
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

function formatTimecode(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const ms = Math.floor((s % 1) * 10)
  return `${m}:${sec.toString().padStart(2, '0')}.${ms}`
}

export function VideoPreview() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const previewMaxWidth = useSignal<number | null>(null)
  const playbackSpeed = useSignal(1)
  const localVolume = useSignal(previewVolume.value)
  const resumeAfterSwitch = useRef(false)
  const rafId = useRef(0)

  const volumeInputRef = useRef<HTMLInputElement>(null)

  useSignalEffect(() => {
    localVolume.value = previewVolume.value
    if (volumeInputRef.current) {
      volumeInputRef.current.value = String(previewVolume.value)
    }
  })

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
    // Always sync volume and mute state when they change
    v.volume = previewVolume.value
    v.muted = previewMuted.value
  })

  useSignalEffect(() => {
    const v = videoRef.current
    if (!v) return
    videoEl.current = v
    v.playbackRate = playbackSpeed.value
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
    const startW = previewMaxWidth.value ?? containerRef.current?.offsetWidth ?? 800
    function onMove(mv: PointerEvent) {
      previewMaxWidth.value = Math.max(320, startW + (mv.clientX - startX))
    }
    function onUp() {
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
      class="relative flex w-full shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white/95 shadow-lg shadow-slate-900/10 backdrop-blur dark:border-slate-700/70 dark:bg-slate-900/95 dark:shadow-black/30"
      style={previewMaxWidth.value ? { maxWidth: `${previewMaxWidth.value}px` } : undefined}
    >
      <div class="relative aspect-video w-full bg-black">
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
      </div>

      {/* Controls */}
      <div class="relative flex items-center border-t border-slate-200/80 px-4 py-2 dark:border-slate-700/80">
        <div class="flex items-center gap-2">
          <button
            onClick={() => {
              previewMuted.value = !previewMuted.value
            }}
            class="flex h-7 w-7 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            title={previewMuted.value ? 'Unmute preview' : 'Mute preview'}
          >
            {previewMuted.value ? <VolumeX class="h-4 w-4" /> : <Volume2 class="h-4 w-4" />}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            ref={volumeInputRef}
            value={localVolume.value}
            disabled={previewMuted.value}
            onInput={(e) => {
              const val = Number((e.currentTarget as HTMLInputElement).value)
              localVolume.value = val
              previewVolume.value = val
            }}
            class="w-20 accent-violet-500 disabled:opacity-40"
            title="Preview volume"
          />
        </div>
        <div class="absolute left-1/2 flex -translate-x-1/2 items-center gap-1">
          <button
            onClick={stepBack}
            disabled={!hasContent}
            class="flex h-9 w-9 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            title="Step back one frame (←)"
          >
            <StepBack class="h-5 w-5" />
          </button>
          <button
            onClick={togglePlay}
            disabled={!hasContent}
            class="flex h-9 w-9 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            {playing.value ? <Pause class="h-5 w-5" /> : <Play class="ml-0.5 h-5 w-5" />}
          </button>
          <button
            onClick={stepForward}
            disabled={!hasContent}
            class="flex h-9 w-9 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            title="Step forward one frame (→)"
          >
            <StepForward class="h-5 w-5" />
          </button>
        </div>
        <div class="ml-auto flex items-center gap-4">
          <select
            id="playback-speed"
            value={playbackSpeed.value}
            onChange={(e) => {
              playbackSpeed.value = Number((e.currentTarget as HTMLSelectElement).value)
            }}
            class="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-semibold text-slate-700 transition-colors outline-none focus:border-violet-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            title="Playback speed"
          >
            {SPEED_OPTIONS.map((speed) => (
              <option key={speed} value={speed}>
                {speed}×
              </option>
            ))}
          </select>
          <span class="text-sm text-slate-500 tabular-nums dark:text-slate-400">
            {formatTimecode(currentPlaybackTime.value)} /{' '}
            {formatTimecode(
              timeline.value.reduce((acc, seg) => acc + (seg.endTime - seg.startTime), 0)
            )}
          </span>
        </div>
      </div>

      {/* Resize handle */}
      <div
        class="absolute right-0 bottom-0 z-10 flex h-5 w-5 cursor-nwse-resize items-end justify-end p-1 opacity-40 transition-opacity hover:opacity-80"
        onPointerDown={onResizePointerDown}
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
  )
}
