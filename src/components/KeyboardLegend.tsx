import { useSignal } from '@preact/signals'
import clsx from 'clsx/lite'
import { Keyboard } from 'lucide-preact'

import { Modal } from '@/components/Modal'
import { SHORTCUTS } from '@/lib/shortcuts'

export function KeyboardLegend({ class: className }: { class?: string }) {
  const isOpen = useSignal(false)

  return (
    <>
      <button
        type="button"
        onClick={() => (isOpen.value = true)}
        class={clsx(className, 'inline-flex items-center justify-center')}
        title="Keyboard shortcuts"
        aria-label="Keyboard shortcuts"
        aria-haspopup="dialog"
      >
        <Keyboard class="size-4" />
      </button>
      <Modal open={isOpen.value} title="Keyboard shortcuts" onClose={() => (isOpen.value = false)}>
        <dl class="space-y-1 p-4">
          {SHORTCUTS.map((shortcut) => (
            <div
              key={shortcut.display + shortcut.description}
              class="flex items-center justify-between gap-4 rounded-md px-3 py-2 transition-colors hover:bg-slate-100 hover:duration-0 dark:hover:bg-slate-800"
            >
              <dt class="text-sm text-slate-700 dark:text-slate-300">{shortcut.description}</dt>
              <dd>
                <kbd class="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-900 dark:bg-slate-800 dark:text-slate-100">
                  {shortcut.display}
                </kbd>
              </dd>
            </div>
          ))}
        </dl>
      </Modal>
    </>
  )
}
