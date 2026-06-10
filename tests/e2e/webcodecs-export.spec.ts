import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

const fixture = fileURLToPath(new URL('../fixtures/tiny.mp4', import.meta.url))

test('exports WebM via the WebCodecs engine', async ({ page }) => {
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles(fixture)

  // Select WebM output.
  await page.getByRole('button', { name: /^WebM$/ }).click()

  const exportButton = page.getByRole('button', { name: /export video/i })
  await expect(exportButton).toBeVisible()
  await exportButton.click()

  // A downloadable .webm link should appear, and the WebCodecs badge confirms
  // the engine.
  await expect(page.getByRole('link', { name: /\.webm/i }).first()).toBeVisible({
    timeout: 60_000,
  })
  await expect(page.getByText('WebCodecs')).toBeVisible()
})

test('falls back to ffmpeg when WebCodecs is forced off', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('splicer_force_ffmpeg', '1')
  })
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles(fixture)

  // MP4 at High quality would normally route to WebCodecs (it is a re-encode,
  // not a lossless stream copy), so forcing ffmpeg here genuinely exercises the
  // fallback. libx264 in wasm handles this combo where lossless VP9 WebM OOMs.
  await page.getByRole('button', { name: /^MP4$/ }).click()
  await page.getByRole('button', { name: /^High$/ }).click()

  const exportButton = page.getByRole('button', { name: /export video/i })
  await expect(exportButton).toBeVisible()
  await exportButton.click()

  // The export still completes, produced by ffmpeg (no WebCodecs badge).
  await expect(page.getByRole('link', { name: /\.mp4/i }).first()).toBeVisible({
    timeout: 120_000,
  })
  await expect(page.getByText('WebCodecs')).toHaveCount(0)
})
