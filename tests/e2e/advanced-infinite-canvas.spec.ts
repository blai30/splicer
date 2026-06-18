import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

const fixture = fileURLToPath(new URL('../fixtures/tiny.mp4', import.meta.url))

test('infinite canvas: pan/zoom controls and output sizing', async ({ page }) => {
  await page.goto('/splicer/')
  await page.getByRole('tab', { name: 'Advanced' }).click()
  await page.locator('input[type="file"]').setInputFiles(fixture)

  // The clip is placed and auto-selected; the preview canvas is present.
  await expect(page.locator('[data-canvas-wrapper] canvas')).toBeVisible()
  await expect(page.locator('[data-canvas-wrapper] .border-violet-400').first()).toBeVisible()

  // Scope to the preview stage (the timeline has its own zoom controls).
  const stage = page.locator('div:has(> [data-canvas-wrapper])')

  // Fit-to-content shows a zoom readout.
  await stage.getByTitle('Fit to content').click()
  const zoomReadout = stage.getByText(/^\d+%$/)
  await expect(zoomReadout).toBeVisible()

  // Zooming in increases the zoom percentage.
  const before = Number.parseInt((await zoomReadout.textContent()) ?? '0', 10)
  await stage.getByTitle('Zoom in').click()
  const after = Number.parseInt((await zoomReadout.textContent()) ?? '0', 10)
  expect(after).toBeGreaterThan(before)

  // In Auto, the export output is the bounding box of placed clips (WxH).
  await expect(page.getByText(/Output:\s*\d+x\d+/)).toBeVisible()

  // Locking a preset size makes the output exactly that size.
  await page.getByRole('button', { name: '720p' }).click()
  await expect(page.getByText(/Output:\s*1280x720/)).toBeVisible()
})
