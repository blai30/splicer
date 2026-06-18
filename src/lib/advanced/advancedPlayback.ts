import { effect } from '@preact/signals'

import {
  orderedForRender,
  projectDuration,
  segmentDuration,
  segmentsActiveAt,
} from '@/lib/advanced/advancedTimelineDomain'
import {
  advancedCanvas,
  advancedPlayhead,
  advancedPlaying,
  advancedSegments,
  advancedTracks,
  getClipById,
  previewMuted,
  previewVolume,
} from '@/lib/store'
import type { AdvancedSegment } from '@/lib/types'

const FRAME_STEP = 1 / 30
const DRIFT_THRESHOLD = 0.18
// While paused we compare against the last requested seek target (not the
// snapped read-back currentTime), so anything above float noise means the
// target actually changed (a scrub/step) rather than an unrelated redraw.
const PAUSED_SEEK_EPSILON = 0.0005

let canvasEl: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null
let videoHost: HTMLDivElement | null = null
let rafId = 0
let playbackRate = 1
let lastTickMs: number | null = null
let disposeDraw: (() => void) | null = null

// One hidden <video> per clip currently needed, keyed by clipId.
const videoPool = new Map<string, HTMLVideoElement>()

// The last source time we requested each video seek to, keyed by clipId. Used
// to avoid re-seeking a paused video to a frame it is already showing (a
// transform drag replaces advancedSegments every move, re-running the paused
// redraw effect; re-seeking on each of those would flicker the clip).
const lastSeekTarget = new Map<string, number>()

// The latest target a video should seek to once its in-flight seek finishes,
// keyed by clipId. Setting currentTime while a seek is in progress cancels it
// and restarts decoding; doing that every pointermove (scrubbing the playhead)
// keeps the decoder perpetually busy, drops readyState, and blanks the canvas.
// Instead we let one seek finish, then chase the most recent target.
const pendingSeek = new Map<string, number>()

// Per-clip cache of the most recently decoded frame. While scrubbing, a video is
// often mid-seek when we redraw (readyState dips below HAVE_CURRENT_DATA); rather
// than skip the layer and flash the checkerboard, we draw its last good frame.
// Preview-only smoothing; the export composites exact frames at grid times.
const lastFrame = new Map<string, HTMLCanvasElement>()

// Pick what to draw for a layer: the live video when it has a current frame
// (also refreshing the cache while paused), otherwise the cached last frame.
function frameSource(clipId: string, video: HTMLVideoElement): CanvasImageSource | null {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
    if (!advancedPlaying.value) {
      let cache = lastFrame.get(clipId)
      if (!cache) {
        cache = document.createElement('canvas')
        lastFrame.set(clipId, cache)
      }
      if (cache.width !== video.videoWidth) cache.width = video.videoWidth
      if (cache.height !== video.videoHeight) cache.height = video.videoHeight
      cache.getContext('2d')?.drawImage(video, 0, 0)
    }
    return video
  }
  return lastFrame.get(clipId) ?? null
}

// Decide whether to issue a seek. While playing, correct only real drift. While
// paused, seek only when the requested target changed (scrub/step), not on every
// redraw triggered by an unrelated edit such as moving or resizing a clip.
export function shouldSeekToFrame(args: {
  currentTime: number
  expected: number
  playing: boolean
  lastTarget: number | undefined
}): boolean {
  const { currentTime, expected, playing, lastTarget } = args
  if (playing) return Math.abs(currentTime - expected) > DRIFT_THRESHOLD
  return lastTarget === undefined || Math.abs(lastTarget - expected) > PAUSED_SEEK_EPSILON
}

// Seek a video, coalescing requests that arrive while a seek is still running.
function requestSeek(video: HTMLVideoElement, clipId: string, target: number) {
  if (video.seeking) {
    pendingSeek.set(clipId, target)
    return
  }
  try {
    video.currentTime = target
    lastSeekTarget.set(clipId, target)
  } catch {
    // Seeking before metadata loads is a no-op; the next tick corrects it.
  }
}

function getVideo(clipId: string): HTMLVideoElement | null {
  const clip = getClipById(clipId)
  if (!clip || !videoHost) return null
  let video = videoPool.get(clipId)
  if (!video) {
    video = document.createElement('video')
    video.playsInline = true
    video.preload = 'auto'
    video.src = clip.objectUrl
    video.muted = true
    // A seek or initial load decodes the frame asynchronously; when that
    // completes while paused, redraw so the canvas shows the current frame
    // instead of staying black. The rAF loop covers redraws during playback.
    const redrawIfPaused = () => {
      if (!advancedPlaying.value) drawComposite(advancedPlayhead.value)
    }
    // When a seek finishes, show the freshly decoded frame, then chase the most
    // recent target queued while it was running (smooth playhead scrubbing).
    const onSeeked = () => {
      redrawIfPaused()
      const pending = pendingSeek.get(clipId)
      if (pending !== undefined) {
        pendingSeek.delete(clipId)
        requestSeek(video as HTMLVideoElement, clipId, pending)
      }
    }
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('loadeddata', redrawIfPaused)
    videoHost.appendChild(video)
    videoPool.set(clipId, video)
  }
  return video
}

function trackHidden(trackId: string): boolean {
  return advancedTracks.value.find((track) => track.id === trackId)?.hidden === true
}

function trackMuted(trackId: string): boolean {
  return advancedTracks.value.find((track) => track.id === trackId)?.muted === true
}

