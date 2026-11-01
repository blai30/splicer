import { beforeEach, describe, expect, it } from 'vitest'

import { buildJob } from '@/lib/exportEngine'
import { clips } from '@/lib/store'
import type { Clip, Segment } from '@/lib/types'

function makeClip(id: string, overrides: Partial<Clip> = {}): Clip {
  return {
    id,
    file: new File([new Uint8Array([0])], `${id}.mp4`, { type: 'video/mp4' }),
    name: id,
    duration: 10,
    width: 1920,
    height: 1080,
    objectUrl: `blob:${id}`,
    waveformPeaks: new Float32Array(0),
    hasAudio: true,
    videoCodec: 'avc',
    decoderConfigKey: 'avc1.640028|1920x1088|abc',
    squarePixels: true,
    rotation: 0,
    ...overrides,
  }
}

function makeSegment(clipId: string): Segment {
  return { id: `seg-${clipId}`, clipId, startTime: 0, endTime: 5 }
}

describe('buildJob', () => {
  beforeEach(() => {
    clips.value = [makeClip('a')]
  })

  it('maps segments to a WebCodecs job with avc/aac for mp4', () => {
    const job = buildJob([makeSegment('a')], 'mp4', 'lossless', 'original')
    expect(job).not.toBeNull()
    expect(job?.container).toBe('mp4')
    expect(job?.videoCodec).toBe('avc')
    expect(job?.audioCodec).toBe('aac')
    expect(job?.sources).toHaveLength(1)
    expect(job?.slices).toHaveLength(1)
    expect(job?.slices[0]).toMatchObject({ sourceIndex: 0, sourceStart: 0, sourceEnd: 5 })
  })

  it('selects opus/webm for webm output', () => {
    const job = buildJob([makeSegment('a')], 'webm', 'high', '30')
    expect(job?.container).toBe('webm')
    expect(job?.audioCodec).toBe('opus')
  })

  it('copies the video for Original when nothing blocks it', () => {
    const job = buildJob([makeSegment('a')], 'mp4', 'original', 'original', { resolution: '720' })
    expect(job?.videoMode).toBe('encode')
    const copy = buildJob([makeSegment('a')], 'mkv', 'original', 'original')
    expect(copy?.videoMode).toBe('copy')
    // Audio is still encoded, at High.
    expect(copy?.quality).toBe('high')
    expect(copy?.maxShortSide).toBeUndefined()
  })

  it('encodes at High when Original cannot copy', () => {
    for (const job of [
      buildJob([makeSegment('a')], 'mp4', 'original', '30'),
      buildJob([makeSegment('a')], 'webm', 'original', 'original'),
      buildJob(
        [{ ...makeSegment('a'), crop: { x: 0, y: 0, width: 960, height: 1080 } }],
        'mp4',
        'original',
        'original'
      ),
    ]) {
      expect(job?.videoMode).toBe('encode')
      expect(job?.quality).toBe('high')
    }
    clips.value = [
      makeClip('a'),
      makeClip('b', { decoderConfigKey: 'avc1.640028|1920x1088|other' }),
    ]
    expect(
      buildJob([makeSegment('a'), makeSegment('b')], 'mp4', 'original', 'original')?.videoMode
    ).toBe('encode')
  })

  it('passes the resolution cap and target size to the job', () => {
    const capped = buildJob([makeSegment('a')], 'mp4', 'high', 'original', { resolution: '480' })
    expect(capped?.maxShortSide).toBe(480)
    expect(capped?.targetBytes).toBeNull()
    const target = buildJob([makeSegment('a')], 'mp4', 'target', 'original', { targetSizeMB: 8 })
    expect(target?.targetBytes).toBe(8_000_000)
    expect(target?.quality).toBe('high')
  })

  it('returns null when a referenced clip is missing', () => {
    const job = buildJob([makeSegment('missing')], 'mp4', 'lossless', 'original')
    expect(job).toBeNull()
  })
})
