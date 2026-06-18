import { describe, expect, it } from 'vitest'

import { shouldSeekToFrame } from '@/lib/advanced/advancedPlayback'

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
