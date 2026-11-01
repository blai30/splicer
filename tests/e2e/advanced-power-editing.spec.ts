import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

const fixture = fileURLToPath(new URL('../fixtures/tiny.mp4', import.meta.url))

const blocks = (page: Page) => page.locator('[data-advanced-segment]')
const selectedBlocks = (page: Page) => page.locator('[data-advanced-segment][data-selected]')

async function openAdvanced(page: Page) {
  await page.goto('/splicer/')
  await page.getByRole('tab', { name: 'Advanced' }).click()
  await page.getByRole('button', { name: '720p' }).click()
}

async function importClip(page: Page, expectedCount: number) {
  await page.locator('input[type="file"]').setInputFiles(fixture)
  await expect(blocks(page)).toHaveCount(expectedCount)
}

// Raw page.mouse uses viewport coordinates and does not auto-scroll.
async function showTimeline(page: Page) {
  await page.locator('[data-advanced-scroller]').scrollIntoViewIfNeeded()
}

// One clip on Track 1 at 0s and one on a new top track at 0s.
async function twoClipsOnTwoTracks(page: Page) {
  await openAdvanced(page)
  await importClip(page, 1)
  await page.getByRole('button', { name: 'Add track' }).click()
  await importClip(page, 2)
  await showTimeline(page)
  return { top: blocks(page).nth(0), bottom: blocks(page).nth(1) }
}

test('Ctrl-click builds a selection that moves together and deletes together', async ({ page }) => {
  const { top, bottom } = await twoClipsOnTwoTracks(page)
  await top.click()
  await bottom.click({ modifiers: ['Control'] })
  await expect(selectedBlocks(page)).toHaveCount(2)
  await expect(page.locator('[data-advanced-selection-count]')).toHaveText('2 selected')

  const topBefore = (await top.boundingBox())!
  const bottomBefore = (await bottom.boundingBox())!
  // Alt places freely, so the move is exactly the pointer travel.
  await page.keyboard.down('Alt')
  await page.mouse.move(topBefore.x + topBefore.width / 2, topBefore.y + topBefore.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    topBefore.x + topBefore.width / 2 + 60,
    topBefore.y + topBefore.height / 2,
    {
      steps: 8,
    }
  )
  // The other selected clip follows the preview before the drop.
  await expect
    .poll(async () => (await bottom.boundingBox())!.x)
    .toBeGreaterThan(bottomBefore.x + 40)
  await page.mouse.up()
  await page.keyboard.up('Alt')

  const topAfter = (await top.boundingBox())!
  const bottomAfter = (await bottom.boundingBox())!
  expect(topAfter.x - topBefore.x).toBeGreaterThan(50)
  expect(Math.abs(topAfter.x - topBefore.x - (bottomAfter.x - bottomBefore.x))).toBeLessThan(1)
  // Both stay on their own lanes.
  expect(Math.abs(topAfter.y - topBefore.y)).toBeLessThan(1)
  expect(Math.abs(bottomAfter.y - bottomBefore.y)).toBeLessThan(1)

  // One undo puts the whole group back.
  await page.getByRole('button', { name: 'Undo' }).click()
  expect(Math.abs((await top.boundingBox())!.x - topBefore.x)).toBeLessThan(1)
  expect(Math.abs((await bottom.boundingBox())!.x - bottomBefore.x)).toBeLessThan(1)

  await page.getByRole('button', { name: 'Delete the selected clips' }).click()
  await expect(blocks(page)).toHaveCount(0)
})

test('Shift-drag on empty lanes draws a marquee, Escape clears, Ctrl+A selects all', async ({
  page,
}) => {
  const { top } = await twoClipsOnTwoTracks(page)
  await page.keyboard.press('Escape')
  await expect(selectedBlocks(page)).toHaveCount(0)

  // From empty space right of the clips, sweep left across both lanes.
  const box = (await top.boundingBox())!
  const lanes = (await page.locator('[data-advanced-lanes]').boundingBox())!
  const startX = box.x + box.width + 40
  await page.keyboard.down('Shift')
  await page.mouse.move(startX, lanes.y + 4)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, lanes.y + lanes.height - 4, { steps: 6 })
  await expect(page.locator('[data-advanced-marquee]')).toBeVisible()
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await expect(page.locator('[data-advanced-marquee]')).toHaveCount(0)
  await expect(selectedBlocks(page)).toHaveCount(2)

  await page.keyboard.press('Escape')
  await expect(selectedBlocks(page)).toHaveCount(0)
  await page.keyboard.press('Control+a')
  await expect(selectedBlocks(page)).toHaveCount(2)
})

