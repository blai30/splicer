import { readFileSync } from 'node:fs'

import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import { describe, expect, it } from 'vitest'

import {
  buildPacketIndex,
  copyBlockers,
  decoderConfigKey,
  keyPositionAtOrBefore,
  planSliceCopy,
  planSliceCopyFromIndex,
  type CopyEligibilityInput,
  type CopySource,
  type PacketMeta,
} from '@/lib/fastCopy'
import { readPacketIndex } from '@/lib/packetIndex'
import { planTrackSlice } from '@/lib/webcodecs/copyVideo'

const fixtureBytes = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url))

describe('decoderConfigKey', () => {
  const avcC = new Uint8Array([1, 100, 0, 31, 255, 225, 0, 4, 1, 2, 3, 4])

  it('matches configs with the same codec, coded size, and description bytes', () => {
    const first = decoderConfigKey({
      codec: 'avc1.64001f',
      codedWidth: 1280,
      codedHeight: 720,
      description: avcC,
    })
    const second = decoderConfigKey({
      codec: 'avc1.64001f',
      codedWidth: 1280,
      codedHeight: 720,
      description: avcC.slice().buffer,
    })
    expect(first).toBe(second)
  })

  it('tells apart a different parameter set, codec string, or coded size', () => {
    const base = { codec: 'avc1.64001f', codedWidth: 1280, codedHeight: 720, description: avcC }
    const key = decoderConfigKey(base)
    const otherSps = avcC.slice()
    otherSps[10] = 9
    expect(decoderConfigKey({ ...base, description: otherSps })).not.toBe(key)
    expect(decoderConfigKey({ ...base, codec: 'avc1.640028' })).not.toBe(key)
    expect(decoderConfigKey({ ...base, codedHeight: 1088 })).not.toBe(key)
  })

  it('handles codecs without a description', () => {
    expect(decoderConfigKey({ codec: 'vp09.00.31.08', codedWidth: 320, codedHeight: 240 })).toBe(
      'vp09.00.31.08|320x240|none'
    )
  })
})

