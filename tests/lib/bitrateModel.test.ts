import { describe, expect, it } from 'vitest'

import type { Quality } from '@/lib/types'
import {
  coveredSourceBytes,
  estimateOutputBytes,
  sourceEquivalentBitrate,
  tableVideoBitrate,
  targetAudioBitrate,
  targetVideoBitrate,
  VIDEO_BITRATE_1080P,
  type EstimateInput,
  type SourceSlice,
} from '@/lib/webcodecs/bitrateModel'

const QUALITIES: Quality[] = ['lossless', 'high', 'medium', 'low']

function slice(overrides: Partial<SourceSlice> = {}): SourceSlice {
  return {
    durationSec: 2,
    displayedPixels: 1280 * 720,
    sourceWidth: 1280,
    sourceHeight: 720,
    videoBitrate: 300_000,
    videoCodec: 'avc',
    ...overrides,
  }
}

describe('sourceEquivalentBitrate', () => {
  it('is the source bitrate for the same picture and codec', () => {
    expect(sourceEquivalentBitrate([slice()], 'avc')).toEqual({
      codecAdjusted: 300_000,
      raw: 300_000,
    })
  })

  it('scales linearly with displayed pixels over source pixels', () => {
    const half = sourceEquivalentBitrate([slice({ displayedPixels: (1280 * 720) / 2 })], 'avc')
    expect(half?.raw).toBeCloseTo(150_000)
  })

  it('converts between codec efficiencies', () => {
    const toVp9 = sourceEquivalentBitrate([slice()], 'vp9')!
    expect(toVp9.codecAdjusted).toBeCloseTo(300_000 * 0.65)
    expect(toVp9.raw).toBe(300_000)
    const fromVp9 = sourceEquivalentBitrate([slice({ videoCodec: 'vp9' })], 'avc')!
    expect(fromVp9.codecAdjusted).toBeCloseTo(300_000 / 0.65)
  })

  it('weights slices by duration', () => {
    const mixed = sourceEquivalentBitrate(
      [
        slice({ durationSec: 3, videoBitrate: 100_000 }),
        slice({ durationSec: 1, videoBitrate: 500_000 }),
      ],
      'avc'
    )
    expect(mixed?.raw).toBeCloseTo(200_000)
  })

  it('is null when any slice has no measured bitrate', () => {
    expect(sourceEquivalentBitrate([slice(), slice({ videoBitrate: undefined })], 'avc')).toBeNull()
    expect(sourceEquivalentBitrate([], 'avc')).toBeNull()
  })
})

describe('targetVideoBitrate', () => {
  const lowSource = sourceEquivalentBitrate([slice()], 'avc')

  it('never exceeds the source bitrate below Maximum', () => {
    for (const quality of QUALITIES.filter((entry) => entry !== 'lossless')) {
      expect(targetVideoBitrate(1280, 720, quality, 'avc', lowSource)).toBeLessThanOrEqual(300_000)
    }
  })

  it('applies the preset fractions and keeps them ordered', () => {
    const rate = (quality: Quality) => targetVideoBitrate(1280, 720, quality, 'avc', lowSource)
    expect(rate('lossless')).toBe(450_000)
    expect(rate('high')).toBe(300_000)
    expect(rate('medium')).toBe(180_000)
    expect(rate('low')).toBe(105_000)
  })

  it('gives VP9 less than H.264 for the same preset', () => {
    const highSource = sourceEquivalentBitrate([slice({ videoBitrate: 4_000_000 })], 'vp9')
    const avcSource = sourceEquivalentBitrate([slice({ videoBitrate: 4_000_000 })], 'avc')
    expect(targetVideoBitrate(1280, 720, 'high', 'vp9', highSource)).toBeLessThan(
      targetVideoBitrate(1280, 720, 'high', 'avc', avcSource)
    )
    expect(targetVideoBitrate(1280, 720, 'high', 'vp9', null)).toBeLessThan(
      targetVideoBitrate(1280, 720, 'high', 'avc', null)
    )
  })

  it('does not let a codec conversion grow the file past the source', () => {
    const fromVp9 = sourceEquivalentBitrate([slice({ videoCodec: 'vp9' })], 'avc')
    expect(targetVideoBitrate(1280, 720, 'high', 'avc', fromVp9)).toBe(300_000)
    // Maximum may go above the source; it is the opt-in tier.
    expect(targetVideoBitrate(1280, 720, 'lossless', 'avc', fromVp9)).toBeGreaterThan(300_000)
  })

  it('is capped by the table for very high bitrate sources', () => {
    const huge = sourceEquivalentBitrate([slice({ videoBitrate: 80_000_000 })], 'avc')
    expect(targetVideoBitrate(1280, 720, 'high', 'avc', huge)).toBe(
      tableVideoBitrate(1280, 720, 'high', 'avc')
    )
  })

  it('falls back to the codec-adjusted table without source stats', () => {
    expect(targetVideoBitrate(1920, 1080, 'high', 'avc', null)).toBe(VIDEO_BITRATE_1080P.high)
    expect(targetVideoBitrate(1920, 1080, 'high', 'vp9', null)).toBe(
      Math.round(VIDEO_BITRATE_1080P.high * 0.65)
    )
  })
})

