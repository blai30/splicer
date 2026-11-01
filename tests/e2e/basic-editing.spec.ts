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

test('the segment context menu splits, mutes, duplicates, moves, and deletes', async ({ page }) => {
  await importClips(page, 2)
  const menu = page.getByRole('menu')
  const first = (await segments(page).first().boundingBox())!
  const middleY = first.y + first.height / 2

  // Right-click one second in: the menu opens with its first item focused.
  await page.mouse.click(first.x + 80, middleY, { button: 'right' })
  await expect(menu).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Duplicate' })).toBeFocused()
  await expect(page.getByRole('menuitem', { name: 'Move left' })).toBeDisabled()
  await expect(page.getByRole('menuitem', { name: 'Reset trim' })).toBeDisabled()
  // Arrow keys walk the enabled items; Enter runs one.
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: 'Split here' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(menu).toHaveCount(0)
  await expect(segments(page)).toHaveCount(3)

  // Escape closes without acting.
  const split = (await segments(page).first().boundingBox())!
  await page.mouse.click(split.x + 20, middleY, { button: 'right' })
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(segments(page)).toHaveCount(3)

  // Mute shows the muted icon on the block.
  await page.mouse.click(split.x + 20, middleY, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Mute' }).click()
  await expect(segments(page).first().getByRole('img', { name: 'Muted' })).toBeVisible()

  // Reset trim brings the split piece back to the full clip.
  await page.mouse.click(split.x + 20, middleY, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Reset trim' }).click()
  await expect(timecode(page, ' / 0:05.0')).toBeVisible()

  // Duplicate from the menu and with Ctrl+D.
  await page.mouse.click(split.x + 20, middleY, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Duplicate' }).click()
  await expect(segments(page)).toHaveCount(4)
  await page.locator('body').press('Control+d')
  await expect(segments(page)).toHaveCount(5)

  // Move right swaps the first block with its neighbour; the selection moves with it.
  await page.mouse.click(split.x + 20, middleY, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Move right' }).click()
  await expect(segments(page).nth(1)).toHaveClass(/ring-violet-400/)
  await expect(segments(page).first()).not.toHaveClass(/ring-violet-400/)

  // Shift+F10 opens the menu for the selected segment; Delete removes it.
  await page.locator('body').press('Shift+F10')
  await expect(menu).toBeVisible()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(segments(page)).toHaveCount(4)

  // A press outside closes the menu.
  await page.mouse.click(split.x + 20, middleY, { button: 'right' })
  await expect(menu).toBeVisible()
  await page.mouse.click(5, 5)
  await expect(menu).toHaveCount(0)
})

test('Split here splits where the menu was opened while playback runs on', async ({ page }) => {
  await importClips(page, 3)
  const first = (await segments(page).first().boundingBox())!
  await page.locator('body').press('Space')
  // Half a second into the first segment (80 px/s).
  await page.mouse.click(first.x + 40, first.y + first.height / 2, { button: 'right' })
  await expect(page.getByRole('menu')).toBeVisible()
  // Let playback cross the cut into the second segment before choosing.
  await expect(segments(page).nth(1)).toHaveClass(/ring-violet-400/, { timeout: 5000 })
  await page.getByRole('menuitem', { name: 'Split here' }).click()
  await expect(segments(page)).toHaveCount(4)
  const widths = await segments(page).evaluateAll((blocks) =>
    blocks.map((block) => Math.round(block.getBoundingClientRect().width))
  )
  expect(widths[0]).toBeCloseTo(40, -1)
  expect(widths[1]).toBeCloseTo(120, -1)
  expect(widths.slice(2)).toEqual([160, 160])
})

test('Shift+F10 on the focused track keeps the menu on the selected segment', async ({ page }) => {
  await importClips(page, 2)
  await page.locator('body').press('ArrowDown')
  await expect(segments(page).nth(1)).toHaveClass(/ring-violet-400/)
  await expect(timecode(page, '0:02.0 / 0:04.0')).toBeVisible()
  await track(page).evaluate((element) => {
    element.tabIndex = -1
    element.focus()
  })
  await page.keyboard.press('Shift+F10')
  await expect(page.getByRole('menu')).toBeVisible()
  // The browser follows the key with a contextmenu event on the focused
  // element at its own position, over the first segment.
  const first = (await segments(page).first().boundingBox())!
  await track(page).dispatchEvent('contextmenu', {
    button: 0,
    clientX: first.x + 20,
    clientY: first.y + first.height / 2,
  })
  await expect(segments(page).nth(1)).toHaveClass(/ring-violet-400/)
  await expect(timecode(page, '0:02.0 / 0:04.0')).toBeVisible()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(segments(page)).toHaveCount(1)
})

test('a forward shuttle ends when playback runs off the end', async ({ page }) => {
  await importClips(page, 2)
  const body = page.locator('body')
  await body.press('ArrowDown')
  await expect(timecode(page, '0:02.0 / 0:04.0')).toBeVisible()
  await body.press('l')
  await body.press('l')
  await expect(page.getByRole('status').filter({ hasText: 'Forward' })).toBeVisible()
  // At 2x the last 2 s segment ends in about a second; the timeline rewinds.
  await expect(segments(page).first()).toHaveClass(/ring-violet-400/, { timeout: 5000 })
  await expect(page.getByRole('status').filter({ hasText: '×' })).toHaveCount(0)
  await expect
    .poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.playbackRate))
    .toBe(1)
})
