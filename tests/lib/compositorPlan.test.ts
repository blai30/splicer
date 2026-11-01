import { describe, expect, it } from 'vitest'

import { buildCompositorPlan, dominantLayerSlices } from '@/lib/webcodecs/compositorPlan'
import type { CompositorJob } from '@/lib/webcodecs/compositorProtocol'

function makeJob(overrides: Partial<CompositorJob> = {}): CompositorJob {
  return {
    canvas: { width: 1920, height: 1080 },
    sources: [
      { file: new File([new Uint8Array([0])], 's.mp4'), width: 1280, height: 720, hasAudio: true },
    ],
    layers: [
      {
        sourceIndex: 0,
        sourceStart: 0,
        sourceEnd: 4,
        timelineStart: 0,
        trackId: 't',
        transform: { x: 0, y: 0, width: 1920, height: 1080 },
        muted: false,
        opacity: 1,
      },
    ],
    tracksOrder: ['t'],
    audioLayers: [],
    durationSec: 4,
    quality: 'high',
    fps: 'original',
    format: 'mp4',
    container: 'mp4',
    videoCodec: 'avc',
    audioCodec: 'aac',
    ...overrides,
  }
}

describe('buildCompositorPlan', () => {
  it('takes output dimensions from the canvas, floored even', () => {
    const plan = buildCompositorPlan(makeJob({ canvas: { width: 1921, height: 1080 } }))
    expect(plan.outputWidth).toBe(1920)
    expect(plan.outputHeight).toBe(1080)
  })

  it('computes layer output start from timelineStart', () => {
    const plan = buildCompositorPlan(
      makeJob({ layers: [{ ...makeJob().layers[0], timelineStart: 2 }] })
    )
    expect(plan.layers[0].outStartUs).toBe(2_000_000)
  })

  it('reports audio output when an audible layer has audio', () => {
    expect(buildCompositorPlan(makeJob()).hasAudioOutput).toBe(false)
    const audioLayers = [
      { sourceIndex: 0, sourceStart: 0, sourceEnd: 4, timelineStart: 0, volume: 1 },
    ]
    expect(buildCompositorPlan(makeJob({ audioLayers })).hasAudioOutput).toBe(true)
  })

  it('resolves the fps grid (30 for original)', () => {
    expect(buildCompositorPlan(makeJob()).fpsGrid).toBe(30)
    expect(buildCompositorPlan(makeJob({ fps: '60' })).fpsGrid).toBe(60)
  })
})

describe('buildCompositorPlan source-aware bitrate', () => {
  const measured = {
    file: new File([new Uint8Array(1_000)], 's.mp4'),
    width: 1920,
    height: 1080,
    hasAudio: true,
    durationSec: 4,
    videoBitrate: 2_000_000,
    videoCodec: 'avc',
  }
  const fullFrame = makeJob().layers[0]

  it('uses the source-equivalent for one full-frame layer at a time', () => {
    const plan = buildCompositorPlan(
      makeJob({
        sources: [measured],
        layers: [fullFrame, { ...fullFrame, timelineStart: 5 }],
      })
    )
    expect(dominantLayerSlices(makeJob({ sources: [measured] }), 1920, 1080)).toHaveLength(1)
    expect(plan.videoBitrate).toBe(2_000_000)
    expect(plan.sizeBasis.sourceEquivalent?.raw).toBe(2_000_000)
    expect(plan.sizeBasis.sourceBytes).toBe(2_000)
  })

  it('falls back to the table when layers overlap in time', () => {
    const overlay = {
      ...fullFrame,
      timelineStart: 1,
      transform: { x: 0, y: 0, width: 480, height: 270 },
    }
    const plan = buildCompositorPlan(makeJob({ sources: [measured], layers: [fullFrame, overlay] }))
    expect(plan.sizeBasis.sourceEquivalent).toBeNull()
    expect(plan.videoBitrate).toBe(12_000_000)
  })

  it('falls back to the table when the only layer leaves much of the frame empty', () => {
    const small = { ...fullFrame, transform: { x: 0, y: 0, width: 960, height: 1080 } }
    expect(dominantLayerSlices(makeJob({ sources: [measured], layers: [small] }), 1920, 1080)).toBe(
      null
    )
  })

  it('gives VP9 the codec-adjusted table', () => {
    const plan = buildCompositorPlan(makeJob({ videoCodec: 'vp9', audioCodec: 'opus' }))
    expect(plan.videoBitrate).toBe(Math.round(12_000_000 * 0.65))
  })
})
