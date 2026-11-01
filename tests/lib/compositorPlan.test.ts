import { describe, expect, it } from 'vitest'

import {
  buildCompositorPlan,
  layeredSourceBitrate,
  sequentialLayerSlices,
} from '@/lib/webcodecs/compositorPlan'
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
    expect(sequentialLayerSlices(makeJob({ sources: [measured] }), 1920, 1080)).toHaveLength(1)
    expect(plan.videoBitrate).toBe(2_000_000)
    expect(plan.sizeBasis.sourceEquivalent?.raw).toBe(2_000_000)
    expect(plan.sizeBasis.sourceBytes).toBe(2_000)
  })

  it('falls back to the table when layers overlap in time, bounded by the sources', () => {
    const overlay = {
      ...fullFrame,
      timelineStart: 1,
      transform: { x: 0, y: 0, width: 480, height: 270 },
    }
    const job = makeJob({ sources: [measured], layers: [fullFrame, overlay] })
    const plan = buildCompositorPlan(job)
    expect(plan.sizeBasis.sourceEquivalent).toBeNull()
    expect(plan.videoBitrate).toBe(12_000_000)
    // 4 s of the full frame plus 4 s of a 1/16 overlay, over the 5 s shown.
    expect(plan.sizeBasis.sourceBitrateBound).toBeCloseTo((2_000_000 * (4 + 4 / 16)) / 5)
    expect(layeredSourceBitrate(makeJob({ layers: [fullFrame, overlay] }), 1920, 1080)).toBeNull()
  })

  it('scales a smaller centered second scene by the area it covers', () => {
    // Auto output 1920x1080 from the first scene; a 1280x720 recording follows,
    // centered at 1:1 with black around it.
    const screen = { ...measured, width: 1280, height: 720, videoBitrate: 1_000_000 }
    const centered = {
      ...fullFrame,
      sourceIndex: 1,
      timelineStart: 4,
      transform: { x: 320, y: 180, width: 1280, height: 720 },
    }
    const plan = buildCompositorPlan(
      makeJob({ sources: [measured, screen], layers: [fullFrame, centered], durationSec: 8 })
    )
    expect(plan.sizeBasis.sourceEquivalent?.raw).toBeCloseTo(1_500_000)
    expect(plan.videoBitrate).toBe(1_500_000)
    expect(plan.sizeBasis.sourceBitrateBound).toBeCloseTo(1_500_000)
  })

  it('scales a letterboxed clip under a portrait lock by its fitted area', () => {
    // 1920x1080 contain-fit into 1080x1920: 1080x607.5, about 32% of the frame.
    const letterboxed = { ...fullFrame, transform: { x: 0, y: 656.25, width: 1080, height: 607.5 } }
    const plan = buildCompositorPlan(
      makeJob({ canvas: { width: 1080, height: 1920 }, sources: [measured], layers: [letterboxed] })
    )
    const expected = 2_000_000 * ((1080 * 607.5) / (1920 * 1080))
    expect(plan.sizeBasis.sourceEquivalent?.raw).toBeCloseTo(expected)
    expect(plan.videoBitrate).toBe(Math.round(expected))
  })

  it('gives VP9 the codec-adjusted table', () => {
    const plan = buildCompositorPlan(makeJob({ videoCodec: 'vp9', audioCodec: 'opus' }))
    expect(plan.videoBitrate).toBe(Math.round(12_000_000 * 0.65))
  })
})

describe('buildCompositorPlan resolution and target size', () => {
  it('scales the canvas and every layer to the chosen resolution', () => {
    const plan = buildCompositorPlan(
      makeJob({
        maxShortSide: 360,
        layers: [
          {
            ...makeJob().layers[0],
            transform: { x: 960, y: 540, width: 960, height: 540 },
          },
        ],
      })
    )
    expect(plan.outputWidth).toBe(640)
    expect(plan.outputHeight).toBe(360)
    expect(plan.layers[0].transform).toEqual({ x: 320, y: 180, width: 320, height: 180 })
  })

  it('fits a target size by shrinking and lowering the frame grid', () => {
    const plan = buildCompositorPlan(
      makeJob({ durationSec: 60, fps: '30', targetBytes: 2_400_000 })
    )
    expect(plan.targetFit?.feasible).toBe(true)
    expect(plan.outputHeight).toBe(360)
    expect(plan.fpsGrid).toBe(24)
    expect(plan.videoBitrate).toBe(plan.targetFit?.videoBitrate)
  })
})
