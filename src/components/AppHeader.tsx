import { theme } from '@/lib/store'
import { Film, Moon, Sun } from 'lucide-preact'

export function AppHeader() {
  function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark')
    theme.value = isDark ? 'dark' : 'light'
    localStorage.setItem('theme', isDark ? 'dark' : 'light')
  }

  return (
    <header class="flex h-12 shrink-0 items-center justify-between rounded-lg bg-slate-100 px-4 dark:bg-slate-900">
      <div class="flex items-center gap-2">
        <Film class="h-6 w-6 text-violet-500" />
        <span class="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          Splicer
        </span>
      </div>

      <button
        onClick={toggleTheme}
        class="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        title="Toggle theme"
      >
        <Sun class="hidden h-4 w-4 dark:block" />
        <Moon class="block h-4 w-4 dark:hidden" />
      </button>
    </header>
  )
}
