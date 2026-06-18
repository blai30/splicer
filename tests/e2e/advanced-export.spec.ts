import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

const fixture = fileURLToPath(new URL('../fixtures/tiny.mp4', import.meta.url))

test('exports the advanced composition to a downloadable file', async ({ page }) => {
  await page.goto('/splicer/')
  await page.getByRole('tab', { name: 'Advanced' }).click()

  // Pick a small canvas for a fast encode, then add a clip.
  await page.getByRole('button', { name: '720p' }).click()
  await page.locator('input[type="file"]').setInputFiles(fixture)
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible()

  // Default format is MP4; export the composition.
  const exportButton = page.getByRole('button', { name: /export video/i })
  await expect(exportButton).toBeEnabled()
  await exportButton.click()

  // A downloadable .mp4 appears in the export history.
  await expect(page.getByRole('link', { name: /\.mp4/i }).first()).toBeVisible({ timeout: 60_000 })
})
