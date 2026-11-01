import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

const fixture = fileURLToPath(new URL('../fixtures/tiny.mp4', import.meta.url))

const basicTrack = (page: Page) => page.locator('[data-track]')
const advancedScroller = (page: Page) => page.locator('[data-advanced-scroller]')
const scrollLeftOf = (element: ReturnType<typeof basicTrack>) =>
  element.evaluate((node) => node.scrollLeft)
const zoomBox = (page: Page) => page.getByRole('spinbutton', { name: /zoom level/i })

async function importBasicClips(page: Page, count: number) {
  for (let index = 1; index <= count; index++) {
    await page.locator('input[type="file"]').setInputFiles(fixture)
    await expect(page.locator('[data-segment]')).toHaveCount(index)
  }
}

async function openAdvancedWithClips(page: Page, count: number) {
  await page.goto('/splicer/')
  await page.getByRole('tab', { name: 'Advanced' }).click()
  await page.getByRole('button', { name: '720p' }).click()
  for (let index = 1; index <= count; index++) {
    await page.locator('input[type="file"]').setInputFiles(fixture)
    await expect(page.locator('[data-advanced-segment]')).toHaveCount(index)
  }
  await advancedScroller(page).scrollIntoViewIfNeeded()
}

test('the Advanced view follows the playhead during playback at high zoom', async ({ page }) => {
  await openAdvancedWithClips(page, 3)
  // Zoom all the way in so the 6 s project overflows the view.
  for (let step = 0; step < 12; step++) await page.locator('body').press('=')
  const scroller = advancedScroller(page)
  expect(await scrollLeftOf(scroller)).toBe(0)

  await page.getByTitle('Play', { exact: true }).click()
  await expect.poll(() => scrollLeftOf(scroller), { timeout: 8000 }).toBeGreaterThan(100)
  // The page jump keeps the playhead on screen.
  const view = (await scroller.boundingBox())!
  const playhead = (await page.locator('[data-advanced-playhead]').boundingBox())!
  expect(playhead.x).toBeGreaterThanOrEqual(view.x)
  expect(playhead.x).toBeLessThanOrEqual(view.x + view.width)
})

test('clicking the Advanced ruler seeks and keeps the clip selected', async ({ page }) => {
  await openAdvancedWithClips(page, 1)
  const block = page.locator('[data-advanced-segment]')
  await block.click()
  const deleteButton = page.getByRole('button', { name: 'Delete selected clip' })
  await expect(deleteButton).toBeEnabled()

  const ruler = page.locator('[data-advanced-scroller] [data-time-ruler]')
  await expect(ruler).toContainText('0:01')
  const box = (await ruler.boundingBox())!
  // 8 px lane padding, then 80 px per second at the default zoom.
  await page.mouse.click(box.x + 8 + 80 * 1.05, box.y + box.height / 2)
  await expect(page.getByText('0:01.0 / 0:02.0').first()).toBeVisible()
  await expect(deleteButton).toBeEnabled()
})

test('clicking the Basic ruler seeks across a cut into the next segment', async ({ page }) => {
  await page.goto('/splicer/')
  await importBasicClips(page, 2)
  const ruler = page.locator('[data-track] [data-time-ruler]')
  await expect(ruler.locator('[data-cut-marker]')).toHaveCount(1)
  // Raw page.mouse uses viewport coordinates and does not auto-scroll.
  await basicTrack(page).scrollIntoViewIfNeeded()

  const second = (await page.locator('[data-segment]').nth(1).boundingBox())!
  const rulerBox = (await ruler.boundingBox())!
  await page.mouse.click(second.x + 80 * 0.55, rulerBox.y + rulerBox.height / 2)
  await expect(page.getByText('0:02.5 / 0:04.0').first()).toBeVisible()
  await expect(page.locator('[data-segment]').nth(1)).toHaveClass(/ring-violet-400/)
})

