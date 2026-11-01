import { describe, expect, it } from 'vitest'

import {
  capShortSide,
  evenFloor,
  resolutionShortSide,
  smallerStandardSides,
} from '@/lib/webcodecs/outputSize'

describe('capShortSide', () => {
  it('caps the shorter side and keeps the aspect ratio', () => {
    expect(capShortSide({ width: 1920, height: 1080 }, 360)).toEqual({ width: 640, height: 360 })
    expect(capShortSide({ width: 1920, height: 1080 }, 720)).toEqual({ width: 1280, height: 720 })
  })

  it('treats a portrait frame by its width', () => {
    expect(capShortSide({ width: 1080, height: 1920 }, 720)).toEqual({ width: 720, height: 1280 })
  })

  it('keeps dimensions even', () => {
    // 1280x720 at 480p is 853.3 wide.
    expect(capShortSide({ width: 1280, height: 720 }, 480)).toEqual({ width: 852, height: 480 })
    expect(capShortSide({ width: 1001, height: 563 }, 360)).toEqual({ width: 640, height: 360 })
  })

  it('never scales up, and evens the size it keeps', () => {
    expect(capShortSide({ width: 640, height: 360 }, 1080)).toEqual({ width: 640, height: 360 })
    expect(capShortSide({ width: 641, height: 361 }, null)).toEqual({ width: 640, height: 360 })
  })
})

describe('resolution choices', () => {
  it('maps choices to a shorter-side cap', () => {
    expect(resolutionShortSide('original')).toBeNull()
    expect(resolutionShortSide('480')).toBe(480)
  })

  it('lists only the standard sizes that would shrink a frame', () => {
    expect(smallerStandardSides({ width: 1280, height: 720 })).toEqual([480, 360])
    expect(smallerStandardSides({ width: 320, height: 240 })).toEqual([])
  })

  it('floors to even with a minimum of 2', () => {
    expect(evenFloor(7.9)).toBe(6)
    expect(evenFloor(0)).toBe(2)
  })
})
