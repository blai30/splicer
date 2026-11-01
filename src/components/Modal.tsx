import { X } from 'lucide-preact'
import type { ComponentChildren } from 'preact'
import { useEffect, useRef } from 'preact/hooks'

// Accessible modal built on the native <dialog>: showModal() traps focus, makes
// the page behind it inert, and closes on Escape. Clicking the backdrop closes.
export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ComponentChildren
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      aria-label={title}
      onClose={onClose}
      onClick={(event) => {
        // A click whose target is the dialog itself landed on the backdrop.
        if (event.target === event.currentTarget) onClose()
      }}
      class="m-auto max-h-[80vh] w-[calc(100%-2rem)] max-w-lg overflow-hidden rounded-lg border border-slate-200/80 bg-white p-0 text-slate-900 shadow-lg backdrop:bg-black/30 backdrop:backdrop-blur-sm dark:border-slate-700/70 dark:bg-slate-900 dark:text-slate-50"
    >
      {open && (
        <div class="flex max-h-[80vh] flex-col">
          <div class="flex shrink-0 items-center justify-between border-b border-slate-200/60 px-6 py-4 dark:border-slate-700/60">
            <h2 class="text-lg font-semibold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              class="inline-flex size-8 items-center justify-center rounded transition-colors hover:bg-slate-100 hover:duration-0 dark:hover:bg-slate-800"
              aria-label="Close"
            >
              <X class="size-4" />
            </button>
          </div>
          <div class="min-h-0 overflow-auto">{children}</div>
        </div>
      )}
    </dialog>
  )
}
