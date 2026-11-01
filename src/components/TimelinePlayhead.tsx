import type { ReadonlySignal } from '@preact/signals'
import clsx from 'clsx/lite'
import type { HTMLAttributes } from 'preact'

type TimelinePlayheadProps = {
  // Track x of the playhead in content px.
  x: ReadonlySignal<number>
  class?: string
} & Omit<HTMLAttributes<HTMLDivElement>, 'class' | 'style'>

// The playhead reads its own position signal, so playback re-renders this one
// line each frame instead of the whole timeline around it.
export function TimelinePlayhead({ x, class: className, ...rest }: TimelinePlayheadProps) {
  return (
    <div
      {...rest}
      class={clsx(
        'absolute bottom-0 z-30 w-3 -translate-x-1/2 cursor-ew-resize touch-none',
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
