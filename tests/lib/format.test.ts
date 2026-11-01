import { describe, expect, it } from 'vitest'

import { formatSizeRange } from '@/lib/format'

describe('formatSizeRange', () => {
  it('shares the unit when both ends use it', () => {
    expect(formatSizeRange(1_700_000, 2_300_000)).toBe('1.7–2.3 MB')
  })

  it('keeps both units when the ends differ', () => {
    expect(formatSizeRange(900_000, 1_100_000)).toBe('900 KB–1.1 MB')
  })
})
