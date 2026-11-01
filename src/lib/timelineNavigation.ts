import { formatRulerLabel } from '@/lib/format'

// Timeline zoom range in px per second, shared by both editors. The floor is
// low enough for an hour-long project to fit a laptop-width view (about 900 px).
export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 200
// One zoom step (buttons, keys, slider arrows, Ctrl+wheel notch).
export const ZOOM_STEP_FACTOR = 1.25
// Blocks never draw narrower than this, so clips stay visible and pickable at
// the lowest zoom levels.
export const MIN_BLOCK_WIDTH_PX = 8
// Below these widths a block's name and duration labels are hidden rather
// than clipped to noise.
export const BLOCK_NAME_MIN_WIDTH_PX = 24
export const BLOCK_DURATION_MIN_WIDTH_PX = 56

export function clampTimelineZoom(pxPerSec: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pxPerSec))
}

// A zoom level for display: decimals only where they matter at low zoom.
export function formatZoom(pxPerSec: number): string {
  if (pxPerSec < 1) return String(Math.round(pxPerSec * 100) / 100)
  if (pxPerSec < 10) return String(Math.round(pxPerSec * 10) / 10)
  return String(Math.round(pxPerSec))
}

export function stepZoom(pxPerSec: number, direction: 1 | -1): number {
  return clampTimelineZoom(pxPerSec * ZOOM_STEP_FACTOR ** direction)
}

// Zoom that shows `duration` seconds across `availablePx`, or null when there
// is nothing to fit.
export function fitZoom(availablePx: number, duration: number): number | null {
  if (!(duration > 0) || !(availablePx > 0)) return null
  return clampTimelineZoom(availablePx / duration)
}

// fitZoom for a layout that draws every block at least `minWidthPx` wide
// (Basic): widened blocks take fixed space whatever the zoom, so their pixels
// and durations come out of the fit. Removing them only lowers the zoom, which
// can widen more blocks, so this repeats until the widened set is stable.
export function fitZoomWithMinWidth(
  availablePx: number,
  durations: number[],
  minWidthPx: number
): number | null {
  const totalDuration = durations.reduce((sum, duration) => sum + duration, 0)
  if (!(totalDuration > 0) || !(availablePx > 0)) return null
  let zoom = availablePx / totalDuration
  for (let pass = 0; pass <= durations.length; pass++) {
    let widenedPx = 0
    let flexibleDuration = 0
    for (const duration of durations) {
      if (duration * zoom < minWidthPx) widenedPx += minWidthPx
      else flexibleDuration += duration
    }
    // Every block is at its minimum width: the largest zoom that keeps them
    // all there gives the same layout with the most room inside them.
    if (flexibleDuration <= 0) return clampTimelineZoom(minWidthPx / Math.max(...durations))
    const nextZoom = (availablePx - widenedPx) / flexibleDuration
    // Even the minimum widths alone overflow the view; zoom out as far as allowed.
    if (nextZoom <= 0) return ZOOM_MIN
    if (Math.abs(nextZoom - zoom) < 1e-9) break
    zoom = nextZoom
  }
  return clampTimelineZoom(zoom)
}

// Slider position (0..1) for a zoom level, on a log scale so each step of the
// slider changes zoom by the same ratio across the whole range.
export function zoomToSliderFraction(pxPerSec: number, min = ZOOM_MIN, max = ZOOM_MAX): number {
  const fraction = Math.log(pxPerSec / min) / Math.log(max / min)
  return Math.min(1, Math.max(0, fraction))
}

export function sliderFractionToZoom(fraction: number, min = ZOOM_MIN, max = ZOOM_MAX): number {
  const clamped = Math.min(1, Math.max(0, fraction))
  return min * (max / min) ** clamped
}

// Where keyboard and button zoom pivot, in viewport px: the playhead while it
// is on screen, otherwise the middle of the view.
export function zoomAnchorX(playheadViewportX: number, viewWidth: number): number {
  return playheadViewportX >= 0 && playheadViewportX <= viewWidth
    ? playheadViewportX
    : viewWidth / 2
}

// During playback the view pages forward once the playhead passes this share
// of the view, landing it at the lead share (Premiere's page-scroll follow).
export const FOLLOW_TRIGGER_SHARE = 0.9
export const FOLLOW_LEAD_SHARE = 0.1
// A manual wheel or scroll pauses follow this long, so it does not fight the user.
export const FOLLOW_SUSPEND_MS = 1500

// The scrollLeft that brings the playhead back into view, or null when it is
// already inside [scrollLeft, scrollLeft + triggerShare * viewWidth].
export function followScrollTarget(
  playheadX: number,
  scrollLeft: number,
  viewWidth: number,
  triggerShare = FOLLOW_TRIGGER_SHARE
): number | null {
  if (!(viewWidth > 0)) return null
  if (playheadX >= scrollLeft && playheadX <= scrollLeft + viewWidth * triggerShare) return null
  const target = Math.max(0, playheadX - viewWidth * FOLLOW_LEAD_SHARE)
  return Math.abs(target - scrollLeft) < 1 ? null : target
}

