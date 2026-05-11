import clsx from 'clsx/lite'
import { Moon, Sun } from 'lucide-preact'

import { theme } from '@/lib/store'

type ThemeSwitcherProps = {
  class?: string
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> }
}

function setTheme(next: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', next === 'dark')
  theme.value = next
  localStorage.setItem('theme', next)
}

export function ThemeSwitcher({ class: className }: ThemeSwitcherProps) {
  function toggleTheme(e: MouseEvent) {
    const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark'
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const doc = document as ViewTransitionDocument
    const button = e.currentTarget as HTMLButtonElement | null
    const rect = button?.getBoundingClientRect()
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2
    const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2

    document.documentElement.style.setProperty('--theme-sweep-x', `${x}px`)
    document.documentElement.style.setProperty('--theme-sweep-y', `${y}px`)

    if (prefersReducedMotion || !doc.startViewTransition) {
      setTheme(next)
      return
    }

    doc.startViewTransition(() => {
      setTheme(next)
    })
  }

  return (
    <button
      onClick={toggleTheme}
      class={clsx('relative flex items-center justify-center', className ?? '')}
      title="Toggle theme"
      aria-label="Toggle theme"
    >
      <Sun class="h-4 w-4 text-amber-500 transition-all duration-300 ease-out dark:scale-0 dark:rotate-90 dark:opacity-0" />
      <Moon class="absolute h-4 w-4 scale-0 rotate-90 text-indigo-400 opacity-0 transition-all duration-300 ease-out dark:scale-100 dark:rotate-0 dark:opacity-100" />
    </button>
  )
}
