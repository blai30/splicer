import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

const fixture = fileURLToPath(new URL('../fixtures/tiny.mp4', import.meta.url))

const segments = (page: Page) => page.locator('[data-segment]')
const track = (page: Page) => page.locator('[data-track]')
const timecode = (page: Page, text: string) => page.getByText(text).first()

async function importClips(page: Page, count: number) {
  await page.goto('/splicer/')
  for (let index = 1; index <= count; index++) {
    await page.locator('input[type="file"]').setInputFiles(fixture)
    await expect(segments(page)).toHaveCount(index)
  }
  // Raw page.mouse uses viewport coordinates and does not auto-scroll.
  await track(page).scrollIntoViewIfNeeded()
}

test('dragging the playhead scrubs across a cut into the next segment', async ({ page }) => {
  await importClips(page, 2)
  await expect(segments(page).first()).toHaveClass(/ring-violet-400/)

  const playhead = (await page.locator('[data-playhead]').boundingBox())!
  const second = (await segments(page).nth(1).boundingBox())!
  const grabX = playhead.x + playhead.width / 2
  const grabY = second.y + second.height / 2
  await page.mouse.move(grabX, grabY)
  await page.mouse.down()
  // Grabbing the playhead must not move it.
  await expect(timecode(page, '0:00.0 / 0:04.0')).toBeVisible()
  // 80 px/s: half a second into the second 2 s clip.
  await page.mouse.move(second.x + 40, grabY, { steps: 8 })
  await page.mouse.up()

  await expect(segments(page).nth(1)).toHaveClass(/ring-violet-400/)
  await expect(timecode(page, '0:02.5 / 0:04.0')).toBeVisible()

  // And back across the cut into the first segment.
  const moved = (await page.locator('[data-playhead]').boundingBox())!
  await page.mouse.move(moved.x + moved.width / 2, grabY)
  await page.mouse.down()
  const first = (await segments(page).first().boundingBox())!
  await page.mouse.move(first.x + 80, grabY, { steps: 8 })
  await page.mouse.up()
  await expect(segments(page).first()).toHaveClass(/ring-violet-400/)
  await expect(timecode(page, '0:01.0 / 0:04.0')).toBeVisible()
})

test('presses in the gap and padding seek to the nearest segment edge', async ({ page }) => {
  await importClips(page, 2)
  const first = (await segments(page).first().boundingBox())!
  const second = (await segments(page).nth(1).boundingBox())!
  // Below the blocks is empty track: the press resolves by x alone.
  const emptyY = first.y + first.height + 6

  // Just right of the first block's end, inside the gap: its out-point.
  await page.mouse.click(first.x + first.width + 1, emptyY)
  await expect(segments(page).first()).toHaveClass(/ring-violet-400/)
  await expect(timecode(page, '0:02.0 / 0:04.0')).toBeVisible()

  // Past the last block: the end of the timeline.
  await page.mouse.click(second.x + second.width + 12, emptyY)
  await expect(segments(page).nth(1)).toHaveClass(/ring-violet-400/)
  await expect(timecode(page, '0:04.0 / 0:04.0')).toBeVisible()

  // The left padding: the very start.
  await page.mouse.click(first.x - 8, emptyY)
  await expect(segments(page).first()).toHaveClass(/ring-violet-400/)
  await expect(timecode(page, '0:00.0 / 0:04.0')).toBeVisible()
})
