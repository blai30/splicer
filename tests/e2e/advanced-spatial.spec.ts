import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

const fixture = fileURLToPath(new URL('../fixtures/tiny.mp4', import.meta.url))

test('selects a clip on the canvas and moves it', async ({ page }) => {
  await page.goto('/splicer/')
  await page.getByRole('tab', { name: 'Advanced' }).click()
  await page.getByRole('button', { name: '720p' }).click()
  await page.locator('input[type="file"]').setInputFiles(fixture)

  // The selection box appears for the placed (auto-selected) clip.
  const box = page.locator('[data-canvas-wrapper] .border-violet-400').first()
  await expect(box).toBeVisible()

  // Drag the box body to move it; its left offset should change.
  const before = await box.boundingBox()
  await box.hover({ position: { x: 20, y: 20 } })
  await page.mouse.down()
  await page.mouse.move(before!.x + 20 - 80, before!.y + 20, { steps: 5 })
  await page.mouse.up()
  const after = await box.boundingBox()
  expect(after!.x).not.toBe(before!.x)

  // The z-order toolbar is enabled with a clip selected.
  await expect(page.getByRole('button', { name: 'Front' })).toBeEnabled()

  // Export still produces a downloadable file with the edited transform.
  await page.getByRole('button', { name: /export video/i }).click()
  await expect(page.getByRole('link', { name: /\.mp4/i }).first()).toBeVisible({ timeout: 90_000 })
})

test('pressing an unselected clip selects and moves it in one gesture', async ({ page }) => {
  await page.goto('/splicer/')
  await page.getByRole('tab', { name: 'Advanced' }).click()
  await page.getByRole('button', { name: '720p' }).click()
  await page.locator('input[type="file"]').setInputFiles(fixture)

  const wrapper = page.locator('[data-canvas-wrapper]')
  const box = page.locator('[data-canvas-wrapper] .border-violet-400').first()
  // The clip is auto-selected on add; record its position before deselecting.
  await expect(box).toBeVisible()
  await wrapper.scrollIntoViewIfNeeded()
  const beforeBox = (await box.boundingBox())!
  const wrapperBox = (await wrapper.boundingBox())!

  // Deselect by clicking an empty corner of the canvas (outside the clip).
  await page.mouse.click(wrapperBox.x + 6, wrapperBox.y + 6)
  await expect(box).toHaveCount(0)

  // Press on the clip body and drag in a single gesture (no prior selecting click).
  const centerX = wrapperBox.x + wrapperBox.width / 2
  const centerY = wrapperBox.y + wrapperBox.height / 2
  await page.mouse.move(centerX, centerY)
  await page.mouse.down()
  await page.mouse.move(centerX - 120, centerY, { steps: 6 })
  await page.mouse.up()

  // The clip is now selected (box reappears) and moved left in that one gesture.
  await expect(box).toBeVisible()
  const afterBox = (await box.boundingBox())!
  expect(afterBox.x).toBeLessThan(beforeBox.x - 40)
})
