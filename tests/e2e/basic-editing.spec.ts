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

test('the waveform is extracted off the main thread and drawn', async ({ page }) => {
  await page.goto('/splicer/')
  const stereo = fileURLToPath(new URL('../fixtures/wide-stereo48k.mp4', import.meta.url))
  await page.locator('input[type="file"]').setInputFiles(stereo)
  await expect(segments(page)).toHaveCount(1)
  const canvas = segments(page).first().locator('canvas')
  // Fills the block's height, not the 150 px canvas default.
  const blockHeight = (await segments(page).first().boundingBox())!.height
  await expect
    .poll(async () => (await canvas.boundingBox())?.height)
    .toBeCloseTo(blockHeight - 2, 0)
  // Once peaks arrive, bars reach past the 1 px minimum around the centre line.
  await expect
    .poll(
      () =>
        canvas.evaluate((element: HTMLCanvasElement) => {
          const context = element.getContext('2d')
          if (!context || element.width === 0) return 0
          const { data } = context.getImageData(0, 0, element.width, element.height)
          const clearAbove = Math.floor(element.height / 2) - 2 * devicePixelRatio
          let tallColumns = 0
          for (let x = 0; x < element.width; x++) {
            for (let y = 0; y < clearAbove; y++) {
              if (data[(y * element.width + x) * 4 + 3] > 0) {
                tallColumns += 1
                break
              }
            }
          }
          return tallColumns
        }),
      { timeout: 10_000 }
    )
    .toBeGreaterThan(0)
  // A dedicated worker did the decoding.
  const workers = page.workers().map((worker) => worker.url())
  expect(workers.some((url) => url.includes('waveformWorker'))).toBe(true)
})

test('Up/Down jump between cuts and End goes to the end', async ({ page }) => {
  await importClips(page, 2)
  const body = page.locator('body')
  await body.press('ArrowDown')
  await expect(segments(page).nth(1)).toHaveClass(/ring-violet-400/)
  await expect(timecode(page, '0:02.0 / 0:04.0')).toBeVisible()
  await body.press('Shift+ArrowRight')
  await expect(timecode(page, '0:03.0 / 0:04.0')).toBeVisible()
  await body.press('ArrowUp')
  await expect(timecode(page, '0:02.0 / 0:04.0')).toBeVisible()
  await body.press('ArrowUp')
  await expect(segments(page).first()).toHaveClass(/ring-violet-400/)
  await expect(timecode(page, '0:00.0 / 0:04.0')).toBeVisible()
  await body.press('End')
  await expect(timecode(page, '0:04.0 / 0:04.0')).toBeVisible()
})

test('J plays in reverse across a cut and K stops', async ({ page }) => {
  await importClips(page, 2)
  const body = page.locator('body')
  await body.press('End')
  await expect(timecode(page, '0:04.0 / 0:04.0')).toBeVisible()
  await body.press('j')
  await body.press('j')
  await expect(page.getByRole('status').filter({ hasText: '2×' })).toBeVisible()
  // At 2x reverse the playhead crosses the cut at 0:02 within about a second.
  await expect(segments(page).first()).toHaveClass(/ring-violet-400/, { timeout: 5000 })
  await body.press('k')
  await expect(page.getByRole('status').filter({ hasText: '×' })).toHaveCount(0)
  const stopped = await page
    .getByText(/ \/ 0:04\.0$/)
    .first()
    .textContent()
  await page.waitForTimeout(400)
  await expect(page.getByText(/ \/ 0:04\.0$/).first()).toHaveText(stopped!)
})

test('the playback speed is shared by both editors and survives a reload', async ({ page }) => {
  await page.goto('/splicer/')
  const speed = page.getByRole('combobox', { name: 'Playback speed' })
  await speed.selectOption('1.5')
  await page.getByRole('tab', { name: 'Advanced' }).click()
  await expect(page.getByRole('combobox', { name: 'Playback speed' })).toHaveValue('1.5')
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Playback speed' })).toHaveValue('1.5')
})

test('trimming selects the segment, previews the edge, and snaps back', async ({ page }) => {
  await importClips(page, 2)
  await expect(segments(page).first()).toHaveClass(/ring-violet-400/)
  const second = (await segments(page).nth(1).boundingBox())!
  const handleY = second.y + second.height / 2
  const handleX = second.x + second.width - 4

  await page.mouse.move(handleX, handleY)
  await page.mouse.down()
  // 41 px at 80 px/s is 0.51 s in; the out-point lands on the 30 fps grid.
  await page.mouse.move(handleX - 41, handleY, { steps: 6 })
  const readout = page.locator('[data-trim-readout]')
  await expect(readout).toHaveText('Out 0:01.50 · Duration 1.50s')
  await expect(segments(page).nth(1)).toHaveClass(/ring-violet-400/)
  // The preview shows the last kept frame, one frame before the out-point.
  await expect(timecode(page, '0:03.4 / 0:03.5')).toBeVisible()
  await expect(page.locator('[data-trim-snap-line]')).toHaveCount(0)

  // Dragging back near the original end snaps onto it.
  await page.mouse.move(handleX - 3, handleY, { steps: 4 })
  await expect(readout).toHaveText('Out 0:02.00 · Duration 2.00s')
  await expect(page.locator('[data-trim-snap-line]')).toBeVisible()
  await page.mouse.move(handleX - 41, handleY, { steps: 4 })
  await page.mouse.up()
  await expect(readout).toHaveCount(0)
  await expect(timecode(page, ' / 0:03.5')).toBeVisible()

  // One undo restores the trim and the selection from before it.
  await page.locator('body').press('Control+z')
  await expect(timecode(page, ' / 0:04.0')).toBeVisible()
  await expect(segments(page).first()).toHaveClass(/ring-violet-400/)
})

test('In with the playhead on a segment edge explains why nothing changed', async ({ page }) => {
  await importClips(page, 1)
  await page.locator('body').press('i')
  await expect(page.locator('[data-edit-notice]')).toHaveText(
    'Move the playhead inside the selected segment to set its in-point.'
  )
  await expect(page.locator('[data-edit-notice]')).toHaveCount(0, { timeout: 5000 })
})
