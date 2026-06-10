import { describe, expect, it } from 'vitest'

import { buildEditPlan } from '@/lib/webcodecs/editPlan'
import type { ExportJob, JobSlice, JobSource } from '@/lib/webcodecs/protocol'

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
