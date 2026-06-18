import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

const fixture = fileURLToPath(new URL('../fixtures/tiny.mp4', import.meta.url))

test('advanced mode places a clip on the canvas and sets resolution', async ({ page }) => {
  await page.goto('/splicer/')
  await page.getByRole('tab', { name: 'Advanced' }).click()

  // Canvas controls are visible; pick a preset.
  await page.getByRole('button', { name: '720p' }).click()
  await expect(page.getByLabel('Canvas width')).toHaveValue('1280')

  // Import a clip into the Advanced project.
  await page.locator('input[type="file"]').setInputFiles(fixture)

  // The preview canvas and transport controls appear.
  await expect(page.locator('canvas')).toBeVisible()
  await expect(page.getByText(/Tracks/i)).toBeVisible()
})
