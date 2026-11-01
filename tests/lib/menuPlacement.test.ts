import { describe, expect, it } from 'vitest'

import { placeMenu } from '@/lib/menuPlacement'

const viewport = { width: 800, height: 600 }
const menu = { width: 200, height: 260 }

describe('placeMenu', () => {
  it('opens below and right of the pointer when it fits', () => {
    expect(placeMenu({ x: 100, y: 100 }, menu, viewport)).toEqual({ left: 100, top: 100 })
  })

  it('flips left and up near the right and bottom edges', () => {
    expect(placeMenu({ x: 750, y: 550 }, menu, viewport)).toEqual({ left: 550, top: 290 })
  })

  it('stays inside the margins when it fits neither way', () => {
    const tall = { width: 200, height: 590 }
    expect(placeMenu({ x: 4, y: 300 }, tall, viewport).top).toBe(8)
    expect(placeMenu({ x: 4, y: 300 }, tall, viewport).left).toBe(8)
  })
})
