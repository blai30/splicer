import { describe, expect, it } from 'vitest'

import { parseTargetSizeMB, TARGET_SIZE_MAX_MB, TARGET_SIZE_MIN_MB } from '@/lib/store'
import {
  complexEncoderFloor,
  fitTargetSize,
  MUX_OVERHEAD,
  overshootsTarget,
  TARGET_SIZE_SAFETY,
  type TargetSizeInput,
} from '@/lib/webcodecs/bitrateModel'

const generous = () => 50_000_000

function input(overrides: Partial<TargetSizeInput> = {}): TargetSizeInput {
  return {
    targetBytes: 10_000_000,
    durationSec: 60,
    size: { width: 1280, height: 720 },
    frameRate: 30,
    videoCodec: 'avc',
    audioCodec: 'aac',
    sourceAudio: [],
    hasAudio: true,
    sourceBitrateBound: null,
    maxVideoBitrate: generous,
    ...overrides,
  }
}

// The whole-file bitrate the fit aims for.
const totalBitrate = (bytes: number, seconds: number) =>
  (bytes * 8 * TARGET_SIZE_SAFETY) / MUX_OVERHEAD / seconds

describe('fitTargetSize', () => {
  it('splits the size between audio and video with a safety margin', () => {
    const fit = fitTargetSize(input())
    expect(fit.feasible).toBe(true)
    expect(fit.size).toEqual({ width: 1280, height: 720 })
    expect(fit.shrunk).toBe(false)
    expect(fit.frameRateLowered).toBe(false)
    // 10 MB over 60 s is about 1.25 Mbps, so audio gets Medium's 96k.
    expect(fit.audioBitrate).toBe(96_000)
    expect(fit.videoBitrate).toBe(Math.round(totalBitrate(10_000_000, 60) - 96_000))
    const bytes = ((fit.videoBitrate + fit.audioBitrate) * 60 * MUX_OVERHEAD) / 8
    expect(bytes).toBeLessThanOrEqual(10_000_000 * TARGET_SIZE_SAFETY + 1)
  })

  it('gives video all of it when there is no audio, and steps audio down on small budgets', () => {
    expect(fitTargetSize(input({ hasAudio: false })).audioBitrate).toBe(0)
    expect(fitTargetSize(input({ targetBytes: 4_000_000 })).audioBitrate).toBe(64_000)
    expect(fitTargetSize(input({ targetBytes: 4_000_000, audioCodec: 'opus' })).audioBitrate).toBe(
      48_000
    )
  })

  it('shrinks to the largest standard size whose floor the budget clears', () => {
    // About 0.5 Mbps of video: under the 720p floor, over the 480p one.
    const fit = fitTargetSize(input({ targetBytes: 4_400_000, hasAudio: false }))
    expect(complexEncoderFloor('avc', 1280, 720, 30)).toBeGreaterThan(fit.videoBitrate)
    expect(fit.size).toEqual({ width: 852, height: 480 })
    expect(fit.shrunk).toBe(true)
    expect(fit.videoBitrate).toBeGreaterThanOrEqual(complexEncoderFloor('avc', 852, 480, 30) * 1.1)
  })

  it('drops the frame rate once the smallest size is not enough', () => {
    const fit = fitTargetSize(input({ targetBytes: 2_400_000, hasAudio: false }))
    expect(fit.size).toEqual({ width: 640, height: 360 })
    expect(fit.frameRateLowered).toBe(true)
    expect(fit.frameRate).toBe(24)
    expect(fit.feasible).toBe(true)
  })

  it('reports the smallest reachable size when nothing fits', () => {
    const fit = fitTargetSize(input({ targetBytes: 200_000 }))
    expect(fit.feasible).toBe(false)
    expect(fit.size).toEqual({ width: 640, height: 360 })
    expect(fit.frameRate).toBe(15)
    // At that size the floor clears exactly.
    const atMinimum = fitTargetSize(input({ targetBytes: fit.minimumBytes }))
    expect(atMinimum.feasible).toBe(true)
  })

  it('lets simple content go below the complex-content floor', () => {
    // The budget that shrank complex content to 480p keeps a 300 kbps source at 720p.
    const fit = fitTargetSize(
      input({ targetBytes: 4_400_000, hasAudio: false, sourceBitrateBound: 300_000 })
    )
    expect(fit.size).toEqual({ width: 1280, height: 720 })
  })

  it('never asks for more than is worth it at the chosen size', () => {
    const fit = fitTargetSize(input({ targetBytes: 500_000_000, maxVideoBitrate: () => 2_000_000 }))
    expect(fit.videoBitrate).toBe(2_000_000)
  })

  it('does not drop frames from a slow source', () => {
    const fit = fitTargetSize(input({ targetBytes: 200_000, frameRate: 15 }))
    expect(fit.frameRate).toBe(15)
    expect(fit.frameRateLowered).toBe(false)
  })
})

describe('overshootsTarget', () => {
  it('tolerates a small miss and flags a clear overshoot', () => {
    expect(overshootsTarget(10_500_000, 10_000_000)).toBe(false)
    expect(overshootsTarget(11_500_000, 10_000_000)).toBe(false)
    expect(overshootsTarget(11_600_000, 10_000_000)).toBe(true)
    expect(overshootsTarget(23_400_000, 8_000_000)).toBe(true)
  })

  it('never flags without a target', () => {
    expect(overshootsTarget(1_000_000, 0)).toBe(false)
  })
})

describe('parseTargetSizeMB', () => {
  it('keeps an in-range entry', () => {
    expect(parseTargetSizeMB('12.5')).toBe(12.5)
  })

  it('clamps an entry outside the range', () => {
    expect(parseTargetSizeMB('0.05')).toBe(TARGET_SIZE_MIN_MB)
    expect(parseTargetSizeMB('-3')).toBe(TARGET_SIZE_MIN_MB)
    expect(parseTargetSizeMB('250000')).toBe(TARGET_SIZE_MAX_MB)
  })

  it('rejects an empty or non-numeric entry', () => {
    expect(parseTargetSizeMB('')).toBeNull()
    expect(parseTargetSizeMB('  ')).toBeNull()
    expect(parseTargetSizeMB('abc')).toBeNull()
  })
})
