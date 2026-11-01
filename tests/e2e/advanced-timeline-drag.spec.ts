import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

const fixture = fileURLToPath(new URL('../fixtures/tiny.mp4', import.meta.url))

const blocks = (page: Page) => page.locator('[data-advanced-segment]')

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

// One clip on Track 1 at 0s, and a second clip on a new top track, also at 0s.
async function twoClipsOnTwoTracks(page: Page) {
  await openAdvanced(page)
  await importClip(page, 1)
  await page.getByRole('button', { name: 'Add track' }).click()
  await importClip(page, 2)
  await showTimeline(page)
  // Lanes render top track first.
  return { top: blocks(page).nth(0), bottom: blocks(page).nth(1) }
}

async function dragBy(page: Page, startX: number, startY: number, deltaX: number, deltaY = 0) {
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 8 })
}

test('a dragged clip snaps its start to the end of a clip on another track', async ({ page }) => {
  const { top, bottom } = await twoClipsOnTwoTracks(page)
  const anchor = (await bottom.boundingBox())!
  const dragged = (await top.boundingBox())!
  const centerY = dragged.y + dragged.height / 2

  // Drop 5 px past the other clip's end: within the 8 px snap distance.
  await dragBy(page, dragged.x + dragged.width / 2, centerY, anchor.width + 5)
  await expect(page.locator('[data-advanced-snap-line]')).toBeVisible()
  await expect(page.locator('[data-advanced-readout]')).toContainText(
    /Start 0:02\.\d\d · \+2\.\d\ds · Track 2/
  )
  await page.mouse.up()
  await expect(page.locator('[data-advanced-snap-line]')).toHaveCount(0)

  const landed = (await top.boundingBox())!
  expect(Math.abs(landed.x - (anchor.x + anchor.width))).toBeLessThan(1)
})

test('holding Alt places a clip without snapping', async ({ page }) => {
  const { top, bottom } = await twoClipsOnTwoTracks(page)
  const anchor = (await bottom.boundingBox())!
  const dragged = (await top.boundingBox())!

  await page.keyboard.down('Alt')
  await dragBy(
    page,
    dragged.x + dragged.width / 2,
    dragged.y + dragged.height / 2,
    anchor.width + 5
  )
  await expect(page.locator('[data-advanced-snap-line]')).toHaveCount(0)
  await page.mouse.up()
  await page.keyboard.up('Alt')

  const landed = (await top.boundingBox())!
  expect(landed.x - (anchor.x + anchor.width)).toBeGreaterThan(3)
})

test('the magnet button and the S key toggle snapping', async ({ page }) => {
  const { top, bottom } = await twoClipsOnTwoTracks(page)
  const magnet = page.getByRole('button', { name: 'Snapping' })
  await expect(magnet).toHaveAttribute('aria-pressed', 'true')
  await magnet.click()
  await expect(magnet).toHaveAttribute('aria-pressed', 'false')

  const anchor = (await bottom.boundingBox())!
  const dragged = (await top.boundingBox())!
  await dragBy(
    page,
    dragged.x + dragged.width / 2,
    dragged.y + dragged.height / 2,
    anchor.width + 5
  )
  await page.mouse.up()
  const landed = (await top.boundingBox())!
  expect(landed.x - (anchor.x + anchor.width)).toBeGreaterThan(3)

  await page.locator('body').press('s')
  await expect(magnet).toHaveAttribute('aria-pressed', 'true')
})

