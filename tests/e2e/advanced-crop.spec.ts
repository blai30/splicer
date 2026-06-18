import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

const fixture = fileURLToPath(new URL('../fixtures/tiny.mp4', import.meta.url))

test('crop clips the box edge instead of stretching the video', async ({ page }) => {
  await page.goto('/splicer/')
  await page.getByRole('tab', { name: 'Advanced' }).click()
  await page.getByRole('button', { name: '720p' }).click()
  await page.locator('input[type="file"]').setInputFiles(fixture)

  // Enter crop mode; the crop box uses an amber dashed border.
  await page.getByRole('button', { name: 'Crop' }).click()
  const box = page.locator('[data-canvas-wrapper] .border-amber-400').first()
  await expect(box).toBeVisible()

  const before = await box.boundingBox()
  // Drag the east (right-middle) handle inward.
  const handleX = before!.x + before!.width
  const handleY = before!.y + before!.height / 2
  await page.mouse.move(handleX, handleY)
  await page.mouse.down()
  await page.mouse.move(handleX - 80, handleY, { steps: 6 })
  await page.mouse.up()

  const after = await box.boundingBox()
  // True crop: the box narrows and its left edge stays put (no stretch/zoom).
  expect(after!.width).toBeLessThan(before!.width - 20)
  expect(Math.abs(after!.x - before!.x)).toBeLessThan(3)
})
