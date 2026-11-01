import clsx from 'clsx/lite'

import {
  formatZoom,
  sliderFractionToZoom,
  stepZoom,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomToSliderFraction,
} from '@/lib/timelineNavigation'

const TICKS = [0, 0.25, 0.5, 0.75, 1]

// Timeline zoom slider on a log scale, so every part of the track changes the
// zoom by the same ratio.
export function ZoomSlider({
  value,
  onChange,
  class: className,
}: {
  value: number
  onChange: (value: number) => void
  class?: string
}) {
  const fraction = zoomToSliderFraction(value)

  function seekFromPointer(pointerEvent: PointerEvent, element: HTMLElement) {
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0) return
    onChange(sliderFractionToZoom((pointerEvent.clientX - rect.left) / rect.width))
  }

  function onPointerDown(event: PointerEvent) {
    event.stopPropagation()
    const element = event.currentTarget as HTMLElement
    element.setPointerCapture(event.pointerId)
    seekFromPointer(event, element)
    function onMove(moveEvent: PointerEvent) {
      seekFromPointer(moveEvent, element)
    }
    function onUp() {
      element.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerup', onUp)
      element.removeEventListener('pointercancel', onUp)
    }
    element.addEventListener('pointermove', onMove)
    element.addEventListener('pointerup', onUp)
    element.addEventListener('pointercancel', onUp)
  }

  function onKeyDown(event: KeyboardEvent) {
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? stepZoom(value, 1)
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? stepZoom(value, -1)
          : event.key === 'Home'
            ? ZOOM_MIN
            : event.key === 'End'
              ? ZOOM_MAX
              : null
    if (next === null) return
    event.preventDefault()
    onChange(next)
  }

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Timeline zoom"
      aria-valuemin={ZOOM_MIN}
      aria-valuemax={ZOOM_MAX}
      aria-valuenow={Number(formatZoom(value))}
      aria-valuetext={`${formatZoom(value)} pixels per second`}
      class={clsx(
        'relative h-5 touch-none rounded-sm outline-none select-none focus-visible:ring-2 focus-visible:ring-violet-400',
        className ?? 'w-28'
      )}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <div class="absolute top-1/2 right-0 left-0 h-px -translate-y-1/2 bg-slate-200 dark:bg-slate-700" />
      <div
        class="absolute top-1/2 left-0 h-px -translate-y-1/2 bg-violet-600 dark:bg-violet-400"
        style={{ width: `${fraction * 100}%` }}
      />
      {TICKS.map((tick) => (
        <div
          key={tick}
          class={clsx(
            'absolute top-1/2 w-px -translate-x-1/2 -translate-y-1/2 bg-slate-300 dark:bg-slate-600',
            tick === 0 || tick === 1 ? 'h-2' : 'h-1.5'
          )}
          style={{ left: `${tick * 100}%` }}
        />
      ))}
      <div
        class="absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 bg-violet-600 dark:bg-violet-400"
        style={{ left: `${fraction * 100}%` }}
      />
    </div>
  )
}
