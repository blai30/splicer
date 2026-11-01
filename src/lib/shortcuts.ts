import { redoAdvanced, undoAdvanced } from '@/lib/advanced/advancedHistory'
import {
  seek as advancedSeek,
  stepFrame as advancedStepFrame,
  togglePlay as advancedTogglePlay,
} from '@/lib/advanced/advancedPlayback'
import { nudgeSegmentTransforms } from '@/lib/advanced/advancedSegmentEditing'
import { clearAdvancedSelection, selectAllAdvanced } from '@/lib/advanced/advancedSelection'
import {
  advancedClipboardSize,
  copyAdvancedSelected,
  cutAdvancedAtPlayhead,
  cutAdvancedSelected,
  deleteAdvancedSelected,
  duplicateAdvancedSelected,
  nudgeAdvancedSelected,
  pasteAdvanced,
  rippleDeleteAdvancedSelected,
  setAdvancedInPoint,
  setAdvancedOutPoint,
  toggleAdvancedMute,
} from '@/lib/advanced/advancedTimelineEditing'
import {
  goToAdjacentCut,
  goToEnd as basicGoToEnd,
  goToStart as basicGoToStart,
  shuttle,
  stepFrame as basicStepFrame,
  stepSeconds,
  togglePlay as basicTogglePlay,
} from '@/lib/playback'
import {
  advancedCanvasFocused,
  advancedClipMenu,
  advancedSegments,
  advancedSelectedId,
  advancedSelectedIds,
  advancedSnapEnabled,
  appMode,
  playheadTime,
  segmentMenu,
  selectedSegmentId,
} from '@/lib/store'
import {
  cutAtPlayhead,
  deleteSegment,
  duplicateSegment,
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
function goToEnd() {
  // Advanced seeks clamp to the project end.
  if (isAdvanced()) advancedSeek(Number.POSITIVE_INFINITY)
  else basicGoToEnd()
  revealTimelinePlayhead()
}
// Basic-only transport moves; each reveals the playhead it moved.
function revealing(move: () => void) {
  return () => {
    move()
    revealTimelinePlayhead()
  }
}
// Keyboard access to the Basic segment menu, opened under the selected block.
function openSegmentMenu() {
  const segmentId = selectedSegmentId.value
  if (!segmentId) return
  const block = document.querySelector(`[data-segment-id="${segmentId}"]`)
  if (!block) return
  const rect = block.getBoundingClientRect()
  suppressFollowingContextMenu()
  segmentMenu.value = {
    segmentId,
    time: playheadTime.peek(),
    x: rect.left + Math.min(rect.width / 2, 24),
    y: rect.bottom,
  }
}
// The browser follows the menu keys with its own contextmenu event, aimed at
// the focused element; that one must neither open the native menu nor
// re-target ours. A real right-click starts with a pointerdown, so one that
// comes next is left alone.
function suppressFollowingContextMenu() {
  const suppress = (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
    stopSuppressing()
  }
  const stopSuppressing = () => {
    window.removeEventListener('contextmenu', suppress, { capture: true })
    window.removeEventListener('pointerdown', stopSuppressing, { capture: true })
  }
  window.addEventListener('contextmenu', suppress, { capture: true })
  window.addEventListener('pointerdown', stopSuppressing, { capture: true })
  setTimeout(stopSuppressing, 500)
}
// Keyboard access to the Advanced clip menu, opened under the primary clip.
function openAdvancedClipMenu() {
  const segmentId = advancedSelectedId.value
  if (!segmentId) return
  const block = document.querySelector(`[data-advanced-segment-id="${segmentId}"]`)
  if (!block) return
  const rect = block.getBoundingClientRect()
  suppressFollowingContextMenu()
  advancedClipMenu.value = {
    segmentId,
    x: rect.left + Math.min(rect.width / 2, 24),
    y: rect.bottom,
  }
}
function hasAdvancedSelection(): boolean {
  return advancedSelectedIds.value.length > 0
}
// Ctrl+C, Ctrl+X, and Ctrl+A keep their usual page meaning while text is
// selected on the page.
function noTextSelected(): boolean {
  const selection = typeof window === 'undefined' ? null : window.getSelection()
  return !selection || selection.isCollapsed
}
// Arrow keys move the selected clips on the canvas while it has focus.
function canvasNudgeActive(): boolean {
  return advancedCanvasFocused.value && hasAdvancedSelection()
}
function nudgeCanvas(dx: number, dy: number) {
  return () => nudgeSegmentTransforms(advancedSelectedIds.value, dx, dy)
}
const CANVAS_NUDGE_STEP_PX = 10

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

// Order matters where two entries share a key: the first whose `when` passes
// wins, so the focused-canvas nudges come before the frame steps.
export const SHORTCUTS: Shortcut[] = [
  ...(
    [
      ['ArrowLeft', '←', 'Left', -1, 0],
      ['ArrowRight', '→', 'Right', 1, 0],
      ['ArrowUp', '↑', 'Up', 0, -1],
      ['ArrowDown', '↓', 'Down', 0, 1],
    ] as const
  ).flatMap(([key, arrow, direction, dx, dy]): Shortcut[] => [
    {
      keys: [key],
      mode: 'advanced',
      when: canvasNudgeActive,
      display: arrow,
      description: `Nudge Clips ${direction} on the Canvas (canvas focused)`,
      run: nudgeCanvas(dx, dy),
    },
    {
      keys: [key],
      shift: true,
      mode: 'advanced',
      when: canvasNudgeActive,
      display: `Shift ${arrow}`,
      description: `Nudge Clips ${direction} 10 px on the Canvas (canvas focused)`,
      run: nudgeCanvas(dx * CANVAS_NUDGE_STEP_PX, dy * CANVAS_NUDGE_STEP_PX),
    },
  ]),
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
  {
    keys: ['ArrowLeft'],
    shift: true,
    mode: 'basic',
    display: 'Shift ←',
    description: 'Back One Second',
    run: revealing(() => stepSeconds(-1)),
  },
  {
    keys: ['ArrowRight'],
    shift: true,
    mode: 'basic',
    display: 'Shift →',
    description: 'Forward One Second',
    run: revealing(() => stepSeconds(1)),
  },
  {
    keys: ['ArrowUp'],
    mode: 'basic',
    display: '↑',
    description: 'Previous Cut',
    run: revealing(() => goToAdjacentCut(-1)),
  },
  {
    keys: ['ArrowDown'],
    mode: 'basic',
    display: '↓',
    description: 'Next Cut',
    run: revealing(() => goToAdjacentCut(1)),
  },
  {
    keys: ['j'],
    mode: 'basic',
    display: 'J',
    description: 'Play Reverse (press again for faster)',
    run: () => shuttle('j'),
  },
  { keys: ['k'], mode: 'basic', display: 'K', description: 'Stop', run: () => shuttle('k') },
  {
    keys: ['l'],
    mode: 'basic',
    display: 'L',
    description: 'Play Forward (press again for faster)',
    run: () => shuttle('l'),
  },
  { keys: ['i'], display: 'I', description: 'Set In-Point', run: setIn },
  { keys: ['o'], display: 'O', description: 'Set Out-Point', run: setOut },
  { keys: ['c'], display: 'C', description: 'Cut at Playhead', run: cut },
  { keys: ['m'], display: 'M', description: 'Mute Segment', run: muteSegment },
  { keys: ['Home'], display: 'Home', description: 'Go to Start', run: goToStart },
  { keys: ['End'], display: 'End', description: 'Go to End', run: goToEnd },
  {
    keys: ['s'],
    mode: 'advanced',
    display: 'S',
    description: 'Toggle Timeline Snapping',
    run: () => (advancedSnapEnabled.value = !advancedSnapEnabled.value),
  },
  {
    keys: ['d'],
    ctrl: true,
    mode: 'basic',
    display: 'Ctrl D',
    description: 'Duplicate Segment',
    run: () => duplicateSegment(),
  },
  {
    keys: ['d'],
    ctrl: true,
    mode: 'advanced',
    when: hasAdvancedSelection,
    display: 'Ctrl D',
    description: 'Duplicate Selected Clips',
    run: duplicateAdvancedSelected,
  },
  {
    keys: ['c'],
    ctrl: true,
    mode: 'advanced',
    when: () => hasAdvancedSelection() && noTextSelected(),
    display: 'Ctrl C',
    description: 'Copy Selected Clips',
    run: () => void copyAdvancedSelected(),
  },
  {
    keys: ['x'],
    ctrl: true,
    mode: 'advanced',
    when: () => hasAdvancedSelection() && noTextSelected(),
    display: 'Ctrl X',
    description: 'Cut Selected Clips to the Clipboard',
    run: cutAdvancedSelected,
  },
  {
    keys: ['v'],
    ctrl: true,
    mode: 'advanced',
    when: () => advancedClipboardSize.value > 0,
    display: 'Ctrl V',
    description: 'Paste at the Playhead on the Active Track',
    run: pasteAdvanced,
  },
  {
    keys: ['a'],
    ctrl: true,
    mode: 'advanced',
    when: () => advancedSegments.value.length > 0 && noTextSelected(),
    display: 'Ctrl A',
    description: 'Select All Clips',
    run: selectAllAdvanced,
  },
  {
    keys: ['Escape'],
    mode: 'advanced',
    when: hasAdvancedSelection,
    display: 'Esc',
    description: 'Clear Selection',
    run: clearAdvancedSelection,
  },
  {
    keys: ['ArrowLeft'],
    alt: true,
    mode: 'advanced',
    when: hasAdvancedSelection,
    display: 'Alt ←',
    description: 'Nudge Clips One Frame Earlier',
    run: () => nudgeAdvancedSelected(-1),
  },
  {
    keys: ['ArrowRight'],
    alt: true,
    mode: 'advanced',
    when: hasAdvancedSelection,
    display: 'Alt →',
    description: 'Nudge Clips One Frame Later',
    run: () => nudgeAdvancedSelected(1),
  },
  {
    keys: ['ArrowLeft'],
    alt: true,
    shift: true,
    mode: 'advanced',
    when: hasAdvancedSelection,
    display: 'Alt Shift ←',
    description: 'Nudge Clips Ten Frames Earlier',
    run: () => nudgeAdvancedSelected(-10),
  },
  {
    keys: ['ArrowRight'],
    alt: true,
    shift: true,
    mode: 'advanced',
    when: hasAdvancedSelection,
    display: 'Alt Shift →',
    description: 'Nudge Clips Ten Frames Later',
    run: () => nudgeAdvancedSelected(10),
  },
  {
    keys: ['Delete', 'Backspace'],
    shift: true,
    mode: 'advanced',
    display: 'Shift Delete',
    description: 'Ripple Delete (close the gap)',
    run: rippleDeleteAdvancedSelected,
  },
  {
    keys: ['ContextMenu'],
    mode: 'advanced',
    display: 'Menu',
    description: 'Clip Actions Menu',
    run: openAdvancedClipMenu,
  },
  {
    keys: ['F10'],
    shift: true,
    mode: 'advanced',
    display: 'Shift F10',
    description: 'Clip Actions Menu',
    run: openAdvancedClipMenu,
  },
  {
    keys: ['ContextMenu'],
    mode: 'basic',
    display: 'Menu',
    description: 'Segment Actions Menu',
    run: openSegmentMenu,
  },
  {
    keys: ['F10'],
    shift: true,
    mode: 'basic',
    display: 'Shift F10',
    description: 'Segment Actions Menu',
    run: openSegmentMenu,
  },
  {
    keys: ['Delete', 'Backspace'],
    display: 'Delete',
    description: 'Delete Selection',
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
  // An open menu owns every key (arrows, letters) until it closes.
  if (event.target instanceof Element && event.target.closest('[role="menu"]')) return false

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
