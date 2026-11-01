import type { ReadonlySignal } from '@preact/signals'
import clsx from 'clsx/lite'
import type { HTMLAttributes } from 'preact'

import { formatTimecode } from '@/lib/format'
import { seekKeyAction, type SeekKeyAction } from '@/lib/timelineKeyboard'

// The playhead as an ARIA slider over the timeline's time.
export type PlayheadSlider = {
  label: string
  // Seconds on the whole timeline.
  time: ReadonlySignal<number>
  duration: number
  onSeekKey: (action: SeekKeyAction) => void
}

type TimelinePlayheadProps = {
  // Track x of the playhead in content px.
  x: ReadonlySignal<number>
  slider: PlayheadSlider
  class?: string
} & Omit<HTMLAttributes<HTMLDivElement>, 'class' | 'style'>

// The playhead reads its own position signal, so playback re-renders this one
// line each frame instead of the whole timeline around it.
export function TimelinePlayhead({ x, slider, class: className, ...rest }: TimelinePlayheadProps) {
  const time = Math.min(slider.duration, Math.max(0, slider.time.value))
  return (
    <div
      {...rest}
      role="slider"
      tabIndex={0}
      aria-label={slider.label}
      aria-valuemin={0}
      aria-valuemax={Math.round(slider.duration * 100) / 100}
      aria-valuenow={Math.round(time * 100) / 100}
      aria-valuetext={`${formatTimecode(time)} of ${formatTimecode(slider.duration)}`}
      onKeyDown={(event) => {
        const action = seekKeyAction(event)
        if (!action) return
        event.preventDefault()
        slider.onSeekKey(action)
      }}
      class={clsx(
        'absolute bottom-0 z-30 w-3 -translate-x-1/2 cursor-ew-resize touch-none rounded-sm focus-visible:outline-2 focus-visible:outline-violet-500',
        className
      )}
      style={{ left: `${x.value}px` }}
    >
      <div class="pointer-events-none absolute inset-x-0 top-0 bottom-0 flex justify-center">
        <div class="h-full w-0.5 bg-violet-400" />
      </div>
      <div class="pointer-events-none absolute top-0 left-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1 rounded-full bg-violet-400" />
    </div>
  )
}
