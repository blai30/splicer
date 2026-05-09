import { Film } from 'lucide-preact'

import { ThemeSwitcher } from '@/components/ThemeSwitcher'

export function AppHeader() {
  return (
    <header class="flex min-h-14 shrink-0 items-center justify-between rounded-xl border border-slate-200/80 bg-white/90 px-4 py-2 shadow-sm shadow-slate-900/5 backdrop-blur dark:border-slate-700/70 dark:bg-slate-900/80 dark:shadow-black/30">
      <div class="flex items-center gap-3">
        <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/15 dark:bg-violet-400/15">
          <Film class="h-5 w-5 text-violet-600 dark:text-violet-300" />
        </div>
        <div class="flex flex-col">
          <span class="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Splicer
          </span>
          <span class="text-sm text-slate-500 dark:text-slate-400">
            Fast timeline cuts, entirely client-sided in the browser
          </span>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <a
          href="https://github.com/blai30/splicer"
          target="_self"
          rel="noopener noreferrer"
          class="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          aria-label="Open Splicer on GitHub"
          title="View repository on GitHub"
        >
          <svg class="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
            <path d="M12 .297a12 12 0 0 0-3.794 23.385c.6.111.82-.26.82-.577v-2.234c-3.338.725-4.043-1.61-4.043-1.61a3.183 3.183 0 0 0-1.335-1.756c-1.09-.744.084-.729.084-.729a2.52 2.52 0 0 1 1.84 1.24 2.558 2.558 0 0 0 3.495.997 2.56 2.56 0 0 1 .763-1.607c-2.665-.305-5.466-1.334-5.466-5.931a4.64 4.64 0 0 1 1.236-3.222 4.302 4.302 0 0 1 .117-3.176s1.008-.322 3.301 1.23a11.435 11.435 0 0 1 6.004 0c2.292-1.552 3.297-1.23 3.297-1.23a4.295 4.295 0 0 1 .12 3.176 4.632 4.632 0 0 1 1.234 3.222c0 4.609-2.805 5.624-5.476 5.921a2.875 2.875 0 0 1 .816 2.23v3.303c0 .319.216.694.825.576A12 12 0 0 0 12 .297" />
          </svg>
        </a>
        <ThemeSwitcher class="h-9 w-9 rounded-md text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800" />
      </div>
    </header>
  )
}
