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
import { advancedSnapEnabled, appMode } from '@/lib/store'
import {
  cutAtPlayhead,
  deleteSegment,
  redo,
  setInPoint,
  setOutPoint,
  toggleMute,
  undo,
} from '@/lib/timelineEditing'
import { fitTimeline, revealTimelinePlayhead, zoomTimelineStep } from '@/lib/timelineNavigator'

function isAdvanced(): boolean {
  return appMode.value === 'advanced'
}

// Mode-aware action dispatch: each action goes to the active editor. Zoom is
// shared (pxPerSec).
function togglePlay() {
  if (isAdvanced()) advancedTogglePlay()
  else basicTogglePlay()
}
// Keyboard seeks scroll a playhead that left the view back into it.
function stepFrame(direction: 1 | -1) {
  if (isAdvanced()) advancedStepFrame(direction)
  else basicStepFrame(direction)
  revealTimelinePlayhead()
}
function goToStart() {
  if (isAdvanced()) advancedSeek(0)
  else basicGoToStart()
  revealTimelinePlayhead()
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

export type ShortcutMode = 'basic' | 'advanced'

export type Shortcut = {
  // Matched against KeyboardEvent.key; single letters are matched lowercase.
  keys: string[]
  ctrl?: boolean
  // Omitted means "not held", except for symbol keys ('+', '_'), where Shift is
  // part of producing the character and is ignored unless set explicitly.
  shift?: boolean
  alt?: boolean
  // Restricts the shortcut to one editor; omitted means both.
  mode?: ShortcutMode
  // Extra context check (e.g. what has focus), evaluated after the key matches.
  when?: () => boolean
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
    keys: ['s'],
    mode: 'advanced',
    display: 'S',
    description: 'Toggle Timeline Snapping',
    run: () => (advancedSnapEnabled.value = !advancedSnapEnabled.value),
  },
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
    run: () => zoomTimelineStep(1),
  },
  {
    keys: ['-', '_'],
    display: '-',
    description: 'Zoom Out',
    run: () => zoomTimelineStep(-1),
  },
  {
    keys: ['z'],
    shift: true,
    display: 'Shift Z',
    description: 'Fit Timeline to View',
    run: fitTimeline,
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

// A printable non-letter ('+', '?', '_') already reflects Shift in its value.
function isSymbolKey(key: string): boolean {
  return key.length === 1 && key.toLowerCase() === key.toUpperCase()
}

export function shortcutsForMode(mode: ShortcutMode): Shortcut[] {
  return SHORTCUTS.filter((shortcut) => !shortcut.mode || shortcut.mode === mode)
}

export function matchesShortcut(
  shortcut: Shortcut,
  event: KeyboardEvent,
  mode: ShortcutMode
): boolean {
  if (shortcut.mode && shortcut.mode !== mode) return false
  const key = normalizeKey(event.key)
  if (!shortcut.keys.includes(key)) return false
  if ((shortcut.ctrl ?? false) !== (event.ctrlKey || event.metaKey)) return false
  if ((shortcut.alt ?? false) !== event.altKey) return false
  const shiftIgnored = shortcut.shift === undefined && isSymbolKey(key)
  if (!shiftIgnored && (shortcut.shift ?? false) !== event.shiftKey) return false
  return shortcut.when?.() ?? true
}

export function handleShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing) return false
  if (isTextEntry(event.target)) return false
  // A modal dialog owns the keyboard while open.
  if (document.querySelector('dialog[open]')) return false
  // Space/Enter on a focused button activates that button, not the editor.
  if (CONTROL_KEYS.has(event.key) && isActivatable(event.target)) return false
  // Arrow keys inside a radio group or tab list move between its options.
  if (event.key.startsWith('Arrow') && isInsideComposite(event.target)) return false

  // Unmatched combinations (e.g. Alt+Arrow history navigation) stay with the
  // browser because nothing is prevented unless a shortcut matches.
  const shortcut = SHORTCUTS.find((entry) => matchesShortcut(entry, event, appMode.value))
  if (!shortcut) return false
  event.preventDefault()
  shortcut.run()
  return true
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
