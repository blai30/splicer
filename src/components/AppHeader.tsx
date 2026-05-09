import { theme } from '@/lib/store'

export function AppHeader() {
  function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark')
    theme.value = isDark ? 'dark' : 'light'
    localStorage.setItem('theme', isDark ? 'dark' : 'light')
  }

  return (
    <header class="flex h-12 shrink-0 items-center justify-between rounded-lg bg-slate-100 px-4 dark:bg-slate-900">
      <div class="flex items-center gap-2">
        <svg
          class="h-6 w-6 text-violet-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M7 4v16M17 4v16M3 8h4m10 0h4M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"
          />
        </svg>
        <span class="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          Splicer
        </span>
      </div>

      <button
        onClick={toggleTheme}
        class="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        title="Toggle theme"
      >
        <svg
          class="hidden h-4 w-4 dark:block"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <circle cx="12" cy="12" r="5" />
          <path
            stroke-linecap="round"
            d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
          />
        </svg>
        <svg
          class="block h-4 w-4 dark:hidden"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"
          />
        </svg>
      </button>
    </header>
  )
}
