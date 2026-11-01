// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'

import { resetAdvancedHistory } from '@/lib/advanced/advancedHistory'
import { addClipToTrack } from '@/lib/advanced/advancedSegmentEditing'
import { clearAdvancedSelection, setAdvancedSelection } from '@/lib/advanced/advancedSelection'
import { resetAdvancedClipboard } from '@/lib/advanced/advancedTimelineEditing'
import { handleShortcut, matchesShortcut, shortcutsForMode, type Shortcut } from '@/lib/shortcuts'
import {
  advancedCanvasFocused,
  advancedPlayhead,
  advancedSegments,
  advancedSelectedIds,
  advancedSnapEnabled,
  advancedTracks,
  appMode,
  clips,
  framerate,
  pxPerSec,
} from '@/lib/store'
import { registerTimelineNavigator } from '@/lib/timelineNavigator'

function keyEvent(key: string, init: KeyboardEventInit = {}) {
  return new KeyboardEvent('keydown', { key, ...init })
}

const noop = () => {}

function press(key: string, init: KeyboardEventInit = {}, target?: HTMLElement) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  Object.defineProperty(event, 'target', { value: target ?? document.body })
  return { handled: handleShortcut(event), event }
}

describe('keyboard shortcuts', () => {
  beforeEach(() => {
    appMode.value = 'basic'
    pxPerSec.value = 80
    document.body.innerHTML = ''
  })

  it('zooms by a constant ratio with = and -', () => {
    press('=')
    expect(pxPerSec.value).toBe(100)
    press('-')
    expect(pxPerSec.value).toBe(80)
    press('-')
    expect(pxPerSec.value).toBe(64)
  })

  it('routes zoom, fit, and keyboard seeks to the mounted timeline', () => {
    const calls: string[] = []
    const unregister = registerTimelineNavigator({
      zoomStep: (direction) => calls.push(`zoom ${direction}`),
      fit: () => calls.push('fit'),
      revealPlayhead: () => calls.push('reveal'),
    })
    press('=')
    press('-')
    press('Z', { shiftKey: true })
    press('ArrowRight')
    press('Home')
    unregister()
    press('Z', { shiftKey: true })
    expect(calls).toEqual(['zoom 1', 'zoom -1', 'fit', 'reveal', 'reveal'])
    // Zoom still works with no timeline mounted.
    expect(pxPerSec.value).toBe(80)
    press('=')
    expect(pxPerSec.value).toBe(100)
  })

  it('maps the Basic transport keys only in Basic', () => {
    const basic = shortcutsForMode('basic')
    const find = (key: string, init: KeyboardEventInit = {}) =>
      basic.find((shortcut) => matchesShortcut(shortcut, keyEvent(key, init), 'basic'))
    expect(find('ArrowLeft', { shiftKey: true })?.description).toBe('Back One Second')
    expect(find('ArrowRight', { shiftKey: true })?.description).toBe('Forward One Second')
    // Without Shift the arrows still step frames.
    expect(find('ArrowLeft')?.description).toBe('Step Back One Frame')
    expect(find('ArrowUp')?.description).toBe('Previous Cut')
    expect(find('ArrowDown')?.description).toBe('Next Cut')
    expect(find('End')?.description).toBe('Go to End')
    expect(find('j')?.description).toMatch(/Reverse/)
    expect(find('K')?.description).toBe('Stop')
    expect(find('l')?.description).toMatch(/Forward/)

    const advanced = shortcutsForMode('advanced')
    for (const key of ['j', 'k', 'l', 'ArrowUp', 'ArrowDown']) {
      expect(
        advanced.some((shortcut) => matchesShortcut(shortcut, keyEvent(key), 'advanced'))
      ).toBe(false)
    }
    // End works in both editors.
    expect(
      advanced.some((shortcut) => matchesShortcut(shortcut, keyEvent('End'), 'advanced'))
    ).toBe(true)
  })

  it('reveals the playhead after Basic transport jumps', () => {
    const calls: string[] = []
    const unregister = registerTimelineNavigator({
      zoomStep: noop,
      fit: noop,
      revealPlayhead: () => calls.push('reveal'),
    })
    press('ArrowDown')
    press('ArrowUp')
    press('ArrowRight', { shiftKey: true })
    press('End')
    unregister()
    expect(calls).toEqual(['reveal', 'reveal', 'reveal', 'reveal'])
  })

  it('leaves every key to an open menu', () => {
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    const item = document.createElement('button')
    menu.append(item)
    document.body.append(menu)
    expect(press('ArrowDown', {}, item).handled).toBe(false)
    expect(press('m', {}, item).handled).toBe(false)
    expect(press('=', {}, item).handled).toBe(false)
  })

  it('binds Ctrl+D and the menu keys in Basic only', () => {
    const basic = shortcutsForMode('basic')
    const find = (key: string, init: KeyboardEventInit = {}) =>
      basic.find((shortcut) => matchesShortcut(shortcut, keyEvent(key, init), 'basic'))
    expect(find('d', { ctrlKey: true })?.description).toBe('Duplicate Segment')
    expect(find('d', { metaKey: true })?.description).toBe('Duplicate Segment')
    expect(find('ContextMenu')?.description).toBe('Segment Actions Menu')
    expect(find('F10', { shiftKey: true })?.description).toBe('Segment Actions Menu')
    expect(
      shortcutsForMode('advanced').some((shortcut) =>
        matchesShortcut(shortcut, keyEvent('d', { ctrlKey: true }), 'advanced')
      )
    ).toBe(false)
  })

  it('ignores keys typed into text fields', () => {
    const input = document.createElement('input')
    document.body.append(input)
    expect(press('=', {}, input).handled).toBe(false)
    expect(pxPerSec.value).toBe(80)
  })

  it('leaves Space to a focused button', () => {
    const button = document.createElement('button')
    document.body.append(button)
    expect(press(' ', {}, button).handled).toBe(false)
  })

  it('leaves unbound Alt combinations to the browser (history navigation)', () => {
    const { handled, event } = press('ArrowLeft', { altKey: true })
    expect(handled).toBe(false)
    expect(event.defaultPrevented).toBe(false)
  })

  it('does not run a plain-key shortcut when Shift is held on a letter or named key', () => {
    expect(press('C', { shiftKey: true }).handled).toBe(false)
    expect(press('Home', { shiftKey: true }).handled).toBe(false)
    // Shift+Arrow is its own Basic shortcut (one-second steps), never a frame
    // step; Advanced leaves it unbound.
    appMode.value = 'advanced'
    expect(press('ArrowRight', { shiftKey: true }).handled).toBe(false)
  })

  it('ignores Shift on symbol keys whose character already encodes it', () => {
    press('+', { shiftKey: true })
    expect(pxPerSec.value).toBe(100)
  })

  it('runs Advanced-only shortcuts only in Advanced mode', () => {
    advancedSnapEnabled.value = true
    expect(press('s').handled).toBe(false)
    expect(advancedSnapEnabled.value).toBe(true)
    appMode.value = 'advanced'
    expect(press('s').handled).toBe(true)
    expect(advancedSnapEnabled.value).toBe(false)
    press('s')
    expect(advancedSnapEnabled.value).toBe(true)
  })

  it('matches letters regardless of case', () => {
    expect(press('C').handled).toBe(true)
  })

  it('is inactive while a modal dialog is open', () => {
    const dialog = document.createElement('dialog')
    dialog.setAttribute('open', '')
    document.body.append(dialog)
    expect(press('=').handled).toBe(false)
  })
})

