import { describe, expect, it } from 'vitest'

import { formatRulerLabel } from '@/lib/format'
import {
  clampTimelineZoom,
  createAutoFitTrigger,
  createFollowSuspension,
  FOLLOW_SUSPEND_MS,
  fitZoom,
  followScrollTarget,
  rulerSpacing,
  rulerTicks,
  sliderFractionToZoom,
  stepZoom,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomAnchorX,
  zoomToSliderFraction,
} from '@/lib/timelineNavigation'

describe('zoom steps', () => {
  it('multiplies and divides by a constant ratio', () => {
    expect(stepZoom(80, 1)).toBe(100)
    expect(stepZoom(100, -1)).toBe(80)
    expect(stepZoom(4, 1)).toBe(5)
  })

  it('stays within the zoom range', () => {
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX)
    expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN)
    expect(clampTimelineZoom(0)).toBe(ZOOM_MIN)
    expect(clampTimelineZoom(1e6)).toBe(ZOOM_MAX)
  })

  it('anchors on the playhead while it is on screen, else the middle', () => {
    expect(zoomAnchorX(120, 800)).toBe(120)
    expect(zoomAnchorX(0, 800)).toBe(0)
    expect(zoomAnchorX(-5, 800)).toBe(400)
    expect(zoomAnchorX(900, 800)).toBe(400)
  })
})

describe('fitZoom', () => {
  it('spreads the duration across the available width', () => {
    expect(fitZoom(1000, 10)).toBe(100)
    expect(fitZoom(1000, 100)).toBe(10)
  })

  it('reaches the floor for long projects and the ceiling for short ones', () => {
    // An hour on a 1200 px view needs 1/3 px/s; the floor keeps it legible.
    expect(fitZoom(1200, 3600)).toBe(ZOOM_MIN)
    expect(fitZoom(1000, 0.5)).toBe(ZOOM_MAX)
  })

  it('has nothing to fit for an empty timeline or a zero-width view', () => {
    expect(fitZoom(1000, 0)).toBeNull()
    expect(fitZoom(0, 10)).toBeNull()
  })
})

describe('zoom slider scale', () => {
  it('is logarithmic: equal slider steps are equal zoom ratios', () => {
    expect(zoomToSliderFraction(ZOOM_MIN)).toBe(0)
    expect(zoomToSliderFraction(ZOOM_MAX)).toBe(1)
    const middle = sliderFractionToZoom(0.5)
    expect(middle).toBeCloseTo(Math.sqrt(ZOOM_MIN * ZOOM_MAX))
    expect(sliderFractionToZoom(0.25) / ZOOM_MIN).toBeCloseTo(middle / sliderFractionToZoom(0.25))
  })

  it('round-trips and clamps', () => {
    expect(sliderFractionToZoom(zoomToSliderFraction(80))).toBeCloseTo(80)
    expect(sliderFractionToZoom(-1)).toBe(ZOOM_MIN)
    expect(sliderFractionToZoom(2)).toBeCloseTo(ZOOM_MAX)
    expect(zoomToSliderFraction(ZOOM_MAX * 2)).toBe(1)
  })
})

describe('followScrollTarget', () => {
  it('leaves a playhead inside the trigger window alone', () => {
    expect(followScrollTarget(500, 0, 1000)).toBeNull()
    expect(followScrollTarget(900, 0, 1000)).toBeNull()
    expect(followScrollTarget(1500, 1000, 1000)).toBeNull()
  })

  it('pages forward so the playhead lands near the left edge', () => {
    expect(followScrollTarget(901, 0, 1000)).toBe(801)
    expect(followScrollTarget(2400, 1000, 1000)).toBe(2300)
  })

  it('pages back when the playhead is left of the view', () => {
    expect(followScrollTarget(50, 3000, 1000)).toBe(0)
    expect(followScrollTarget(2500, 3000, 1000)).toBe(2400)
  })

  it('with a full trigger window, scrolls only for a hidden playhead', () => {
    expect(followScrollTarget(950, 0, 1000, 1)).toBeNull()
    expect(followScrollTarget(1001, 0, 1000, 1)).toBe(901)
  })

  it('ignores a view that has no width yet', () => {
    expect(followScrollTarget(5000, 0, 0)).toBeNull()
  })
})

describe('createFollowSuspension', () => {
  it('suspends follow for a while after manual scrolling', () => {
    let now = 1000
    const suspension = createFollowSuspension(() => now)
    expect(suspension.isSuspended()).toBe(false)
    suspension.suspend()
    now += FOLLOW_SUSPEND_MS - 1
    expect(suspension.isSuspended()).toBe(true)
    now += 1
    expect(suspension.isSuspended()).toBe(false)
  })
})

