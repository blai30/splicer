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

  it('keeps a codec conversion at or under the source bitrate below Maximum', () => {
    // 64k Opus needs about 91k of AAC, which would grow the file past the source.
    const opusSource = [{ bitrate: 64_000, codec: 'opus' }]
    expect(targetAudioBitrate('medium', 'aac', opusSource)).toBe(64_000)
    expect(targetAudioBitrate('high', 'aac', opusSource)).toBe(64_000)
    // Maximum is the opt-in tier that may convert at equal quality.
    expect(targetAudioBitrate('lossless', 'aac', opusSource)).toBe(96_000)
  })

  it('follows a quiet source down to each codec minimum', () => {
    const voiceMemo = [{ bitrate: 24_000, codec: 'aac' }]
    // Some platform AAC encoders reject rates under 32k.
    expect(targetAudioBitrate('high', 'aac', voiceMemo)).toBe(32_000)
    expect(targetAudioBitrate('high', 'opus', voiceMemo)).toBe(16_000)
    expect(targetAudioBitrate('high', 'opus', [{ bitrate: 8_000, codec: 'aac' }])).toBe(16_000)
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
    sourceBitrateBound: 2_000_000,
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
    // 720p30 H.264 floor on complex content: (4800 + 0.027 x 921600) x 30, ~890 kbps.
    const complexFloor = (4_800 + 0.027 * 1280 * 720) * 30
    const estimate = estimateOutputBytes(
      estimateInput({
        videoBitrate: 105_000,
        sourceEquivalent: { codecAdjusted: 900_000, raw: 900_000 },
        sourceBitrateBound: 900_000,
      })
    )
    expect(estimate.belowEncoderFloor).toBe(true)
    expect(estimate.encoderFloorBitrate).toBeCloseTo(complexFloor)
    expect(estimate.expected).toBeCloseTo((complexFloor * 10 * 1.01) / 8, -3)
  })

  it('keeps a simple low-bitrate source near its own bitrate at the floor', () => {
    // tests/fixtures/tiny.mp4: 320x240 at 46 kbps of video. OpenH264 lands at
    // 36-45 kbps, well under the complex-content floor (~206 kbps).
    const estimate = estimateOutputBytes(
      estimateInput({
        width: 320,
        height: 240,
        durationSec: 2,
        videoBitrate: 16_000,
        audioBitrate: 64_000,
        sourceEquivalent: { codecAdjusted: 46_000, raw: 46_000 },
        sourceBitrateBound: 46_000,
        sourceBytes: 32_694,
      })
    )
    expect(estimate.belowEncoderFloor).toBe(true)
    expect(estimate.encoderFloorBitrate).toBeCloseTo(69_000)
    const bytesAt = (videoBitrate: number) => (((videoBitrate + 64_000) * 2) / 8) * 1.01
    // The measured exports (27.2 KB at Low, 29.4 KB at High) fall in the range.
    expect(estimate.low).toBeLessThanOrEqual(bytesAt(36_000))
    expect(estimate.high).toBeGreaterThanOrEqual(bytesAt(45_000))
    expect(estimate.expected).toBeLessThan(32_694 * 1.1)
  })

  it('caps H.264 at its best-quantizer ceiling', () => {
    const estimate = estimateOutputBytes(
      estimateInput({ videoBitrate: 40_000_000, sourceBitrateBound: null })
    )
    expect(estimate.expected).toBeLessThan((12_000_000 * 10) / 8)
  })

  it('bounds a table request by the source when layers overlap', () => {
    // Two 46 kbps 320x240 clips side by side at half size, Maximum: a 1.5 Mbps
    // table request that OpenH264 meets at about 175 kbps on this content.
    const estimate = estimateOutputBytes(
      estimateInput({
        width: 320,
        height: 240,
        durationSec: 2,
        videoBitrate: 1_480_000,
        audioBitrate: 64_000,
        sourceEquivalent: null,
        sourceBitrateBound: 23_000,
      })
    )
    expect(estimate.low).toBeLessThanOrEqual(60_961)
    expect(estimate.high).toBeGreaterThanOrEqual(60_961)
  })

  it('models libvpx overshooting near its floor and undershooting generous targets', () => {
    const vp9At = (videoBitrate: number) =>
      estimateOutputBytes(estimateInput({ videoCodec: 'vp9', videoBitrate }))
    const bytesAt = (videoBitrate: number) => ((videoBitrate * 10) / 8) * 1.01
    // 720p30 VP9 Medium from a 1.5 Mbps source: 582 kbps asked, ~624 delivered.
    const medium = vp9At(582_000)
    expect(medium.expected).toBeGreaterThan(bytesAt(582_000))
    expect(medium.high).toBeGreaterThanOrEqual(bytesAt(624_000))
    // Maximum on the same source: 1455 kbps asked, ~1139 delivered.
    const maximum = vp9At(1_455_000)
    expect(maximum.expected).toBeLessThan(bytesAt(1_455_000))
    expect(maximum.low).toBeLessThanOrEqual(bytesAt(1_139_000))
  })

  it('expects VP9 VBR to land under a generous target', () => {
    const avc = estimateOutputBytes(estimateInput())
    const vp9 = estimateOutputBytes(estimateInput({ videoCodec: 'vp9' }))
    expect(vp9.expected).toBeLessThan(avc.expected)
  })

  it('adds audio and widens the band without source stats', () => {
    const unknown = { sourceEquivalent: null, sourceBitrateBound: null }
    const silent = estimateOutputBytes(estimateInput(unknown))
    const withAudio = estimateOutputBytes(estimateInput({ ...unknown, audioBitrate: 128_000 }))
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