describe('matchesShortcut', () => {
  it('matches Alt and Shift exactly when the shortcut declares them', () => {
    const nudge: Shortcut = {
      keys: ['ArrowRight'],
      alt: true,
      shift: true,
      display: 'Alt Shift →',
      description: 'Nudge',
      run: noop,
    }
    expect(
      matchesShortcut(nudge, keyEvent('ArrowRight', { altKey: true, shiftKey: true }), 'basic')
    ).toBe(true)
    expect(matchesShortcut(nudge, keyEvent('ArrowRight', { altKey: true }), 'basic')).toBe(false)
    expect(matchesShortcut(nudge, keyEvent('ArrowRight', { shiftKey: true }), 'basic')).toBe(false)
  })

  it('treats Meta like Ctrl', () => {
    const undoShortcut: Shortcut = {
      keys: ['z'],
      ctrl: true,
      display: '',
      description: '',
      run: noop,
    }
    expect(matchesShortcut(undoShortcut, keyEvent('z', { metaKey: true }), 'basic')).toBe(true)
    expect(matchesShortcut(undoShortcut, keyEvent('z'), 'basic')).toBe(false)
  })

  it('respects the mode and the when() predicate', () => {
    let canvasFocused = false
    const contextual: Shortcut = {
      keys: ['ArrowUp'],
      mode: 'advanced',
      when: () => canvasFocused,
      display: '',
      description: '',
      run: noop,
    }
    expect(matchesShortcut(contextual, keyEvent('ArrowUp'), 'basic')).toBe(false)
    expect(matchesShortcut(contextual, keyEvent('ArrowUp'), 'advanced')).toBe(false)
    canvasFocused = true
    expect(matchesShortcut(contextual, keyEvent('ArrowUp'), 'advanced')).toBe(true)
  })
})

