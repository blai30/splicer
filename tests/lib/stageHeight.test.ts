import { describe, expect, it } from 'vitest'

import { clampStageHeight, STAGE_MAX_HEIGHT, STAGE_MIN_HEIGHT } from '@/lib/advanced/stageHeight'

describe('clampStageHeight', () => {
  it('clamps below the minimum', () => {
    expect(clampStageHeight(100)).toBe(STAGE_MIN_HEIGHT)
  })

  it('clamps above the maximum', () => {
    expect(clampStageHeight(9999)).toBe(STAGE_MAX_HEIGHT)
  })

  it('leaves an in-range value unchanged', () => {
    expect(clampStageHeight(640)).toBe(640)
  })

  it('rounds to an integer', () => {
    expect(clampStageHeight(640.7)).toBe(641)
  })
})
