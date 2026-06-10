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

const FRAME_STEP = 1 / 30

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

export function getActiveSegmentInfo(): ActiveSegmentInfo | null {
  const segId = selectedSegmentId.value ?? timeline.value[0]?.id
  if (!segId) return null
  const segment = timeline.value.find((segment) => segment.id === segId)
  if (!segment) return null
  const clip = getClipById(segment.clipId)
  if (!clip) return null
  return { url: clip.objectUrl, start: segment.startTime, end: segment.endTime, segment, clip }
}

function tickPlayhead() {
  if (!video) return
  const info = getActiveSegmentInfo()
  const segStart = info?.start ?? 0
  playheadTime.value = video.currentTime
  currentPlaybackTime.value = Math.max(0, video.currentTime - segStart)
  rafId = requestAnimationFrame(tickPlayhead)
}

function onPlay() {
  playing.value = true
  rafId = requestAnimationFrame(tickPlayhead)
}

function onPause() {
  playing.value = false
  cancelAnimationFrame(rafId)
}

// Auto-advance: when playback reaches the segment end, move to the next
// segment (resuming playback) or stop and rewind selection to the first.
function onTimeUpdate() {
  if (!video) return
  const info = getActiveSegmentInfo()
  const segEnd = info?.end ?? video.duration

  if (video.currentTime >= segEnd) {
    const segments = timeline.value
    const currentIndex = segments.findIndex((segment) => segment.id === info?.segment.id)
    const nextSeg = segments[currentIndex + 1]
    if (nextSeg && playing.value) {
      resumeAfterSwitch = true
      selectedSegmentId.value = nextSeg.id
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
    videoElement.removeAttribute('src')
    videoElement.load()
    currentSegmentDuration.value = 0
    currentPlaybackTime.value = 0
    playing.value = false
    return
  }

  const segmentMuted = info.segment.muted ?? false
  videoElement.muted = previewMuted.value || segmentMuted

  const resume = resumeAfterSwitch
  resumeAfterSwitch = false

  if (videoElement.src !== info.url) {
    videoElement.src = info.url
    videoElement.load()
    videoElement.onloadedmetadata = () => {
      videoElement.currentTime = info.start
      currentSegmentDuration.value = info.end - info.start
      currentPlaybackTime.value = 0
      if (resume) videoElement.play()
    }
  } else {
    currentSegmentDuration.value = info.end - info.start
    if (videoElement.currentTime < info.start || videoElement.currentTime >= info.end) {
      videoElement.currentTime = info.start
      currentPlaybackTime.value = 0
    }
    if (resume && videoElement.paused) videoElement.play()
  }
}

export function attachVideo(element: HTMLVideoElement) {
  video = element
  element.addEventListener('play', onPlay)
  element.addEventListener('pause', onPause)
  element.addEventListener('timeupdate', onTimeUpdate)
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
    video.removeEventListener('timeupdate', onTimeUpdate)
  }
  cancelAnimationFrame(rafId)
  disposeEffects?.()
  disposeEffects = null
  video = null
}

export function togglePlay() {
  if (!video) return
  const info = getActiveSegmentInfo()
  if (video.paused) {
    if (info && video.currentTime >= info.end) video.currentTime = info.start
    video.play()
  } else {
    video.pause()
  }
}

export function stepFrame(direction: 1 | -1) {
  if (!video) return
  const info = getActiveSegmentInfo()
  const segStart = info?.start ?? 0
  const segEnd = info?.end ?? video.duration
  const nextTime =
    direction === 1
      ? Math.min(segEnd, video.currentTime + FRAME_STEP)
      : Math.max(segStart, video.currentTime - FRAME_STEP)
  video.currentTime = nextTime
  playheadTime.value = nextTime
  currentPlaybackTime.value = Math.max(0, nextTime - segStart)
}

export function seek(time: number) {
  playheadTime.value = time
  if (video) video.currentTime = time
}

export function setPlaybackRate(rate: number) {
  if (!video) return
  // defaultPlaybackRate keeps the rate across src switches between segments.
  video.defaultPlaybackRate = rate
  video.playbackRate = rate
}
