import clsx from 'clsx/lite'
import { Info } from 'lucide-preact'

import { CANVAS_MAX, CANVAS_MIN, setCanvasSize } from '@/lib/advanced/advancedEditing'
import { advancedCanvas } from '@/lib/store'

const PRESETS: { label: string; width: number; height: number }[] = [
  { label: '1080p', width: 1920, height: 1080 },
  { label: '720p', width: 1280, height: 720 },
  { label: 'Vertical', width: 1080, height: 1920 },
  { label: 'Square', width: 1080, height: 1080 },
]

export function CanvasSizeControls() {
  const canvas = advancedCanvas.value

  function onManual(axis: 'width' | 'height', raw: string) {
    const value = Number(raw)
    if (!Number.isFinite(value) || value <= 0) return
    const next = { ...canvas, [axis]: value }
    setCanvasSize(next.width, next.height)
  }

  return (
    <div class="flex flex-wrap items-center gap-2">
      <span class="w-14 text-sm text-slate-500 dark:text-slate-400">Canvas</span>
      {PRESETS.map((preset) => {
        const active = canvas.width === preset.width && canvas.height === preset.height
        return (
          <button
            key={preset.label}
            onClick={() => setCanvasSize(preset.width, preset.height)}
            class={clsx(
              'rounded px-2.5 py-1 text-sm font-medium transition-colors hover:duration-0',
              active
                ? 'bg-violet-500 text-white'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100'
            )}
          >
            {preset.label}
          </button>
        )
      })}
      <div class="flex items-center gap-1 text-sm text-slate-600 dark:text-slate-300">
        <input
          type="number"
          min={CANVAS_MIN}
          max={CANVAS_MAX}
          value={canvas.width}
          aria-label="Canvas width"
          onBlur={(event) => onManual('width', (event.currentTarget as HTMLInputElement).value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter')
              onManual('width', (event.currentTarget as HTMLInputElement).value)
          }}
          class="w-20 rounded border border-slate-300 bg-white px-2 py-1 outline-none focus:border-violet-400 dark:border-slate-600 dark:bg-slate-800"
        />
        <span class="text-slate-400">x</span>
        <input
          type="number"
          min={CANVAS_MIN}
          max={CANVAS_MAX}
          value={canvas.height}
          aria-label="Canvas height"
          onBlur={(event) => onManual('height', (event.currentTarget as HTMLInputElement).value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter')
              onManual('height', (event.currentTarget as HTMLInputElement).value)
          }}
          class="w-20 rounded border border-slate-300 bg-white px-2 py-1 outline-none focus:border-violet-400 dark:border-slate-600 dark:bg-slate-800"
        />
      </div>
      <span
        class="inline-flex text-slate-400 dark:text-slate-500"
        title="Dimensions are rounded to even numbers (required for video export)"
        aria-label="Dimensions are rounded to even numbers (required for video export)"
      >
        <Info class="h-3.5 w-3.5" />
      </span>
    </div>
  )
}
