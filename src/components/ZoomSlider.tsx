import clsx from 'clsx/lite'

interface ZoomSliderProps {
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  class?: string
}

const TICKS = [0, 0.25, 0.5, 0.75, 1]

export function ZoomSlider({ value, min, max, onChange, class: className }: ZoomSliderProps) {
  const pct = (value - min) / (max - min)

  function seekFromPointer(ev: PointerEvent, el: HTMLElement) {
    const rect = el.getBoundingClientRect()
    const p = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
    onChange(min + p * (max - min))
  }

  function onPointerDown(e: PointerEvent) {
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    seekFromPointer(e, el)
    function onMove(mv: PointerEvent) {
      seekFromPointer(mv, el)
    }
    function onUp() {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }

  return (
    <div
      class={clsx('relative h-5 select-none', className ?? 'w-28')}
      onPointerDown={onPointerDown}
    >
      <div class="absolute top-1/2 right-0 left-0 h-px -translate-y-1/2 bg-slate-200 dark:bg-slate-700" />
      <div
        class="absolute top-1/2 left-0 h-px -translate-y-1/2 bg-violet-600 dark:bg-violet-400"
        style={{ width: `${pct * 100}%` }}
      />
      {TICKS.map((t) => (
        <div
          key={t}
          class="absolute top-1/2 w-px -translate-x-1/2 -translate-y-1/2 bg-slate-300 dark:bg-slate-600"
          style={{
            left: `${t * 100}%`,
            height: t === 0 || t === 1 ? '8px' : '5px',
          }}
        />
      ))}
      <div
        class="absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 bg-violet-600 dark:bg-violet-400"
        style={{ left: `${pct * 100}%` }}
      />
    </div>
  )
}
