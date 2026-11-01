import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))
// 320x180 15 fps H.264 at ~250 kbps with 64 kbps AAC: above the encoder floor
// at every preset.
const highBitrate = fixture('high-bitrate.mp4')
// 640x360 H.264 at ~60 kbps: below what the browser's H.264 encoder can reach
// at that size, so every preset lands near the encoder floor.
const lowBitrate = fixture('low-bitrate.mp4')
// 320x240 30 fps H.264 at ~46 kbps of simple content: the encoder goes under
// its complex-content floor and the export comes out smaller than the source.
const tiny = fixture('tiny.mp4')
// 1280x720 30 fps detailed H.264 (testsrc2) at ~1.5 Mbps, no audio.
const detailed720p = fixture('detailed-720p.mp4')

const UNIT_BYTES: Record<string, number> = { B: 1, KB: 1_000, MB: 1_000_000, GB: 1_000_000_000 }

// "~98 KB (83–113 KB)" -> 98000
async function readEstimate(page: Page): Promise<number> {
  const summary = page.getByText(/~\s*[\d.]+ [KMG]?B/)
  await expect(summary).toBeVisible()
  const match = (await summary.innerText()).match(/~\s*([\d.]+) ([KMG]?B)/)
  if (!match) throw new Error('No size estimate shown')
  return Number(match[1]) * UNIT_BYTES[match[2]]
}

// "(83–113 KB)" or "(745 KB–1.0 MB)" -> [83000, 113000]
async function readRange(page: Page): Promise<[number, number]> {
  const text = await page.getByText(/~\s*[\d.]+ [KMG]?B/).innerText()
  const match = text.match(/\(([\d.]+) ?([KMG]?B)?–([\d.]+) ([KMG]?B)\)/)
  if (!match) throw new Error(`No size range shown in "${text}"`)
  return [
    Number(match[1]) * UNIT_BYTES[match[2] ?? match[4]],
    Number(match[3]) * UNIT_BYTES[match[4]],
  ]
}

async function exportCurrent(page: Page, exportsSoFar: number) {
  await page.getByRole('button', { name: /export video/i }).click()
  const links = page.getByRole('link', { name: /splicer-.*\.(mp4|webm)/ })
  await expect(links).toHaveCount(exportsSoFar + 1, { timeout: 90_000 })
  // The newest export is listed first.
  const href = await links.first().getAttribute('href')
  return page.evaluate(async (url) => (await (await fetch(url!)).blob()).size, href)
}

async function exportAt(page: Page, label: string, exportsSoFar: number) {
  await page.getByRole('radio', { name: new RegExp(`^${label}$`) }).click()
  const estimate = await readEstimate(page)
  const range = await readRange(page)
  const bytes = await exportCurrent(page, exportsSoFar)
  return { estimate, range, bytes }
}

// Range bounds are rounded for display; allow that rounding.
function expectInRange(bytes: number, [low, high]: [number, number]) {
  expect(bytes).toBeGreaterThanOrEqual(low * 0.98)
  expect(bytes).toBeLessThanOrEqual(high * 1.02)
}

test('presets order sizes and stay at or under a source above the encoder floor', async ({
  page,
}) => {
  const sourceBytes = statSync(highBitrate).size
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles(highBitrate)
  await expect(page.locator('[data-segment]')).toHaveCount(1)
  await expect(page.getByText(/· source \d+ KB/)).toBeVisible()

  const low = await exportAt(page, 'Low', 0)
  const medium = await exportAt(page, 'Medium', 1)
  const high = await exportAt(page, 'High', 2)

  expect(low.bytes).toBeLessThan(medium.bytes)
  expect(medium.bytes).toBeLessThan(high.bytes)
  expect(high.bytes).toBeLessThanOrEqual(sourceBytes * 1.1)
  expect(low.bytes).toBeLessThanOrEqual(sourceBytes * 0.6)
  for (const result of [low, medium, high]) {
    expect(result.bytes / result.estimate).toBeGreaterThan(0.7)
    expect(result.bytes / result.estimate).toBeLessThan(1.35)
  }
  await expect(page.getByText(/likely larger than the source/i)).toHaveCount(0)

  // VP9 needs fewer bits than H.264 for the same quality, and gets fewer.
  await page.getByRole('radio', { name: /^WebM$/ }).click()
  const vp9High = await exportAt(page, 'High', 3)
  expect(vp9High.bytes).toBeLessThan(high.bytes)
  expect(vp9High.bytes / vp9High.estimate).toBeGreaterThan(0.7)
  expect(vp9High.bytes / vp9High.estimate).toBeLessThan(1.35)
})

