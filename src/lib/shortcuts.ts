import {
  setInPoint,
  setOutPoint,
  cutAtPlayhead,
  toggleMute,
  deleteSegment,
  undoDelete,
  videoEl,
} from './store'

let attached = false

export function initKeyboardShortcuts() {
  if (attached || typeof window === 'undefined') return
  attached = true

  function handler(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

    // basic playback controls
    const v = videoEl.current
    switch (e.key) {
      case ' ':
        e.preventDefault()
        if (!v) return
        if (v.paused) v.play()
        else v.pause()
        return
      case 'ArrowLeft':
      case ',':
        e.preventDefault()
        if (!v) return
        v.currentTime = Math.max(0, v.currentTime - 1 / 30)
        return
      case 'ArrowRight':
      case '.':
        e.preventDefault()
        if (!v) return
        v.currentTime = Math.min(v.duration, v.currentTime + 1 / 30)
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
