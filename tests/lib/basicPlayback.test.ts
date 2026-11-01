import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  attachVideo,
  beginEdgePreview,
  beginScrub,
  detachVideo,
  endEdgePreview,
  endScrub,
  goToAdjacentCut,
  goToEnd,
  previewEdgeFrame,
  setPlaybackSpeed,
  shuttle,
  stepSeconds,
  togglePlay,
} from '@/lib/playback'
import {
  clips,
  currentPlaybackTime,
  playbackRate,
  playheadTime,
  playing,
  selectedSegmentId,
  shuttleRate,
  timeline,
  transportRunning,
} from '@/lib/store'
import type { Clip } from '@/lib/types'

// Just enough of a media element for the playback module: load() drops the
// position as a real source switch does, and listeners are kept so the test
// can fire the end-of-segment check by hand.
class FakeVideo {
  src = ''
  currentTime = 0
  paused = true
  readyState = 0
  seeking = false
  playbackRate = 1
  defaultPlaybackRate = 1
  muted = false
  volume = 1
  onloadedmetadata: (() => void) | null = null
  listeners = new Map<string, () => void>()
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, listener)
  }
  removeEventListener(type: string) {
    this.listeners.delete(type)
  }
  load() {
    this.currentTime = 0
    this.readyState = 0
  }
  playCalls = 0
  play() {
    this.playCalls += 1
    this.paused = false
    return Promise.resolve()
  }
  pause() {
    this.paused = true
  }
  removeAttribute() {}
}

function clip(id: string): Clip {
  return {
    id,
    file: {} as File,
    name: id,
    duration: 100,
    width: 640,
    height: 360,
    frameRate: 25,
    objectUrl: `blob:${id}`,
    waveformPeaks: new Float32Array(0),
  }
}

let video: FakeVideo

// Manual animation frames, so reverse play can be stepped through time.
let frameCallbacks = new Map<number, FrameRequestCallback>()
let nextFrameId = 1
function runFrame(nowMs: number) {
  const due = [...frameCallbacks.values()]
  frameCallbacks = new Map()
  for (const callback of due) callback(nowMs)
}

// Finish a pending source switch the way a real element reports it.
function finishLoading() {
  video.readyState = 4
  video.onloadedmetadata?.()
}

beforeEach(() => {
  frameCallbacks = new Map()
  vi.stubGlobal('HTMLMediaElement', { HAVE_METADATA: 1 })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frameCallbacks.set(nextFrameId, callback)
    return nextFrameId++
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frameCallbacks.delete(id))
  playbackRate.value = 1
  clips.value = [clip('clip-a'), clip('clip-b')]
  timeline.value = [
    { id: 'a', clipId: 'clip-a', startTime: 0, endTime: 10 },
    { id: 'b', clipId: 'clip-b', startTime: 50, endTime: 60 },
  ]
  selectedSegmentId.value = 'a'
  video = new FakeVideo()
  attachVideo(video as unknown as HTMLVideoElement)
})

afterEach(() => {
  detachVideo()
  vi.unstubAllGlobals()
  timeline.value = []
  clips.value = []
  selectedSegmentId.value = null
  playheadTime.value = 0
})

describe('Basic playback across a cut between two files', () => {
  it('rests the playhead at the next segment start while its source loads', () => {
    playing.value = true
    video.paused = false
    video.currentTime = 10
    playheadTime.value = 10
    video.listeners.get('timeupdate')?.()

    expect(selectedSegmentId.value).toBe('b')
    expect(video.src).toBe('blob:clip-b')
    // Not the 10 s left over from 'a', which lies outside 'b' entirely.
    expect(playheadTime.value).toBe(50)
    expect(currentPlaybackTime.value).toBe(0)
    expect(playing.value).toBe(true)

    video.onloadedmetadata?.()
    expect(video.currentTime).toBe(50)
    expect(playheadTime.value).toBe(50)
  })
})

describe('Basic scrubbing', () => {
  it('pauses playback for the gesture and resumes it on release', () => {
    video.paused = false
    beginScrub()
    expect(video.paused).toBe(true)
    endScrub()
    expect(video.playCalls).toBe(1)
    expect(video.paused).toBe(false)
  })

  it('leaves a paused preview paused', () => {
    beginScrub()
    endScrub()
    expect(video.playCalls).toBe(0)
    expect(video.paused).toBe(true)
  })
})

