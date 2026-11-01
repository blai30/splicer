import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { attachVideo, detachVideo } from '@/lib/playback'
import {
  clips,
  currentPlaybackTime,
  playheadTime,
  playing,
  selectedSegmentId,
  timeline,
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
  play() {
    return Promise.resolve()
  }
  pause() {}
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
    objectUrl: `blob:${id}`,
    waveformPeaks: [],
  }
}

let video: FakeVideo

beforeEach(() => {
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
