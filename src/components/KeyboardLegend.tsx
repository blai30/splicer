import { useSignal } from '@preact/signals'
import { X } from 'lucide-preact'
import { createPortal } from 'preact/compat'
import { useEffect } from 'preact/hooks'

const SHORTCUTS = [
  { key: 'Space', description: 'Play / Pause' },
  { key: 'I', description: 'Set In-Point' },
  { key: 'O', description: 'Set Out-Point' },
  { key: 'C', description: 'Cut at Playhead' },
  { key: 'Delete', description: 'Delete Segment' },
  { key: 'Ctrl +', description: 'Zoom In' },
  { key: 'Ctrl -', description: 'Zoom Out' },
  { key: 'M', description: 'Toggle Mute' },
  { key: '← →', description: 'Frame Step' },
]

export function KeyboardLegend() {
  const isOpen = useSignal(false)

  useEffect(() => {
    if (!isOpen.value) return

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        isOpen.value = false
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen.value])

  const modal =
    isOpen.value && typeof document !== 'undefined' ? (
      <div
        class="fixed inset-0 z-999 flex items-center justify-center bg-black/30 backdrop-blur-sm"
        onClick={() => (isOpen.value = false)}
      >
        <div
          class="relative max-h-128 w-full max-w-md scrollbar-thumb-slate-400/80 scrollbar-track-transparent overflow-auto rounded-lg border border-slate-200/80 bg-white shadow-lg dark:scrollbar-thumb-slate-600/80 dark:border-slate-700/70 dark:bg-slate-900"
          onClick={(e) => e.stopPropagation()}
        >
          <div class="sticky top-0 flex items-center justify-between border-b border-slate-200/60 bg-white px-6 py-4 dark:border-slate-700/60 dark:bg-slate-900">
            <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">
              Keyboard Shortcuts
            </h2>
            <button
              onClick={() => (isOpen.value = false)}
              class="inline-flex h-8 w-8 items-center justify-center rounded transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Close"
            >
              <X class="h-4 w-4" />
            </button>
          </div>

          <div class="space-y-1 p-4">
            {SHORTCUTS.map((shortcut, idx) => (
              <div
                key={idx}
                class="flex items-center justify-between rounded-md px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <span class="text-sm text-slate-700 dark:text-slate-300">
                  {shortcut.description}
                </span>
                <kbd class="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-900 dark:bg-slate-800 dark:text-slate-100">
                  {shortcut.key}
                </kbd>
              </div>
            ))}
          </div>
        </div>
      </div>
    ) : null

  return (
    <>
      <button
        onClick={() => (isOpen.value = !isOpen.value)}
        class="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        aria-label="Show keyboard shortcuts"
        title="Keyboard shortcuts"
      >
        <svg
          class="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
          <path d="M12 18v-4" />
          <path d="M12 8h.01" />
        </svg>
      </button>
      {modal ? createPortal(modal, document.body) : null}
    </>
  )
}