describe('createAutoFitTrigger', () => {
  it('fits while the first import into an empty timeline runs, then stops', () => {
    const trigger = createAutoFitTrigger(true)
    expect(trigger.update(true, true)).toBe(false)
    // First clip lands, then a second one from the same batch.
    expect(trigger.update(false, true)).toBe(true)
    expect(trigger.update(false, true)).toBe(true)
    // The batch finishes: one last fit, then the user's zoom is left alone.
    expect(trigger.update(false, false)).toBe(true)
    expect(trigger.update(false, false)).toBe(false)
    expect(trigger.update(false, true)).toBe(false)
  })

  it('does not fit content restored by undo', () => {
    const trigger = createAutoFitTrigger(true)
    expect(trigger.update(false, false)).toBe(false)
    expect(trigger.update(false, false)).toBe(false)
  })

  it('does not fit a timeline that already had content when it mounted', () => {
    const trigger = createAutoFitTrigger(false)
    expect(trigger.update(false, true)).toBe(false)
  })

  it('re-arms once the timeline is emptied', () => {
    const trigger = createAutoFitTrigger(false)
    trigger.update(true, false)
    expect(trigger.update(false, true)).toBe(true)
  })
})

describe('rulerTicks', () => {
  it('picks the smallest step with readable label spacing', () => {
    expect(rulerSpacing(80).majorStep).toBe(1)
    expect(rulerSpacing(200).majorStep).toBe(0.5)
    expect(rulerSpacing(30).majorStep).toBe(5)
    expect(rulerSpacing(1).majorStep).toBe(120)
    // Past the largest step it stays at the largest.
    expect(rulerSpacing(0.001).majorStep).toBe(3600)
  })

  it('subdivides majors with minors that stay at least 8 px apart', () => {
    for (const zoom of [1, 3, 7, 13, 40, 80, 120, 200]) {
      const { majorStep, divisions } = rulerSpacing(zoom)
      expect(majorStep * zoom).toBeGreaterThanOrEqual(80)
      if (divisions > 1) expect((majorStep / divisions) * zoom).toBeGreaterThanOrEqual(8)
    }
  })

  it('labels majors in m:ss and leaves minors unlabeled', () => {
    const ticks = rulerTicks(80, 0, 2)
    expect(ticks.filter((tick) => tick.major).map((tick) => tick.label)).toEqual([
      '0:00',
      '0:01',
      '0:02',
    ])
    expect(ticks.filter((tick) => !tick.major).every((tick) => tick.label === null)).toBe(true)
    // 1 s majors at 80 px/s split into fifths (16 px apart).
    expect(ticks.map((tick) => tick.time).slice(0, 6)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
  })

  it('shows tenths once labels are under a second apart', () => {
    const labels = rulerTicks(200, 0, 1.5)
      .filter((tick) => tick.major)
      .map((tick) => tick.label)
    expect(labels).toEqual(['0:00.0', '0:00.5', '0:01.0', '0:01.5'])
  })

  it('only covers the visible window', () => {
    const ticks = rulerTicks(80, 10.1, 11.9)
    expect(ticks[0].time).toBeCloseTo(10.2)
    expect(ticks.at(-1)!.time).toBeCloseTo(11.8)
    expect(ticks.find((tick) => tick.major)?.label).toBe('0:11')
  })

  it('keeps tick times exact far along the timeline', () => {
    const ticks = rulerTicks(200, 3599.5, 3600)
    expect(ticks.at(-1)).toEqual({ time: 3600, major: true, label: '1:00:00.0' })
  })

  it('returns nothing for an empty or inverted window', () => {
    expect(rulerTicks(80, 5, 4)).toEqual([])
    expect(rulerTicks(0, 0, 10)).toEqual([])
  })

  it('never starts before zero', () => {
    expect(rulerTicks(80, -3, 0.5)[0].time).toBe(0)
  })
})

describe('formatRulerLabel', () => {
  it('formats minutes, hours, and rounded tenths', () => {
    expect(formatRulerLabel(65, false)).toBe('1:05')
    expect(formatRulerLabel(65.5, true)).toBe('1:05.5')
    expect(formatRulerLabel(0.3, true)).toBe('0:00.3')
    expect(formatRulerLabel(3725, false)).toBe('1:02:05')
  })
})
