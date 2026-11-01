import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

const fixture = fileURLToPath(new URL('../fixtures/tiny.mp4', import.meta.url))

test('exports WebM via the WebCodecs engine', async ({ page }) => {
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles(fixture)

  // Select WebM output.
  await page.getByRole('radio', { name: /^WebM$/ }).click()

  const exportButton = page.getByRole('button', { name: /export video/i })
  await expect(exportButton).toBeVisible()
  await exportButton.click()

  // A downloadable .webm link should appear.
  await expect(page.getByRole('link', { name: /\.webm/i }).first()).toBeVisible({
    timeout: 60_000,
  })
})
