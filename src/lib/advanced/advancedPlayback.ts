import { effect } from '@preact/signals'

import {
  advancedCanvas,
  advancedPlayhead,
  advancedPlaying,
  advancedSegments,
  advancedSelectedId,
  getClipById,
  previewMuted,
  previewVolume,
} from '@/lib/store'
import type { AdvancedSegment } from '@/lib/types'

const FRAME_STEP = 1 / 30

let canvasEl: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null
let videoEl: HTMLVideoElement | null = null
let rafId = 0
let disposers: (() => void)[] = []

function activeSegment(): AdvancedSegment | null {
  const segments = advancedSegments.value
  if (segments.length === 0) return null
  const selected = segments.find((segment) => segment.id === advancedSelectedId.value)
  return selected ?? segments[0]
}

// Draw the active clip's current frame onto the canvas using its transform.
function drawFrame() {
  if (!ctx || !canvasEl || !videoEl) return
  const canvas = advancedCanvas.value
  if (canvasEl.width !== canvas.width) canvasEl.width = canvas.width
  if (canvasEl.height !== canvas.height) canvasEl.height = canvas.height

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const segment = activeSegment()
  if (segment && videoEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    const { x, y, width, height } = segment.transform
    ctx.drawImage(videoEl, x, y, width, height)
  }
}

function tick() {
  if (!videoEl) return
  advancedPlayhead.value = videoEl.currentTime
  drawFrame()
  rafId = requestAnimationFrame(tick)
}

function syncSource() {
  if (!videoEl) return
  const segment = activeSegment()
  const clip = segment ? getClipById(segment.clipId) : null
  if (!clip) {
    videoEl.removeAttribute('src')
    videoEl.load()
    drawFrame()
    return
  }
  if (videoEl.src !== clip.objectUrl) {
    videoEl.src = clip.objectUrl
    videoEl.load()
    videoEl.onloadeddata = () => drawFrame()
  }
}

function syncAudio() {
  if (!videoEl) return
  videoEl.volume = previewVolume.value
  videoEl.muted = previewMuted.value
}

export function attachAdvancedPreview(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement
): () => void {
  canvasEl = canvas
  ctx = canvas.getContext('2d')
  videoEl = video

  const onPlay = () => {
    advancedPlaying.value = true
    cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(tick)
  }
  const onPause = () => {
    advancedPlaying.value = false
    cancelAnimationFrame(rafId)
    drawFrame()
  }
  video.addEventListener('play', onPlay)
  video.addEventListener('pause', onPause)

  disposers = [effect(syncSource), effect(syncAudio), effect(drawFrame)]

  return () => {
    cancelAnimationFrame(rafId)
    video.removeEventListener('play', onPlay)
    video.removeEventListener('pause', onPause)
    video.onloadeddata = null
    for (const dispose of disposers) dispose()
    disposers = []
    canvasEl = null
    ctx = null
    videoEl = null
  }
}

export function togglePlay() {
  if (!videoEl || !activeSegment()) return
  if (videoEl.paused) {
    void videoEl.play().catch(() => {})
  } else {
    videoEl.pause()
  }
}

export function stepFrame(direction: 1 | -1) {
  if (!videoEl) return
  const next = Math.max(0, videoEl.currentTime + direction * FRAME_STEP)
  videoEl.currentTime = next
  advancedPlayhead.value = next
}

export function seek(time: number) {
  if (!videoEl) return
  const clamped = Math.max(0, Math.min(videoEl.duration || time, time))
  videoEl.currentTime = clamped
  advancedPlayhead.value = clamped
}
