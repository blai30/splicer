import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

const fixture = fileURLToPath(new URL('../fixtures/tiny.mp4', import.meta.url))

async function setup(page: import('@playwright/test').Page) {
  await page.goto('/splicer/')
  await page.getByRole('tab', { name: 'Advanced' }).click()
  await page.getByRole('button', { name: '720p' }).click()
  await page.locator('input[type="file"]').setInputFiles(fixture)
  await expect(page.locator('[data-advanced-segment]')).toHaveCount(1)
  // The timeline sits below the fold at this viewport; raw page.mouse uses
  // viewport coordinates and does not auto-scroll, so bring it into view first.
  await page.locator('[data-advanced-playhead]').scrollIntoViewIfNeeded()
}

const playheadCenter = async (page: import('@playwright/test').Page) => {
  const box = await page.locator('[data-advanced-playhead]').boundingBox()
  return box!.x + box!.width / 2
}

test('drags the timeline playhead to scrub without moving the clip', async ({ page }) => {
  await setup(page)

  const segBefore = await page.locator('[data-advanced-segment]').boundingBox()
  const ph = await page.locator('[data-advanced-playhead]').boundingBox()

  // Grab the playhead (it sits over the clip at time 0) and drag it right.
  await page.mouse.move(ph!.x + ph!.width / 2, ph!.y + ph!.height / 2)
  await page.mouse.down()
  await page.mouse.move(ph!.x + 80, ph!.y + ph!.height / 2, { steps: 6 })
  await page.mouse.up()

  // The playhead advanced and the clip block stayed put (no accidental clip drag).
  await expect.poll(() => playheadCenter(page)).toBeGreaterThan(ph!.x + 20)
  const segAfter = await page.locator('[data-advanced-segment]').boundingBox()
  expect(Math.abs(segAfter!.x - segBefore!.x)).toBeLessThan(2)
  expect(Math.abs(segAfter!.width - segBefore!.width)).toBeLessThan(2)
})

test('pressing a blank area snaps the playhead to the cursor and scrubs', async ({ page }) => {
  await setup(page)

  // Find a point inside the track that is not over a clip block or the playhead.
  const blank = await page.evaluate(() => {
    const container = document
      .querySelector('[data-advanced-playhead]')!
      .closest('.overflow-x-auto')!
    const cb = container.getBoundingClientRect()
    const segs = [...document.querySelectorAll('[data-advanced-segment]')].map((s) =>
      s.getBoundingClientRect()
    )
    const ph = document.querySelector('[data-advanced-playhead]')!.getBoundingClientRect()
    const inside = (x: number, y: number, r: DOMRect) =>
      x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
    for (let x = cb.left + 100; x < cb.left + 140; x += 4) {
      for (let y = cb.top + 12; y < cb.bottom - 6; y += 8) {
        if (segs.some((r) => inside(x, y, r))) continue
        if (inside(x, y, ph)) continue
        return { x: Math.round(x), y: Math.round(y) }
      }
    }
    return null
  })
  expect(blank).not.toBeNull()

  await page.mouse.move(blank!.x, blank!.y)
  await page.mouse.down()
  // The playhead jumps to the cursor on press.
  await expect.poll(async () => Math.abs((await playheadCenter(page)) - blank!.x)).toBeLessThan(10)
  // ...and keeps following while dragging.
  await page.mouse.move(blank!.x + 50, blank!.y, { steps: 4 })
  await expect.poll(() => playheadCenter(page)).toBeGreaterThan(blank!.x + 20)
  await page.mouse.up()
})
