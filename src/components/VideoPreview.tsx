import { useSignal, useSignalEffect } from '@preact/signals'
import { useRef } from 'preact/hooks'
import { clips, currentPlaybackTime, currentSegmentDuration, playing, playheadTime, selectedSegmentId, timeline, videoEl } from '../lib/store'

const FRAME_STEP = 1 / 30

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
  const resumeAfterSwitch = useRef(false)

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
    videoEl.current = v
    const info = getActiveSegInfo()
    if (!info) {
      v.removeAttribute('src')
      v.load()
      v.muted = false
      currentSegmentDuration.value = 0
      currentPlaybackTime.value = 0
      playing.value = false
      return
    }

    v.muted = info.seg.muted

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

  function onTimeUpdate() {
    const v = videoRef.current
    if (!v) return
    const info = getActiveSegInfo()
    const segStart = info?.start ?? 0
    const segEnd = info?.end ?? v.duration
    currentPlaybackTime.value = Math.max(0, v.currentTime - segStart)
    playheadTime.value = v.currentTime

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

  function onResizePointerDown(e: PointerEvent) {
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startW = previewMaxWidth.value ?? (containerRef.current?.offsetWidth ?? 800)
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
  const btnIcon = 'flex items-center justify-center w-7 h-7 rounded-md text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors'

  return (
    <div
      ref={containerRef}
      class="flex flex-col rounded-lg overflow-hidden shrink-0 bg-slate-100 dark:bg-slate-900 relative w-full"
      style={previewMaxWidth.value ? { maxWidth: `${previewMaxWidth.value}px` } : undefined}
    >
      <div class="aspect-video w-full bg-black relative">
        {!hasContent && (
          <div class="absolute inset-0 flex items-center justify-center">
            <p class="text-slate-500 text-sm select-none">Drop video files onto the timeline</p>
          </div>
        )}
        <video
          ref={videoRef}
          class="absolute inset-0 w-full h-full object-contain"
          onTimeUpdate={onTimeUpdate}
          onPlay={() => { playing.value = true }}
          onPause={() => { playing.value = false }}
        />
      </div>

      {/* Controls */}
      <div class="flex items-center px-4 py-2 relative">
        <div class="flex items-center gap-1 absolute left-1/2 -translate-x-1/2">
          <button onClick={stepBack} disabled={!hasContent} class={btnIcon} title="Step back one frame">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
            </svg>
          </button>
          <button
            onClick={togglePlay}
            disabled={!hasContent}
            class="flex items-center justify-center w-8 h-8 rounded-full bg-violet-500 hover:bg-violet-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors mx-1"
          >
            {playing.value ? (
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg class="w-3.5 h-3.5 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M5 3l14 9-14 9V3z" />
              </svg>
            )}
          </button>
          <button onClick={stepForward} disabled={!hasContent} class={btnIcon} title="Step forward one frame">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 18 14.5 12 6 6v12zm8-12v12h2V6h-2z" />
            </svg>
          </button>
        </div>
        <span class="ml-auto text-xs tabular-nums text-slate-500 dark:text-slate-400">
          {formatTimecode(currentPlaybackTime.value)} / {formatTimecode(currentSegmentDuration.value)}
        </span>
      </div>

      {/* Resize handle */}
      <div
        class="absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize z-10 flex items-end justify-end p-1 opacity-40 hover:opacity-80 transition-opacity"
        onPointerDown={onResizePointerDown}
      >
        <svg class="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <path d="M2 10L10 2M6 10L10 6" />
        </svg>
      </div>
    </div>
  )
}
