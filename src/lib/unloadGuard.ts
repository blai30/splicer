import { advancedSegments, exportHistory, exporting, timeline } from '@/lib/store'

// Nothing is persisted across reloads (source files cannot be rehydrated), so
// warn before the page unloads with work that would be lost.
export function hasUnsavedWork(): boolean {
  return (
    exporting.value ||
    timeline.value.length > 0 ||
    advancedSegments.value.length > 0 ||
    exportHistory.value.length > 0
  )
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
