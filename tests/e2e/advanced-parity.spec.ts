import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

const fixture = fileURLToPath(new URL('../fixtures/tiny.mp4', import.meta.url))

test('advanced timeline supports cut and renders waveform segment blocks', async ({ page }) => {
  await page.goto('/splicer/')
  await page.getByRole('tab', { name: 'Advanced' }).click()
  await page.getByRole('button', { name: '720p' }).click()

  await page.locator('input[type="file"]').setInputFiles(fixture)
  await expect(page.locator('[data-advanced-segment]')).toHaveCount(1)

  // The segment block renders an audio waveform canvas (Basic-style block).
  await expect(page.locator('[data-advanced-segment] canvas')).toHaveCount(1)

  // Select the clip, then move the playhead into it via the seek bar.
  await page.locator('[data-advanced-segment]').click()
  await expect(page.locator('[data-advanced-playhead]')).toBeVisible()
  await page.getByRole('button', { name: 'Seek' }).click({ position: { x: 50, y: 2 } })

  // The Cut button's accessible name comes from its aria-label.
  const cutButton = page.getByRole('button', { name: /split clip at current playhead/i })
  await expect(cutButton).toBeEnabled()
  await cutButton.click()

  // Cutting splits the selected clip into two blocks.
  await expect(page.locator('[data-advanced-segment]')).toHaveCount(2)
})

test('advanced timeline cut can be undone and redone', async ({ page }) => {
  await page.goto('/splicer/')
  await page.getByRole('tab', { name: 'Advanced' }).click()
  await page.getByRole('button', { name: '720p' }).click()
  await page.locator('input[type="file"]').setInputFiles(fixture)
  await expect(page.locator('[data-advanced-segment]')).toHaveCount(1)

  await page.locator('[data-advanced-segment]').click()
  await page.getByRole('button', { name: 'Seek' }).click({ position: { x: 50, y: 2 } })
  await page.getByRole('button', { name: /split clip at current playhead/i }).click()
  await expect(page.locator('[data-advanced-segment]')).toHaveCount(2)

  await page.keyboard.press('Control+z')
  await expect(page.locator('[data-advanced-segment]')).toHaveCount(1)

  await page.keyboard.press('Control+y')
  await expect(page.locator('[data-advanced-segment]')).toHaveCount(2)
})

test('track header row aligns vertically with its lane', async ({ page }) => {
  await page.goto('/splicer/')
  await page.getByRole('tab', { name: 'Advanced' }).click()
  await page.getByRole('button', { name: '720p' }).click()
  await page.locator('input[type="file"]').setInputFiles(fixture)
  await expect(page.locator('[data-advanced-segment]')).toHaveCount(1)

  // The "Track 1" header label is centered in its header row; the clip block is
  // centered in its lane. With aligned geometry their vertical centers match.
  const header = await page.getByText('Track 1').boundingBox()
  const block = await page.locator('[data-advanced-segment]').first().boundingBox()
  const headerCenter = (header?.y ?? 0) + (header?.height ?? 0) / 2
  const blockCenter = (block?.y ?? 0) + (block?.height ?? 0) / 2
  expect(Math.abs(headerCenter - blockCenter)).toBeLessThan(6)
})

test('advanced timeline zoom buttons change clip width', async ({ page }) => {
  await page.goto('/splicer/')
  await page.getByRole('tab', { name: 'Advanced' }).click()
  await page.getByRole('button', { name: '720p' }).click()
  await page.locator('input[type="file"]').setInputFiles(fixture)
  await expect(page.locator('[data-advanced-segment]')).toHaveCount(1)

  const block = page.locator('[data-advanced-segment]').first()
  const before = (await block.boundingBox())?.width ?? 0
  // Scope to the timeline; the preview stage also has Zoom in/out controls.
  const timeline = page
    .locator('div:has([data-advanced-segment])')
    .filter({ hasText: 'Tracks' })
    .last()
  await timeline.getByTitle('Zoom in').click()
  await timeline.getByTitle('Zoom in').click()
  const after = (await block.boundingBox())?.width ?? 0
  expect(after).toBeGreaterThan(before)
})