test('the clip menu duplicates, and overlapping clips on a track are hatched', async ({ page }) => {
  await openAdvanced(page)
  await importClip(page, 1)
  await showTimeline(page)
  const first = blocks(page).first()
  await first.click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Clip actions' })
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Duplicate' }).click()
  await expect(blocks(page)).toHaveCount(2)
  const original = (await first.boundingBox())!
  const copy = (await blocks(page).nth(1).boundingBox())!
  // Right after the original on the same track.
  expect(Math.abs(copy.x - (original.x + original.width))).toBeLessThan(1)
  expect(Math.abs(copy.y - original.y)).toBeLessThan(1)
  await expect(page.locator('[data-advanced-overlap]')).toHaveCount(0)

  // Copy, then paste at the playhead (0s) on the same track: it overlaps.
  await page.keyboard.press('Control+c')
  await page.keyboard.press('Home')
  await page.keyboard.press('Control+v')
  await expect(blocks(page)).toHaveCount(3)
  await expect(page.locator('[data-advanced-overlap]')).toHaveCount(1)

  // Ripple delete the pasted clip from its menu: the overlap goes away.
  await page.keyboard.press('Shift+Delete')
  await expect(blocks(page)).toHaveCount(2)
  await expect(page.locator('[data-advanced-overlap]')).toHaveCount(0)
})

test('a track renames in place and becomes the paste target', async ({ page }) => {
  await openAdvanced(page)
  await importClip(page, 1)
  await page.getByRole('button', { name: 'Add track' }).click()
  const nameButton = page.getByRole('button', { name: /^Track 2, active track/ })
  await expect(nameButton).toBeVisible()
  await nameButton.dblclick()
  const field = page.getByRole('textbox', { name: 'Rename Track 2' })
  await field.fill('Overlay')
  await field.press('Enter')
  await expect(page.getByRole('button', { name: /^Overlay, active track/ })).toBeVisible()
  // Escape cancels a rename.
  await page.getByRole('button', { name: /^Overlay/ }).dblclick()
  await page.getByRole('textbox', { name: 'Rename Overlay' }).fill('Nope')
  await page.getByRole('textbox', { name: 'Rename Overlay' }).press('Escape')
  await expect(page.getByRole('button', { name: /^Overlay/ })).toBeVisible()

  // Copy the Track 1 clip and paste: it lands on the active (Overlay) track.
  await showTimeline(page)
  await blocks(page).first().click()
  await page.keyboard.press('Control+c')
  await page.getByRole('button', { name: /^Overlay/ }).click()
  await page.keyboard.press('Control+v')
  const lanes = page.locator('[data-advanced-lanes] > div')
  await expect(lanes.nth(0).locator('[data-advanced-segment]')).toHaveCount(1)
  await expect(lanes.nth(1).locator('[data-advanced-segment]')).toHaveCount(1)
})

test('the inspector sets exact size with a linked aspect, opacity, and fades', async ({ page }) => {
  await openAdvanced(page)
  await importClip(page, 1)
  const inspector = page.getByRole('region', { name: 'Clip inspector' })
  await expect(inspector).toBeVisible()
  const width = inspector.getByLabel('Width')
  const height = inspector.getByLabel('Height')
  const startWidth = Number(await width.inputValue())
  const startHeight = Number(await height.inputValue())
  const selection = page.locator('[data-canvas-selection]')
  const startBox = (await selection.boundingBox())!

  await width.fill(String(startWidth * 2))
  await width.press('Enter')
  await expect(height).toHaveValue(String(Math.round(startHeight * 2)))
  // The canvas box doubled too (the view zoom is unchanged).
  await expect
    .poll(async () => (await selection.boundingBox())!.width / startBox.width)
    .toBeCloseTo(2, 1)

  // Unlinked, only the typed side changes.
  await inspector.getByRole('button', { name: 'Keep aspect ratio' }).click()
  await height.fill(String(startHeight))
  await height.press('Enter')
  await expect(width).toHaveValue(String(startWidth * 2))
  await expect(height).toHaveValue(String(startHeight))

  await inspector.getByLabel('X position').fill('-40')
  await inspector.getByLabel('X position').press('Enter')
  await expect(inspector.getByLabel('X position')).toHaveValue('-40')

  const opacity = inspector.getByRole('slider', { name: 'Opacity' })
  await opacity.focus()
  for (let step = 0; step < 25; step++) await opacity.press('ArrowLeft')
  await expect(opacity).toHaveValue('75')
  await expect(inspector).toContainText('75%')

  const fadeIn = inspector.getByLabel('Fade in duration in seconds')
  await fadeIn.fill('99')
  await fadeIn.press('Enter')
  // Clamped to the clip's length.
  expect(Number(await fadeIn.inputValue())).toBeLessThan(99)
  expect(Number(await fadeIn.inputValue())).toBeGreaterThan(0)

  // Undo walks back one edit at a time: fade, then the whole opacity run.
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(fadeIn).toHaveValue('0')
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(opacity).toHaveValue('100')
})