describe('copyBlockers', () => {
  const source = (overrides: Partial<CopySource> = {}): CopySource => ({
    name: 'clip',
    codec: 'avc',
    decoderConfigKey: 'avc1.64001f|1280x720|a',
    width: 1280,
    height: 720,
    rotation: 0,
    squarePixels: true,
    ...overrides,
  })
  const input = (overrides: Partial<CopyEligibilityInput> = {}): CopyEligibilityInput => ({
    mode: 'basic',
    container: 'mp4',
    fps: 'original',
    resolution: 'original',
    slices: [{ sourceIndex: 0 }],
    sources: [source()],
    ...overrides,
  })

  it('allows a plain trim of one clip into a container that holds its codec', () => {
    expect(copyBlockers(input())).toEqual([])
    expect(copyBlockers(input({ container: 'mkv' }))).toEqual([])
    expect(copyBlockers(input({ container: 'webm', sources: [source({ codec: 'vp9' })] }))).toEqual(
      []
    )
  })

  it('allows clips that share one decoder setup', () => {
    expect(
      copyBlockers(
        input({
          slices: [{ sourceIndex: 0 }, { sourceIndex: 1 }],
          sources: [source(), source({ name: 'other' })],
        })
      )
    ).toEqual([])
  })

  it('ignores a resolution cap that leaves every clip at its size', () => {
    // 1280x720: a 720p or 1080p cap never upscales, so the copy is the same.
    expect(copyBlockers(input({ resolution: '720' }))).toEqual([])
    expect(copyBlockers(input({ resolution: '1080' }))).toEqual([])
    expect(
      copyBlockers(input({ resolution: '720', sources: [source({ width: 720, height: 1280 })] }))
    ).toEqual([])
  })

  it('blocks a resolution cap that shrinks any clip on the timeline', () => {
    expect(
      copyBlockers(
        input({
          resolution: '720',
          slices: [{ sourceIndex: 0 }, { sourceIndex: 1 }],
          sources: [source(), source({ name: 'big', width: 1920, height: 1080 })],
        })
      )
    ).toContain('Resolution must be Original; 720p shrinks the video.')
  })

  it('names each setting that needs a re-encode', () => {
    expect(copyBlockers(input({ fps: '30' }))).toEqual(['FPS must be Original.'])
    expect(copyBlockers(input({ resolution: '480' }))).toEqual([
      'Resolution must be Original; 480p shrinks the video.',
    ])
    expect(
      copyBlockers(
        input({ slices: [{ sourceIndex: 0, crop: { x: 0, y: 0, width: 640, height: 720 } }] })
      )
    ).toEqual(['A segment is cropped.'])
    expect(copyBlockers(input({ mode: 'advanced' }))[0]).toMatch(/Advanced mode/)
  })

  it('treats a crop of the whole frame as no crop', () => {
    expect(
      copyBlockers(
        input({ slices: [{ sourceIndex: 0, crop: { x: 0, y: 0, width: 1280, height: 720 } }] })
      )
    ).toEqual([])
  })

  it('rejects clips that cannot share one output track', () => {
    const two = (other: CopySource) =>
      copyBlockers(
        input({ slices: [{ sourceIndex: 0 }, { sourceIndex: 1 }], sources: [source(), other] })
      )
    expect(two(source({ codec: 'vp9', decoderConfigKey: 'vp9' }))).toEqual([
      'Clips use different codecs (H.264, VP9).',
    ])
    expect(two(source({ decoderConfigKey: 'other' }))).toEqual([
      'Clips were encoded with different settings.',
    ])
    expect(two(source({ width: 1920, height: 1080 }))).toContain(
      'Clips have different resolutions.'
    )
    expect(two(source({ rotation: 90 }))).toContain('Clips have different rotations.')
  })

  it('rejects unknown setups, non-square pixels, and unverified codecs', () => {
    expect(copyBlockers(input({ sources: [source({ decoderConfigKey: undefined })] }))).toEqual([
      'The codec setup of "clip" could not be read.',
    ])
    expect(copyBlockers(input({ sources: [source({ squarePixels: false })] }))).toEqual([
      '"clip" uses non-square pixels.',
    ])
    expect(copyBlockers(input({ sources: [source({ codec: 'av1' })] }))).toEqual([
      'AV1 cannot be copied yet.',
    ])
  })

  it('suggests the containers that hold the codec', () => {
    expect(copyBlockers(input({ container: 'webm' }))).toEqual([
      'WebM cannot hold H.264 here; choose MP4 or MOV or MKV.',
    ])
    expect(copyBlockers(input({ sources: [source({ codec: 'vp9' })] }))).toEqual([
      'MP4 cannot hold VP9 here; choose WebM or MKV.',
    ])
  })

  it('asks for a clip on an empty timeline', () => {
    expect(copyBlockers(input({ slices: [] }))).toEqual(['Add a clip to the timeline first.'])
  })
})

// Packets in decode order. `frame` is the presentation index at 30 fps.
function packets(spec: { frame: number; key?: boolean }[]): PacketMeta[] {
  return spec.map(({ frame, key }, index) => ({
    timestamp: frame / 30,
    duration: 1 / 30,
    isKey: key === true,
    byteLength: 100 + index,
    sequenceNumber: index,
  }))
}

const at = (frame: number) => frame / 30

