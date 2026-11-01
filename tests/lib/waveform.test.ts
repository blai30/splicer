import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  MAX_PEAK_COUNT,
  MIN_PEAK_COUNT,
  accumulatePeaks,
  computeBars,
  createPauseGate,
  createSerialQueue,
  visibleSpan,
  waveformPeakCount,
} from '@/lib/waveform'
import { extractWaveformPeaks } from '@/lib/waveformExtract'

// The bucket loop the previous main-thread extractor ran: one division per
// sample. The run-based loop must agree with it exactly.
function referencePeaks(
  samples: Float32Array,
  channelCount: number,
  startFrame: number,
  framesPerBucket: number,
  peakCount: number
): Float32Array {
  const peaks = new Float32Array(peakCount)
  const frameCount = samples.length / channelCount
  for (let frame = 0; frame < frameCount; frame++) {
    const bucket = Math.floor((startFrame + frame) / framesPerBucket)
    if (bucket < 0 || bucket >= peakCount) continue
    for (let channel = 0; channel < channelCount; channel++) {
      const amplitude = Math.abs(samples[frame * channelCount + channel])
      if (amplitude > peaks[bucket]) peaks[bucket] = amplitude
    }
  }
  return peaks
}

function noise(length: number, seed = 1): Float32Array {
  const samples = new Float32Array(length)
  let state = seed
  for (let i = 0; i < length; i++) {
    state = (state * 1103515245 + 12345) % 2147483648
    samples[i] = (state / 2147483648) * 2 - 1
  }
  return samples
}

describe('waveformPeakCount', () => {
  it('scales with duration between the bounds', () => {
    expect(waveformPeakCount(5)).toBe(MIN_PEAK_COUNT)
    expect(waveformPeakCount(60)).toBe(6000)
    expect(waveformPeakCount(600)).toBe(60_000)
    expect(waveformPeakCount(10 * 3600)).toBe(MAX_PEAK_COUNT)
    expect(waveformPeakCount(0)).toBe(MIN_PEAK_COUNT)
    expect(waveformPeakCount(Number.NaN)).toBe(MIN_PEAK_COUNT)
  })
})

describe('accumulatePeaks', () => {
  it('matches a per-sample bucket loop across fractional bucket sizes', () => {
    const samples = noise(2 * 4801)
    for (const framesPerBucket of [1, 2.5, 7.3, 480, 4801]) {
      const peakCount = Math.ceil(4801 / framesPerBucket) + 2
      const peaks = new Float32Array(peakCount)
      accumulatePeaks(peaks, samples, 2, 4801, 0, framesPerBucket)
      expect(peaks).toEqual(referencePeaks(samples, 2, 0, framesPerBucket, peakCount))
    }
  })

  it('folds consecutive chunks into the same buckets as one chunk', () => {
    const samples = noise(3000, 7)
    const whole = new Float32Array(40)
    accumulatePeaks(whole, samples, 1, 3000, 0, 75.5)
    const chunked = new Float32Array(40)
    for (let start = 0; start < 3000; start += 1024) {
      const end = Math.min(3000, start + 1024)
      accumulatePeaks(chunked, samples.subarray(start, end), 1, end - start, start, 75.5)
    }
    expect(chunked).toEqual(whole)
  })

  it('skips frames before the clip start and reports running past the end', () => {
    const samples = new Float32Array([0.9, 0.9, 0.2, 0.4, 0.6, 0.8, 1, 1])
    const peaks = new Float32Array(2)
    // Starts two frames before 0 and buckets are 2 frames long, so the first
    // two frames are skipped and the last two fall past the last bucket.
    const more = accumulatePeaks(peaks, samples, 1, 8, -2, 2)
    expect(Array.from(peaks)).toEqual([Math.fround(0.4), Math.fround(0.8)])
    expect(more).toBe(false)
    expect(accumulatePeaks(new Float32Array(4), samples, 1, 8, 0, 2)).toBe(true)
  })
})

