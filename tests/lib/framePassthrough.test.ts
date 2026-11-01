import { describe, expect, it } from 'vitest'

import {
  canPassThrough,
  canPassThroughExport,
  createPassThroughGate,
  isPassThroughFrame,
  PassThroughMismatchError,
  withPassThroughFallback,
  type PassThroughFrame,
} from '@/lib/webcodecs/framePassthrough'
import type { JobSource } from '@/lib/webcodecs/protocol'

const plan = { outputWidth: 1280, outputHeight: 720 }

function source(overrides: Partial<JobSource> = {}): JobSource {
  return {
    file: new File([], 'clip.mp4'),
    width: 1280,
    height: 720,
    hasAudio: true,
    rotation: 0,
    ...overrides,
  }
}

function frame(overrides: Partial<PassThroughFrame> = {}): PassThroughFrame {
  return {
    format: 'I420',
    rotation: 0,
    pixelAspectRatio: { num: 1, den: 1 },
    visibleRect: { left: 0, top: 0, width: 1280, height: 720 },
    colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false },
    ...overrides,
  }
}

describe('canPassThrough', () => {
  it('accepts an uncropped, unrotated slice at the output size', () => {
    expect(canPassThrough({}, source(), plan)).toBe(true)
  })

  it('treats a crop of the whole frame as no crop', () => {
    const crop = { x: 0, y: 0, width: 1280, height: 720 }
    expect(canPassThrough({ crop }, source(), plan)).toBe(true)
  })

  it('accepts a source probed before rotation was recorded', () => {
    expect(canPassThrough({}, source({ rotation: undefined }), plan)).toBe(true)
  })

  it('rejects a real crop', () => {
    const crop = { x: 10, y: 0, width: 1270, height: 720 }
    expect(canPassThrough({ crop }, source(), plan)).toBe(false)
  })

  it('rejects a rotated source even when its display size matches', () => {
    expect(canPassThrough({}, source({ rotation: 90 }), plan)).toBe(false)
  })

  it('rejects a source that must be letterboxed or scaled', () => {
    expect(canPassThrough({}, source({ width: 1920, height: 1080 }), plan)).toBe(false)
    expect(canPassThrough({}, source({ width: 1280, height: 536 }), plan)).toBe(false)
  })

  it('rejects an odd-sized source the output had to floor to even', () => {
    const odd = source({ width: 1281, height: 721 })
    expect(canPassThrough({}, odd, plan)).toBe(false)
  })

  it('rejects a missing source', () => {
    expect(canPassThrough({}, undefined, plan)).toBe(false)
  })
})

describe('isPassThroughFrame', () => {
  it('accepts 8-bit YUV and opaque RGB frames at the output size', () => {
    for (const format of ['I420', 'NV12', 'RGBX', 'BGRX'] as const) {
      expect(isPassThroughFrame(frame({ format }), plan)).toBe(true)
    }
  })

  it('rejects 10-bit, alpha, and unknown layouts', () => {
    for (const format of ['I420P10', 'I420A', 'RGBA', 'BGRA', null] as const) {
      expect(isPassThroughFrame(frame({ format }), plan)).toBe(false)
    }
  })

  it('rejects HDR transfer functions', () => {
    // Browsers report these, though the DOM typings do not list them yet.
    for (const transfer of ['pq', 'hlg'] as unknown as VideoTransferCharacteristics[]) {
      const colorSpace = { ...frame().colorSpace, transfer }
      expect(isPassThroughFrame(frame({ colorSpace }), plan)).toBe(false)
    }
  })

  it('rejects rotated, anamorphic, and differently sized frames', () => {
    expect(isPassThroughFrame(frame({ rotation: 180 }), plan)).toBe(false)
    expect(isPassThroughFrame(frame({ pixelAspectRatio: { num: 4, den: 3 } }), plan)).toBe(false)
    const smaller = { left: 0, top: 0, width: 1280, height: 718 }
    expect(isPassThroughFrame(frame({ visibleRect: smaller }), plan)).toBe(false)
    const offset = { left: 8, top: 0, width: 1280, height: 720 }
    expect(isPassThroughFrame(frame({ visibleRect: offset }), plan)).toBe(false)
  })
})

describe('canPassThroughExport', () => {
  it('passes through only when every slice can', () => {
    const sources = [source(), source({ rotation: 90 })]
    expect(canPassThroughExport([{ sourceIndex: 0 }, { sourceIndex: 0 }], sources, plan)).toBe(true)
    // One drawn slice would put two color ranges in one stream.
    expect(canPassThroughExport([{ sourceIndex: 0 }, { sourceIndex: 1 }], sources, plan)).toBe(
      false
    )
    const crop = { x: 10, y: 0, width: 1270, height: 720 }
    expect(
      canPassThroughExport([{ sourceIndex: 0 }, { sourceIndex: 0, crop }], sources, plan)
    ).toBe(false)
  })

  it('draws an export with no slices', () => {
    expect(canPassThroughExport([], [source()], plan)).toBe(false)
  })
})

describe('createPassThroughGate', () => {
  it('admits frames that share the first frame color space', () => {
    const gate = createPassThroughGate(plan)
    expect(() => gate.admit(frame())).not.toThrow()
    expect(() => gate.admit(frame({ format: 'NV12' }))).not.toThrow()
  })

  it('admits a BT.601 or full range source when it is the whole export', () => {
    const sd = { primaries: 'smpte170m', transfer: 'smpte170m', matrix: 'smpte170m' } as const
    const gate = createPassThroughGate(plan)
    expect(() => gate.admit(frame({ colorSpace: { ...sd, fullRange: true } }))).not.toThrow()
    expect(() => gate.admit(frame({ colorSpace: { ...sd, fullRange: true } }))).not.toThrow()
  })

  it('rejects a frame whose matrix, primaries, or range differs', () => {
    const base = frame().colorSpace
    for (const colorSpace of [
      { ...base, matrix: 'smpte170m' as const },
      { ...base, primaries: 'bt470bg' as const },
      { ...base, fullRange: true },
      { ...base, fullRange: null },
    ]) {
      const gate = createPassThroughGate(plan)
      gate.admit(frame())
      expect(() => gate.admit(frame({ colorSpace }))).toThrow(PassThroughMismatchError)
    }
  })

  it('rejects a frame the per-frame check refuses', () => {
    const gate = createPassThroughGate(plan)
    expect(() => gate.admit(frame({ rotation: 90 }))).toThrow(PassThroughMismatchError)
  })
})

describe('withPassThroughFallback', () => {
  it('redraws the whole export after a mismatch', async () => {
    const attempts: boolean[] = []
    const result = await withPassThroughFallback(
      true,
      async (passThrough) => {
        attempts.push(passThrough)
        if (passThrough) throw new PassThroughMismatchError()
        return 'drawn'
      },
      () => false
    )
    expect(result).toBe('drawn')
    expect(attempts).toEqual([true, false])
  })

  it('does not retry other errors, cancels, or drawn exports', async () => {
    const failing = (error: Error) => async () => {
      throw error
    }
    await expect(
      withPassThroughFallback(true, failing(new Error('x')), () => false)
    ).rejects.toThrow('x')
    await expect(
      withPassThroughFallback(true, failing(new PassThroughMismatchError()), () => true)
    ).rejects.toBeInstanceOf(PassThroughMismatchError)
    await expect(
      withPassThroughFallback(false, failing(new PassThroughMismatchError()), () => false)
    ).rejects.toBeInstanceOf(PassThroughMismatchError)
  })
})