test('a source below the encoder floor gets an honest estimate and note', async ({ page }) => {
  const sourceBytes = statSync(lowBitrate).size
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles(lowBitrate)
  await expect(page.locator('[data-segment]')).toHaveCount(1)

  await page.getByRole('radio', { name: /^Low$/ }).click()
  await expect(page.getByText(/likely larger than the source/i)).toContainText(
    /more compressed than the encoder can go at 640×360/
  )
  const low = await exportAt(page, 'Low', 0)
  const high = await exportAt(page, 'High', 1)

  expect(low.bytes).toBeLessThanOrEqual(high.bytes * 1.05)
  // The floor bounds the growth; the old fixed table made this 3-10x.
  expect(high.bytes).toBeLessThan(sourceBytes * 3)
  for (const result of [low, high]) {
    expect(result.bytes / result.estimate).toBeGreaterThan(0.6)
    expect(result.bytes / result.estimate).toBeLessThan(1.5)
  }
})

test('a simple low-bitrate source is not flagged as growing and lands in the range', async ({
  page,
}) => {
  const sourceBytes = statSync(tiny).size
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles(tiny)
  await expect(page.locator('[data-segment]')).toHaveCount(1)
  await expect(page.getByText(/· source \d+ KB/)).toBeVisible()

  const high = await exportAt(page, 'High', 0)
  await expect(page.getByText(/likely larger than the source/i)).toHaveCount(0)
  const low = await exportAt(page, 'Low', 1)
  await expect(page.getByText(/likely larger than the source/i)).toHaveCount(0)
  for (const result of [high, low]) {
    expectInRange(result.bytes, result.range)
    expect(result.bytes).toBeLessThanOrEqual(sourceBytes * 1.05)
  }
})

test('VP9 Medium at 720p lands in the shown range', async ({ page }) => {
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles(detailed720p)
  await expect(page.locator('[data-segment]')).toHaveCount(1)
  await expect(page.getByText(/· source \d+ KB/)).toBeVisible()
  await page.getByRole('radio', { name: /^WebM$/ }).click()
  const medium = await exportAt(page, 'Medium', 0)
  expectInRange(medium.bytes, medium.range)
  // libvpx meets a moderate target here; a flat 85% adherence guessed ~14% low.
  expect(medium.bytes / medium.estimate).toBeGreaterThan(0.85)
  expect(medium.bytes / medium.estimate).toBeLessThan(1.12)
  const high = await exportAt(page, 'High', 1)
  expectInRange(high.bytes, high.range)
})

test('the quality hint describes the selected preset', async ({ page }) => {
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles(highBitrate)
  const group = page.getByRole('radiogroup', { name: 'Quality' })
  await group.getByRole('radio', { name: /^Maximum$/ }).click()
  await expect(page.locator('#export-quality-hint')).toContainText('1.5× the source bitrate')
  await group.getByRole('radio', { name: /^Medium$/ }).click()
  await expect(page.locator('#export-quality-hint')).toContainText('60% of the source bitrate')
})

test('Advanced warns when clips playing together spread the auto canvas and locks a size', async ({
  page,
}) => {
  const tiny = fixture('tiny.mp4')
  await page.goto('/splicer/')
  await page.getByRole('tab', { name: 'Advanced' }).click()
  // Imports append on the top track, so give the second clip its own track to
  // make both start together at 0s.
  await page.locator('input[type="file"]').setInputFiles(tiny)
  await expect(page.locator('[data-advanced-segment]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Add track' }).click()
  await page.locator('input[type="file"]').setInputFiles(tiny)
  await expect(page.locator('[data-advanced-segment]')).toHaveCount(2)
  await expect(page.getByText(/^320×240 ·/)).toBeVisible()

  // Both clips sit at the canvas origin; drag the selected one clear of the
  // other so they play side by side.
  const box = page.locator('[data-canvas-wrapper] .border-violet-400').first()
  await expect(box).toBeVisible()
  // Clicking Add track scrolled the page down to the timeline.
  await page.locator('[data-canvas-wrapper]').scrollIntoViewIfNeeded()
  const before = (await box.boundingBox())!
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
  await page.mouse.down()
  await page.mouse.move(before.x + before.width * 1.75, before.y + before.height / 2, {
    steps: 8,
  })
  await page.mouse.up()

  const lock = page.getByRole('button', { name: 'Lock to 320×240' })
  await expect(lock).toBeVisible()
  await expect(page.getByText(/clips that play together span/i)).toBeVisible()
  await lock.click()
  await expect(page.getByText(/^320×240 ·/)).toBeVisible()
  await expect(lock).toHaveCount(0)

  // Overlapping layers have no source-equivalent, but the sources still
  // bound the estimate, and nothing claims the export outgrows the source.
  await expect(page.getByText(/likely larger than the source/i)).toHaveCount(0)
  const range = await readRange(page)
  expectInRange(await exportCurrent(page, 0), range)
})
