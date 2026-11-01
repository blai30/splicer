import { readFileSync } from 'node:fs'

import { ALL_FORMATS, BufferSource, Input } from 'mediabunny'
import { describe, expect, it, vi } from 'vitest'

import {
  audioPacketBound,
  chooseFastStart,
  doneMessage,
  hasRoomFor,
  isReserveOverflow,
  packetBudget,
  reservedIndexBytes,
  shouldStream,
  withReserveFallback,
} from '@/lib/webcodecs/exportTarget'
import { countPacketsInRange } from '@/lib/webcodecs/mediabunnyInput'

describe('chooseFastStart', () => {
  it('keeps the in-memory index for buffered output', () => {
    expect(chooseFastStart(false, null)).toBe('in-memory')
    expect(chooseFastStart(false, { video: 10, audio: 10 })).toBe('in-memory')
  })

  it('reserves the index for streamed output only with packet bounds', () => {
    expect(chooseFastStart(true, { video: 10, audio: 10 })).toBe('reserve')
    expect(chooseFastStart(true, null)).toBe(false)
  })
})

describe('packet bounds', () => {
  it('adds a margin to the expected count', () => {
    expect(packetBudget(0)).toBe(32)
    expect(packetBudget(300)).toBeGreaterThanOrEqual(375)
    expect(packetBudget(-5)).toBe(32)
  })

  it('bounds audio packets by the codec frame size', () => {
    // 10 s at 48 kHz: 469 AAC packets or 500 Opus packets, plus encoder extras.
    expect(audioPacketBound(10, 48_000, 'aac', 0)).toBe(473)
    expect(audioPacketBound(10, 48_000, 'opus', 0)).toBe(504)
    expect(audioPacketBound(10, 48_000, 'aac', 3)).toBe(476)
  })

  it('streams unless a reserved index would be a visible share of the file', () => {
    const tenSeconds = { video: 300, audio: 473 }
    // A 10 s 720p export: the reserve is under 1% of ~4 MB.
    expect(reservedIndexBytes(tenSeconds)).toBeLessThan(40_000)
    expect(shouldStream(4_000_000, 'mp4', tenSeconds)).toBe(true)
    // A 2 s thumbnail-sized export stays in memory with an exact index.
    expect(shouldStream(35_000, 'mov', { video: 61, audio: 99 })).toBe(false)
  })

  it('keeps unbounded MP4/MOV exports in memory for fast start unless large', () => {
    const megabyte = 1024 * 1024
    // A 10 s 720p export from a WebM source, whose packets cannot be counted.
    expect(shouldStream(5 * megabyte, 'mp4', null)).toBe(false)
    expect(shouldStream(5 * megabyte, 'mov', null)).toBe(false)
    expect(shouldStream(2000 * megabyte, 'mp4', null)).toBe(true)
  })

  it('always streams Matroska, which has no index to place', () => {
    expect(shouldStream(1_000, 'webm', null)).toBe(true)
    expect(shouldStream(1_000, 'mkv', null)).toBe(true)
  })
})

describe('hasRoomFor', () => {
  it('needs the estimate with margin plus headroom', () => {
    const megabyte = 1024 * 1024
    expect(hasRoomFor({ quota: 1000 * megabyte, usage: 0 }, 100 * megabyte)).toBe(true)
    expect(hasRoomFor({ quota: 1000 * megabyte, usage: 900 * megabyte }, 100 * megabyte)).toBe(
      false
    )
  })

  it('refuses when the browser reports no quota', () => {
    expect(hasRoomFor({}, 1)).toBe(false)
  })
})

describe('withReserveFallback', () => {
  const overflow = new Error('Track #1 has already reached the maximum packet count (40).')

  it('retries an overflowing reserved index with the index at the end', async () => {
    const attempt = vi.fn(async (counts: unknown) => {
      if (counts) throw overflow
      return 'done'
    })
    const result = await withReserveFallback({ video: 1, audio: 1 }, attempt, () => false)
    expect(result).toBe('done')
    expect(attempt.mock.calls).toEqual([[{ video: 1, audio: 1 }], [null]])
  })

  it('passes other errors and cancellations through', async () => {
    const failing = vi.fn(async () => {
      throw new Error('decoder failed')
    })
    await expect(withReserveFallback({ video: 1, audio: 1 }, failing, () => false)).rejects.toThrow(
      'decoder failed'
    )
    expect(failing).toHaveBeenCalledOnce()

    const canceled = vi.fn(async () => {
      throw overflow
    })
    await expect(withReserveFallback({ video: 1, audio: 1 }, canceled, () => true)).rejects.toBe(
      overflow
    )
    expect(canceled).toHaveBeenCalledOnce()
  })

  it('recognizes the overflow message', () => {
    expect(isReserveOverflow(overflow)).toBe(true)
    expect(isReserveOverflow(new Error('other'))).toBe(false)
    expect(isReserveOverflow('maximum packet count')).toBe(false)
  })
})

describe('doneMessage', () => {
  it('sends a streamed file by reference', () => {
    const file = new File([], 'export.mp4')
    const { message, transfer } = doneMessage({ kind: 'file', file, storageName: 'tab/x.mp4' })
    expect(message).toEqual({ type: 'done', file, storageName: 'tab/x.mp4' })
    expect(transfer).toEqual([])
  })

  it('transfers an in-memory buffer', () => {
    const buffer = new ArrayBuffer(8)
    const { message, transfer } = doneMessage({ kind: 'buffer', buffer })
    expect(message).toEqual({ type: 'done', buffer })
    expect(transfer).toEqual([buffer])
  })
})

describe('countPacketsInRange', () => {
  async function tinyVideoTrack() {
    // 320x240 at 30 fps, 60 frames.
    const bytes = readFileSync(new URL('../fixtures/tiny.mp4', import.meta.url))
    const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(bytes) })
    return (await input.getPrimaryVideoTrack())!
  }

  it('counts every frame of the whole clip', async () => {
    expect(await countPacketsInRange(await tinyVideoTrack(), 0, 2)).toBe(60)
  })

  it('counts frames overlapping a trimmed range', async () => {
    const track = await tinyVideoTrack()
    expect(await countPacketsInRange(track, 0.5, 1.5)).toBe(30)
    // Frames 15 (0.5-0.533 s) through 29 overlap [0.51, 1).
    expect(await countPacketsInRange(track, 0.51, 1)).toBe(15)
  })

  it('counts nothing past the end', async () => {
    expect(await countPacketsInRange(await tinyVideoTrack(), 5, 6)).toBe(0)
  })
})
