import { readFileSync } from 'node:fs'

import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import { describe, expect, it } from 'vitest'

import { advancedSegments } from '@/lib/store'
import {
  createClip,
  getPeaksFromSamples,
  hasPacketIndex,
  importIntoAdvanced,
  isVideoFile,
  measureStreamStats,
} from '@/lib/videoImport'

function openFixture(name: string): Input {
  const bytes = readFileSync(new URL(`../fixtures/${name}`, import.meta.url))
  return new Input({ formats: ALL_FORMATS, source: new BlobSource(new Blob([bytes])) })
}

describe('isVideoFile', () => {
  it('accepts supported video files', () => {
    expect(isVideoFile(new File([], 'clip.mp4', { type: 'video/mp4' }))).toBe(true)
    expect(isVideoFile(new File([], 'clip.webm', { type: 'video/webm' }))).toBe(true)
    expect(isVideoFile(new File([], 'clip.mkv'))).toBe(true)
    expect(isVideoFile(new File([], 'clip.mov'))).toBe(true)
  })

  it('rejects AVI files by type and by extension', () => {
    expect(isVideoFile(new File([], 'old.avi', { type: 'video/x-msvideo' }))).toBe(false)
    expect(isVideoFile(new File([], 'old.avi'))).toBe(false)
  })
})

describe('getPeaksFromSamples', () => {
  it('returns absolute-value peaks bucketed across the sample range', () => {
    const samples = new Float32Array([0, -0.5, 0.25, -1, 0.75, -0.1])
    const peaks = getPeaksFromSamples(samples, 64)
    expect(peaks.length).toBeGreaterThan(0)
    expect(Math.max(...peaks)).toBeCloseTo(1)
    expect(Math.min(...peaks)).toBeGreaterThanOrEqual(0)
  })

  it('returns an empty array for empty input', () => {
    expect(getPeaksFromSamples(new Float32Array([]), 64)).toEqual([])
  })
})

describe('importIntoAdvanced', () => {
  it('ignores non-video files', async () => {
    advancedSegments.value = []
    await importIntoAdvanced(new File([], 'notes.txt', { type: 'text/plain' }))
    expect(advancedSegments.value).toHaveLength(0)
  })

  it('exposes createClip', () => {
    expect(typeof createClip).toBe('function')
  })
})

describe('measureStreamStats', () => {
  it('reads bitrates and codecs from packet metadata over the whole MP4 index', async () => {
    const input = openFixture('tiny.mp4')
    try {
      expect(await hasPacketIndex(input)).toBe(true)
      const video = await input.getPrimaryVideoTrack()
      const audio = await input.getPrimaryAudioTrack()
      const stats = await measureStreamStats(video!, audio, true)
      expect(stats.videoCodec).toBe('avc')
      expect(stats.audioCodec).toBe('aac')
      // ffprobe reports about 46 kbps video and 70 kbps audio for this file.
      expect(stats.videoBitrate).toBeGreaterThan(35_000)
      expect(stats.videoBitrate).toBeLessThan(60_000)
      expect(stats.audioBitrate).toBeGreaterThan(55_000)
      expect(stats.audioBitrate).toBeLessThan(85_000)
      expect(stats.frameRate).toBeGreaterThan(0)
    } finally {
      input.dispose()
    }
  })

  it('leaves audio stats out for a silent clip', async () => {
    const input = openFixture('tall-silent.mp4')
    try {
      const video = await input.getPrimaryVideoTrack()
      const stats = await measureStreamStats(video!, null, true)
      expect(stats.videoBitrate).toBeGreaterThan(0)
      expect(stats.audioBitrate).toBeUndefined()
    } finally {
      input.dispose()
    }
  })
})
