import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

const fixture = fileURLToPath(new URL('../fixtures/tiny.mp4', import.meta.url))

test('places two clips and exports the multi-track composition', async ({ page }) => {
  await page.goto('/splicer/')
  await page.getByRole('tab', { name: 'Advanced' }).click()
  await page.getByRole('button', { name: '720p' }).click()

  // Add a second track and import two clips.
  // Wait between imports so the first async import completes and the file
  // input's value is cleared before the second setInputFiles call.
  await page.getByRole('button', { name: 'Add track' }).click()
  await page.locator('input[type="file"]').setInputFiles(fixture)
  await expect(page.locator('[data-advanced-segment]')).toHaveCount(1)
  await page.locator('input[type="file"]').setInputFiles(fixture)

  // Two segment blocks exist on the timeline.
  await expect(page.locator('[data-advanced-segment]')).toHaveCount(2)

  // Export the composition.
  const exportButton = page.getByRole('button', { name: /export video/i })
  await expect(exportButton).toBeEnabled()
  await exportButton.click()
  await expect(page.getByRole('link', { name: /\.mp4/i }).first()).toBeVisible({ timeout: 90_000 })
})