describe('Basic transport', () => {
  beforeEach(() => finishLoading())

  it('jumps to the next cut and then to the end', () => {
    playheadTime.value = 3
    goToAdjacentCut(1)
    expect(selectedSegmentId.value).toBe('b')
    finishLoading()
    expect(video.currentTime).toBe(50)
    goToAdjacentCut(1)
    expect(selectedSegmentId.value).toBe('b')
    expect(playheadTime.value).toBe(60)
  })

  it('goes back to the segment start, then to the previous cut', () => {
    playheadTime.value = 5
    goToAdjacentCut(-1)
    expect(playheadTime.value).toBe(0)

    selectedSegmentId.value = 'b'
    finishLoading()
    playheadTime.value = 55
    goToAdjacentCut(-1)
    expect(selectedSegmentId.value).toBe('b')
    expect(playheadTime.value).toBe(50)
    // Within a frame of the start: the previous segment's start.
    goToAdjacentCut(-1)
    expect(selectedSegmentId.value).toBe('a')
    expect(playheadTime.value).toBe(0)
  })

  it('steps whole seconds across a cut and clamps at the ends', () => {
    playheadTime.value = 9.5
    stepSeconds(1)
    expect(selectedSegmentId.value).toBe('b')
    expect(playheadTime.value).toBeCloseTo(50.5)
    stepSeconds(-30)
    expect(selectedSegmentId.value).toBe('a')
    expect(playheadTime.value).toBe(0)
  })

  it('goes to the end and plays again from the top', () => {
    goToEnd()
    finishLoading()
    expect(selectedSegmentId.value).toBe('b')
    expect(video.currentTime).toBe(60)
    togglePlay()
    expect(selectedSegmentId.value).toBe('a')
    expect(video.playCalls).toBe(1)
  })

  it('applies the shared speed to the element', () => {
    playbackRate.value = 1.5
    expect(video.playbackRate).toBe(1.5)
    expect(video.defaultPlaybackRate).toBe(1.5)
  })

  it('shuttles forward faster with each L and stops with K', () => {
    shuttle('l')
    expect(video.playCalls).toBe(1)
    expect(shuttleRate.value).toBeNull()
    playing.value = true
    shuttle('l')
    expect(shuttleRate.value).toBe(2)
    expect(video.playbackRate).toBe(2)
    shuttle('l')
    shuttle('l')
    shuttle('l')
    expect(shuttleRate.value).toBe(8)
    shuttle('k')
    expect(video.paused).toBe(true)
    expect(shuttleRate.value).toBeNull()
    expect(video.playbackRate).toBe(1)
  })

  it('ends a forward shuttle when a new speed is chosen', () => {
    shuttle('l')
    shuttle('l')
    setPlaybackSpeed(0.5)
    expect(shuttleRate.value).toBeNull()
    expect(video.playbackRate).toBe(0.5)
  })

  it('ends a forward shuttle when playback runs off the end of the timeline', () => {
    selectedSegmentId.value = 'b'
    finishLoading()
    video.currentTime = 59
    shuttle('l')
    playing.value = true
    shuttle('l')
    expect(video.playbackRate).toBe(2)
    // Reaching the end rewinds to 'a', a different source, before any pause
    // event could arrive.
    video.currentTime = 60
    video.listeners.get('timeupdate')?.()
    expect(selectedSegmentId.value).toBe('a')
    expect(playing.value).toBe(false)
    expect(shuttleRate.value).toBeNull()
    expect(video.playbackRate).toBe(1)
  })

  it('plays in reverse across a cut, faster with each J', () => {
    selectedSegmentId.value = 'b'
    finishLoading()
    video.currentTime = 50.5
    playheadTime.value = 50.5
    shuttle('j')
    expect(shuttleRate.value).toBe(-1)
    expect(transportRunning.value).toBe(true)
    runFrame(0)
    runFrame(250)
    expect(playheadTime.value).toBeCloseTo(50.25)
    expect(video.currentTime).toBeCloseTo(50.25)

    shuttle('j')
    expect(shuttleRate.value).toBe(-2)
    // 0.25 s at 2x passes the start of 'b': continue from the end of 'a'.
    runFrame(500)
    expect(selectedSegmentId.value).toBe('a')
    expect(playheadTime.value).toBeCloseTo(10 - 1 / 25)
    finishLoading()
    runFrame(750)
    expect(playheadTime.value).toBeCloseTo(10 - 1 / 25 - 0.5)

    shuttle('k')
    expect(shuttleRate.value).toBeNull()
    expect(transportRunning.value).toBe(false)
    expect(frameCallbacks.size).toBe(0)
  })

  it('stops reverse at the start of the timeline', () => {
    video.currentTime = 0.1
    shuttle('j')
    runFrame(0)
    runFrame(500)
    expect(playheadTime.value).toBe(0)
    expect(shuttleRate.value).toBeNull()
    expect(frameCallbacks.size).toBe(0)
  })

  it('L during reverse plays forward at the chosen speed', () => {
    video.currentTime = 5
    shuttle('j')
    shuttle('l')
    expect(shuttleRate.value).toBeNull()
    expect(video.playCalls).toBe(1)
  })
})

describe('trim edge preview', () => {
  beforeEach(() => {
    finishLoading()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('moves the playhead every step and seeks the element at a bounded rate', () => {
    video.paused = false
    beginEdgePreview()
    expect(video.paused).toBe(true)
    previewEdgeFrame(2)
    expect(video.currentTime).toBe(2)
    previewEdgeFrame(2.1)
    previewEdgeFrame(2.2)
    expect(playheadTime.value).toBe(2.2)
    // The element catches up with the latest step once the interval passes.
    expect(video.currentTime).toBe(2)
    vi.advanceTimersByTime(40)
    expect(video.currentTime).toBe(2.2)
    endEdgePreview(2.5)
    expect(video.currentTime).toBe(2.5)
  })

  it('keeps the previewed out-point frame while the segment shrinks under it', () => {
    beginEdgePreview()
    previewEdgeFrame(9.96)
    // The trim moves the out-point in; a range clamp must not rewind to 0.
    timeline.value = [{ ...timeline.value[0], endTime: 8 }, timeline.value[1]]
    expect(video.currentTime).toBe(9.96)
    previewEdgeFrame(7.96)
    vi.advanceTimersByTime(40)
    expect(video.currentTime).toBe(7.96)
    endEdgePreview(7.96)
    expect(video.currentTime).toBe(7.96)
  })
})
