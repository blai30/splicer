import { describe, expect, it } from 'vitest'

import { probeContainer } from '@/lib/webcodecs/demux'

function fileFromBytes(bytes: number[], name = 'x.bin'): File {
  return new File([new Uint8Array(bytes)], name)
}

describe('probeContainer', () => {
  it('detects WebM/Matroska by the EBML magic', () => {
    const file = fileFromBytes([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0], 'clip.webm')
    return expect(probeContainer(file)).resolves.toBe('webm')
  })

  it('detects MP4/MOV by the ftyp box at offset 4', () => {
    // 4 bytes of box size, then 'ftyp'.
    const file = fileFromBytes([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70], 'clip.mp4')
    return expect(probeContainer(file)).resolves.toBe('mp4')
  })

  it('returns unsupported for anything else', () => {
    const file = fileFromBytes([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0], 'clip.avi')
    return expect(probeContainer(file)).resolves.toBe('unsupported')
  })
})