function expectedSourceTime(segment: AdvancedSegment, playhead: number): number {
  return segment.sourceStart + (playhead - segment.timelineStart)
}

// Draw all active, non-hidden layers onto the canvas, ordered bottom lane first.
function drawComposite(playhead: number) {
  if (!ctx || !canvasEl) return
  const canvas = advancedCanvas.value
  if (canvasEl.width !== canvas.width) canvasEl.width = canvas.width
  if (canvasEl.height !== canvas.height) canvasEl.height = canvas.height

  // Leave empty areas transparent so the fixed-size CSS checkerboard behind the
  // canvas shows through (a preview-only editing aid). Export fills these black.
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const active = segmentsActiveAt(advancedSegments.value, playhead).filter(
    (segment) => !trackHidden(segment.trackId)
  )
  for (const segment of orderedForRender(active, advancedTracks.value)) {
    const video = getVideo(segment.clipId)
    if (!video) continue
    const source = frameSource(segment.clipId, video)
    if (!source) continue
    const { x, y, width, height } = segment.transform
    ctx.globalAlpha = segment.opacity ?? 1
    if (segment.crop) {
      const crop = segment.crop
      ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, x, y, width, height)
    } else {
      ctx.drawImage(source, x, y, width, height)
    }
  }
  ctx.globalAlpha = 1
}

// Keep each active source's video element synced to the playhead; play/pause and
// mute follow the global clock and track/clip mute. Idle clips are paused.
function syncVideos(playhead: number, playing: boolean) {
  const active = segmentsActiveAt(advancedSegments.value, playhead)
  const activeClipIds = new Set(active.map((segment) => segment.clipId))

  for (const [clipId, video] of videoPool) {
    if (!activeClipIds.has(clipId)) {
      if (!video.paused) video.pause()
    }
  }

  for (const segment of active) {
    const video = getVideo(segment.clipId)
    if (!video) continue
    const expected = expectedSourceTime(segment, playhead)
    const seekArgs = {
      currentTime: video.currentTime,
      expected,
      playing,
      lastTarget: lastSeekTarget.get(segment.clipId),
    }
    if (shouldSeekToFrame(seekArgs)) requestSeek(video, segment.clipId, expected)
    video.muted = previewMuted.value || segment.muted === true || trackMuted(segment.trackId)
    video.volume = previewVolume.value
    video.playbackRate = playbackRate
    if (playing && video.paused) void video.play().catch(() => {})
    if (!playing && !video.paused) video.pause()
  }
}

function tick(nowMs: number) {
  if (lastTickMs === null) lastTickMs = nowMs
  const deltaSec = ((nowMs - lastTickMs) / 1000) * playbackRate
  lastTickMs = nowMs

  const duration = projectDuration(advancedSegments.value)
  let next = advancedPlayhead.value + deltaSec
  if (next >= duration) {
    next = duration
    advancedPlayhead.value = next
    stopPlayback()
    drawComposite(next)
    return
  }
  advancedPlayhead.value = next
  syncVideos(next, true)
  drawComposite(next)
  rafId = requestAnimationFrame(tick)
}

function startPlayback() {
  if (advancedPlaying.value) return
  if (advancedSegments.value.length === 0) return
  advancedPlaying.value = true
  lastTickMs = null
  syncVideos(advancedPlayhead.value, true)
  rafId = requestAnimationFrame(tick)
}

function stopPlayback() {
  advancedPlaying.value = false
  cancelAnimationFrame(rafId)
  lastTickMs = null
  syncVideos(advancedPlayhead.value, false)
}

export function attachAdvancedPreview(canvas: HTMLCanvasElement): () => void {
  canvasEl = canvas
  ctx = canvas.getContext('2d')
  videoHost = document.createElement('div')
  videoHost.style.display = 'none'
  document.body.appendChild(videoHost)

  // Redraw and re-sync whenever the project or playhead changes while paused.
  disposeDraw = effect(() => {
    // touch dependencies
    void advancedSegments.value
    void advancedCanvas.value
    const playhead = advancedPlayhead.value
    if (!advancedPlaying.value) {
      syncVideos(playhead, false)
      drawComposite(playhead)
    }
  })

  return () => {
    cancelAnimationFrame(rafId)
    disposeDraw?.()
    disposeDraw = null
    for (const video of videoPool.values()) {
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
    videoPool.clear()
    lastSeekTarget.clear()
    pendingSeek.clear()
    lastFrame.clear()
    videoHost?.remove()
    videoHost = null
    canvasEl = null
    ctx = null
  }
}

export function togglePlay() {
  if (advancedPlaying.value) stopPlayback()
  else startPlayback()
}

export function stepFrame(direction: 1 | -1) {
  stopPlayback()
  const duration = projectDuration(advancedSegments.value)
  const next = Math.max(0, Math.min(duration, advancedPlayhead.value + direction * FRAME_STEP))
  advancedPlayhead.value = next
  syncVideos(next, false)
  drawComposite(next)
}

export function seek(time: number) {
  const duration = projectDuration(advancedSegments.value)
  const next = Math.max(0, Math.min(duration, time))
  advancedPlayhead.value = next
  syncVideos(next, advancedPlaying.value)
  drawComposite(next)
}

export function setPlaybackRate(rate: number) {
  playbackRate = rate
  for (const video of videoPool.values()) video.playbackRate = rate
}

// Re-export for the timeline math used by the preview component.
export { projectDuration, segmentDuration }
