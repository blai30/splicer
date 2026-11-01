import { effect } from '@preact/signals'

import {
  currentPlaybackTime,
  currentSegmentDuration,
  getClipById,
  playing,
  playheadTime,
  previewMuted,
  previewVolume,
  selectedSegmentId,
  timeline,
} from '@/lib/store'
import type { Clip, Segment } from '@/lib/types'

const DEFAULT_FRAME_RATE = 30

type ActiveSegmentInfo = {
  url: string
  start: number
  end: number
  segment: Segment
  clip: Clip
}

// The playback module is the only writer of the video element and of the
// playing/playheadTime/currentPlaybackTime/currentSegmentDuration signals.
let video: HTMLVideoElement | null = null
let rafId = 0
let resumeAfterSwitch = false
let disposeEffects: (() => void) | null = null
// Seek requested while a source switch is still loading metadata; applied in
// onloadedmetadata instead of being overwritten by the segment start.
let pendingSeekTime: number | null = null

// play() rejects when interrupted by a later load() or when no source is set;
// neither case should surface as an unhandled rejection.
function playSafely(element: HTMLVideoElement) {
  element.play().catch(() => {})
}

export function getActiveSegmentInfo(): ActiveSegmentInfo | null {
  const segmentId = selectedSegmentId.value ?? timeline.value[0]?.id
  if (!segmentId) return null
  const segment = timeline.value.find((segment) => segment.id === segmentId)
  if (!segment) return null
  const clip = getClipById(segment.clipId)
  if (!clip) return null
  return { url: clip.objectUrl, start: segment.startTime, end: segment.endTime, segment, clip }
}

function tickPlayhead() {
  if (!video) return
  const info = getActiveSegmentInfo()
  const segmentStart = info?.start ?? 0
  playheadTime.value = video.currentTime
  currentPlaybackTime.value = Math.max(0, video.currentTime - segmentStart)
  // Check the segment boundary every frame: timeupdate alone fires only a few
  // times per second, letting playback overshoot the out-point audibly.
  advanceAtSegmentEnd()
  if (rafId) rafId = requestAnimationFrame(tickPlayhead)
}

// Exactly one playhead loop runs at a time; 0 means none.
function startTicking() {
  stopTicking()
  rafId = requestAnimationFrame(tickPlayhead)
}

function stopTicking() {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
}

function onPlay() {
  playing.value = true
  startTicking()
}

function onPause() {
  playing.value = false
  stopTicking()
}

// Auto-advance: when playback reaches the segment end, move to the next
// segment (resuming playback) or stop and rewind selection to the first.
// Only applies during playback; a paused seek or frame step that lands on the
// segment end must not reset the selection. Gates on the playing signal rather
// than video.paused because paused already reads true during the final
// timeupdate when the media runs out.
function advanceAtSegmentEnd() {
  if (!video || !playing.value) return
  const info = getActiveSegmentInfo()
  const segmentEnd = info?.end ?? video.duration

  if (video.currentTime >= segmentEnd) {
    const segments = timeline.value
    const currentIndex = segments.findIndex((segment) => segment.id === info?.segment.id)
    const nextSegment = segments[currentIndex + 1]
    if (nextSegment) {
      resumeAfterSwitch = true
      selectedSegmentId.value = nextSegment.id
    } else {
      video.pause()
      playing.value = false
      currentPlaybackTime.value = 0
      if (segments.length > 0) {
        selectedSegmentId.value = segments[0].id
      }
    }
  }
}

function syncAudio() {
  if (!video) return
  video.volume = previewVolume.value
  const segmentMuted = getActiveSegmentInfo()?.segment.muted ?? false
  video.muted = previewMuted.value || segmentMuted
}

