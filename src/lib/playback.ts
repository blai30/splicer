import { batch, effect } from '@preact/signals'

import {
  currentPlaybackTime,
  currentSegmentDuration,
  getClipById,
  playbackRate,
  playing,
  playheadTime,
  previewMuted,
  previewVolume,
  selectedSegmentId,
  shuttleRate,
  timeline,
} from '@/lib/store'
import { cutTimes, globalTimeOf, segmentAtGlobalTime, totalDuration } from '@/lib/timelineDomain'
import type { Clip, Segment } from '@/lib/types'

const DEFAULT_FRAME_RATE = 30
// Shuttle speeds, in multiples of normal speed. Each further J or L press
// moves one step faster in that direction.
const SHUTTLE_SPEEDS = [1, 2, 4, 8]

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
// Set by the end-of-timeline reset so the next same-source sync rewinds even
// when the position sits exactly on the segment's out-point.
let rewindOnSync = false
// Set when a scrub paused playback, so its release resumes it.
let resumeAfterScrub = false
// Reverse shuttle: browsers reject negative playbackRate, so reverse play is a
// frame loop that seeks backwards. The position runs ahead of the video while
// a seek is still decoding; the next free frame catches up.
let reverseFrameId = 0
let reverseLastMs: number | null = null
let reversePosition = 0

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
  const time = video.currentTime
  // One notification per frame for both time signals.
  batch(() => {
    playheadTime.value = time
    currentPlaybackTime.value = Math.max(0, time - segmentStart)
  })
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
  stopReverse()
  playing.value = true
  startTicking()
}

function onPause() {
  playing.value = false
  stopTicking()
  // A forward shuttle ends with playback. Reverse pauses the element on
  // purpose, and this event arrives after it starts, so it is left alone.
  if ((shuttleRate.peek() ?? 0) > 0) shuttleRate.value = null
}

function frameDuration(clip: Clip | undefined): number {
  return 1 / (clip?.frameRate || DEFAULT_FRAME_RATE)
}

