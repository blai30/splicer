import { useEffect } from 'preact/hooks'

import { initKeyboardShortcuts } from '@/lib/shortcuts'

// Renders nothing; just attaches the editor keyboard shortcuts on mount. Kept
// out of the shared header so shortcuts only run on the editor page.
export function KeyboardShortcutsInit() {
  useEffect(() => {
    initKeyboardShortcuts()
  }, [])
  return null
}
