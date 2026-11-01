import { useEffect } from 'preact/hooks'

import { initKeyboardShortcuts } from '@/lib/shortcuts'
import { initUnloadGuard } from '@/lib/unloadGuard'

// Renders nothing; attaches the editor keyboard shortcuts and the leave-page
// guard on mount. Kept
// out of the shared header so shortcuts only run on the editor page.
export function KeyboardShortcutsInit() {
  useEffect(() => {
    initKeyboardShortcuts()
    initUnloadGuard()
  }, [])
  return null
}
