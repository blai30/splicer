import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

import { probeExport } from './helpers/probeExport'

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))
// 320x240 30 fps, 2 s, with audio.
const tiny = fixture('tiny.mp4')
// 1280x720 30 fps, 2 s, no audio.
const detailed720p = fixture('detailed-720p.mp4')

test('removes the audio track from the export', async ({ page }) => {
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles(tiny)
  await expect(page.locator('[data-segment]')).toHaveCount(1)
  await page
    .getByRole('radiogroup', { name: 'Audio' })
    .getByRole('radio', { name: 'Remove' })
    .click()
  await page.getByRole('button', { name: /export video/i }).click()
  const link = page.getByRole('link', { name: /splicer-.*\.mp4/ })
  await expect(link).toHaveCount(1, { timeout: 90_000 })
  const probe = await probeExport(page, (await link.getAttribute('href'))!)
  expect(probe.audioDurationSec).toBeNull()
  expect(probe.videoDurationSec).toBeCloseTo(2, 1)
})

test('removes the audio from a stream copy', async ({ page }) => {
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles(tiny)
  await expect(page.locator('[data-segment]')).toHaveCount(1)
  await page.getByRole('radio', { name: 'Original (no re-encode)' }).click()
  await page
    .getByRole('radiogroup', { name: 'Audio' })
    .getByRole('radio', { name: 'Remove' })
    .click()
  await expect(page.getByText('video copied as is')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: /export video/i }).click()
  const link = page.getByRole('link', { name: /splicer-.*\.mp4/ })
  await expect(link).toHaveCount(1, { timeout: 90_000 })
  const probe = await probeExport(page, (await link.getAttribute('href'))!)
  expect(probe.audioDurationSec).toBeNull()
  expect(probe.videoPackets).toBeGreaterThan(0)
})

test('exports each segment as its own numbered file', async ({ page }) => {
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles([tiny, detailed720p])
  await expect(page.locator('[data-segment]')).toHaveCount(2)
  await page
    .getByRole('radiogroup', { name: 'Output' })
    .getByRole('radio', { name: 'File per segment' })
    .click()
  await page.getByRole('button', { name: 'Export 2 files' }).click()
  await expect(page.getByText('Exported 2 files.')).toBeVisible({ timeout: 120_000 })

  const first = page.getByRole('link', { name: /splicer-.*-part-1\.mp4/ })
  const second = page.getByRole('link', { name: /splicer-.*-part-2\.mp4/ })
  const firstProbe = await probeExport(page, (await first.getAttribute('href'))!)
  const secondProbe = await probeExport(page, (await second.getAttribute('href'))!)
  // Each file holds only its own segment, at that segment's size.
  expect(firstProbe.videoDurationSec).toBeCloseTo(2, 1)
  expect(secondProbe.videoDurationSec).toBeCloseTo(2, 1)
  expect(firstProbe.width).toBe(320)
  expect(secondProbe.width).toBe(1280)
})

test('turns off per-segment files while Target size is picked', async ({ page }) => {
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles([tiny, detailed720p])
  await expect(page.locator('[data-segment]')).toHaveCount(2)
  await page
    .getByRole('radiogroup', { name: 'Output' })
    .getByRole('radio', { name: 'File per segment' })
    .click()
  await page.getByRole('radio', { name: 'Target size' }).click()
  await expect(
    page
      .getByRole('radiogroup', { name: 'Output' })
      .getByRole('radio', { name: 'File per segment' })
  ).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByRole('button', { name: /export video/i })).toBeVisible()
})

test('saves the frame on screen as a PNG', async ({ page }) => {
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles(detailed720p)
  await expect(page.locator('[data-segment]')).toHaveCount(1)
  await expect
    .poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState))
    .toBeGreaterThanOrEqual(2)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save frame as PNG' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('detailed-720p-0m00.000s.png')
  const path = await download.path()
  const { readFile } = await import('node:fs/promises')
  const bytes = await readFile(path)
  // PNG signature, then the IHDR width and height.
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG')
  expect(bytes.readUInt32BE(16)).toBe(1280)
  expect(bytes.readUInt32BE(20)).toBe(720)
})
