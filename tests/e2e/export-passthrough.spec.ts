import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

import { probeExport } from './helpers/probeExport'

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))
// 320x240 30 fps, 2 s, 60 frames.
const tiny = fixture('tiny.mp4')
// 320x180 30 fps, 1 s, 30 frames.
const wide = fixture('wide-stereo48k.mp4')

async function exportNewest(page: Page, exportsSoFar: number) {
  await page.getByRole('button', { name: /export video/i }).click()
  const links = page.getByRole('link', { name: /splicer-.*\.(mp4|webm)/ })
  await expect(links).toHaveCount(exportsSoFar + 1, { timeout: 90_000 })
  // The newest export is listed first.
  return probeExport(page, (await links.first().getAttribute('href'))!)
}

test('a same-size clip keeps every frame and its duration', async ({ page }) => {
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles(tiny)
  await expect(page.locator('[data-segment]')).toHaveCount(1)
  const probe = await exportNewest(page, 0)
  expect(probe.width).toBe(320)
  expect(probe.height).toBe(240)
  expect(probe.videoPackets).toBe(60)
  expect(probe.videoDurationSec).toBeCloseTo(2, 2)
  expect(Math.abs(probe.audioDurationSec! - probe.videoDurationSec)).toBeLessThan(0.05)
})

// The first clip passes straight through and the letterboxed second one is
// drawn, so both paths share one track.
test('passthrough and drawn slices join with the source frame counts', async ({ page }) => {
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles([tiny, wide])
  await expect(page.locator('[data-segment]')).toHaveCount(2)
  const probe = await exportNewest(page, 0)
  expect(probe.width).toBe(320)
  expect(probe.height).toBe(240)
  expect(probe.videoPackets).toBe(90)
  expect(probe.videoDurationSec).toBeCloseTo(3, 2)
  expect(Math.abs(probe.audioDurationSec! - probe.videoDurationSec)).toBeLessThan(0.05)

  // Constant-rate output resamples passthrough frames like drawn ones.
  await page.getByRole('radio', { name: /^24 fps$/ }).click()
  const resampled = await exportNewest(page, 1)
  expect(resampled.videoPackets).toBe(72)
  expect(resampled.videoDurationSec).toBeCloseTo(3, 1)
})
