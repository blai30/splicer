import { useEffect } from 'preact/hooks'

import { initProjectPersistence } from '@/lib/project/projectPersistence'
import { initKeyboardShortcuts } from '@/lib/shortcuts'
import { initUnloadGuard } from '@/lib/unloadGuard'

// Renders nothing; attaches the editor keyboard shortcuts, the leave-page
// guard, and project autosave on mount. Kept out of the shared header so they
// only run on the editor page.
export function KeyboardShortcutsInit() {
  useEffect(() => {
    initKeyboardShortcuts()
    initUnloadGuard()
    void initProjectPersistence()
  }, [])
  return null
}
