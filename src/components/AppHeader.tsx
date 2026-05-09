import { Film, Moon, Sun } from 'lucide-preact'

import { theme } from '@/lib/store'

export function AppHeader() {
  function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark')
    theme.value = isDark ? 'dark' : 'light'
    localStorage.setItem('theme', isDark ? 'dark' : 'light')
  }

  return (
    <header class="flex min-h-14 shrink-0 items-center justify-between rounded-xl border border-slate-200/80 bg-white/90 px-4 py-2 shadow-sm shadow-slate-900/5 backdrop-blur dark:border-slate-700/70 dark:bg-slate-900/80 dark:shadow-black/30">
      <div class="flex items-center gap-3">
        <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/15 dark:bg-violet-400/15">
          <Film class="h-5 w-5 text-violet-600 dark:text-violet-300" />
        </div>
        <div class="flex flex-col">
          <span class="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Splicer
          </span>
          <span class="text-xs text-slate-500 dark:text-slate-400">
            Fast timeline cuts, no upload
          </span>
        </div>
      </div>

      <button
        onClick={toggleTheme}
        class="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        title="Toggle theme"
      >
        <Sun class="hidden h-4 w-4 dark:block" />
        <Moon class="block h-4 w-4 dark:hidden" />
      </button>
    </header>
  )
}