test('Fit and zoom steps in Basic', async ({ page }) => {
  await page.goto('/splicer/')
  await importBasicClips(page, 1)
  await expect(zoomBox(page)).toHaveValue('80')

  // A 2 s clip fits the view only at the maximum zoom.
  await page.locator('body').press('Shift+Z')
  await expect(zoomBox(page)).toHaveValue('200')
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click()
  await expect(zoomBox(page)).toHaveValue('160')
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(zoomBox(page)).toHaveValue('200')

  const slider = page.getByRole('slider', { name: 'Timeline zoom' })
  await slider.focus()
  await slider.press('Home')
  await expect(zoomBox(page)).toHaveValue('0.25')
  await page.getByRole('button', { name: 'Fit timeline to view' }).click()
  await expect(zoomBox(page)).toHaveValue('200')
})

test('a long first import zooms out to fit the view', async ({ page }) => {
  await page.goto('/splicer/')
  // Five 2 s copies in one batch: 10 s does not fit at 80 px/s on a phone.
  await page.setViewportSize({ width: 700, height: 900 })
  await page.locator('input[type="file"]').setInputFiles(Array(5).fill(fixture))
  await expect(page.locator('[data-segment]')).toHaveCount(5)
  await expect.poll(async () => Number(await zoomBox(page).inputValue())).toBeLessThan(80)
  const track = basicTrack(page)
  const fits = await track.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
  expect(fits).toBe(true)
})

test('Home scrolls a hidden Basic playhead back into view', async ({ page }) => {
  await page.goto('/splicer/')
  await importBasicClips(page, 4)
  for (let step = 0; step < 12; step++) await page.locator('body').press('=')
  const track = basicTrack(page)
  await track.evaluate((node) => (node.scrollLeft = node.scrollWidth))
  await expect.poll(() => scrollLeftOf(track)).toBeGreaterThan(100)

  await page.locator('body').press('Home')
  await expect.poll(() => scrollLeftOf(track)).toBe(0)
})

test('the Basic track follows the playhead during playback at high zoom', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 })
  await page.goto('/splicer/')
  await importBasicClips(page, 3)
  for (let step = 0; step < 12; step++) await page.locator('body').press('=')
  const track = basicTrack(page)
  expect(await scrollLeftOf(track)).toBe(0)

  await page.getByTitle('Play (Space)').click()
  await expect.poll(() => scrollLeftOf(track), { timeout: 8000 }).toBeGreaterThan(100)
  const view = (await track.boundingBox())!
  const playhead = (await page.locator('[data-playhead]').boundingBox())!
  expect(playhead.x).toBeGreaterThanOrEqual(view.x)
  expect(playhead.x).toBeLessThanOrEqual(view.x + view.width)
})

test('a wheel over the Basic header pauses follow instead of being snapped back', async ({
  page,
}) => {
  await page.setViewportSize({ width: 700, height: 900 })
  await page.goto('/splicer/')
  await importBasicClips(page, 3)
  for (let step = 0; step < 12; step++) await page.locator('body').press('=')
  const track = basicTrack(page)

  await page.getByTitle('Play (Space)').click()
  await expect.poll(() => scrollLeftOf(track), { timeout: 8000 }).toBeGreaterThan(100)
  // Scroll back to the start from the toolbar row, away from the track itself.
  await page.getByText('Timeline', { exact: true }).hover()
  await page.mouse.wheel(0, -100_000)
  await expect.poll(() => scrollLeftOf(track)).toBe(0)
  await page.waitForTimeout(500)
  expect(await scrollLeftOf(track)).toBe(0)
})

for (const width of [375, 320]) {
  test(`Basic clips stay inside the track on a ${width} px phone`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/splicer/')
    await importBasicClips(page, 1)
    const trackBox = (await basicTrack(page).boundingBox())!
    const blockBox = (await page.locator('[data-segment]').boundingBox())!
    expect(blockBox.y).toBeGreaterThanOrEqual(trackBox.y)
    expect(blockBox.y + blockBox.height).toBeLessThanOrEqual(trackBox.y + trackBox.height)
  })
}
