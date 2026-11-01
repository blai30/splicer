import { useSignal } from '@preact/signals'
import clsx from 'clsx/lite'
import type { LucideIcon } from 'lucide-preact'
import { createPortal } from 'preact/compat'
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks'

import { placeMenu } from '@/lib/menuPlacement'

export type ContextMenuItem = {
  label: string
  icon: LucideIcon
  // Shown beside the label and announced via aria-keyshortcuts.
  shortcut?: { display: string; aria: string }
  disabled?: boolean
  danger?: boolean
  run: () => void
}

// A floating menu of actions (WAI-ARIA menu pattern): arrow keys, Home and End
// move between items, Enter or Space runs one, Escape or Tab closes, as does a
// press outside, a scroll, or a resize. Focus returns to where it was on close.
// Rendered into <body>, since a blurred ancestor would otherwise become the
// containing block for its fixed position and clip it.
export function ContextMenu({
  x,
  y,
  label,
  items,
  onClose,
}: {
  // Viewport coordinates to open at.
  x: number
  y: number
  label: string
  items: ContextMenuItem[]
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  // Hidden until measured, so it never flashes at an unclamped spot.
  const position = useSignal<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    position.value = placeMenu(
      { x, y },
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight }
    )
  }, [x, y])

  // A hidden element cannot take focus: wait until the menu is placed.
  const placed = position.value !== null
  useEffect(() => {
    if (placed) enabledItems()[0]?.focus()
  }, [placed])

  useEffect(() => {
    const restoreFocus = document.activeElement as HTMLElement | null

    function close() {
      onCloseRef.current()
    }
    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) close()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    // On the window, not the menu: keys pressed before focus has moved into
    // the menu (it is focused once placed) must still reach it.
    window.addEventListener('keydown', onKeyDown, true)
    // Scroll events are delivered at the next frame, so one from a scroll that
    // ended just before opening would otherwise close the menu at once.
    const scrollListenFrame = requestAnimationFrame(() =>
      window.addEventListener('scroll', close, true)
    )
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    return () => {
      cancelAnimationFrame(scrollListenFrame)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      // Only take focus back if it is still in the menu (or lost to <body>);
      // a press elsewhere has already put it where the user wanted.
      const active = document.activeElement
      if (!active || active === document.body || menuRef.current?.contains(active)) {
        restoreFocus?.focus?.()
      }
    }
  }, [])

  function enabledItems(): HTMLButtonElement[] {
    return Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []
    )
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.isComposing) return
    const buttons = enabledItems()
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    let next: number | null = null
    if (event.key === 'ArrowDown') next = current + 1 >= buttons.length ? 0 : current + 1
    else if (event.key === 'ArrowUp') next = current <= 0 ? buttons.length - 1 : current - 1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = buttons.length - 1
    else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      onCloseRef.current()
      return
    }
    if (next === null) return
    event.preventDefault()
    buttons[next]?.focus()
  }

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      aria-orientation="vertical"
      onContextMenu={(event) => event.preventDefault()}
      class={clsx(
        'fixed z-50 min-w-48 rounded-lg border border-slate-200/80 bg-white/95 p-1 text-slate-900 shadow-lg backdrop-blur dark:border-slate-700/70 dark:bg-slate-900/95 dark:text-slate-50',
        position.value === null && 'invisible'
      )}
      style={
        position.value
          ? { left: `${position.value.left}px`, top: `${position.value.top}px` }
          : undefined
      }
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          tabIndex={-1}
          disabled={item.disabled}
          aria-keyshortcuts={item.shortcut?.aria}
          onClick={() => {
            onClose()
            item.run()
          }}
          class={clsx(
            'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors outline-none hover:duration-0 disabled:cursor-not-allowed disabled:opacity-40',
            item.danger
              ? 'text-red-600 hover:bg-red-100/60 focus-visible:bg-red-100/60 dark:text-red-400 dark:hover:bg-red-900/30 dark:focus-visible:bg-red-900/30'
              : 'hover:bg-slate-100 focus-visible:bg-slate-100 dark:hover:bg-slate-800 dark:focus-visible:bg-slate-800'
          )}
        >
          <item.icon class="size-4 shrink-0" aria-hidden="true" />
          <span class="flex-1">{item.label}</span>
          {item.shortcut && (
            <kbd class="text-xs text-slate-500 dark:text-slate-400" aria-hidden="true">
              {item.shortcut.display}
            </kbd>
          )}
        </button>
      ))}
    </div>,
    document.body
  )
}