describe('targetAudioBitrate', () => {
  it('uses the codec preset without source stats', () => {
    expect(targetAudioBitrate('high', 'aac', [])).toBe(128_000)
    expect(targetAudioBitrate('high', 'opus', [])).toBe(96_000)
    expect(targetAudioBitrate('low', 'opus', [{ codec: 'aac' }])).toBe(48_000)
  })

  it('caps at the richest audible source, snapped to a valid AAC rate', () => {
    expect(targetAudioBitrate('high', 'aac', [{ bitrate: 69_600, codec: 'aac' }])).toBe(64_000)
    expect(targetAudioBitrate('high', 'aac', [{ bitrate: 46_700, codec: 'aac' }])).toBe(48_000)
    expect(
      targetAudioBitrate('high', 'aac', [
        { bitrate: 64_000, codec: 'aac' },
        { bitrate: 96_000, codec: 'aac' },
      ])
    ).toBe(96_000)
  })

  it('converts the cap into Opus terms', () => {
    // 128k AAC needs about 90k of Opus.
    expect(targetAudioBitrate('lossless', 'opus', [{ bitrate: 128_000, codec: 'aac' }])).toBe(
      88_000
    )
  })

  it('never goes above the preset', () => {
    expect(targetAudioBitrate('low', 'aac', [{ bitrate: 320_000, codec: 'aac' }])).toBe(64_000)
  })
})

function estimateInput(overrides: Partial<EstimateInput> = {}): EstimateInput {
  return {
    durationSec: 10,
    frameRate: 30,
    width: 1280,
    height: 720,
    videoCodec: 'avc',
    videoBitrate: 2_000_000,
    audioBitrate: 0,
    sourceEquivalent: { codecAdjusted: 2_000_000, raw: 2_000_000 },
    sourceBytes: 2_500_000,
    ...overrides,
  }
}

describe('estimateOutputBytes', () => {
  it('follows the target above the encoder floor', () => {
    const estimate = estimateOutputBytes(estimateInput())
    expect(estimate.expected).toBeCloseTo(2_525_000, -3)
    expect(estimate.low).toBeLessThan(estimate.expected)
    expect(estimate.high).toBeGreaterThan(estimate.expected)
    expect(estimate.belowEncoderFloor).toBe(false)
    expect(estimate.sourceBytes).toBe(2_500_000)
  })

  it('predicts the floor, not the target, for a heavily compressed complex source', () => {
    // 720p30 floor for H.264 is about 0.025 bpp: ~690 kbps.
    const estimate = estimateOutputBytes(
      estimateInput({
        videoBitrate: 105_000,
        sourceEquivalent: { codecAdjusted: 300_000, raw: 300_000 },
      })
    )
    expect(estimate.belowEncoderFloor).toBe(true)
    expect(estimate.encoderFloorBitrate).toBeCloseTo(691_200)
    expect(estimate.expected).toBeCloseTo((691_200 * 10 * 1.01) / 8, -3)
  })

  it('lets simple content go below the complex-content floor', () => {
    const estimate = estimateOutputBytes(
      estimateInput({
        videoBitrate: 22_000,
        sourceEquivalent: { codecAdjusted: 22_000, raw: 22_000 },
      })
    )
    expect(estimate.encoderFloorBitrate).toBe(66_000)
  })

  it('caps H.264 at its best-quantizer ceiling', () => {
    const estimate = estimateOutputBytes(estimateInput({ videoBitrate: 40_000_000 }))
    expect(estimate.expected).toBeLessThan((12_000_000 * 10) / 8)
  })

  it('expects VP9 VBR to land under its target', () => {
    const avc = estimateOutputBytes(estimateInput())
    const vp9 = estimateOutputBytes(estimateInput({ videoCodec: 'vp9' }))
    expect(vp9.expected).toBeLessThan(avc.expected)
  })

  it('adds audio and widens the band without source stats', () => {
    const silent = estimateOutputBytes(estimateInput({ sourceEquivalent: null }))
    const withAudio = estimateOutputBytes(
      estimateInput({ sourceEquivalent: null, audioBitrate: 128_000 })
    )
    expect(withAudio.expected - silent.expected).toBeCloseTo((128_000 * 10 * 1.01) / 8, -2)
    expect(silent.high / silent.expected).toBeCloseTo(1.4)
  })
})

describe('coveredSourceBytes', () => {
  it('sums the covered share of each file', () => {
    expect(
      coveredSourceBytes([
        { durationSec: 2, fileBytes: 1_000, sourceDurationSec: 4 },
        { durationSec: 10, fileBytes: 300, sourceDurationSec: 3 },
      ])
    ).toBe(800)
  })

  it('is null when a source duration is unknown', () => {
    expect(coveredSourceBytes([{ durationSec: 2, fileBytes: 1_000 }])).toBeNull()
    expect(coveredSourceBytes([])).toBeNull()
  })
})
