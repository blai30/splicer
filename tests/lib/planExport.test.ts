import { beforeEach, describe, expect, it } from 'vitest'

import { planExport } from '@/lib/ffmpeg'
import { clips } from '@/lib/store'
import type { Clip, Segment } from '@/lib/types'

function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'clip-1',
    file: new File([new Uint8Array([0])], 'sample.mp4', { type: 'video/mp4' }),
    name: 'sample',
    duration: 10,
    width: 1280,
    height: 720,
    objectUrl: 'blob:test',
    waveformPeaks: [],
    hasAudio: true,
    ...overrides,
  }
}

function segment(overrides: Partial<Segment> = {}): Segment {
  return { id: 'seg-1', clipId: 'clip-1', startTime: 0, endTime: 5, ...overrides }
}

beforeEach(() => {
  clips.value = [makeClip()]
})

describe('planExport webm encode args', () => {
  it('emits vp9 with row-mt and threads under multithread', () => {
    const plan = planExport([segment()], 'webm', 'high', 'original', 'run1', {
      threads: 4,
      webmCodec: 'vp9',
    })
    const cmd = plan.commands.at(-1)!.join(' ')
    expect(cmd).toContain('-c:v libvpx-vp9')
    expect(cmd).toContain('-row-mt 1')
    expect(cmd).toContain('-threads 4')
    expect(cmd).toContain('-cpu-used')
    expect(cmd).not.toContain('-deadline best')
  })

  it('omits thread args under single-thread', () => {
    const plan = planExport([segment()], 'webm', 'high', 'original', 'run1', {
      threads: null,
      webmCodec: 'vp9',
    })
    const cmd = plan.commands.at(-1)!.join(' ')
    expect(cmd).not.toContain('-row-mt')
    expect(cmd).not.toContain('-threads')
  })

  it('uses libvpx (vp8) when webmCodec is vp8', () => {
    const plan = planExport([segment()], 'webm', 'high', 'original', 'run1', {
      threads: 4,
      webmCodec: 'vp8',
    })
    const cmd = plan.commands.at(-1)!.join(' ')
    expect(cmd).toContain('-c:v libvpx ')
    expect(cmd).toContain('-c:a libopus')
  })

  it('injects a scale filter when maxDimension is set', () => {
    const plan = planExport([segment()], 'webm', 'high', 'original', 'run1', {
      threads: null,
      webmCodec: 'vp8',
      maxDimension: 1280,
    })
    const cmd = plan.commands.at(-1)!.join(' ')
    expect(cmd).toContain('scale=w=1280:h=1280:force_original_aspect_ratio=decrease')
  })

  it('omits the scale filter when maxDimension is null', () => {
    const plan = planExport([segment()], 'webm', 'high', 'original', 'run1', {
      threads: null,
      webmCodec: 'vp8',
      maxDimension: null,
    })
    const cmd = plan.commands.at(-1)!.join(' ')
    expect(cmd).not.toContain('scale=')
  })
})

describe('planExport webm stream copy', () => {
  it('stream-copies webm to webm when lossless and unmuted', () => {
    clips.value = [
      makeClip({
        file: new File([new Uint8Array([0])], 'sample.webm', { type: 'video/webm' }),
      }),
    ]
    const plan = planExport([segment()], 'webm', 'lossless', 'original', 'run1', {
      threads: 4,
      webmCodec: 'vp9',
    })
    const cmd = plan.commands[0].join(' ')
    expect(cmd).toContain('-c copy')
    expect(plan.commands.length).toBe(1)
  })

  it('uses libopus for muted webm stream copy', () => {
    clips.value = [
      makeClip({
        file: new File([new Uint8Array([0])], 'sample.webm', { type: 'video/webm' }),
      }),
    ]
    const plan = planExport([segment({ muted: true })], 'webm', 'lossless', 'original', 'run1', {
      threads: 4,
      webmCodec: 'vp9',
    })
    const lastCmd = plan.commands.at(-1)!.join(' ')
    expect(lastCmd).toContain('-c:a libopus')
    expect(lastCmd).toContain('volume=0')
  })
})

describe('planFullEncode no-audio handling', () => {
  it('omits the audio track entirely when no clip has audio', () => {
    clips.value = [makeClip({ hasAudio: false })]
    // medium quality forces a full re-encode (no stream copy path).
    const plan = planExport([segment()], 'mp4', 'medium', 'original', 'run1', {
      threads: null,
      webmCodec: 'vp8',
    })
    const cmd = plan.commands.at(-1)!.join(' ')
    expect(cmd).not.toContain('anullsrc')
    expect(cmd).not.toContain('[outa]')
    // A single segment skips the concat filter; the video output maps directly.
    expect(cmd).toContain('[outv]')
    expect(cmd).not.toContain('concat=')
    // Exactly one -map, for video only.
    expect(cmd.match(/-map/g)?.length).toBe(1)
  })

  it('keeps silence-fill when some clips have audio and others do not', () => {
    clips.value = [
      makeClip({ id: 'clip-1', hasAudio: true }),
      makeClip({ id: 'clip-2', hasAudio: false }),
    ]
    const plan = planExport(
      [segment({ id: 'seg-1', clipId: 'clip-1' }), segment({ id: 'seg-2', clipId: 'clip-2' })],
      'mp4',
      'medium',
      'original',
      'run1',
      { threads: null, webmCodec: 'vp8' }
    )
    const cmd = plan.commands.at(-1)!.join(' ')
    expect(cmd).toContain('anullsrc')
    expect(cmd).toContain('[outa]')
    expect(cmd).toContain('concat=n=2:v=1:a=1')
  })
})
