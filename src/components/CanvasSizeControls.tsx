import clsx from 'clsx/lite'
import { Info } from 'lucide-preact'

import {
  CANVAS_MAX,
  CANVAS_MIN,
  clearOutputLock,
  setOutputLock,
} from '@/lib/advanced/advancedEditing'
import { advancedOutputLock } from '@/lib/store'

const PRESETS: { label: string; width: number; height: number }[] = [
  { label: '1080p', width: 1920, height: 1080 },
  { label: '720p', width: 1280, height: 720 },
  { label: 'Vertical', width: 1080, height: 1920 },
  { label: 'Square', width: 1080, height: 1080 },
]

export function CanvasSizeControls() {
  const lock = advancedOutputLock.value
  const auto = lock === null
  const widthValue = lock?.width ?? ''
  const heightValue = lock?.height ?? ''

  function onManual(axis: 'width' | 'height', raw: string) {
    const value = Number(raw)
    if (!Number.isFinite(value) || value <= 0) return
    const base = lock ?? { width: 1920, height: 1080 }
    const next = { ...base, [axis]: value }
    setOutputLock(next.width, next.height)
  }

  return (
    <div class="flex flex-wrap items-center gap-2">
      <span class="w-14 text-sm text-slate-500 dark:text-slate-400">Output</span>
      <button
        onClick={clearOutputLock}
        title="Export the bounding box of placed clips"
        class={clsx(
          'rounded px-2.5 py-1 text-sm font-medium transition-colors hover:duration-0',
          auto
            ? 'bg-violet-500 text-white'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100'
        )}
      >
        Auto
      </button>
      {PRESETS.map((preset) => {
        const active = !auto && lock.width === preset.width && lock.height === preset.height
        return (
          <button
            key={preset.label}
            onClick={() => setOutputLock(preset.width, preset.height)}
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
          value={widthValue}
          disabled={auto}
          aria-label="Output width"
          placeholder="auto"
          onBlur={(event) => onManual('width', (event.currentTarget as HTMLInputElement).value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter')
              onManual('width', (event.currentTarget as HTMLInputElement).value)
          }}
          class={clsx(
            'w-20 rounded border border-slate-300 px-2 py-1 outline-none focus:border-violet-400 dark:border-slate-600',
            auto
              ? 'cursor-not-allowed bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-400'
              : 'bg-white dark:bg-slate-800'
          )}
        />
        <span class="text-slate-400">x</span>
        <input
          type="number"
          min={CANVAS_MIN}
          max={CANVAS_MAX}
          value={heightValue}
          disabled={auto}
          aria-label="Output height"
          placeholder="auto"
          onBlur={(event) => onManual('height', (event.currentTarget as HTMLInputElement).value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter')
              onManual('height', (event.currentTarget as HTMLInputElement).value)
          }}
          class={clsx(
            'w-20 rounded border border-slate-300 px-2 py-1 outline-none focus:border-violet-400 dark:border-slate-600',
            auto
              ? 'cursor-not-allowed bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-400'
              : 'bg-white dark:bg-slate-800'
          )}
        />
      </div>
      <span
        class="inline-flex text-slate-400 dark:text-slate-500"
        title="Auto exports the bounding box of placed clips. A locked size contain-fits and letterboxes the content. Dimensions are rounded to even numbers."
        aria-label="Auto exports the bounding box of placed clips. A locked size contain-fits and letterboxes the content. Dimensions are rounded to even numbers."
      >
        <Info class="h-3.5 w-3.5" />
      </span>
    </div>
  )
}