// The chosen speed, or a faster forward shuttle on top of it.
function syncRate() {
  if (!video) return
  const shuttle = shuttleRate.value
  const rate = shuttle !== null && shuttle > 0 ? shuttle : playbackRate.value
  // defaultPlaybackRate keeps the rate across src switches between segments.
  video.defaultPlaybackRate = rate
  video.playbackRate = rate
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
      const first = segments[0]
      if (first) {
        // Reset to the start of the timeline. When the first segment is already
        // selected or shares this clip, no source switch happens, so rewind here.
        rewindOnSync = true
        selectedSegmentId.value = first.id
        if (rewindOnSync && video.src === getActiveSegmentInfo()?.url) {
          rewindOnSync = false
          video.currentTime = first.startTime
          playheadTime.value = first.startTime
        }
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
    // Until the new source reports its position, rest the playhead at the
    // segment start: the old source's time means nothing in this clip, and the
    // timeline would otherwise draw (and follow) it at a stale spot. A seek
    // issued right after the switch still overrides this.
    batch(() => {
      playheadTime.value = info.start
      currentPlaybackTime.value = 0
    })
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
    const forceRewind = autoAdvance || rewindOnSync
    rewindOnSync = false
    const pastEnd = forceRewind ? time >= info.end : time > info.end + 1e-3
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
  const disposeRate = effect(syncRate)
  disposeEffects = () => {
    disposeSource()
    disposeAudio()
    disposeRate()
  }
}

export function detachVideo() {
  stopReverse()
  shuttleRate.value = null
  if (video) {
    video.removeEventListener('play', onPlay)
    video.removeEventListener('pause', onPause)
    video.removeEventListener('timeupdate', advanceAtSegmentEnd)
    video.onloadedmetadata = null
  }
  stopTicking()
  pendingSeekTime = null
  resumeAfterSwitch = false
  rewindOnSync = false
  resumeAfterScrub = false
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
  // Reverse shows as running, so the same toggle stops it.
  if (stopReverse()) return
  if (video.paused) {
    if (video.currentTime >= info.end - 1e-3) {
      // At the very end of the timeline, play it again from the top.
      if (info.segment.id === timeline.value.at(-1)?.id) goToStart()
      else video.currentTime = info.start
    }
    playSafely(video)
  } else {
    video.pause()
  }
}

export function stepFrame(direction: 1 | -1) {
  if (!video) return
  const info = getActiveSegmentInfo()
  if (!info) return
  stopReverse()
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
  stopReverse()
  seekSource(time)
}

// Seek within the active segment's source without touching the shuttle.
function seekSource(time: number) {
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

// Jump to the start of the first segment.
export function goToStart() {
  const first = timeline.value[0]
  if (!first) return
  stopReverse()
  if (video && !video.paused) video.pause()
  selectedSegmentId.value = first.id
  seek(first.startTime)
}

// A scrub holds playback still while the pointer moves the playhead (crossing
// cuts would otherwise race the auto-advance), then resumes on release.
export function beginScrub() {
  if (!video || video.paused) return
  resumeAfterScrub = true
  video.pause()
}

export function endScrub() {
  if (!video || !resumeAfterScrub) return
  resumeAfterScrub = false
  playSafely(video)
}

// The playhead on the whole edited timeline (null when it is empty).
function activeGlobalTime(): number | null {
  const info = getActiveSegmentInfo()
  if (!info) return null
  return globalTimeOf(timeline.value, info.segment.id, playheadTime.value)
}

// Seek to a time on the whole edited timeline, selecting the segment there.
function seekGlobal(globalTime: number) {
  const segments = timeline.value
  const clamped = Math.max(0, Math.min(totalDuration(segments), globalTime))
  const hit = segmentAtGlobalTime(segments, clamped)
  if (!hit) return
  selectedSegmentId.value = hit.segment.id
  seek(hit.localTime)
}

// Jump to the last frame of the timeline and stop there.
export function goToEnd() {
  const last = timeline.value.at(-1)
  if (!last) return
  stopReverse()
  if (video && !video.paused) video.pause()
  selectedSegmentId.value = last.id
  seek(last.endTime)
}

// Down (1) goes to the next cut, or the end of the timeline. Up (-1) goes to
// the start of the current segment, or to the previous cut when already
// within a frame of it, so repeated presses keep walking back. Playback keeps
// running across a jump, except at the end.
export function goToAdjacentCut(direction: 1 | -1) {
  const current = activeGlobalTime()
  if (current === null) return
  const segments = timeline.value
  const cuts = cutTimes(segments)
  const end = cuts[cuts.length - 1]
  if (direction === 1) {
    const next = cuts.find((time) => time > current + 1e-6)
    if (next === undefined || next >= end - 1e-9) goToEnd()
    else seekGlobal(next)
    return
  }
  const frame = frameDuration(getActiveSegmentInfo()?.clip)
  const previous = cuts.filter((time) => time < current - frame - 1e-6).at(-1) ?? 0
  seekGlobal(previous)
}

// Move the paused playhead by whole seconds across cuts (Shift+Arrow).
export function stepSeconds(seconds: number) {
  const current = activeGlobalTime()
  if (current === null) return
  if (video && !video.paused) video.pause()
  seekGlobal(current + seconds)
}

function nextShuttleSpeed(current: number): number {
  return SHUTTLE_SPEEDS.find((speed) => speed > current) ?? SHUTTLE_SPEEDS.at(-1)!
}

// J/K/L shuttle. L plays forward, and each further press while playing goes
// faster; J does the same in reverse; K stops and returns to normal speed.
export function shuttle(key: 'j' | 'k' | 'l') {
  if (!video || !getActiveSegmentInfo()) return
  const current = shuttleRate.peek()
  if (key === 'k') {
    stopReverse()
    if (!video.paused) video.pause()
    shuttleRate.value = null
    return
  }
  if (key === 'l') {
    if (stopReverse() || video.paused) {
      shuttleRate.value = null
      togglePlay()
      return
    }
    // Already playing forward: one step past the current speed.
    const speed = current !== null && current > 0 ? current : playbackRate.peek()
    shuttleRate.value = nextShuttleSpeed(speed)
    return
  }
  const reverseSpeed = current !== null && current < 0 ? nextShuttleSpeed(-current) : 1
  startReverse(reverseSpeed)
}

function startReverse(speed: number) {
  const element = video
  const info = getActiveSegmentInfo()
  if (!element || !info) return
  if (!element.paused) element.pause()
  shuttleRate.value = -speed
  if (reverseFrameId) return
  reversePosition = Math.min(info.end, Math.max(info.start, element.currentTime))
  reverseLastMs = null
  reverseFrameId = requestAnimationFrame(reverseTick)
}

// Ends reverse play, leaving the video on the last reverse position. Returns
// whether reverse was running.
function stopReverse(): boolean {
  if (!reverseFrameId) return false
  cancelAnimationFrame(reverseFrameId)
  finishReverse()
  return true
}

function finishReverse() {
  reverseFrameId = 0
  reverseLastMs = null
  if ((shuttleRate.peek() ?? 0) < 0) shuttleRate.value = null
  seekSource(reversePosition)
}

function reverseTick(nowMs: number) {
  reverseFrameId = 0
  const element = video
  const info = getActiveSegmentInfo()
  if (!element || !info) {
    if ((shuttleRate.peek() ?? 0) < 0) shuttleRate.value = null
    return
  }
  // Hold still while a new source loads, so a cut does not swallow time.
  const loading = element.readyState < HTMLMediaElement.HAVE_METADATA
  const elapsed = reverseLastMs === null || loading ? 0 : (nowMs - reverseLastMs) / 1000
  reverseLastMs = nowMs
  const speed = -(shuttleRate.peek() ?? -1)
  const next = reversePosition - elapsed * speed

  if (next <= info.start) {
    const segments = timeline.value
    const index = segments.findIndex((segment) => segment.id === info.segment.id)
    const previous = segments[index - 1]
    if (!previous) {
      // Reached the start of the timeline.
      reversePosition = info.start
      finishReverse()
      return
    }
    // Continue from the last frame of the previous segment.
    const lastFrame = previous.endTime - frameDuration(getClipById(previous.clipId))
    reversePosition = Math.max(previous.startTime, lastFrame)
    selectedSegmentId.value = previous.id
    seekSource(reversePosition)
  } else {
    reversePosition = next
    batch(() => {
      playheadTime.value = next
      currentPlaybackTime.value = next - info.start
    })
    // Let an in-flight seek finish rather than restarting the decoder.
    if (!loading && !element.seeking) element.currentTime = next
  }
  reverseFrameId = requestAnimationFrame(reverseTick)
}

// The speed selector: a new choice also ends a forward shuttle, so it applies.
export function setPlaybackSpeed(rate: number) {
  playbackRate.value = rate
  if ((shuttleRate.peek() ?? 0) > 0) shuttleRate.value = null
}
