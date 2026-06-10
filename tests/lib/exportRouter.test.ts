import { describe, expect, it } from 'vitest'

import { chooseEngine } from '@/lib/exportEngine'

describe('chooseEngine', () => {
  it('uses webcodecs for re-encode of supported formats', () => {
    const base = { forceFfmpeg: false, streamCopyEligible: false }
    expect(chooseEngine({ ...base, format: 'mp4' })).toBe('webcodecs')
    expect(chooseEngine({ ...base, format: 'mkv' })).toBe('webcodecs')
    expect(chooseEngine({ ...base, format: 'mov' })).toBe('webcodecs')
    expect(chooseEngine({ ...base, format: 'webm' })).toBe('webcodecs')
  })

  it('keeps stream-copy-eligible exports on ffmpeg', () => {
    expect(chooseEngine({ format: 'mp4', forceFfmpeg: false, streamCopyEligible: true })).toBe(
      'ffmpeg'
    )
  })

  it('honors the force-ffmpeg test hook', () => {
    expect(chooseEngine({ format: 'mp4', forceFfmpeg: true, streamCopyEligible: false })).toBe(
      'ffmpeg'
    )
  })
})
