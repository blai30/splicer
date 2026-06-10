import clsx from 'clsx/lite'

const TICKS = [0, 0.25, 0.5, 0.75, 1]

export function ZoomSlider({
  value,
  min,
  max,
  onChange,
  class: className,
}: {
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  class?: string
}) {
  const fraction = (value - min) / (max - min)

  function seekFromPointer(pointerEvent: PointerEvent, element: HTMLElement) {
    const rect = element.getBoundingClientRect()
    const pointerFraction = Math.max(
      0,
      Math.min(1, (pointerEvent.clientX - rect.left) / rect.width)
    )
    onChange(min + pointerFraction * (max - min))
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
    }
    element.addEventListener('pointermove', onMove)
    element.addEventListener('pointerup', onUp)
  }

  return (
    <div
      class={clsx('relative h-5 select-none', className ?? 'w-28')}
      onPointerDown={onPointerDown}
    >
      <div class="absolute top-1/2 right-0 left-0 h-px -translate-y-1/2 bg-slate-200 dark:bg-slate-700" />
      <div
        class="absolute top-1/2 left-0 h-px -translate-y-1/2 bg-violet-600 dark:bg-violet-400"
        style={{ width: `${fraction * 100}%` }}
      />
      {TICKS.map((tick) => (
        <div
          key={tick}
          class="absolute top-1/2 w-px -translate-x-1/2 -translate-y-1/2 bg-slate-300 dark:bg-slate-600"
          style={{
            left: `${tick * 100}%`,
            height: tick === 0 || tick === 1 ? '8px' : '5px',
          }}
        />
      ))}
      <div
        class="absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 bg-violet-600 dark:bg-violet-400"
        style={{ left: `${fraction * 100}%` }}
      />
    </div>
  )
}