describe('shortcutsForMode', () => {
  it('lists shared shortcuts in both modes and mode-only ones in their mode', () => {
    const basic = shortcutsForMode('basic').map((shortcut) => shortcut.description)
    const advanced = shortcutsForMode('advanced').map((shortcut) => shortcut.description)
    expect(basic).toContain('Play / Pause')
    expect(advanced).toContain('Play / Pause')
    expect(basic).not.toContain('Toggle Timeline Snapping')
    expect(advanced).toContain('Toggle Timeline Snapping')
  })
})

describe('Advanced editing shortcuts', () => {
  const clip = {
    id: 'clip-a',
    file: new File([new Uint8Array([0])], 'a.mp4'),
    name: 'a',
    duration: 2,
    width: 1280,
    height: 720,
    frameRate: 30,
    objectUrl: 'blob:a',
    waveformPeaks: new Float32Array(0),
  }

  beforeEach(() => {
    appMode.value = 'advanced'
    document.body.innerHTML = ''
    clips.value = []
    advancedSegments.value = []
    advancedTracks.value = [{ id: 'track-1', name: 'Track 1' }]
    advancedPlayhead.value = 0
    advancedCanvasFocused.value = false
    framerate.value = 'original'
    resetAdvancedClipboard()
    clearAdvancedSelection()
    resetAdvancedHistory()
  })

  it('selects all with Ctrl+A and clears with Escape', () => {
    const first = addClipToTrack(clip, 'track-1', 0)
    const second = addClipToTrack(clip, 'track-1', 2)
    expect(press('a', { ctrlKey: true }).handled).toBe(true)
    expect(advancedSelectedIds.value).toEqual([first, second])
    expect(press('Escape').handled).toBe(true)
    expect(advancedSelectedIds.value).toEqual([])
    // Nothing selected: Escape stays with the page.
    expect(press('Escape').handled).toBe(false)
  })

  it('nudges clips by a frame with Alt+Arrow and leaves Alt+Arrow alone with no selection', () => {
    addClipToTrack(clip, 'track-1', 1)
    press('ArrowRight', { altKey: true })
    expect(advancedSegments.value[0].timelineStart).toBeCloseTo(1 + 1 / 30)
    press('ArrowLeft', { altKey: true, shiftKey: true })
    expect(advancedSegments.value[0].timelineStart).toBeCloseTo(1 - 9 / 30)
    clearAdvancedSelection()
    expect(press('ArrowLeft', { altKey: true }).handled).toBe(false)
  })

  it('nudges on the canvas only while it has focus, and steps frames otherwise', () => {
    addClipToTrack(clip, 'track-1', 0)
    advancedSegments.value = advancedSegments.value.map((entry) => ({ ...entry, sourceEnd: 2 }))
    press('ArrowRight')
    expect(advancedSegments.value[0].transform.x).toBe(0)
    expect(advancedPlayhead.value).toBeCloseTo(1 / 30)
    advancedCanvasFocused.value = true
    press('ArrowRight')
    press('ArrowDown', { shiftKey: true })
    expect(advancedSegments.value[0].transform).toMatchObject({ x: 1, y: 10 })
    expect(advancedPlayhead.value).toBeCloseTo(1 / 30)
  })

  it('duplicates, copies, and pastes the selection', () => {
    addClipToTrack(clip, 'track-1', 0)
    press('d', { ctrlKey: true })
    expect(advancedSegments.value.map((entry) => entry.timelineStart)).toEqual([0, 2])
    press('c', { ctrlKey: true })
    advancedPlayhead.value = 3
    press('v', { ctrlKey: true })
    expect(advancedSegments.value.map((entry) => entry.timelineStart)).toEqual([0, 2, 3])
  })

  it('ripple deletes with Shift+Delete', () => {
    const first = addClipToTrack(clip, 'track-1', 0)
    addClipToTrack(clip, 'track-1', 2)
    setAdvancedSelection([first])
    press('Delete', { shiftKey: true })
    expect(advancedSegments.value.map((entry) => entry.timelineStart)).toEqual([0])
  })
})
