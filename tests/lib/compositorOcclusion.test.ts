import { describe, expect, it } from 'vitest'

import { firstVisibleLayerIndex, type OcclusionLayer } from '@/lib/webcodecs/compositorVideoEncode'

const full = { x: 0, y: 0, width: 1920, height: 1080 }

function layer(overrides: Partial<OcclusionLayer> = {}): OcclusionLayer {
  return { opacity: 1, transform: full, hasAlpha: false, ...overrides }
}

describe('firstVisibleLayerIndex', () => {
  it('draws everything when nothing covers the canvas', () => {
    const pip = layer({ transform: { x: 100, y: 100, width: 640, height: 360 } })
    expect(firstVisibleLayerIndex([layer(), pip], 1920, 1080)).toBe(0)
    expect(firstVisibleLayerIndex([pip, pip], 1920, 1080)).toBe(0)
  })

  it('starts at the topmost opaque full-frame layer', () => {
    const pip = layer({ transform: { x: 100, y: 100, width: 640, height: 360 } })
    expect(firstVisibleLayerIndex([layer(), layer(), pip], 1920, 1080)).toBe(1)
    expect(firstVisibleLayerIndex([pip, layer()], 1920, 1080)).toBe(1)
  })

  it('counts a layer that overflows the canvas as covering it', () => {
    const overflow = layer({ transform: { x: -50, y: -20, width: 2100, height: 1200 } })
    expect(firstVisibleLayerIndex([layer(), overflow], 1920, 1080)).toBe(1)
  })

  it('never skips under a translucent, alpha, or unknown-alpha layer', () => {
    expect(firstVisibleLayerIndex([layer(), layer({ opacity: 0.99 })], 1920, 1080)).toBe(0)
    expect(firstVisibleLayerIndex([layer(), layer({ hasAlpha: true })], 1920, 1080)).toBe(0)
    expect(firstVisibleLayerIndex([layer(), layer({ hasAlpha: null })], 1920, 1080)).toBe(0)
  })

  it('does not count a layer that leaves an edge uncovered', () => {
    const short = layer({ transform: { x: 0, y: 0, width: 1920, height: 1079 } })
    expect(firstVisibleLayerIndex([layer(), short], 1920, 1080)).toBe(0)
  })

  it('handles no layers', () => {
    expect(firstVisibleLayerIndex([], 1920, 1080)).toBe(0)
  })
})
