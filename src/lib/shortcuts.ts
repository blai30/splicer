import { redoAdvanced, undoAdvanced } from '@/lib/advanced/advancedHistory'
import {
  seek as advancedSeek,
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
import {
  goToStart as basicGoToStart,
  stepFrame as basicStepFrame,
  togglePlay as basicTogglePlay,
} from '@/lib/playback'
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

// Mode-aware action dispatch: each action goes to the active editor. Zoom is
// shared (pxPerSec).
function togglePlay() {
  if (isAdvanced()) advancedTogglePlay()
  else basicTogglePlay()
}
function stepFrame(direction: 1 | -1) {
  if (isAdvanced()) advancedStepFrame(direction)
  else basicStepFrame(direction)
}
function goToStart() {
  if (isAdvanced()) advancedSeek(0)
  else basicGoToStart()
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
  if (isAdvanced()) undoAdvanced()
  else undo()
}
function redoEdit() {
  if (isAdvanced()) redoAdvanced()
  else redo()
}

export type Shortcut = {
  // Matched against KeyboardEvent.key; single letters are matched lowercase.
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
  { keys: ['Home'], display: 'Home', description: 'Go to Start', run: goToStart },
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

// Keys that operate a focused control natively; the editor must not steal them.
const CONTROL_KEYS = new Set([' ', 'Enter'])

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function isActivatable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.closest('button, a[href], summary, [role="button"], [role="tab"]') !== null
}

function isInsideComposite(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.closest('[role="radiogroup"], [role="tablist"], [role="slider"]') !== null
}

// Normalize a key for matching: single letters ignore case (Caps Lock, Shift).
function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key
}

export function handleShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.altKey || event.isComposing) return false
  if (isTextEntry(event.target)) return false
  // A modal dialog owns the keyboard while open.
  if (document.querySelector('dialog[open]')) return false
  // Space/Enter on a focused button activates that button, not the editor.
  if (CONTROL_KEYS.has(event.key) && isActivatable(event.target)) return false
  // Arrow keys inside a radio group or tab list move between its options.
  if (event.key.startsWith('Arrow') && isInsideComposite(event.target)) return false

  const hasCtrl = event.ctrlKey || event.metaKey
  const key = normalizeKey(event.key)
  for (const shortcut of SHORTCUTS) {
    if ((shortcut.ctrl ?? false) !== hasCtrl) continue
    if (shortcut.ctrl && (shortcut.shift ?? false) !== event.shiftKey) continue
    if (!shortcut.keys.includes(key)) continue
    event.preventDefault()
    shortcut.run()
    return true
  }
  return false
}

function handler(event: KeyboardEvent) {
  handleShortcut(event)
}

let attached = false

export function initKeyboardShortcuts() {
  if (attached || typeof window === 'undefined') return
  attached = true
  window.addEventListener('keydown', handler)
}

export default initKeyboardShortcuts
