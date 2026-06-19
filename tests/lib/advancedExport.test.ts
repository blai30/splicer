import { beforeEach, describe, expect, it } from 'vitest'

import { buildCompositorJob } from '@/lib/advanced/advancedExport'
import { advancedOutputLock, advancedTracks, clips } from '@/lib/store'
import type { AdvancedSegment, Clip } from '@/lib/types'

function makeClip(id: string): Clip {
  return {
    id,
    file: new File([new Uint8Array([0])], `${id}.mp4`, { type: 'video/mp4' }),
    name: id,
    duration: 8,
    width: 1280,
    height: 720,
    objectUrl: `blob:${id}`,
    waveformPeaks: [],
    hasAudio: true,
  }
}

function makeSegment(clipId: string): AdvancedSegment {
  return {
    id: `seg-${clipId}`,
    clipId,
    trackId: 'track-1',
    timelineStart: 0,
    sourceStart: 0,
    sourceEnd: 8,
    transform: { x: 0, y: 0, width: 1920, height: 1080 },
  }
}

describe('buildCompositorJob', () => {
  beforeEach(() => {
    clips.value = [makeClip('a')]
    advancedTracks.value = [{ id: 'track-1', name: 'Track 1' }]
    advancedOutputLock.value = null
  })

  it('builds a job with canvas dims, one source, and one layer', () => {
    const job = buildCompositorJob([makeSegment('a')], 'mp4', 'high', 'original')
    expect(job).not.toBeNull()
    expect(job?.canvas).toEqual({ width: 1920, height: 1080 })
    expect(job?.sources).toHaveLength(1)
    expect(job?.layers).toHaveLength(1)
    expect(job?.layers[0]).toMatchObject({
      sourceIndex: 0,
      sourceStart: 0,
      sourceEnd: 8,
      timelineStart: 0,
      trackId: 'track-1',
      muted: false,
      opacity: 1,
    })
    expect(job?.layers[0].trackId).toBe('track-1')
    expect(job?.tracksOrder).toContain('track-1')
    expect(job?.container).toBe('mp4')
    expect(job?.videoCodec).toBe('avc')
    expect(job?.audioCodec).toBe('aac')
  })

  it('returns null when a referenced clip is missing', () => {
    expect(buildCompositorJob([makeSegment('missing')], 'mp4', 'high', 'original')).toBeNull()
  })

  it('sizes the job canvas to the content bounding box and offsets layer transforms', () => {
    const segment = { ...makeSegment('a'), transform: { x: 100, y: 50, width: 1920, height: 1080 } }
    const job = buildCompositorJob([segment], 'mp4', 'high', 'original')
    expect(job).not.toBeNull()
    // bbox: minX=100 minY=50 -> 1920 x 1080 (already even); content shifts flush.
    expect(job!.canvas).toEqual({ width: 1920, height: 1080 })
    expect(job!.layers[0].transform).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
  })

  it('excludes segments on hidden tracks from layers', () => {
    clips.value = [makeClip('a'), makeClip('b')]
    advancedTracks.value = [
      { id: 'track-1', name: 'T1' },
      { id: 'track-2', name: 'T2', hidden: true },
    ]
    const segOnT1 = { ...makeSegment('a'), trackId: 'track-1' }
    const segOnT2 = { ...makeSegment('b'), id: 'seg-b', trackId: 'track-2' }
    const job = buildCompositorJob([segOnT1, segOnT2], 'mp4', 'high', 'original')
    expect(job).not.toBeNull()
    expect(job?.layers).toHaveLength(1)
    expect(job?.layers[0].trackId).toBe('track-1')
  })
})
