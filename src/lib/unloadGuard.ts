import { projectSaved, unlinkedClips } from '@/lib/project/projectPersistence'
import { advancedSegments, exportHistory, exporting, timeline } from '@/lib/store'

// Warn before the page unloads only when something would be lost: an export
// still running, exports in the library (kept for the session only), or edits
// the autosave has not stored yet (or cannot store, e.g. without IndexedDB).
export function hasUnsavedWork(): boolean {
  if (exporting.value || exportHistory.value.length > 0) return true
  const hasProject =
    timeline.value.length > 0 || advancedSegments.value.length > 0 || unlinkedClips.value.length > 0
  return hasProject && !projectSaved.value
}

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (!hasUnsavedWork()) return
  event.preventDefault()
}

let attached = false

export function initUnloadGuard() {
  if (attached || typeof window === 'undefined') return
  attached = true
  window.addEventListener('beforeunload', onBeforeUnload)
}
