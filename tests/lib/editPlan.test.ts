import { describe, expect, it } from 'vitest'

import { buildEditPlan, computeEncodeParams } from '@/lib/webcodecs/editPlan'
import type { ExportJob, JobSlice, JobSource } from '@/lib/webcodecs/protocol'

describe('computeEncodeParams', () => {
  it('scales video bitrate by pixel count relative to 1080p', () => {
    const full = computeEncodeParams(1920, 1080, 'original', 'high')
    const quarter = computeEncodeParams(960, 540, 'original', 'high')
    expect(quarter.videoBitrate).toBeCloseTo(full.videoBitrate / 4, -3)
  })

  it('orders bitrate by quality preset', () => {
    const lossless = computeEncodeParams(1920, 1080, 'original', 'lossless').videoBitrate
    const low = computeEncodeParams(1920, 1080, 'original', 'low').videoBitrate
    expect(lossless).toBeGreaterThan(low)
  })

  it('maps fps presets to a frame duration and original to null', () => {
    expect(computeEncodeParams(1920, 1080, 'original', 'high').frameDurationUs).toBeNull()
    expect(computeEncodeParams(1920, 1080, '30', 'high').frameDurationUs).toBe(
      Math.round(1_000_000 / 30)
    )
  })
})

function source(overrides: Partial<JobSource> = {}): JobSource {
  return {
    file: new File([new Uint8Array([0])], 'src.mp4', { type: 'video/mp4' }),
    width: 1920,
    height: 1080,
    hasAudio: true,
    ...overrides,
  }
}

function slice(overrides: Partial<JobSlice> = {}): JobSlice {
  return { sourceIndex: 0, sourceStart: 0, sourceEnd: 2, muted: false, ...overrides }
}

function job(overrides: Partial<ExportJob> = {}): ExportJob {
  return {
    sources: [source()],
    slices: [slice()],
    quality: 'high',
    fps: 'original',
    format: 'webm',
    container: 'webm',
    videoCodec: 'vp9',
    audioCodec: 'opus',
    videoMode: 'encode',
    ...overrides,
  }
}

describe('buildEditPlan dimensions', () => {
  it('uses max source dimensions, even-floored', () => {
    const plan = buildEditPlan(job({ sources: [source({ width: 1921, height: 1081 })] }))
    expect(plan.outputWidth).toBe(1920)
    expect(plan.outputHeight).toBe(1080)
  })

  it('takes the max across multiple sources', () => {
    const plan = buildEditPlan(
      job({
        sources: [source({ width: 640, height: 360 }), source({ width: 1280, height: 720 })],
        slices: [slice({ sourceIndex: 0 }), slice({ sourceIndex: 1 })],
      })
    )
    expect(plan.outputWidth).toBe(1280)
    expect(plan.outputHeight).toBe(720)
  })

  it('uses uniform crop dimensions when every slice shares the same crop', () => {
    const crop = { x: 10, y: 10, width: 800, height: 600 }
    const plan = buildEditPlan(job({ slices: [slice({ crop }), slice({ crop })] }))
    expect(plan.outputWidth).toBe(800)
    expect(plan.outputHeight).toBe(600)
  })
})

describe('buildEditPlan slice timing', () => {
  it('assigns cumulative, gapless output start timestamps in microseconds', () => {
    const plan = buildEditPlan(
      job({
        slices: [
          slice({ sourceStart: 5, sourceEnd: 7 }), // 2s
          slice({ sourceStart: 0, sourceEnd: 3 }), // 3s
        ],
      })
    )
    expect(plan.slices[0].outStartTimestampUs).toBe(0)
    expect(plan.slices[1].outStartTimestampUs).toBe(2_000_000)
  })

  it('preserves slice order', () => {
    const plan = buildEditPlan(
      job({
        slices: [slice({ sourceStart: 9, sourceEnd: 10 }), slice({ sourceStart: 0, sourceEnd: 1 })],
      })
    )
    expect(plan.slices.map((s) => s.sourceStart)).toEqual([9, 0])
  })
})

describe('buildEditPlan fps', () => {
  it('maps fps presets to frame duration in microseconds', () => {
    expect(buildEditPlan(job({ fps: '60' })).frameDurationUs).toBe(Math.round(1_000_000 / 60))
    expect(buildEditPlan(job({ fps: '30' })).frameDurationUs).toBe(Math.round(1_000_000 / 30))
    expect(buildEditPlan(job({ fps: '24' })).frameDurationUs).toBe(Math.round(1_000_000 / 24))
  })

  it('passes original timing through as null', () => {
    expect(buildEditPlan(job({ fps: 'original' })).frameDurationUs).toBeNull()
  })
})

