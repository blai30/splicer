import { useSignal, useSignalEffect } from '@preact/signals'
import { useRef } from 'preact/hooks'
import { clips, playheadTime, selectedSegmentId, timeline } from '../lib/store'

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const ms = Math.floor((s % 1) * 10)
  return `${m}:${sec.toString().padStart(2, '0')}.${ms}`
}

export function VideoPreview() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const playing = useSignal(false)
  const currentTime = useSignal(0)
  const duration = useSignal(0)

  // Derive the active segment and its clip
  function getActiveClipUrl(): string | null {
    const segId = selectedSegmentId.value
    if (!segId) {
      // No selection — play first segment if available
      const first = timeline.value[0]
      if (!first) return null
      return clips.value.find((c) => c.id === first.clipId)?.objectUrl ?? null
    }
    const seg = timeline.value.find((s) => s.id === segId)
    if (!seg) return null
    return clips.value.find((c) => c.id === seg.clipId)?.objectUrl ?? null
  }

  function getSegmentBounds(): { start: number; end: number } | null {
    const segId = selectedSegmentId.value ?? timeline.value[0]?.id
    if (!segId) return null
    const seg = timeline.value.find((s) => s.id === segId)
    if (!seg) return null
    return { start: seg.startTime, end: seg.endTime }
  }

  useSignalEffect(() => {
    const v = videoRef.current
    if (!v) return
    const url = getActiveClipUrl()
    if (!url) return
    const bounds = getSegmentBounds()
    if (v.src !== url) {
      v.src = url
      v.load()
      v.onloadedmetadata = () => {
        if (bounds) {
          v.currentTime = bounds.start
          duration.value = bounds.end - bounds.start
        } else {
          duration.value = v.duration
        }
        currentTime.value = 0
      }
    }
  })

  function onTimeUpdate() {
    const v = videoRef.current
    if (!v) return
    const bounds = getSegmentBounds()
    const segStart = bounds?.start ?? 0
    const segEnd = bounds?.end ?? v.duration
    const elapsed = v.currentTime - segStart
    currentTime.value = Math.max(0, elapsed)
    playheadTime.value = v.currentTime

    if (v.currentTime >= segEnd) {
      v.pause()
      v.currentTime = segStart
      playing.value = false
      currentTime.value = 0
    }
  }

  function togglePlay() {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      const bounds = getSegmentBounds()
      if (bounds && v.currentTime >= bounds.end) {
        v.currentTime = bounds.start
        currentTime.value = 0
      }
      v.play()
      playing.value = true
    } else {
      v.pause()
      playing.value = false
    }
  }

  function onScrub(e: Event) {
    const v = videoRef.current
    if (!v) return
    const bounds = getSegmentBounds()
    const segStart = bounds?.start ?? 0
    const segEnd = bounds?.end ?? v.duration
    const pct = parseFloat((e.target as HTMLInputElement).value) / 100
    const t = segStart + pct * (segEnd - segStart)
    v.currentTime = t
    currentTime.value = t - segStart
    playheadTime.value = t
  }

  const progress = duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0
  const hasContent = timeline.value.length > 0

  return (
    <div class="flex flex-col flex-1 min-h-0 bg-mist-50 dark:bg-mist-900">
      {/* Video area */}
      <div class="flex-1 min-h-0 flex items-center justify-center bg-black relative">
        {!hasContent && (
          <p class="text-mist-500 dark:text-mist-400 text-sm">
            Import clips and add them to the timeline
          </p>
        )}
        <video
          ref={videoRef}
          class={`max-w-full max-h-full ${!hasContent ? 'hidden' : ''}`}
          onTimeUpdate={onTimeUpdate}
          onPlay={() => { playing.value = true }}
          onPause={() => { playing.value = false }}
        />
      </div>

      {/* Controls */}
      <div class="flex items-center gap-3 px-4 py-2 bg-mist-100 dark:bg-mist-800 border-t border-mist-200 dark:border-mist-700">
        <button
          onClick={togglePlay}
          disabled={!hasContent}
          class="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors shrink-0"
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

        <span class="text-xs tabular-nums text-mist-600 dark:text-mist-300 shrink-0 w-20">
          {formatTime(currentTime.value)} / {formatTime(duration.value)}
        </span>

        <input
          type="range"
          min="0"
          max="100"
          value={progress.toFixed(1)}
          onInput={onScrub}
          disabled={!hasContent}
          class="flex-1 h-1.5 accent-emerald-500 disabled:opacity-40 cursor-pointer"
        />
      </div>
    </div>
  )
}
