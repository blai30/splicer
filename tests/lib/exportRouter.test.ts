import { beforeEach, describe, expect, it } from 'vitest'

import { buildJob } from '@/lib/exportEngine'
import { clips } from '@/lib/store'
import type { Clip, Segment } from '@/lib/types'

function makeClip(id: string): Clip {
  return {
    id,
    file: new File([new Uint8Array([0])], `${id}.mp4`, { type: 'video/mp4' }),
    name: id,
    duration: 10,
    width: 1920,
    height: 1080,
    objectUrl: `blob:${id}`,
    waveformPeaks: [],
    hasAudio: true,
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

  it('returns null when a referenced clip is missing', () => {
    const job = buildJob([makeSegment('missing')], 'mp4', 'lossless', 'original')
    expect(job).toBeNull()
  })
})