// Pauses follow after manual scrolling. Scroll events carry no source, so the
// timeline reports every scrollLeft it sets itself (noteScrollSet); any other
// position seen in a scroll event (wheel anywhere on the card, scrollbar
// drag, keyboard) came from the user.
export function createFollowSuspension(now: () => number = () => performance.now()) {
  let resumeAt = -Infinity
  let ownScrollLeft: number | null = null
  function suspend() {
    resumeAt = now() + FOLLOW_SUSPEND_MS
  }
  return {
    suspend,
    isSuspended() {
      return now() < resumeAt
    },
    noteScrollSet(scrollLeft: number) {
      ownScrollLeft = scrollLeft
    },
    onScroll(scrollLeft: number) {
      if (ownScrollLeft !== null && Math.abs(scrollLeft - ownScrollLeft) < 1) return
      ownScrollLeft = null
      suspend()
    },
  }
}

// Fit the timeline once after the first import into an empty timeline. It
// arms only when content arrives during an import (not an undo), keeps fitting
// while that import runs so a multi-file batch ends up fully in view, and
// disarms when the import finishes.
export function createAutoFitTrigger(startsEmpty: boolean) {
  let wasEmpty = startsEmpty
  let armed = false
  return {
    // Returns true when the caller should fit now.
    update(isEmpty: boolean, importing: boolean): boolean {
      if (isEmpty) {
        wasEmpty = true
        armed = false
        return false
      }
      if (wasEmpty) {
        wasEmpty = false
        armed = importing
        return armed
      }
      if (!armed) return false
      if (!importing) armed = false
      return true
    },
  }
}

export type RulerTick = { time: number; major: boolean; label: string | null }

// Candidate label intervals (seconds), each with the minor subdivisions that
// read naturally for it, densest first.
const RULER_STEPS: { step: number; divisions: number[] }[] = [
  { step: 0.1, divisions: [5, 2] },
  { step: 0.2, divisions: [4, 2] },
  { step: 0.5, divisions: [5] },
  { step: 1, divisions: [5, 4, 2] },
  { step: 2, divisions: [4, 2] },
  { step: 5, divisions: [5] },
  { step: 10, divisions: [5, 2] },
  { step: 15, divisions: [3] },
  { step: 30, divisions: [6, 3] },
  { step: 60, divisions: [6, 4, 2] },
  { step: 120, divisions: [4, 2] },
  { step: 300, divisions: [5] },
  { step: 600, divisions: [5, 2] },
  { step: 900, divisions: [3] },
  { step: 1800, divisions: [6, 3] },
  { step: 3600, divisions: [6, 4, 2] },
]
// Room for a label like "10:00.5" plus breathing space.
export const RULER_MIN_MAJOR_PX = 80
export const RULER_MIN_MINOR_PX = 8
// Upper bound on generated ticks, whatever window the caller asks for.
const RULER_MAX_TICKS = 2000

export function rulerSpacing(pxPerSec: number): { majorStep: number; divisions: number } {
  const choice =
    RULER_STEPS.find((entry) => entry.step * pxPerSec >= RULER_MIN_MAJOR_PX) ??
    RULER_STEPS[RULER_STEPS.length - 1]
  const majorPx = choice.step * pxPerSec
  const divisions = choice.divisions.find((count) => majorPx / count >= RULER_MIN_MINOR_PX) ?? 1
  return { majorStep: choice.step, divisions }
}

// Ticks for the visible window [viewStart, viewEnd] seconds. Majors carry a
// label, with tenths once the labels are less than a second apart.
export function rulerTicks(pxPerSec: number, viewStart: number, viewEnd: number): RulerTick[] {
  if (!(pxPerSec > 0) || !(viewEnd >= viewStart)) return []
  const { majorStep, divisions } = rulerSpacing(pxPerSec)
  const minorStep = majorStep / divisions
  // Whole-number indices keep tick times exact (no accumulated float drift).
  const first = Math.max(0, Math.ceil(viewStart / minorStep - 1e-9))
  const last = Math.min(Math.floor(viewEnd / minorStep + 1e-9), first + RULER_MAX_TICKS - 1)
  const showTenths = majorStep < 1
  const ticks: RulerTick[] = []
  for (let index = first; index <= last; index++) {
    const time = Math.round(index * minorStep * 1000) / 1000
    const major = index % divisions === 0
    ticks.push({ time, major, label: major ? formatRulerLabel(time, showTenths) : null })
  }
  return ticks
}
