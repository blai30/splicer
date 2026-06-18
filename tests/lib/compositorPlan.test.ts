import { describe, expect, it } from 'vitest'

import { buildCompositorPlan } from '@/lib/webcodecs/compositorPlan'
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
        transform: { x: 0, y: 0, width: 1920, height: 1080 },
        muted: false,
        opacity: 1,
      },
    ],
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

  it('reports audio output when a non-muted layer has audio', () => {
    expect(buildCompositorPlan(makeJob()).hasAudioOutput).toBe(true)
    expect(
      buildCompositorPlan(makeJob({ layers: [{ ...makeJob().layers[0], muted: true }] }))
        .hasAudioOutput
    ).toBe(false)
  })
})
