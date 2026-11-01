import { pxPerSec } from '@/lib/store'
import { stepZoom } from '@/lib/timelineNavigation'

// View actions of whichever timeline is mounted (only one editor is at a
// time), so keyboard shortcuts can zoom and scroll it without owning its DOM.
export type TimelineNavigator = {
  zoomStep: (direction: 1 | -1) => void
  fit: () => void
  revealPlayhead: () => void
}

let activeNavigator: TimelineNavigator | null = null

export function registerTimelineNavigator(navigator: TimelineNavigator): () => void {
  activeNavigator = navigator
  return () => {
    if (activeNavigator === navigator) activeNavigator = null
  }
}

export function zoomTimelineStep(direction: 1 | -1) {
  if (activeNavigator) activeNavigator.zoomStep(direction)
  else pxPerSec.value = stepZoom(pxPerSec.value, direction)
}

export function fitTimeline() {
  activeNavigator?.fit()
}

// Scroll the playhead back into view after a keyboard seek.
export function revealTimelinePlayhead() {
  activeNavigator?.revealPlayhead()
}