test('dragging a clip above the first lane creates a new top track, undone in one step', async ({
  page,
}) => {
  await openAdvanced(page)
  await importClip(page, 1)
  await showTimeline(page)
  const block = (await blocks(page).first().boundingBox())!

  // The lanes start 4 px above the block; aim into the band above them.
  await dragBy(
    page,
    block.x + block.width / 2,
    block.y + block.height / 2,
    0,
    -(block.height / 2 + 14)
  )
  const zone = page.locator('[data-advanced-new-track-zone]').first()
  await expect(zone).toContainText('New track')
  await expect(page.locator('[data-advanced-readout]')).toContainText('New track')
  await page.mouse.up()
  await expect(page.locator('[data-advanced-new-track-zone]')).toHaveCount(0)

  // The new track is the top lane and holds the clip; Track 1 is now empty.
  await expect(page.getByRole('button', { name: 'Remove Track 2' })).toBeVisible()
  const lanes = page.locator('[data-advanced-lanes] > div')
  await expect(lanes).toHaveCount(2)
  await expect(lanes.nth(0).locator('[data-advanced-segment]')).toHaveCount(1)
  await expect(lanes.nth(1).locator('[data-advanced-segment]')).toHaveCount(0)

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(lanes).toHaveCount(1)
  await expect(lanes.nth(0).locator('[data-advanced-segment]')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Remove Track 1' })).toBeDisabled()
})

test('dragging a clip below the last lane creates a new bottom track', async ({ page }) => {
  await openAdvanced(page)
  await importClip(page, 1)
  await showTimeline(page)
  const block = (await blocks(page).first().boundingBox())!

  await dragBy(page, block.x + block.width / 2, block.y + block.height / 2, 0, block.height)
  await expect(page.locator('[data-advanced-new-track-zone]')).toHaveCount(2)
  await page.mouse.up()

  const lanes = page.locator('[data-advanced-lanes] > div')
  await expect(lanes).toHaveCount(2)
  await expect(lanes.nth(0).locator('[data-advanced-segment]')).toHaveCount(0)
  await expect(lanes.nth(1).locator('[data-advanced-segment]')).toHaveCount(1)
})

test('scrubbing past the right edge auto-scrolls the timeline', async ({ page }) => {
  await openAdvanced(page)
  for (let count = 1; count <= 4; count++) await importClip(page, count)
  // An empty lane to scrub on, and enough zoom that the clips overflow.
  await page.getByRole('button', { name: 'Add track' }).click()
  for (let step = 0; step < 12; step++) await page.locator('body').press('=')
  await showTimeline(page)

  const scroller = page.locator('[data-advanced-scroller]')
  const view = (await scroller.boundingBox())!
  const emptyLane = (await page.locator('[data-advanced-lanes] > div').first().boundingBox())!
  const laneY = emptyLane.y + emptyLane.height / 2
  await dragBy(page, view.x + 120, laneY, view.width - 125)
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollLeft), { timeout: 3000 })
    .toBeGreaterThan(100)
  await page.mouse.up()
})

test('a trimmed edge snaps to the playhead', async ({ page }) => {
  const { top } = await twoClipsOnTwoTracks(page)
  // Park the playhead at 1s (30 frames of the 30 fps fixture).
  for (let frame = 0; frame < 30; frame++) await page.locator('body').press('.')
  const box = (await top.boundingBox())!
  const pxPerSecond = box.width / 2

  // Drag the right edge to 5 px past the playhead: inside the snap distance.
  await dragBy(page, box.x + box.width - 3, box.y + box.height / 2, -(pxPerSecond - 5))
  await expect(page.locator('[data-advanced-snap-line]')).toBeVisible()
  await expect(page.locator('[data-advanced-readout]')).toContainText(
    'In 0:00.00 · Out 0:01.00 · Duration 1.00s'
  )
  await page.mouse.up()
  const trimmed = (await top.boundingBox())!
  expect(Math.abs(trimmed.width - pxPerSecond)).toBeLessThan(1)
})

test('dragging a clip to the right edge auto-scrolls and keeps the move scroll-aware', async ({
  page,
}) => {
  await openAdvanced(page)
  for (let count = 1; count <= 4; count++) await importClip(page, count)
  for (let step = 0; step < 12; step++) await page.locator('body').press('=')
  await showTimeline(page)

  const scroller = page.locator('[data-advanced-scroller]')
  const view = (await scroller.boundingBox())!
  const first = blocks(page).first()
  const box = (await first.boundingBox())!
  const grabX = box.x + 60
  await dragBy(page, grabX, box.y + box.height / 2, view.x + view.width - 2 - grabX)
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollLeft), { timeout: 3000 })
    .toBeGreaterThan(100)
  const scrolled = await scroller.evaluate((element) => element.scrollLeft)
  await page.mouse.up()

  // The clip moved by the pointer travel plus the distance scrolled.
  const landed = (await first.boundingBox())!
  const pointerTravel = view.x + view.width - 2 - grabX
  expect(landed.x + scrolled - box.x).toBeGreaterThan(pointerTravel + 50)
})
