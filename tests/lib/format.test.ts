import { describe, expect, it } from 'vitest'

import { formatPreciseTime, formatSignedSeconds, formatSizeRange } from '@/lib/format'

describe('formatSizeRange', () => {
  it('shares the unit when both ends use it', () => {
    expect(formatSizeRange(1_700_000, 2_300_000)).toBe('1.7–2.3 MB')
  })

  it('keeps both units when the ends differ', () => {
    expect(formatSizeRange(900_000, 1_100_000)).toBe('900 KB–1.1 MB')
  })
})

describe('formatPreciseTime', () => {
  it('shows minutes, seconds, and hundredths', () => {
    expect(formatPreciseTime(12.4)).toBe('0:12.40')
    expect(formatPreciseTime(75.005)).toBe('1:15.01')
    expect(formatPreciseTime(59.999)).toBe('1:00.00')
    expect(formatPreciseTime(-1)).toBe('0:00.00')
  })
})

describe('formatSignedSeconds', () => {
  it('always shows a sign', () => {
    expect(formatSignedSeconds(1.2)).toBe('+1.20s')
    expect(formatSignedSeconds(-0.5)).toBe('\u22120.50s')
    expect(formatSignedSeconds(0)).toBe('+0.00s')
    expect(formatSignedSeconds(-0.001)).toBe('+0.00s')
  })
})
