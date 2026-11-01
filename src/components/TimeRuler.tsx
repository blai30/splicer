import type { ReadonlySignal } from '@preact/signals'
import clsx from 'clsx/lite'

import type { ScrollWindow } from '@/components/useTimelineNavigation'
import { rulerTicks } from '@/lib/timelineNavigation'

// Ticks are generated a little past each side of the view so labels slide in
// rather than pop in while scrolling.
const OVERSCAN_PX = 120
// Room a label needs to the right of its tick; one that would be cut off at
// the ruler's end is left out.
const LABEL_ROOM_PX = 40

// Time scale above the lanes. It only draws: pressing it is handled by the
// timeline (which seeks), found through the data-time-ruler attribute. It reads
// the scroll window itself, so scrolling re-renders only the ruler.
export function TimeRuler({
  pxPerSec,
  width: rulerWidth,
  endTime,
  timeToX,
  xToTime,
  scrollWindow,
  markerXs = [],
  class: className,
}: {
  pxPerSec: number
  // Ruler width in content px.
  width: number
  // Ticks stop at this time (seconds).
  endTime: number
  // Content px of a time, and the time under a content px, at the current zoom.
  timeToX: (time: number) => number
  xToTime: (x: number) => number
  scrollWindow: ReadonlySignal<ScrollWindow>
  // Content px of cut points to mark.
  markerXs?: number[]
  class?: string
}) {
  const { left, width } = scrollWindow.value
  const viewStart = Math.max(0, xToTime(left - OVERSCAN_PX))
  const viewEnd = Math.min(endTime, xToTime(left + width + OVERSCAN_PX))
  const ticks = rulerTicks(pxPerSec, viewStart, viewEnd)

  return (
    <div
      data-time-ruler
      aria-hidden="true"
      title="Click or drag to move the playhead"
      class={clsx(
        'cursor-pointer touch-none overflow-hidden border-b border-slate-200/60 select-none dark:border-slate-700/60',
        className
      )}
      style={{ width: `${rulerWidth}px` }}
    >
      {ticks.map((tick) => {
        const x = timeToX(tick.time)
        return (
          <div
            key={tick.time}
            class="pointer-events-none absolute bottom-0"
            style={{ left: `${x}px` }}
          >
            <div
              class={clsx(
                'absolute bottom-0 w-px',
                tick.major
                  ? 'h-2.5 bg-slate-400 dark:bg-slate-500'
                  : 'h-1.5 bg-slate-300 dark:bg-slate-600'
              )}
            />
            {tick.label !== null && x + LABEL_ROOM_PX <= rulerWidth && (
              <span class="absolute bottom-2 left-1 text-xs leading-none whitespace-nowrap text-slate-500 tabular-nums dark:text-slate-400">
                {tick.label}
              </span>
            )}
          </div>
        )
      })}
      {markerXs.map((markerX) => (
        <div
          key={markerX}
          data-cut-marker
          class="pointer-events-none absolute bottom-0 h-2 w-1 -translate-x-1/2 rounded-t-sm bg-violet-400/80"
          style={{ left: `${markerX}px` }}
        />
      ))}
    </div>
  )
}
