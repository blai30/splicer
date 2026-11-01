// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'

import { handleShortcut, matchesShortcut, shortcutsForMode, type Shortcut } from '@/lib/shortcuts'
import { advancedSnapEnabled, appMode, pxPerSec } from '@/lib/store'

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

  it('zooms with = and -', () => {
    press('=')
    expect(pxPerSec.value).toBe(90)
    press('-')
    expect(pxPerSec.value).toBe(80)
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
    expect(press('ArrowRight', { shiftKey: true }).handled).toBe(false)
  })

  it('ignores Shift on symbol keys whose character already encodes it', () => {
    press('+', { shiftKey: true })
    expect(pxPerSec.value).toBe(90)
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
