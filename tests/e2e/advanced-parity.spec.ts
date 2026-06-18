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

test('advanced timeline zoom buttons change clip width', async ({ page }) => {
  await page.goto('/splicer/')
  await page.getByRole('tab', { name: 'Advanced' }).click()
  await page.getByRole('button', { name: '720p' }).click()
  await page.locator('input[type="file"]').setInputFiles(fixture)
  await expect(page.locator('[data-advanced-segment]')).toHaveCount(1)

  const block = page.locator('[data-advanced-segment]').first()
  const before = (await block.boundingBox())?.width ?? 0
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await page.getByRole('button', { name: 'Zoom in' }).click()
  const after = (await block.boundingBox())?.width ?? 0
  expect(after).toBeGreaterThan(before)
})
