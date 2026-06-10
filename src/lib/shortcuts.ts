import { stepFrame, togglePlay } from '@/lib/playback'
import { ZOOM_MAX, ZOOM_MIN, pxPerSec } from '@/lib/store'
import {
  cutAtPlayhead,
  deleteSegment,
  setInPoint,
  setOutPoint,
  toggleMute,
  undo,
} from '@/lib/timelineEditing'

const ZOOM_KEYBOARD_STEP = 10

function zoomBy(delta: number) {
  pxPerSec.value = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, pxPerSec.value + delta))
}

export type Shortcut = {
  // Matched against KeyboardEvent.key (lowercased when ctrl is set).
  keys: string[]
  ctrl?: boolean
  // Display label and description rendered by the keyboard legend.
  display: string
  description: string
  run: () => void
}

export const SHORTCUTS: Shortcut[] = [
  { keys: [' '], display: 'Space', description: 'Play / Pause', run: togglePlay },
  {
    keys: ['ArrowLeft', ','],
    display: '←',
    description: 'Step Back One Frame',
    run: () => stepFrame(-1),
  },
  {
    keys: ['ArrowRight', '.'],
    display: '→',
    description: 'Step Forward One Frame',
    run: () => stepFrame(1),
  },
  { keys: ['i'], display: 'I', description: 'Set In-Point', run: setInPoint },
  { keys: ['o'], display: 'O', description: 'Set Out-Point', run: setOutPoint },
  { keys: ['c'], display: 'C', description: 'Cut at Playhead', run: cutAtPlayhead },
  { keys: ['m'], display: 'M', description: 'Mute Segment', run: toggleMute },
  {
    keys: ['Delete', 'Backspace'],
    display: 'Delete',
    description: 'Delete Segment',
    run: deleteSegment,
  },
  { keys: ['z'], ctrl: true, display: 'Ctrl Z', description: 'Undo', run: undo },
  {
    keys: ['=', '+'],
    display: '+',
    description: 'Zoom In',
    run: () => zoomBy(ZOOM_KEYBOARD_STEP),
  },
  {
    keys: ['-', '_'],
    display: '-',
    description: 'Zoom Out',
    run: () => zoomBy(-ZOOM_KEYBOARD_STEP),
  },
]

function handler(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement).tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

  const hasCtrl = e.ctrlKey || e.metaKey
  for (const shortcut of SHORTCUTS) {
    if ((shortcut.ctrl ?? false) !== hasCtrl) continue
    const key = shortcut.ctrl ? e.key.toLowerCase() : e.key
    if (!shortcut.keys.includes(key)) continue
    e.preventDefault()
    shortcut.run()
    return
  }
}

let attached = false

export function initKeyboardShortcuts() {
  if (attached || typeof window === 'undefined') return
  attached = true
  window.addEventListener('keydown', handler)
}

export default initKeyboardShortcuts
