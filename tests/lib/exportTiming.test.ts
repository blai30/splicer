import { describe, expect, it } from 'vitest'

import { audioFrameRange } from '@/lib/webcodecs/audioEncode'
import { normalizeAudio, resampleChannel, toStereo } from '@/lib/webcodecs/audioNormalize'
import { frameOutputSpan } from '@/lib/webcodecs/videoEncode'

describe('frameOutputSpan', () => {
  it('clips a frame straddling the slice start to the output origin', () => {
    // Frame shows 0.9..1.0; slice starts at 0.95 and is placed at output 10.
    const span = frameOutputSpan(0.9, 0.1, 0.95, 2, 10)
    expect(span?.start).toBeCloseTo(10)
    expect(span?.end).toBeCloseTo(10.05)
  })

  it('clips a frame straddling the slice end', () => {
    const span = frameOutputSpan(1.95, 0.1, 1, 2, 0)
    expect(span?.start).toBeCloseTo(0.95)
    expect(span?.end).toBeCloseTo(1)
  })

  it('rejects frames outside the slice', () => {
    expect(frameOutputSpan(0, 0.5, 1, 2, 0)).toBeNull()
    expect(frameOutputSpan(2, 0.1, 1, 2, 0)).toBeNull()
  })

  it('falls back to a nominal duration when the frame reports none', () => {
    expect(frameOutputSpan(1, 0, 1, 2, 0)).not.toBeNull()
  })
})

describe('audioFrameRange', () => {
  it('keeps every frame when the sample is inside the window', () => {
    expect(audioFrameRange(1, 1000, 1000, 0, 5)).toEqual({ startFrame: 0, endFrame: 1000 })
  })

  it('trims the head at the cut point', () => {
    expect(audioFrameRange(1, 1000, 1000, 1.25, 5)).toEqual({ startFrame: 250, endFrame: 1000 })
  })

  it('trims the tail at the cut point', () => {
    expect(audioFrameRange(1, 1000, 1000, 0, 1.5)).toEqual({ startFrame: 0, endFrame: 500 })
  })

  it('returns null when nothing overlaps', () => {
    expect(audioFrameRange(1, 1000, 1000, 3, 5)).toBeNull()
  })
})

describe('normalizeAudio', () => {
  it('duplicates mono to stereo', () => {
    const mono = new Float32Array([0.1, 0.2])
    const [left, right] = toStereo([mono])
    expect(left).toBe(mono)
    expect(right).toBe(mono)
  })

  it('passes matching-rate stereo through as planar data', () => {
    const result = normalizeAudio(
      { sampleRate: 48_000, channels: [new Float32Array([1, 2]), new Float32Array([3, 4])] },
      48_000
    )
    expect(result.frames).toBe(2)
    expect(Array.from(result.data)).toEqual([1, 2, 3, 4])
  })

  it('resamples 44.1 kHz to 48 kHz preserving duration', () => {
    const input = new Float32Array(44_100).fill(0.5)
    const result = normalizeAudio({ sampleRate: 44_100, channels: [input] }, 48_000)
    expect(result.frames).toBe(48_000)
    expect(result.data[0]).toBeCloseTo(0.5)
    expect(result.data[result.data.length - 1]).toBeCloseTo(0.5)
  })

  it('linearly interpolates between input frames', () => {
    const output = resampleChannel(new Float32Array([0, 1]), 0.5, 3)
    expect(Array.from(output)).toEqual([0, 0.5, 1])
  })
})
