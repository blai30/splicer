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

let canvasEl: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null
let videoHost: HTMLDivElement | null = null
let rafId = 0
let playbackRate = 1
let lastTickMs: number | null = null
let disposeDraw: (() => void) | null = null

// One hidden <video> per clip currently needed, keyed by clipId.
const videoPool = new Map<string, HTMLVideoElement>()

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

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const active = segmentsActiveAt(advancedSegments.value, playhead).filter(
    (segment) => !trackHidden(segment.trackId)
  )
  for (const segment of orderedForRender(active, advancedTracks.value)) {
    const video = getVideo(segment.clipId)
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) continue
    const { x, y, width, height } = segment.transform
    ctx.globalAlpha = segment.opacity ?? 1
    if (segment.crop) {
      const crop = segment.crop
      ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height, x, y, width, height)
    } else {
      ctx.drawImage(video, x, y, width, height)
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
    if (Math.abs(video.currentTime - expected) > DRIFT_THRESHOLD || !playing) {
      try {
        video.currentTime = expected
      } catch {
        // Seeking before metadata loads is a no-op; the next tick corrects it.
      }
    }
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
