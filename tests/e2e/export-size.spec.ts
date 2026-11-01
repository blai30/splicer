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

const UNIT_BYTES: Record<string, number> = { B: 1, KB: 1_000, MB: 1_000_000, GB: 1_000_000_000 }

// "~98 KB (83–113 KB)" -> 98000
async function readEstimate(page: Page): Promise<number> {
  const summary = page.getByText(/~\s*[\d.]+ [KMG]?B/)
  await expect(summary).toBeVisible()
  const match = (await summary.innerText()).match(/~\s*([\d.]+) ([KMG]?B)/)
  if (!match) throw new Error('No size estimate shown')
  return Number(match[1]) * UNIT_BYTES[match[2]]
}

async function exportAt(page: Page, label: string, exportsSoFar: number) {
  await page.getByRole('radio', { name: new RegExp(`^${label}$`) }).click()
  const estimate = await readEstimate(page)
  await page.getByRole('button', { name: /export video/i }).click()
  const links = page.getByRole('link', { name: /splicer-.*\.(mp4|webm)/ })
  await expect(links).toHaveCount(exportsSoFar + 1, { timeout: 90_000 })
  // The newest export is listed first.
  const href = await links.first().getAttribute('href')
  const bytes = await page.evaluate(async (url) => (await (await fetch(url!)).blob()).size, href)
  return { estimate, bytes }
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
  await page.locator('input[type="file"]').setInputFiles([tiny, tiny])
  await expect(page.locator('[data-advanced-segment]')).toHaveCount(2)
  await expect(page.getByText(/^320×240 ·/)).toBeVisible()

  // Both clips start together at the origin; drag the selected one clear of
  // the other so they play side by side.
  const box = page.locator('[data-canvas-wrapper] .border-violet-400').first()
  await expect(box).toBeVisible()
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
})
