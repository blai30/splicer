import { describe, expect, it } from 'vitest'

import { isVideoFile } from '@/lib/videoImport'

function file(name: string, type: string): File {
  return new File([new Uint8Array([0])], name, { type })
}

describe('isVideoFile', () => {
  it('accepts webm by MIME type', () => {
    expect(isVideoFile(file('clip.webm', 'video/webm'))).toBe(true)
  })

  it('accepts a webm blob with no extension via MIME type', () => {
    // A pasted or recorded webm often arrives without a .webm filename.
    expect(isVideoFile(file('recording', 'video/webm'))).toBe(true)
  })

  it('accepts webm by extension when MIME is empty', () => {
    expect(isVideoFile(file('clip.webm', ''))).toBe(true)
  })

  it('rejects a non-video file', () => {
    expect(isVideoFile(file('notes.txt', 'text/plain'))).toBe(false)
  })
})