describe('planSliceCopy', () => {
  // I0 P3 B1 B2 P6 B4 B5 I9 P12 B10 B11: closed GOPs, key every 9 frames.
  const closed = packets([
    { frame: 0, key: true },
    { frame: 3 },
    { frame: 1 },
    { frame: 2 },
    { frame: 6 },
    { frame: 4 },
    { frame: 5 },
    { frame: 9, key: true },
    { frame: 12 },
    { frame: 10 },
    { frame: 11 },
  ])

  it('starts at the key frame and copies a gap-free run up to the end', () => {
    const plan = planSliceCopy(closed, at(9))!
    expect(plan.snappedStart).toBe(0)
    expect(plan.sequenceNumbers).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(plan.end).toBeCloseTo(at(7))
    expect(plan.byteLength).toBe(100 + 101 + 102 + 103 + 104 + 105 + 106)
  })

  it('keeps a later frame a B-frame before the end depends on, and the frames between', () => {
    // End at frame 2: B2 needs P3 (decoded before it), so P3 and B1 come too.
    const plan = planSliceCopy(closed, at(2))!
    expect(plan.sequenceNumbers).toEqual([0, 1, 2, 3])
    expect(plan.end).toBeCloseTo(at(4))
  })

  it('takes nothing past the next key frame at or after the end', () => {
    const plan = planSliceCopy(closed, at(9) + 1e-9)!
    expect(plan.sequenceNumbers).not.toContain(7)
    expect(plan.end).toBeCloseTo(at(7))
  })

  it('crosses key frames inside the slice', () => {
    const plan = planSliceCopy(closed, at(11))!
    expect(plan.sequenceNumbers).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(plan.end).toBeCloseTo(at(13))
  })

  it('drops open-GOP leading frames that reference the previous GOP', () => {
    // I9 starts the slice; B7 B8 follow it in decode order but show before it.
    const open = packets([
      { frame: 9, key: true },
      { frame: 7 },
      { frame: 8 },
      { frame: 12 },
      { frame: 10 },
      { frame: 11 },
    ])
    const plan = planSliceCopy(open, at(12))!
    expect(plan.snappedStart).toBeCloseTo(at(9))
    expect(plan.sequenceNumbers).toEqual([0, 3, 4, 5])
    expect(plan.end).toBeCloseTo(at(13))
  })

  it('uses the shortest known frame length when the last has none', () => {
    const spec = packets([{ frame: 0, key: true }, { frame: 1 }])
    spec[1] = { ...spec[1], duration: 0 }
    expect(planSliceCopy(spec, at(2))!.end).toBeCloseTo(at(2))
  })

  it('needs a key packet first', () => {
    expect(planSliceCopy(packets([{ frame: 0 }]), 1)).toBeNull()
    expect(planSliceCopy([], 1)).toBeNull()
  })
})

describe('packet index', () => {
  const index = buildPacketIndex(
    packets([
      { frame: 0, key: true },
      { frame: 2 },
      { frame: 1 },
      { frame: 30, key: true },
      { frame: 32 },
      { frame: 31 },
      { frame: 60, key: true },
      { frame: 61 },
    ])
  )

  it('finds the last key frame at or before a time, tolerating float noise', () => {
    expect(keyPositionAtOrBefore(index, 0.5)).toBe(0)
    expect(keyPositionAtOrBefore(index, 1 - 1e-9)).toBe(3)
    expect(keyPositionAtOrBefore(index, 1.5)).toBe(3)
    expect(keyPositionAtOrBefore(index, 99)).toBe(6)
    // Before the first key frame, copying starts at the first one.
    expect(keyPositionAtOrBefore(index, -1)).toBe(0)
    expect(keyPositionAtOrBefore(buildPacketIndex([]), 1)).toBeNull()
  })

  it('plans a slice from its snapped start', () => {
    const plan = planSliceCopyFromIndex(index, 1.2, at(32))!
    expect(plan.snappedStart).toBe(1)
    expect(plan.sequenceNumbers).toEqual([3, 4, 5])
  })
})

describe('reading real files', () => {
  it('indexes key frames once a second in the H.264 fixture', async () => {
    const index = await readPacketIndex(new Blob([fixtureBytes('gop-1s.mp4')]))
    expect(index.timestamps.length).toBe(120)
    expect(Array.from(index.keyPositions, (position) => index.timestamps[position])).toEqual([
      0, 1, 2, 3,
    ])
  })

  it('plans the same copy in the worker as in the panel', async () => {
    const bytes = fixtureBytes('gop-1s.mp4')
    const index = await readPacketIndex(new Blob([bytes]))
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(new Blob([bytes])) })
    try {
      const track = (await input.getPrimaryVideoTrack())!
      const { plan, keyPacket } = await planTrackSlice(track, 1.3, 2.5)
      expect(keyPacket.timestamp).toBe(1)
      expect(plan).toEqual(planSliceCopyFromIndex(index, 1.3, 2.5))
      // From the key frame at 1 s to a frame past 2.5 s that a B-frame needs.
      expect(plan.snappedStart).toBe(1)
      expect(plan.end).toBeGreaterThanOrEqual(2.5)
      expect(plan.end).toBeLessThan(2.5 + 3 / 30)
    } finally {
      input.dispose()
    }
  })
})
