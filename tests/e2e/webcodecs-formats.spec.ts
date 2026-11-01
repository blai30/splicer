import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

const fixture = fileURLToPath(new URL('../fixtures/tiny.mp4', import.meta.url))

// Each case re-encodes through the WebCodecs/mediabunny engine.
const cases: { format: string; ext: string; codec?: string }[] = [
  { format: 'MP4', ext: 'mp4' },
  { format: 'MOV', ext: 'mov' },
  { format: 'MKV', ext: 'mkv' }, // default codec: H.264
  { format: 'MKV', ext: 'mkv', codec: 'VP9' },
]

for (const { format, ext, codec } of cases) {
  const label = codec ? `${format} (${codec})` : format
  test(`exports ${label} via the WebCodecs engine`, async ({ page }) => {
    await page.goto('/splicer/')
    await page.locator('input[type="file"]').setInputFiles(fixture)

    await page.getByRole('radio', { name: new RegExp(`^${format}$`) }).click()
    await page.getByRole('radio', { name: /^High$/ }).click()
    if (codec) {
      await page.getByRole('radio', { name: new RegExp(`^${codec}$`) }).click()
    }

    const exportButton = page.getByRole('button', { name: /export video/i })
    await expect(exportButton).toBeVisible()
    await exportButton.click()

    await expect(
      page.getByRole('link', { name: new RegExp(`\\.${ext}`, 'i') }).first()
    ).toBeVisible({ timeout: 60_000 })
  })
}