// Keep the video element pointed at the active segment: switch src when the
// selected clip changes, clamp the position into the segment range, and
// resume playback after an auto-advance switch.
function syncSource() {
  const videoElement = video
  if (!videoElement) return

  const info = getActiveSegmentInfo()
  if (!info) {
    stopTicking()
    videoElement.removeAttribute('src')
    videoElement.load()
    currentSegmentDuration.value = 0
    currentPlaybackTime.value = 0
    playing.value = false
    return
  }

  const segmentMuted = info.segment.muted ?? false
  videoElement.muted = previewMuted.value || segmentMuted

  const autoAdvance = resumeAfterSwitch
  resumeAfterSwitch = false

  if (videoElement.src !== info.url) {
    // Switching clips mid-playback (auto-advance or the user picking another
    // segment) keeps playing; load() itself stops the element.
    const resume = autoAdvance || !videoElement.paused
    stopTicking()
    videoElement.src = info.url
    videoElement.load()
    if (!resume) playing.value = false
    videoElement.onloadedmetadata = () => {
      // A seek issued while the new source was loading wins over the default
      // segment start (e.g. clicking into a segment from a different clip).
      const startTime =
        pendingSeekTime !== null
          ? Math.min(info.end, Math.max(info.start, pendingSeekTime))
          : info.start
      pendingSeekTime = null
      videoElement.currentTime = startTime
      playheadTime.value = startTime
      currentSegmentDuration.value = info.end - info.start
      currentPlaybackTime.value = startTime - info.start
      if (resume) playSafely(videoElement)
    }
  } else {
    currentSegmentDuration.value = info.end - info.start
    // Rewind only when the position is outside the segment. A paused playhead
    // resting exactly on the out-point stays put (mute toggles and unrelated
    // edits re-run this effect); auto-advance landing on it restarts.
    const time = videoElement.currentTime
    const pastEnd = autoAdvance ? time >= info.end : time > info.end + 1e-3
    if (time < info.start - 1e-3 || pastEnd) {
      videoElement.currentTime = info.start
      playheadTime.value = info.start
      currentPlaybackTime.value = 0
    }
    if (autoAdvance && videoElement.paused) playSafely(videoElement)
  }
}

export function attachVideo(element: HTMLVideoElement) {
  video = element
  element.addEventListener('play', onPlay)
  element.addEventListener('pause', onPause)
  element.addEventListener('timeupdate', advanceAtSegmentEnd)
  const disposeSource = effect(syncSource)
  const disposeAudio = effect(syncAudio)
  disposeEffects = () => {
    disposeSource()
    disposeAudio()
  }
}

export function detachVideo() {
  if (video) {
    video.removeEventListener('play', onPlay)
    video.removeEventListener('pause', onPause)
    video.removeEventListener('timeupdate', advanceAtSegmentEnd)
    video.onloadedmetadata = null
  }
  stopTicking()
  pendingSeekTime = null
  resumeAfterSwitch = false
  playing.value = false
  disposeEffects?.()
  disposeEffects = null
  video = null
}

export function togglePlay() {
  if (!video) return
  const info = getActiveSegmentInfo()
  // Nothing to play when the timeline is empty; calling play() on a video
  // without a source leaves a dangling rejected promise.
  if (!info) return
  if (video.paused) {
    if (video.currentTime >= info.end - 1e-3) video.currentTime = info.start
    playSafely(video)
  } else {
    video.pause()
  }
}

export function stepFrame(direction: 1 | -1) {
  if (!video) return
  const info = getActiveSegmentInfo()
  if (!info) return
  if (!video.paused) video.pause()
  const segmentStart = info.start
  const segmentEnd = info.end
  const frameStep = 1 / (info.clip.frameRate || DEFAULT_FRAME_RATE)
  const nextTime =
    direction === 1
      ? Math.min(segmentEnd, video.currentTime + frameStep)
      : Math.max(segmentStart, video.currentTime - frameStep)
  video.currentTime = nextTime
  playheadTime.value = nextTime
  currentPlaybackTime.value = Math.max(0, nextTime - segmentStart)
}

export function seek(time: number) {
  playheadTime.value = time
  const info = getActiveSegmentInfo()
  if (info) currentPlaybackTime.value = Math.max(0, Math.min(info.end, time) - info.start)
  if (!video) return
  if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
    // Metadata for a source switch is still loading; defer the seek so the
    // onloadedmetadata handler applies it instead of the segment start.
    pendingSeekTime = time
  } else {
    video.currentTime = time
  }
}

export function setPlaybackRate(rate: number) {
  if (!video) return
  // defaultPlaybackRate keeps the rate across src switches between segments.
  video.defaultPlaybackRate = rate
  video.playbackRate = rate
}

// Jump to the start of the first segment.
export function goToStart() {
  const first = timeline.value[0]
  if (!first) return
  if (video && !video.paused) video.pause()
  selectedSegmentId.value = first.id
  seek(first.startTime)
}
