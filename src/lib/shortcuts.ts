import { stepFrame, togglePlay } from '@/lib/playback'
import {
  setInPoint,
  setOutPoint,
  cutAtPlayhead,
  deleteSegment,
  undoDelete,
  toggleMute,
} from '@/lib/store'

let attached = false

export function initKeyboardShortcuts() {
  if (attached || typeof window === 'undefined') return
  attached = true

  function handler(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

    // basic playback controls
    switch (e.key) {
      case ' ':
        e.preventDefault()
        togglePlay()
        return
      case 'ArrowLeft':
      case ',':
        e.preventDefault()
        stepFrame(-1)
        return
      case 'ArrowRight':
      case '.':
        e.preventDefault()
        stepFrame(1)
        return
      case 'i':
        setInPoint()
        return
      case 'o':
        setOutPoint()
        return
      case 'c':
        cutAtPlayhead()
        return
      case 'm':
        toggleMute()
        return
      case 'Delete':
      case 'Backspace':
        deleteSegment()
        return
      default:
        break
    }

    // Ctrl+Z undo
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      undoDelete()
    }
  }

  window.addEventListener('keydown', handler)
}

export default initKeyboardShortcuts
