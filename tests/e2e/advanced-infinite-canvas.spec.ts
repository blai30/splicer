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

test('drag the bottom handle to grow the work area vertically', async ({ page }) => {
  await page.goto('/splicer/')
  await page.getByRole('tab', { name: 'Advanced' }).click()
  await page.locator('input[type="file"]').setInputFiles(fixture)

  const wrapper = page.locator('[data-canvas-wrapper]')
  const before = (await wrapper.boundingBox())?.height ?? 0

  // Hover the handle first so it is scrolled into view, then drag it down.
  const handle = page.getByTitle('Drag to resize the work area')
  await handle.hover({ force: true })
  const handleBox = await handle.boundingBox()
  const startX = handleBox!.x + handleBox!.width / 2
  const startY = handleBox!.y + handleBox!.height / 2
  await page.mouse.down()
  await page.mouse.move(startX, startY + 150, { steps: 6 })
  await page.mouse.up()

  const after = (await wrapper.boundingBox())?.height ?? 0
  expect(after).toBeGreaterThan(before + 100)
})

test('panning the canvas moves the dot grid with the content', async ({ page }) => {
  await page.goto('/splicer/')
  await page.getByRole('tab', { name: 'Advanced' }).click()
  await page.locator('input[type="file"]').setInputFiles(fixture)

  const stage = page.locator('div:has(> [data-canvas-wrapper])')
  await stage.scrollIntoViewIfNeeded()
  const wrapperBox = (await page.locator('[data-canvas-wrapper]').boundingBox())!
  const before = await stage.evaluate((el) => (el as HTMLElement).style.backgroundPosition)

  // Pan by dragging an empty corner of the canvas (outside the centered clip).
  await page.mouse.move(wrapperBox.x + 6, wrapperBox.y + 6)
  await page.mouse.down()
  await page.mouse.move(wrapperBox.x + 140, wrapperBox.y + 110, { steps: 6 })
  await page.mouse.up()

  const after = await stage.evaluate((el) => (el as HTMLElement).style.backgroundPosition)
  expect(after).not.toBe(before)
})
