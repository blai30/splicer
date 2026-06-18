import { describe, expect, it } from 'vitest'

import { getPeaksFromSamples, isVideoFile } from '@/lib/videoImport'

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