test('a corner drag keeps the clip shape and shows its size; Shift stretches', async ({ page }) => {
  await openAdvanced(page)
  await importClip(page, 1)
  const selection = page.locator('[data-canvas-selection]')
  await selection.scrollIntoViewIfNeeded()
  const before = (await selection.boundingBox())!
  const corner = (await page.locator('[data-resize-handle="se"]').boundingBox())!
  const cornerX = corner.x + corner.width / 2
  const cornerY = corner.y + corner.height / 2

  await page.mouse.move(cornerX, cornerY)
  await page.mouse.down()
  await page.mouse.move(cornerX - 40, cornerY - 5, { steps: 6 })
  await expect(page.locator('[data-canvas-size-readout]')).toHaveText(/^\d+ × \d+$/)
  await page.mouse.up()
  await expect(page.locator('[data-canvas-size-readout]')).toHaveCount(0)
  const locked = (await selection.boundingBox())!
  expect(locked.width).toBeLessThan(before.width - 20)
  expect(locked.width / locked.height).toBeCloseTo(before.width / before.height, 1)

  const freeCorner = (await page.locator('[data-resize-handle="se"]').boundingBox())!
  await page.keyboard.down('Shift')
  await page.mouse.move(freeCorner.x + freeCorner.width / 2, freeCorner.y + freeCorner.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    freeCorner.x + freeCorner.width / 2,
    freeCorner.y + freeCorner.height / 2 - 30,
    { steps: 6 }
  )
  await page.mouse.up()
  await page.keyboard.up('Shift')
  const stretched = (await selection.boundingBox())!
  expect(Math.abs(stretched.width - locked.width)).toBeLessThan(1)
  expect(stretched.height).toBeLessThan(locked.height - 15)
})

test('arrow keys nudge the clip while the canvas has focus', async ({ page }) => {
  await openAdvanced(page)
  await importClip(page, 1)
  const inspector = page.getByRole('region', { name: 'Clip inspector' })
  const x = inspector.getByLabel('X position')
  const start = Number(await x.inputValue())
  await page.locator('[data-canvas-selection]').click()
  await expect(page.locator('[data-advanced-canvas]')).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+ArrowRight')
  await expect(x).toHaveValue(String(start + 11))
})

test('a corner dragged straight down still resizes along the clip shape', async ({ page }) => {
  await openAdvanced(page)
  await importClip(page, 1)
  const selection = page.locator('[data-canvas-selection]')
  await selection.scrollIntoViewIfNeeded()
  const before = (await selection.boundingBox())!
  const corner = (await page.locator('[data-resize-handle="se"]').boundingBox())!
  const cornerX = corner.x + corner.width / 2
  const cornerY = corner.y + corner.height / 2
  await page.mouse.move(cornerX, cornerY)
  await page.mouse.down()
  await page.mouse.move(cornerX, cornerY - 30, { steps: 6 })
  await page.mouse.up()
  const after = (await selection.boundingBox())!
  expect(after.height).toBeLessThan(before.height - 20)
  expect(after.width).toBeLessThan(before.width - 20)
  expect(after.width / after.height).toBeCloseTo(before.width / before.height, 1)
})

test('arrow keys step frames again after the focused canvas unmounts', async ({ page }) => {
  await openAdvanced(page)
  await importClip(page, 1)
  const x = page.getByRole('region', { name: 'Clip inspector' }).getByLabel('X position')
  const start = await x.inputValue()
  await page.locator('[data-canvas-selection]').click()
  await expect(page.locator('[data-advanced-canvas]')).toBeFocused()
  await page.getByRole('tab', { name: 'Basic' }).click()
  await page.getByRole('tab', { name: 'Advanced' }).click()
  await showTimeline(page)
  await blocks(page).first().click()
  await page.keyboard.press('ArrowRight')
  await expect(x).toHaveValue(start)
})

test('the active track header shows its whole default name', async ({ page }) => {
  await openAdvanced(page)
  await page.getByRole('button', { name: 'Add track' }).click()
  for (const name of [/^Track 2, active track/, /^Track 1, make active track/]) {
    const nameButton = page.getByRole('button', { name })
    await expect(nameButton).toBeVisible()
    const clipped = await nameButton.evaluate(
      (element) => element.scrollWidth > element.clientWidth
    )
    expect(clipped).toBe(false)
  }
})

test('a typed inspector value commits to its clip when another clip is clicked', async ({
  page,
}) => {
  const { top, bottom } = await twoClipsOnTwoTracks(page)
  const width = page.getByRole('region', { name: 'Clip inspector' }).getByLabel('Width')
  await top.click()
  const otherWidth = await width.inputValue()
  await width.fill('100')
  await bottom.click()
  await expect(width).toHaveValue(otherWidth)
  await top.click()
  await expect(width).toHaveValue('100')
})

test('pasting a two-track copy onto the bottom track keeps the clips stacked', async ({ page }) => {
  await twoClipsOnTwoTracks(page)
  const lanes = page.locator('[data-advanced-lanes] > div')
  await blocks(page).first().click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Control+c')
  await page.getByRole('button', { name: /^Track 1, make active track/ }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Control+v')
  await expect(blocks(page)).toHaveCount(4)
  await expect(lanes.nth(0).locator('[data-advanced-segment]')).toHaveCount(2)
  await expect(lanes.nth(1).locator('[data-advanced-segment]')).toHaveCount(2)
})
