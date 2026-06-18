import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

const fixture = fileURLToPath(new URL('../fixtures/tiny.mp4', import.meta.url))

test('Auto canvas locks the size inputs and tracks placed content', async ({ page }) => {
  await page.goto('/splicer/')
  await page.getByRole('tab', { name: 'Advanced' }).click()
  await page.getByRole('button', { name: '720p' }).click()
  await page.locator('input[type="file"]').setInputFiles(fixture)

  const widthInput = page.getByLabel('Canvas width')
  const heightInput = page.getByLabel('Canvas height')

  // A fixed preset leaves the inputs editable.
  await expect(widthInput).toBeEnabled()
  await expect(widthInput).toHaveValue('1280')

  // Turning Auto on locks both inputs; they now mirror the derived output size.
  await page.getByRole('button', { name: 'Auto', exact: true }).click()
  await expect(widthInput).toBeDisabled()
  await expect(heightInput).toBeDisabled()

  // A disabled field cannot be focused, so clicking it and away leaves Auto on
  // (the width input stays disabled because Auto is still active).
  await widthInput.click({ force: true })
  await page.getByText('Canvas', { exact: true }).first().click()
  await expect(widthInput).toBeDisabled()

  // Picking a preset again turns Auto off and restores manual editing.
  await page.getByRole('button', { name: '720p' }).click()
  await expect(widthInput).toBeEnabled()
  await expect(widthInput).toHaveValue('1280')

  // Export under Auto still produces a downloadable file.
  await page.getByRole('button', { name: 'Auto', exact: true }).click()
  await page.getByRole('button', { name: /export video/i }).click()
  await expect(page.getByRole('link', { name: /\.mp4/i }).first()).toBeVisible({ timeout: 90_000 })
})