describe('buildEditPlan presets', () => {
  it('orders video bitrate by quality descending', () => {
    const bitrate = (quality: ExportJob['quality']) => buildEditPlan(job({ quality })).videoBitrate
    expect(bitrate('lossless')).toBeGreaterThan(bitrate('high'))
    expect(bitrate('high')).toBeGreaterThan(bitrate('medium'))
    expect(bitrate('medium')).toBeGreaterThan(bitrate('low'))
  })

  it('scales video bitrate with pixel count', () => {
    const small = buildEditPlan(
      job({ sources: [source({ width: 960, height: 540 })] })
    ).videoBitrate
    const large = buildEditPlan(
      job({ sources: [source({ width: 1920, height: 1080 })] })
    ).videoBitrate
    // Quadruple the pixels, roughly quadruple the bitrate.
    expect(large / small).toBeGreaterThan(3)
  })

  it('orders audio bitrate by quality', () => {
    expect(buildEditPlan(job({ quality: 'high' })).audioBitrate).toBeGreaterThan(
      buildEditPlan(job({ quality: 'low' })).audioBitrate
    )
  })

  it('maps the chosen codecs through to the plan', () => {
    expect(buildEditPlan(job({ videoCodec: 'vp8' })).videoCodec).toBe('vp8')
    expect(buildEditPlan(job({ videoCodec: 'avc', audioCodec: 'aac' })).audioCodec).toBe('aac')
  })

  it('uses a 2 second keyframe interval', () => {
    expect(buildEditPlan(job()).keyFrameIntervalUs).toBe(2_000_000)
  })
})

describe('buildEditPlan audio-omit rule', () => {
  it('omits audio when no source has audio', () => {
    const plan = buildEditPlan(job({ sources: [source({ hasAudio: false })] }))
    expect(plan.hasAudioOutput).toBe(false)
  })

  it('keeps audio when a muted slice comes from a source that has audio', () => {
    const plan = buildEditPlan(job({ slices: [slice({ muted: true })] }))
    expect(plan.hasAudioOutput).toBe(true)
  })

  it('keeps audio when the timeline mixes audio and no-audio sources', () => {
    const plan = buildEditPlan(
      job({
        sources: [source({ hasAudio: true }), source({ hasAudio: false })],
        slices: [slice({ sourceIndex: 0 }), slice({ sourceIndex: 1 })],
      })
    )
    expect(plan.hasAudioOutput).toBe(true)
  })
})

describe('outputDimensions with mixed aspect ratios', () => {
  it('keeps the first segment aspect ratio instead of stretching to a max box', () => {
    const plan = buildEditPlan(
      job({
        sources: [source({ width: 640, height: 360 }), source({ width: 360, height: 640 })],
        slices: [slice({ sourceIndex: 0 }), slice({ sourceIndex: 1 })],
      })
    )
    expect(plan.outputWidth).toBe(640)
    expect(plan.outputHeight).toBe(360)
  })
})

