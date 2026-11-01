import { describe, expect, it } from 'vitest'

import { audioFrameRange } from '@/lib/webcodecs/audioEncode'
import { StereoResampler, toStereo } from '@/lib/webcodecs/audioNormalize'
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

describe('StereoResampler', () => {
  it('duplicates mono to stereo', () => {
    const mono = new Float32Array([0.1, 0.2])
    const [left, right] = toStereo([mono])
    expect(left).toBe(mono)
    expect(right).toBe(mono)
  })

  it('passes matching-rate audio through unchanged', () => {
    const resampler = new StereoResampler(48_000, 48_000)
    const result = resampler.process(new Float32Array([1, 2]), new Float32Array([3, 4]))
    expect(result.frames).toBe(2)
    expect(Array.from(result.data)).toEqual([1, 2, 3, 4])
  })

  it('resamples chunked 44.1 kHz audio as one continuous stream', () => {
    const total = 44_100
    const ramp = Float32Array.from({ length: total }, (_, i) => i / total)
    const chunked = new StereoResampler(44_100, 48_000)
    const pieces: number[] = []
    for (let start = 0; start < total; start += 1024) {
      const chunk = ramp.subarray(start, Math.min(total, start + 1024))
      const { data, frames } = chunked.process(chunk, chunk)
      pieces.push(...data.subarray(0, frames))
    }
    const whole = new StereoResampler(44_100, 48_000).process(ramp, ramp)
    // Same frames as resampling all at once: nothing dropped at chunk edges.
    expect(pieces.length).toBe(whole.frames)
    expect(Math.abs(pieces.length - 48_000)).toBeLessThanOrEqual(2)
    for (let i = 0; i < pieces.length; i++) {
      expect(pieces[i]).toBeCloseTo(whole.data[i], 6)
    }
    // A ramp stays monotonic: no jumps backwards at chunk boundaries.
    for (let i = 1; i < pieces.length; i++) expect(pieces[i]).toBeGreaterThanOrEqual(pieces[i - 1])
  })
})
