import { describe, expect, it } from 'vitest'

import { decodeSimpleBlock, readVint } from '@/lib/webcodecs/demux/ebml'
import { UnsupportedSourceError } from '@/lib/webcodecs/protocol'

describe('readVint', () => {
  it('reads a one-byte vint (0x82 -> 2)', () => {
    const result = readVint(new Uint8Array([0x82]), 0)
    expect(result.value).toBe(2)
    expect(result.length).toBe(1)
  })

  it('reads a two-byte vint (0x40 0x02 -> 2)', () => {
    const result = readVint(new Uint8Array([0x40, 0x02]), 0)
    expect(result.value).toBe(2)
    expect(result.length).toBe(2)
  })

  it('reads element IDs preserving the length marker when keepMarker is true', () => {
    // 0x1A45DFA3 is the EBML header ID; its leading byte is 0x1A (4-byte form).
    const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])
    const result = readVint(bytes, 0, true)
    expect(result.value).toBe(0x1a45dfa3)
    expect(result.length).toBe(4)
  })
})

describe('decodeSimpleBlock', () => {
  it('decodes track number, relative timestamp, and keyframe flag', () => {
    // Track number 1 (0x81), relative timestamp +256 (0x01 0x00), flags 0x80
    // (keyframe), then one byte of frame data (0xAA).
    const block = new Uint8Array([0x81, 0x01, 0x00, 0x80, 0xaa])
    const result = decodeSimpleBlock(block)
    expect(result.trackNumber).toBe(1)
    expect(result.relTimestamp).toBe(256)
    expect(result.keyframe).toBe(true)
    expect(Array.from(result.frame)).toEqual([0xaa])
  })

  it('decodes a non-keyframe block (flags 0x00)', () => {
    const block = new Uint8Array([0x81, 0x00, 0x05, 0x00, 0xbb])
    const result = decodeSimpleBlock(block)
    expect(result.keyframe).toBe(false)
    expect(result.relTimestamp).toBe(5)
  })

  it('throws UnsupportedSourceError when lacing is set', () => {
    // Flags 0x06 sets the lacing bits, which this parser does not handle.
    const block = new Uint8Array([0x81, 0x00, 0x00, 0x06, 0xcc])
    expect(() => decodeSimpleBlock(block)).toThrow(UnsupportedSourceError)
  })
})