describe('buildEditPlan source-aware bitrate', () => {
  const lowBitrateSource = source({
    width: 1280,
    height: 720,
    videoBitrate: 304_000,
    videoCodec: 'avc',
    audioBitrate: 128_000,
    audioCodec: 'aac',
    durationSec: 6,
    file: new File([new Uint8Array(323_000)], 'low.mp4', { type: 'video/mp4' }),
  })
  const mp4Job = (overrides: Partial<ExportJob> = {}) =>
    job({
      sources: [lowBitrateSource],
      slices: [slice({ sourceEnd: 6 })],
      format: 'mp4',
      container: 'mp4',
      videoCodec: 'avc',
      audioCodec: 'aac',
      ...overrides,
    })

  it('keeps every preset below Maximum at or under the source bitrate', () => {
    for (const quality of ['high', 'medium', 'low'] as const) {
      expect(buildEditPlan(mp4Job({ quality })).videoBitrate).toBeLessThanOrEqual(304_000)
    }
    expect(buildEditPlan(mp4Job({ quality: 'low' })).videoBitrate).toBe(Math.round(304_000 * 0.35))
  })

  it('scales the source bitrate down with the picture when a crop is shown at its own size', () => {
    const crop = { x: 0, y: 0, width: 640, height: 360 }
    const plan = buildEditPlan(mp4Job({ slices: [slice({ sourceEnd: 6, crop })] }))
    expect(plan.outputWidth).toBe(640)
    expect(plan.videoBitrate).toBe(76_000)
  })

  it('counts only the letterboxed picture area of a mismatched slice', () => {
    const vertical = source({ width: 720, height: 1280, videoBitrate: 304_000 })
    const plan = buildEditPlan(
      mp4Job({
        sources: [lowBitrateSource, vertical],
        slices: [slice({ sourceEnd: 3 }), slice({ sourceIndex: 1, sourceEnd: 3 })],
      })
    )
    // The vertical clip fills (720/1280)^2 of its own pixels in a 1280x720 frame.
    const verticalShare = 304_000 * (720 / 1280) ** 2
    expect(plan.videoBitrate).toBe(Math.round((304_000 + verticalShare) / 2))
  })

  it('caps audio at the source rate', () => {
    expect(buildEditPlan(mp4Job({ quality: 'high' })).audioBitrate).toBe(128_000)
    const quiet = source({ ...lowBitrateSource, audioBitrate: 64_000 })
    expect(buildEditPlan(mp4Job({ sources: [quiet] })).audioBitrate).toBe(64_000)
  })

  it('ignores muted slices for the audio cap', () => {
    const rich = source({ audioBitrate: 256_000, audioCodec: 'aac', videoBitrate: 1_000_000 })
    const quiet = source({ audioBitrate: 48_000, audioCodec: 'aac', videoBitrate: 1_000_000 })
    const plan = buildEditPlan(
      mp4Job({
        sources: [rich, quiet],
        slices: [slice({ muted: true }), slice({ sourceIndex: 1 })],
      })
    )
    expect(plan.audioBitrate).toBe(48_000)
  })

  it('records the size basis for the estimate', () => {
    const plan = buildEditPlan(mp4Job({ slices: [slice({ sourceStart: 0, sourceEnd: 3 })] }))
    expect(plan.sizeBasis.durationSec).toBe(3)
    expect(plan.sizeBasis.sourceBytes).toBe(161_500)
    expect(plan.sizeBasis.sourceEquivalent?.raw).toBe(304_000)
    expect(plan.sizeBasis.frameRate).toBe(30)
  })

  it('falls back to the table when a source has no bitrate', () => {
    const plan = buildEditPlan(mp4Job({ sources: [source({ width: 1280, height: 720 })] }))
    expect(plan.sizeBasis.sourceEquivalent).toBeNull()
    expect(plan.videoBitrate).toBeGreaterThan(1_000_000)
  })
})

describe('buildEditPlan resolution and target size', () => {
  it('caps the output at the chosen resolution, keeping the aspect ratio', () => {
    const plan = buildEditPlan(job({ maxShortSide: 360 }))
    expect(plan.outputWidth).toBe(640)
    expect(plan.outputHeight).toBe(360)
    // The bitrate follows the smaller picture.
    expect(plan.videoBitrate).toBeLessThan(buildEditPlan(job()).videoBitrate)
  })

  it('never upscales past the source', () => {
    const plan = buildEditPlan(
      job({ sources: [source({ width: 640, height: 360 })], maxShortSide: 1080 })
    )
    expect(plan.outputHeight).toBe(360)
  })

  it('aims a target size with constant bitrate on VP9', () => {
    const plan = buildEditPlan(job({ targetBytes: 2_000_000, slices: [slice({ sourceEnd: 10 })] }))
    expect(plan.targetFit?.feasible).toBe(true)
    expect(plan.bitrateMode).toBe('constant')
    expect(plan.videoBitrate).toBe(plan.targetFit?.videoBitrate)
    expect(plan.audioBitrate).toBe(plan.targetFit?.audioBitrate)
    const bytes = ((plan.videoBitrate + plan.audioBitrate) * 10) / 8
    expect(bytes).toBeLessThan(2_000_000)
    expect(bytes).toBeGreaterThan(2_000_000 * 0.9)
  })

  it('keeps variable bitrate for H.264 and for quality presets', () => {
    expect(buildEditPlan(job()).bitrateMode).toBe('variable')
    expect(
      buildEditPlan(
        job({ targetBytes: 2_000_000, container: 'mp4', videoCodec: 'avc', audioCodec: 'aac' })
      ).bitrateMode
    ).toBe('variable')
  })

  it('shrinks and drops frames when the target leaves too few bits', () => {
    const plan = buildEditPlan(
      job({
        sources: [source({ hasAudio: false })],
        slices: [slice({ sourceEnd: 60 })],
        fps: '30',
        targetBytes: 2_000_000,
      })
    )
    expect(plan.outputHeight).toBe(360)
    expect(plan.frameRate).toBe(24)
    expect(plan.frameDurationUs).toBe(Math.round(1_000_000 / 24))
    expect(plan.nominalFrameRate).toBe(24)
  })
})
