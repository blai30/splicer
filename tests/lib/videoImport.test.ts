import { describe, expect, it } from 'vitest'

import { isVideoFile } from '@/lib/videoImport'

describe('isVideoFile', () => {
  it('accepts supported video files', () => {
    expect(isVideoFile(new File([], 'clip.mp4', { type: 'video/mp4' }))).toBe(true)
    expect(isVideoFile(new File([], 'clip.webm', { type: 'video/webm' }))).toBe(true)
    expect(isVideoFile(new File([], 'clip.mkv'))).toBe(true)
    expect(isVideoFile(new File([], 'clip.mov'))).toBe(true)
  })

  it('rejects AVI files by type and by extension', () => {
    expect(isVideoFile(new File([], 'old.avi', { type: 'video/x-msvideo' }))).toBe(false)
    expect(isVideoFile(new File([], 'old.avi'))).toBe(false)
  })
})
