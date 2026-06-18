import {
  stepFrame as advancedStepFrame,
  togglePlay as advancedTogglePlay,
} from '@/lib/advanced/advancedPlayback'
import {
  cutAdvancedAtPlayhead,
  deleteAdvancedSelected,
  setAdvancedInPoint,
  setAdvancedOutPoint,
  toggleAdvancedMute,
} from '@/lib/advanced/advancedTimelineEditing'
import { stepFrame as basicStepFrame, togglePlay as basicTogglePlay } from '@/lib/playback'
import { appMode, ZOOM_MAX, ZOOM_MIN, pxPerSec } from '@/lib/store'
import {
  cutAtPlayhead,
  deleteSegment,
  redo,
  setInPoint,
  setOutPoint,
  toggleMute,
  undo,
} from '@/lib/timelineEditing'

const ZOOM_KEYBOARD_STEP = 10

function isAdvanced(): boolean {
  return appMode.value === 'advanced'
}

function zoomBy(delta: number) {
  pxPerSec.value = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, pxPerSec.value + delta))
}

// Mode-aware action dispatch. Zoom is shared (pxPerSec); undo/redo exist only in
// Basic, so they no-op in Advanced rather than mutating Basic state.
function togglePlay() {
  if (isAdvanced()) advancedTogglePlay()
  else basicTogglePlay()
}
function stepFrame(direction: 1 | -1) {
  if (isAdvanced()) advancedStepFrame(direction)
  else basicStepFrame(direction)
}
function setIn() {
  if (isAdvanced()) setAdvancedInPoint()
  else setInPoint()
}
function setOut() {
  if (isAdvanced()) setAdvancedOutPoint()
  else setOutPoint()
}
function cut() {
  if (isAdvanced()) cutAdvancedAtPlayhead()
  else cutAtPlayhead()
}
function muteSegment() {
  if (isAdvanced()) toggleAdvancedMute()
  else toggleMute()
}
function removeSelected() {
  if (isAdvanced()) deleteAdvancedSelected()
  else deleteSegment()
}
function undoEdit() {
  if (!isAdvanced()) undo()
}
function redoEdit() {
  if (!isAdvanced()) redo()
}

export type Shortcut = {
  // Matched against KeyboardEvent.key (lowercased when ctrl is set).
  keys: string[]
  ctrl?: boolean
  // Only checked for ctrl shortcuts; plain keys already encode shift ('=' vs '+').
  shift?: boolean
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
  { keys: ['i'], display: 'I', description: 'Set In-Point', run: setIn },
  { keys: ['o'], display: 'O', description: 'Set Out-Point', run: setOut },
  { keys: ['c'], display: 'C', description: 'Cut at Playhead', run: cut },
  { keys: ['m'], display: 'M', description: 'Mute Segment', run: muteSegment },
  {
    keys: ['Delete', 'Backspace'],
    display: 'Delete',
    description: 'Delete Segment',
    run: removeSelected,
  },
  { keys: ['z'], ctrl: true, display: 'Ctrl Z', description: 'Undo', run: undoEdit },
  {
    keys: ['z'],
    ctrl: true,
    shift: true,
    display: 'Ctrl Shift Z',
    description: 'Redo',
    run: redoEdit,
  },
  { keys: ['y'], ctrl: true, display: 'Ctrl Y', description: 'Redo', run: redoEdit },
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

function handler(event: KeyboardEvent) {
  const tag = (event.target as HTMLElement).tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

  const hasCtrl = event.ctrlKey || event.metaKey
  for (const shortcut of SHORTCUTS) {
    if ((shortcut.ctrl ?? false) !== hasCtrl) continue
    if (shortcut.ctrl && (shortcut.shift ?? false) !== event.shiftKey) continue
    const key = shortcut.ctrl ? event.key.toLowerCase() : event.key
    if (!shortcut.keys.includes(key)) continue
    event.preventDefault()
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