describe('computeBars', () => {
  it('takes the max of every peak a bar covers, never skipping one', () => {
    // 60 s clip at 100 peaks/s drawn into 1000 bars: six peaks per bar.
    const peaks = new Float32Array(6000)
    peaks[3001] = 1
    const bars = computeBars(peaks, 0, 1, 1000)
    expect(bars[500]).toBe(1)
    expect(Array.from(bars).filter((value) => value > 0)).toHaveLength(1)
  })

  it('leaves no empty bar when zoomed in past one peak per bar', () => {
    const peaks = new Float32Array(2000).fill(0.5)
    const bars = computeBars(peaks, 0.25, 0.26, 4000)
    expect(bars.length).toBe(4000)
    expect(Math.min(...bars)).toBeCloseTo(0.5)
  })

  it('interpolates between neighbouring peak centres', () => {
    const peaks = new Float32Array([0, 1])
    // Four bars over two peaks: centres at 0.25, 0.75, 1.25, 1.75 peaks.
    const bars = computeBars(peaks, 0, 1, 4)
    expect(Array.from(bars)).toEqual([0, 0.25, 0.75, 1])
  })

  it('maps a trimmed range onto the matching peaks', () => {
    const peaks = new Float32Array(100)
    for (let i = 0; i < 100; i++) peaks[i] = i / 100
    const bars = computeBars(peaks, 0.5, 0.6, 10)
    expect(Array.from(bars, (value) => Math.round(value * 100))).toEqual([
      50, 51, 52, 53, 54, 55, 56, 57, 58, 59,
    ])
  })

  it('returns empty bars for no peaks or an empty range', () => {
    expect(Array.from(computeBars(new Float32Array(0), 0, 1, 3))).toEqual([0, 0, 0])
    expect(Array.from(computeBars(new Float32Array(4).fill(1), 0.5, 0.5, 2))).toEqual([0, 0])
  })
})

describe('visibleSpan', () => {
  it('covers the view plus a chunk each side, snapped to chunks', () => {
    expect(visibleSpan(10_000, 1000, 800, 256)).toEqual({ from: 512, to: 2304 })
    // Scrolling inside the same chunks keeps the span.
    expect(visibleSpan(10_000, 1010, 800, 256)).toEqual({ from: 512, to: 2304 })
  })

  it('clamps to the block and is empty off screen', () => {
    expect(visibleSpan(300, -100, 800, 256)).toEqual({ from: 0, to: 300 })
    expect(visibleSpan(300, 5000, 800, 256)).toEqual({ from: 0, to: 0 })
    expect(visibleSpan(300, -5000, 800, 256)).toEqual({ from: 0, to: 0 })
  })

  it('stays bounded for a very long block', () => {
    const span = visibleSpan(288_000, 150_000, 1200, 256)
    expect(span.to - span.from).toBeLessThanOrEqual(1200 + 4 * 256)
  })
})

describe('createSerialQueue', () => {
  it('runs tasks one at a time in order, past a failure', async () => {
    const enqueue = createSerialQueue()
    const events: string[] = []
    let running = 0
    const task =
      (name: string, fail = false) =>
      async () => {
        running += 1
        expect(running).toBe(1)
        events.push(`start ${name}`)
        await new Promise((resolve) => setTimeout(resolve, 1))
        events.push(`end ${name}`)
        running -= 1
        if (fail) throw new Error(name)
        return name
      }
    const results = await Promise.allSettled([
      enqueue(task('a')),
      enqueue(task('b', true)),
      enqueue(task('c')),
    ])
    expect(events).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c'])
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled'])
  })
})

describe('extractWaveformPeaks', () => {
  function fixture(name: string): File {
    const bytes = readFileSync(new URL(`../fixtures/${name}`, import.meta.url))
    return new File([bytes], name)
  }

  it('returns an empty buffer for a file without audio', async () => {
    const peaks = await extractWaveformPeaks(fixture('tall-silent.mp4'), 1, 2000)
    expect(peaks).toBeInstanceOf(Float32Array)
    expect(peaks.length).toBe(0)
  })
})

describe('createPauseGate', () => {
  it('holds waiters while paused and releases them on resume', async () => {
    const gate = createPauseGate()
    await gate.wait()
    gate.pause()
    gate.pause()
    expect(gate.paused).toBe(true)
    let released = false
    const waiting = gate.wait().then(() => (released = true))
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(released).toBe(false)
    gate.resume()
    await waiting
    expect(released).toBe(true)
    expect(gate.paused).toBe(false)
  })

  it('keeps queued tasks from starting until it resumes', async () => {
    const gate = createPauseGate()
    const enqueue = createSerialQueue(gate.wait)
    const started: string[] = []
    gate.pause()
    const first = enqueue(async () => started.push('a'))
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(started).toEqual([])
    gate.resume()
    await first
    expect(started).toEqual(['a'])

    // A pause between tasks holds the next one.
    gate.pause()
    const second = enqueue(async () => started.push('b'))
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(started).toEqual(['a'])
    gate.resume()
    await second
    expect(started).toEqual(['a', 'b'])
  })
})
