import { describe, expect, it } from 'vitest'

import { makeExportFilename } from '@/lib/exportFilename'

const date = new Date('2026-11-02T07:18:05.123Z')

describe('makeExportFilename', () => {
  it('stamps a single export with the time it started', () => {
    expect(makeExportFilename('mp4', date)).toBe('splicer-2026-11-02T07-18-05.mp4')
  })

  it('numbers the parts of a per-segment export from 1', () => {
    expect(makeExportFilename('webm', date, { index: 0, count: 3 })).toBe(
      'splicer-2026-11-02T07-18-05-part-1.webm'
    )
  })

  it('pads part numbers to the width of the count so they sort', () => {
    expect(makeExportFilename('mkv', date, { index: 2, count: 12 })).toBe(
      'splicer-2026-11-02T07-18-05-part-03.mkv'
    )
  })
})
