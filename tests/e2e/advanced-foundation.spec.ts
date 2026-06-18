import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

const fixture = fileURLToPath(new URL('../fixtures/tiny.mp4', import.meta.url))

test('advanced mode places a clip on the canvas and sets resolution', async ({ page }) => {
  await page.goto('/splicer/')
  await page.getByRole('tab', { name: 'Advanced' }).click()

  // Output controls are visible; lock a preset size.
  await page.getByRole('button', { name: '720p' }).click()
  await expect(page.getByLabel('Output width')).toHaveValue('1280')

  // Import a clip into the Advanced project.
  await page.locator('input[type="file"]').setInputFiles(fixture)

  // The preview canvas and transport controls appear.
  await expect(page.locator('[data-canvas-wrapper] canvas')).toBeVisible()
  await expect(page.getByText(/Tracks/i)).toBeVisible()
})
