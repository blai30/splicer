import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))
const tiny = fixture('tiny.mp4')
const tall = fixture('tall-silent.mp4')
const wide = fixture('wide-stereo48k.mp4')

test('Basic segments form a listbox with one tab stop on the selection', async ({ page }) => {
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles([tiny, tall, wide])
  const listbox = page.getByRole('listbox', { name: 'Segments' })
  const options = listbox.getByRole('option')
  await expect(options).toHaveCount(3)
  await expect(page.locator('[data-segment][tabindex="0"]')).toHaveCount(1)
  await expect(options.first()).toHaveAccessibleName(/^tiny, /)

  // Tab reaches the selected block from the zoom input just before it.
  await options.first().click()
  await expect(options.first()).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('spinbutton', { name: /zoom level/i }).focus()
  await page.keyboard.press('Tab')
  await expect(options.first()).toBeFocused()

  // Arrows move the selection and the focus together.
  await page.keyboard.press('ArrowRight')
  await expect(options.nth(1)).toBeFocused()
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(options.first()).toHaveAttribute('aria-selected', 'false')
  await expect(page.locator('[data-segment][tabindex="0"]')).toHaveAttribute(
    'aria-label',
    /^tall-silent, /
  )

  // Alt+Arrow reorders the focused block and keeps it focused.
  await page.keyboard.press('Alt+ArrowLeft')
  await expect(options.first()).toHaveAccessibleName(/^tall-silent, /)
  await expect(options.first()).toBeFocused()

  // Delete removes it and hands focus to the block that took its place.
  await page.keyboard.press('Delete')
  await expect(options).toHaveCount(2)
  await expect(options.first()).toHaveAccessibleName(/^tiny, /)
  await expect(options.first()).toBeFocused()
})

test('a pointer click on a Basic segment leaves arrow keys stepping frames', async ({ page }) => {
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles([tiny, tall])
  const options = page.getByRole('listbox', { name: 'Segments' }).getByRole('option')
  await expect(options).toHaveCount(2)
  await options.first().click({ position: { x: 20, y: 30 } })
  await expect(options.first()).not.toBeFocused()

  const playhead = page.getByRole('slider', { name: 'Playhead' })
  const before = Number(await playhead.getAttribute('aria-valuenow'))
  await page.keyboard.press('ArrowRight')
  await expect(options.first()).toHaveAttribute('aria-selected', 'true')
  await expect
    .poll(async () => Number(await playhead.getAttribute('aria-valuenow')))
    .toBeGreaterThan(before)
})

test('the Basic playhead is a keyboard slider', async ({ page }) => {
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles([tiny, tall])
  await expect(page.locator('[data-segment]')).toHaveCount(2)
  const playhead = page.getByRole('slider', { name: 'Playhead' })
  await expect(playhead).toHaveAttribute('aria-valuenow', '0')
  const max = Number(await playhead.getAttribute('aria-valuemax'))
  expect(max).toBeGreaterThan(1)

  await playhead.focus()
  await page.keyboard.press('Shift+ArrowRight')
  await expect(playhead).toHaveAttribute('aria-valuenow', '1')
  await expect(playhead).toHaveAttribute('aria-valuetext', /of/)
  await page.keyboard.press('End')
  await expect
    .poll(async () => Number(await playhead.getAttribute('aria-valuenow')))
    .toBeCloseTo(max, 1)
  await page.keyboard.press('Home')
  await expect(playhead).toHaveAttribute('aria-valuenow', '0')
})

test('Advanced clips are reachable and editable from the keyboard', async ({ page }) => {
  await page.goto('/splicer/')
  await page.getByRole('tab', { name: 'Advanced' }).click()
  await page.locator('input[type="file"]').setInputFiles([tiny, tall])
  const lane = page.getByRole('listbox', { name: 'Track 1 clips' })
  const clips = lane.getByRole('option')
  await expect(clips).toHaveCount(2)
  await expect(page.locator('[data-advanced-segment][tabindex="0"]')).toHaveCount(1)

  await clips.first().focus()
  await page.keyboard.press('Enter')
  await expect(clips.first()).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowRight')
  await expect(clips.nth(1)).toBeFocused()
  await expect(clips.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(clips.first()).toHaveAttribute('aria-selected', 'false')

  // Shift+Arrow extends the selection.
  await page.keyboard.press('Shift+ArrowLeft')
  await expect(clips.first()).toBeFocused()
  await expect(clips.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(clips.first()).toHaveAttribute('aria-selected', 'true')

  // Enter narrows it back to the focused clip; Delete removes it and the
  // remaining clip takes the focus.
  await page.keyboard.press('Enter')
  await expect(clips.nth(1)).toHaveAttribute('aria-selected', 'false')
  await page.keyboard.press('Delete')
  await expect(clips).toHaveCount(1)
  await expect(clips.first()).toBeFocused()
  await expect(clips.first()).toHaveAccessibleName(/^tall-silent, /)
})

test('the Advanced seek bar and playhead are keyboard sliders', async ({ page }) => {
  await page.goto('/splicer/')
  await page.getByRole('tab', { name: 'Advanced' }).click()
  const seekBar = page.getByRole('slider', { name: 'Seek' })
  await expect(seekBar).toHaveAttribute('aria-disabled', 'true')
  await page.locator('input[type="file"]').setInputFiles(tiny)
  await expect(seekBar).toHaveAttribute('aria-disabled', 'false')

  const max = Number(await seekBar.getAttribute('aria-valuemax'))
  await seekBar.focus()
  await page.keyboard.press('End')
  await expect
    .poll(async () => Number(await seekBar.getAttribute('aria-valuenow')))
    .toBeCloseTo(max, 1)
  const playhead = page.getByRole('slider', { name: 'Playhead' })
  await expect
    .poll(async () => Number(await playhead.getAttribute('aria-valuenow')))
    .toBeCloseTo(max, 1)

  await playhead.focus()
  await page.keyboard.press('Home')
  await expect(seekBar).toHaveAttribute('aria-valuenow', '0')
  await page.keyboard.press('ArrowRight')
  await expect
    .poll(async () => Number(await playhead.getAttribute('aria-valuenow')))
    .toBeGreaterThan(0)
})
