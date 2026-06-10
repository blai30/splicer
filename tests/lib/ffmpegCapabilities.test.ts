import { afterEach, describe, expect, it, vi } from 'vitest'

import { computeThreadCount, isolationAvailable } from '@/lib/ffmpegCapabilities'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isolationAvailable', () => {
  it('is true when crossOriginIsolated is true', () => {
    vi.stubGlobal('crossOriginIsolated', true)
    expect(isolationAvailable()).toBe(true)
  })

  it('is false when crossOriginIsolated is false', () => {
    vi.stubGlobal('crossOriginIsolated', false)
    expect(isolationAvailable()).toBe(false)
  })
})

describe('computeThreadCount', () => {
  it('returns 1 when hardwareConcurrency is missing', () => {
    vi.stubGlobal('navigator', {} as Navigator)
    expect(computeThreadCount()).toBe(1)
  })

  it('returns the core count when reasonable', () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 4 } as Navigator)
    expect(computeThreadCount()).toBe(4)
  })

  it('caps the thread count at 8', () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 32 } as Navigator)
    expect(computeThreadCount()).toBe(8)
  })
})
