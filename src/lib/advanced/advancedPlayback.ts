import { effect } from '@preact/signals'

import {
  orderedForRender,
  projectDuration,
  segmentDuration,
  segmentsActiveAt,
} from '@/lib/advanced/advancedTimelineDomain'
import {
  advancedPlayhead,
  advancedPlaying,
  advancedSegments,
  advancedTracks,
  advancedViewport,
  getClipById,
  playbackRate,
  previewMuted,
  previewVolume,
} from '@/lib/store'
import type { AdvancedSegment } from '@/lib/types'

const DEFAULT_FRAME_RATE = 30
const DRIFT_THRESHOLD = 0.18
// While paused we compare against the last requested seek target (not the
// snapped read-back currentTime), so anything above float noise means the
// target actually changed (a scrub/step) rather than an unrelated redraw.
const PAUSED_SEEK_EPSILON = 0.0005

let canvasEl: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null
let videoHost: HTMLDivElement | null = null
let rafId = 0
let lastTickMs: number | null = null
let disposeDraw: (() => void) | null = null

// One hidden <video> per placed segment, keyed by segment id. Two segments of
// the same clip can be on screen at once at different source times, so they
// cannot share an element.
const videoPool = new Map<string, HTMLVideoElement>()

// The last source time we requested each video seek to, keyed by segment id. Used
// to avoid re-seeking a paused video to a frame it is already showing (a
// transform drag replaces advancedSegments every move, re-running the paused
// redraw effect; re-seeking on each of those would flicker the clip).
const lastSeekTarget = new Map<string, number>()

// The latest target a video should seek to once its in-flight seek finishes,
// keyed by segment id. Setting currentTime while a seek is in progress cancels it
// and restarts decoding; doing that every pointermove (scrubbing the playhead)
// keeps the decoder perpetually busy, drops readyState, and blanks the canvas.
// Instead we let one seek finish, then chase the most recent target.
const pendingSeek = new Map<string, number>()

// Per-segment cache of the most recently decoded frame. While scrubbing, a video is
// often mid-seek when we redraw (readyState dips below HAVE_CURRENT_DATA); rather
// than skip the layer and flash the checkerboard, we draw its last good frame.
// Preview-only smoothing; the export composites exact frames at grid times.
const lastFrame = new Map<string, HTMLCanvasElement>()
// The video time each cached frame was copied at.
const lastFrameTime = new Map<string, number>()

// Whether a layer's cached frame is stale: the video shows a different time,
// or its size changed. Redraws for edits (a transform drag fires one per
// pointermove) leave the video where it was, so they skip the full-size copy.
export function frameCacheStale(
  cachedTime: number | undefined,
  cache: { width: number; height: number } | undefined,
  video: { currentTime: number; videoWidth: number; videoHeight: number }
): boolean {
  return (
    cachedTime !== video.currentTime ||
    cache?.width !== video.videoWidth ||
    cache?.height !== video.videoHeight
  )
}

// Pick what to draw for a layer: the live video when it has a current frame
// (also refreshing the cache while paused), otherwise the cached last frame.
function frameSource(key: string, video: HTMLVideoElement): CanvasImageSource | null {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
    let cache = lastFrame.get(key)
    // Mid-seek, currentTime already reads the target while the old frame
    // still shows; copying then would file the old picture under the new time.
    const settled = !advancedPlaying.value && !video.seeking
    if (settled && frameCacheStale(lastFrameTime.get(key), cache, video)) {
      if (!cache) {
        cache = document.createElement('canvas')
        lastFrame.set(key, cache)
      }
      if (cache.width !== video.videoWidth) cache.width = video.videoWidth
      if (cache.height !== video.videoHeight) cache.height = video.videoHeight
      cache.getContext('2d')?.drawImage(video, 0, 0)
      lastFrameTime.set(key, video.currentTime)
    }
    return video
  }
  return lastFrame.get(key) ?? null
}

// Runs `draw` at most once per animation frame however often it is asked for.
export function createFrameCoalescer(
  draw: () => void,
  requestFrame: (callback: () => void) => number = requestAnimationFrame,
  cancelFrame: (id: number) => void = cancelAnimationFrame
) {
  let frameId = 0
  return {
    schedule() {
      if (frameId) return
      frameId = requestFrame(() => {
        frameId = 0
        draw()
      })
    },
    cancel() {
      if (frameId) cancelFrame(frameId)
      frameId = 0
    },
  }
}

// Paused redraws (seeks landing, edits, scrubs) share one draw per frame.
let pausedDraw: ReturnType<typeof createFrameCoalescer> | null = null

