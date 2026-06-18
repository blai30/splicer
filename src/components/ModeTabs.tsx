import clsx from 'clsx/lite'

import { appMode } from '@/lib/store'

const TABS: { value: 'basic' | 'advanced'; label: string }[] = [
  { value: 'basic', label: 'Basic' },
  { value: 'advanced', label: 'Advanced' },
]

export function ModeTabs() {
  const mode = appMode.value
  return (
    <div
      role="tablist"
      aria-label="Editor mode"
      class="flex w-fit items-center gap-1 rounded-lg border border-slate-200/60 bg-slate-50/40 p-1 backdrop-blur dark:border-slate-700/60 dark:bg-slate-900/40"
    >
      {TABS.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          aria-selected={mode === tab.value}
          onClick={() => {
            appMode.value = tab.value
          }}
          class={clsx(
            'rounded px-3 py-1 text-sm font-semibold transition-colors hover:duration-0',
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
