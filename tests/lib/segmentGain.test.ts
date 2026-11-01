import { beforeEach, describe, expect, it } from 'vitest'

import { buildCompositorJob } from '@/lib/advanced/advancedExport'
import { effectiveFades, hasFades, segmentGainAt } from '@/lib/advanced/segmentGain'
import { advancedOutputLock, advancedTracks, clips } from '@/lib/store'
import type { AdvancedSegment, Clip } from '@/lib/types'
import { addToMix, createMixBuffer, layerMixGain } from '@/lib/webcodecs/compositorAudioMix'
import type { CompositorLayerPlan } from '@/lib/webcodecs/compositorPlan'
import { layerAlphaAt } from '@/lib/webcodecs/compositorVideoEncode'
import { OUTPUT_SAMPLE_RATE } from '@/lib/webcodecs/mediabunnyOutput'

// A 4 s span (source 1..5) with a 1 s fade in and a 2 s fade out.
const SPAN = { sourceStart: 1, sourceEnd: 5, fadeIn: 1, fadeOut: 2 }

describe('segmentGainAt', () => {
  it('is 1 without fades', () => {
    expect(segmentGainAt({ sourceStart: 0, sourceEnd: 4 }, 0)).toBe(1)
    expect(hasFades({ sourceStart: 0, sourceEnd: 4, fadeIn: 0 })).toBe(false)
  })

  it('ramps linearly up through the fade in and down through the fade out', () => {
    expect(segmentGainAt(SPAN, 0)).toBe(0)
    expect(segmentGainAt(SPAN, 0.5)).toBe(0.5)
    expect(segmentGainAt(SPAN, 1)).toBe(1)
    expect(segmentGainAt(SPAN, 1.5)).toBe(1)
    expect(segmentGainAt(SPAN, 3)).toBe(0.5)
    expect(segmentGainAt(SPAN, 4)).toBe(0)
    // Outside the span the gain stays clamped.
    expect(segmentGainAt(SPAN, -1)).toBe(0)
    expect(segmentGainAt(SPAN, 9)).toBe(0)
  })

  it('shrinks fades that would outlast a trimmed clip so they meet', () => {
    const trimmed = { sourceStart: 0, sourceEnd: 2, fadeIn: 3, fadeOut: 1 }
    expect(effectiveFades(trimmed)).toEqual({ fadeIn: 1.5, fadeOut: 0.5 })
    expect(segmentGainAt(trimmed, 1.5)).toBeCloseTo(1)
    expect(segmentGainAt(trimmed, 0.75)).toBeCloseTo(0.5)
  })
})

describe('export fades', () => {
  it('fades a compositor layer through its alpha at output time', () => {
    const layer = {
      ...SPAN,
      timelineStart: 10,
      opacity: 0.8,
    } as CompositorLayerPlan
    expect(layerAlphaAt(layer, 10)).toBe(0)
    expect(layerAlphaAt(layer, 10.5)).toBeCloseTo(0.4)
    expect(layerAlphaAt(layer, 12)).toBeCloseTo(0.8)
  })

  it('shapes mixed audio with the same envelope, in any mix window', () => {
    const layer = { ...SPAN, sourceIndex: 0, timelineStart: 0, volume: 0.5 }
    const frames = OUTPUT_SAMPLE_RATE // the first second: the fade in
    const ones = new Float32Array(frames * 2).fill(1)
    const whole = createMixBuffer(1)
    addToMix(whole, ones, frames, frames, 0, layerMixGain(layer))
    expect(whole.left[0]).toBe(0)
    expect(whole.left[frames / 2]).toBeCloseTo(0.25)
    expect(whole.right[frames - 1]).toBeCloseTo(0.5, 3)

    // A window starting half a second in sees the same gain at that time.
    const window = createMixBuffer(0.5)
    addToMix(window, ones, frames, frames / 2, 0, layerMixGain(layer, frames / 2))
    expect(window.left[0]).toBeCloseTo(whole.left[frames / 2])
    expect(layerMixGain({ ...layer, fadeIn: 0, fadeOut: 0 })).toBe(0.5)
  })
})

function makeClip(id: string): Clip {
  return {
    id,
    file: new File([new Uint8Array([0])], `${id}.mp4`, { type: 'video/mp4' }),
    name: id,
    duration: 8,
    width: 1280,
    height: 720,
    objectUrl: `blob:${id}`,
    waveformPeaks: new Float32Array(0),
    hasAudio: true,
  }
}

describe('buildCompositorJob fades', () => {
  beforeEach(() => {
    clips.value = [makeClip('a')]
    advancedTracks.value = [{ id: 'track-1', name: 'Track 1' }]
    advancedOutputLock.value = null
  })

  it('carries each clip fades into its video and audio layers', () => {
    const segment: AdvancedSegment = {
      id: 'seg',
      clipId: 'a',
      trackId: 'track-1',
      timelineStart: 0,
      sourceStart: 0,
      sourceEnd: 8,
      transform: { x: 0, y: 0, width: 1280, height: 720 },
      fadeIn: 1,
      fadeOut: 2,
    }
    const job = buildCompositorJob([segment], 'mp4', 'high', 'original')!
    expect(job.layers[0]).toMatchObject({ fadeIn: 1, fadeOut: 2 })
    expect(job.audioLayers[0]).toMatchObject({ fadeIn: 1, fadeOut: 2 })
  })
})