function schedulePausedDraw() {
  pausedDraw?.schedule()
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
function requestSeek(video: HTMLVideoElement, key: string, target: number) {
  if (video.seeking) {
    pendingSeek.set(key, target)
    return
  }
  try {
    video.currentTime = target
    lastSeekTarget.set(key, target)
  } catch {
    // Seeking before metadata loads is a no-op; the next tick corrects it.
  }
}

function getVideo(segment: AdvancedSegment): HTMLVideoElement | null {
  const key = segment.id
  const clip = getClipById(segment.clipId)
  if (!clip || !videoHost) return null
  let video = videoPool.get(key)
  if (video && video.dataset.src !== clip.objectUrl) {
    // The segment now points at a different clip URL; rebuild its element.
    releaseVideo(key)
    video = undefined
  }
  if (!video) {
    video = document.createElement('video')
    video.playsInline = true
    video.preload = 'auto'
    video.src = clip.objectUrl
    video.dataset.src = clip.objectUrl
    video.muted = true
    // A seek or initial load decodes the frame asynchronously; when that
    // completes while paused, redraw so the canvas shows the current frame
    // instead of staying black. The rAF loop covers redraws during playback.
    const redrawIfPaused = () => {
      if (!advancedPlaying.value) schedulePausedDraw()
    }
    // When a seek finishes, show the freshly decoded frame, then chase the most
    // recent target queued while it was running (smooth playhead scrubbing).
    const onSeeked = () => {
      redrawIfPaused()
      const pending = pendingSeek.get(key)
      if (pending !== undefined) {
        pendingSeek.delete(key)
        requestSeek(video as HTMLVideoElement, key, pending)
      }
    }
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('loadeddata', redrawIfPaused)
    videoHost.appendChild(video)
    videoPool.set(key, video)
  }
  return video
}

function releaseVideo(segmentId: string) {
  const video = videoPool.get(segmentId)
  if (video) {
    video.pause()
    video.removeAttribute('src')
    video.load()
    video.remove()
  }
  videoPool.delete(segmentId)
  lastSeekTarget.delete(segmentId)
  pendingSeek.delete(segmentId)
  lastFrame.delete(segmentId)
  lastFrameTime.delete(segmentId)
}

// Release elements for segments that no longer exist (deleted, split, undone).
function pruneVideos() {
  const live = new Set(advancedSegments.value.map((segment) => segment.id))
  for (const segmentId of videoPool.keys()) {
    if (!live.has(segmentId)) releaseVideo(segmentId)
  }
}

function trackHidden(trackId: string): boolean {
  return advancedTracks.value.find((track) => track.id === trackId)?.hidden === true
}

function trackMuted(trackId: string): boolean {
  return advancedTracks.value.find((track) => track.id === trackId)?.muted === true
}

// The time to show for a playhead. At (or past) the very end no segment is
// active (ranges are end-exclusive), which would blank the preview; show the
// final frame instead.
export function displayTime(playhead: number): number {
  const duration = projectDuration(advancedSegments.value)
  if (duration > 0 && playhead >= duration) return Math.max(0, duration - 1e-3)
  return playhead
}

function expectedSourceTime(segment: AdvancedSegment, playhead: number): number {
  return segment.sourceStart + (playhead - segment.timelineStart)
}

// Draw all active, non-hidden layers onto the canvas, ordered bottom lane first.
// The canvas backing store matches the displayed stage (CSS px x devicePixelRatio)
// and clips are drawn in world coordinates under the pan/zoom viewport transform.
function drawComposite(requested: number) {
  if (!ctx || !canvasEl) return
  const playhead = displayTime(requested)
  const viewport = advancedViewport.value
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const backingWidth = Math.max(1, Math.round(canvasEl.clientWidth * dpr))
  const backingHeight = Math.max(1, Math.round(canvasEl.clientHeight * dpr))
  if (canvasEl.width !== backingWidth) canvasEl.width = backingWidth
  if (canvasEl.height !== backingHeight) canvasEl.height = backingHeight

  // Clear to transparent so the stage background (dark + dotted grid) shows in
  // empty areas. This is a preview-only editing aid; export fills uncovered
  // areas black, mirroring the previous checkerboard behavior.
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, backingWidth, backingHeight)

  // world -> backing px: scale by dpr*zoom, translate by -pan (in world units).
  const scale = dpr * viewport.zoom
  ctx.setTransform(scale, 0, 0, scale, -viewport.panX * scale, -viewport.panY * scale)

  const active = segmentsActiveAt(advancedSegments.value, playhead).filter(
    (segment) => !trackHidden(segment.trackId)
  )
  for (const segment of orderedForRender(active, advancedTracks.value)) {
    const video = getVideo(segment)
    if (!video) continue
    const source = frameSource(segment.id, video)
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
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

// The clip's own volume scales the master preview volume, matching the export
// mix. Media elements reject values above 1, so louder-than-source clips cap.
export function segmentPreviewVolume(masterVolume: number, segmentVolume = 1): number {
  const volume = masterVolume * segmentVolume
  return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0
}

// Keep each active source's video element synced to the playhead; play/pause and
// mute follow the global clock and track/clip mute. Idle clips are paused.
function syncVideos(requested: number, playing: boolean) {
  pruneVideos()
  const playhead = displayTime(requested)
  const active = segmentsActiveAt(advancedSegments.value, playhead)
  const activeIds = new Set(active.map((segment) => segment.id))

  for (const [segmentId, video] of videoPool) {
    if (activeIds.has(segmentId)) continue
    if (!video.paused) video.pause()
    // Its position no longer matches any requested target.
    lastSeekTarget.delete(segmentId)
  }

  for (const segment of active) {
    const video = getVideo(segment)
    if (!video) continue
    const expected = expectedSourceTime(segment, playhead)
    const seekArgs = {
      currentTime: video.currentTime,
      expected,
      playing,
      lastTarget: lastSeekTarget.get(segment.id),
    }
    if (shouldSeekToFrame(seekArgs)) requestSeek(video, segment.id, expected)
    video.muted = previewMuted.value || segment.muted === true || trackMuted(segment.trackId)
    video.volume = segmentPreviewVolume(previewVolume.value, segment.volume)
    video.playbackRate = playbackRate.peek()
    if (playing && video.paused) void video.play().catch(() => {})
    if (!playing && !video.paused) video.pause()
  }
}

function tick(nowMs: number) {
  if (lastTickMs === null) lastTickMs = nowMs
  const deltaSec = ((nowMs - lastTickMs) / 1000) * playbackRate.peek()
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
  // Pressing play at the end restarts from the beginning.
  const duration = projectDuration(advancedSegments.value)
  if (advancedPlayhead.value >= duration - 1e-3) advancedPlayhead.value = 0
  // Playing moves every video away from its last paused target, so the next
  // paused seek must not be skipped as "already there".
  lastSeekTarget.clear()
  pendingSeek.clear()
  advancedPlaying.value = true
  lastTickMs = null
  syncVideos(advancedPlayhead.value, true)
  rafId = requestAnimationFrame(tick)
}

// The paused effect re-syncs the videos when advancedPlaying flips.
function stopPlayback() {
  cancelAnimationFrame(rafId)
  lastTickMs = null
  if (advancedPlaying.value) advancedPlaying.value = false
}

export function attachAdvancedPreview(canvas: HTMLCanvasElement): () => void {
  canvasEl = canvas
  ctx = canvas.getContext('2d')
  videoHost = document.createElement('div')
  videoHost.style.display = 'none'
  document.body.appendChild(videoHost)

  pausedDraw = createFrameCoalescer(() => {
    if (!advancedPlaying.value) drawComposite(advancedPlayhead.peek())
  })

  // Re-sync whenever the project or playhead changes while paused, so seeks
  // start right away, and redraw once on the next frame.
  disposeDraw = effect(() => {
    // touch dependencies
    void advancedSegments.value
    void advancedViewport.value
    const playhead = advancedPlayhead.value
    if (!advancedPlaying.value) {
      syncVideos(playhead, false)
      schedulePausedDraw()
    }
  })

  return () => {
    cancelAnimationFrame(rafId)
    advancedPlaying.value = false
    lastTickMs = null
    disposeDraw?.()
    disposeDraw = null
    pausedDraw?.cancel()
    pausedDraw = null
    for (const video of videoPool.values()) {
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
    videoPool.clear()
    lastSeekTarget.clear()
    pendingSeek.clear()
    lastFrame.clear()
    lastFrameTime.clear()
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

// One frame of the fastest clip under the playhead (or of any placed clip).
function frameStepSeconds(): number {
  const segments = advancedSegments.value
  const active = segmentsActiveAt(segments, advancedPlayhead.value)
  let fastest = 0
  for (const segment of active.length > 0 ? active : segments) {
    fastest = Math.max(fastest, getClipById(segment.clipId)?.frameRate ?? 0)
  }
  return 1 / (fastest || DEFAULT_FRAME_RATE)
}

export function stepFrame(direction: 1 | -1) {
  stopPlayback()
  const duration = projectDuration(advancedSegments.value)
  const next = Math.max(
    0,
    Math.min(duration, advancedPlayhead.value + direction * frameStepSeconds())
  )
  // Paused, so the effect syncs and redraws.
  advancedPlayhead.value = next
}

export function seek(time: number) {
  const duration = projectDuration(advancedSegments.value)
  const next = Math.max(0, Math.min(duration, time))
  advancedPlayhead.value = next
  // While paused the effect syncs and redraws; the playback loop only
  // corrects drift, so a jump during playback re-syncs here.
  if (advancedPlaying.value) {
    syncVideos(next, true)
    drawComposite(next)
  }
}

// Re-export for the timeline math used by the preview component.
export { projectDuration, segmentDuration }
