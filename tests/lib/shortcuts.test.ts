// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'

import { handleShortcut } from '@/lib/shortcuts'
import { appMode, pxPerSec } from '@/lib/store'

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

  it('ignores Alt combinations (browser navigation)', () => {
    expect(press('ArrowLeft', { altKey: true }).handled).toBe(false)
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
