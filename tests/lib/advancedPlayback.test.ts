import { describe, expect, it } from 'vitest'

import { segmentPreviewVolume, shouldSeekToFrame } from '@/lib/advanced/advancedPlayback'

describe('shouldSeekToFrame', () => {
  it('seeks while playing only when drift exceeds the threshold', () => {
    expect(
      shouldSeekToFrame({ currentTime: 1.0, expected: 1.05, playing: true, lastTarget: 1.0 })
    ).toBe(false)
    expect(
      shouldSeekToFrame({ currentTime: 1.0, expected: 1.4, playing: true, lastTarget: 1.0 })
    ).toBe(true)
  })

  it('seeks while paused on the first sync (no prior target)', () => {
    expect(
      shouldSeekToFrame({ currentTime: 0, expected: 2.0, playing: false, lastTarget: undefined })
    ).toBe(true)
  })

  it('does not re-seek a paused video to the same requested frame (drag case)', () => {
    // currentTime has snapped to the nearest decodable frame and differs from the
    // request, but the requested target is unchanged, so no seek should happen.
    expect(
      shouldSeekToFrame({ currentTime: 1.983, expected: 2.0, playing: false, lastTarget: 2.0 })
    ).toBe(false)
  })

  it('seeks while paused when the requested frame changes (scrub case)', () => {
    expect(
      shouldSeekToFrame({ currentTime: 2.0, expected: 3.5, playing: false, lastTarget: 2.0 })
    ).toBe(true)
  })
})

describe('segmentPreviewVolume', () => {
  it('scales the master preview volume by the clip volume', () => {
    expect(segmentPreviewVolume(0.5, 0.5)).toBe(0.25)
    expect(segmentPreviewVolume(0.8, 0)).toBe(0)
  })

  it('uses the master volume when the clip has none set', () => {
    expect(segmentPreviewVolume(0.6)).toBe(0.6)
  })

  it('clamps to the media element range', () => {
    expect(segmentPreviewVolume(0.8, 2)).toBe(1)
    expect(segmentPreviewVolume(0.5, -1)).toBe(0)
    expect(segmentPreviewVolume(0.5, Number.NaN)).toBe(0)
  })
})
