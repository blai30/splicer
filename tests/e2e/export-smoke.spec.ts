import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

// Imports a tiny clip, exports MP4 (stream-copy, fast and deterministic), and
// asserts a downloadable record appears. Heavy WebM is excluded from CI.
test('imports a clip and exports MP4', async ({ page }) => {
  await page.goto('/splicer/')

  const fixture = fileURLToPath(new URL('../fixtures/tiny.mp4', import.meta.url))
  // The import input is always present but visually hidden.
  await page.locator('input[type="file"]').setInputFiles(fixture)

  // The export panel only renders once a segment exists on the timeline.
  const exportButton = page.getByRole('button', { name: /export video/i })
  await expect(exportButton).toBeVisible()

  await exportButton.click()

  // The export library should gain a downloadable .mp4 link.
  await expect(page.getByRole('link', { name: /\.mp4/i }).first()).toBeVisible({
    timeout: 60_000,
  })

  // Default quality is lossless on a same-container trim, so this must route to
  // the ffmpeg stream-copy fast path, not a WebCodecs re-encode.
  await expect(page.getByText('WebCodecs')).toHaveCount(0)
})
