import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

const fixture = fileURLToPath(new URL('../fixtures/tiny.mp4', import.meta.url))

test('selects a clip on the canvas and moves it', async ({ page }) => {
  await page.goto('/splicer/')
  await page.getByRole('tab', { name: 'Advanced' }).click()
  await page.getByRole('button', { name: '720p' }).click()
  await page.locator('input[type="file"]').setInputFiles(fixture)

  // The selection box appears for the placed (auto-selected) clip.
  const box = page.locator('[data-canvas-wrapper] .border-violet-400').first()
  await expect(box).toBeVisible()

  // Drag the box body to move it; its left offset should change.
  const before = await box.boundingBox()
  await box.hover({ position: { x: 20, y: 20 } })
  await page.mouse.down()
  await page.mouse.move(before!.x + 20 - 80, before!.y + 20, { steps: 5 })
  await page.mouse.up()
  const after = await box.boundingBox()
  expect(after!.x).not.toBe(before!.x)

  // The z-order toolbar is enabled with a clip selected.
  await expect(page.getByRole('button', { name: 'Front' })).toBeEnabled()

  // Export still produces a downloadable file with the edited transform.
  await page.getByRole('button', { name: /export video/i }).click()
  await expect(page.getByRole('link', { name: /\.mp4/i }).first()).toBeVisible({ timeout: 90_000 })
})
