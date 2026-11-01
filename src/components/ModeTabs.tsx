import clsx from 'clsx/lite'

import { appMode } from '@/lib/store'

type Mode = 'basic' | 'advanced'

const TABS: { value: Mode; label: string; hint: string }[] = [
  { value: 'basic', label: 'Basic', hint: 'Single-track trimming and joining' },
  { value: 'advanced', label: 'Advanced', hint: 'Multi-track compositing on a canvas' },
]

export function ModeTabs() {
  const mode = appMode.value

  // Arrow keys move between tabs (WAI-ARIA tabs pattern, automatic activation).
  function onKeyDown(event: KeyboardEvent) {
    const index = TABS.findIndex((tab) => tab.value === mode)
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = TABS.length - 1
    else return
    event.preventDefault()
    event.stopPropagation()
    appMode.value = TABS[next].value
    const container = event.currentTarget as HTMLElement
    container.querySelector<HTMLButtonElement>(`[data-mode="${TABS[next].value}"]`)?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label="Editor mode"
      onKeyDown={onKeyDown}
      class="flex w-fit items-center gap-1 rounded-lg border border-slate-200/60 bg-slate-50/40 p-1 backdrop-blur dark:border-slate-700/60 dark:bg-slate-900/40"
    >
      {TABS.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          data-mode={tab.value}
          aria-selected={mode === tab.value}
          tabIndex={mode === tab.value ? 0 : -1}
          title={tab.hint}
          onClick={() => {
            appMode.value = tab.value
          }}
          class={clsx(
            'rounded px-3 py-1 text-sm font-semibold transition-colors hover:duration-0 focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:outline-none',
            mode === tab.value
              ? 'bg-violet-500 text-white'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
