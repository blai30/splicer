import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

import { probeExport } from './helpers/probeExport'

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))
// 320x240 30 fps, 2 s, 60 frames.
const tiny = fixture('tiny.mp4')
// 320x180 30 fps, 1 s, 30 frames.
const wide = fixture('wide-stereo48k.mp4')

async function exportNewestUrl(page: Page, exportsSoFar: number) {
  await page.getByRole('button', { name: /export video/i }).click()
  const links = page.getByRole('link', { name: /splicer-.*\.(mp4|webm)/ })
  await expect(links).toHaveCount(exportsSoFar + 1, { timeout: 90_000 })
  // The newest export is listed first.
  return (await links.first().getAttribute('href'))!
}

async function exportNewest(page: Page, exportsSoFar: number) {
  return probeExport(page, await exportNewestUrl(page, exportsSoFar))
}

type Sample = { timeSec: number; x: number; y: number }

// The RGB a browser shows at each point, played back the way a viewer sees
// it, so the stream's color range tag is applied.
function renderedColors(page: Page, url: string, samples: Sample[]) {
  return page.evaluate(
    async ({ url, samples }) => {
      const video = document.createElement('video')
      video.muted = true
      video.src = url
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve
        video.onerror = reject
      })
      const canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight)
      const context = canvas.getContext('2d', { willReadFrequently: true })!
      const colors: number[][] = []
      for (const sample of samples) {
        video.currentTime = sample.timeSec
        await new Promise((resolve) => (video.onseeked = resolve))
        context.drawImage(video, 0, 0)
        colors.push(Array.from(context.getImageData(sample.x, sample.y, 1, 1).data.slice(0, 3)))
      }
      video.removeAttribute('src')
      return colors
    },
    { url, samples }
  )
}

function expectSameColor(actual: number[], expected: number[]) {
  for (let channel = 0; channel < 3; channel++) {
    expect(Math.abs(actual[channel] - expected[channel])).toBeLessThanOrEqual(6)
  }
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

// A stream carries one color range tag, so an export that mixed decoded
// frames (limited range) with drawn ones (full range) would shift the colors
// on one side of the cut. Both sides must look like each clip exported alone.
test('a mixed export keeps both clips colors across the cut', async ({ page }) => {
  // Flat bars: green in the tiny clip, green in the wide clip below its
  // timecode. The wide clip is letterboxed 30 px down in the mixed export.
  const tinyGreen = { x: 220, y: 20 }
  const wideGreen = { x: 80, y: 160 }

  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles([tiny, wide])
  await expect(page.locator('[data-segment]')).toHaveCount(2)
  const [mixedTiny, mixedWide] = await renderedColors(page, await exportNewestUrl(page, 0), [
    { timeSec: 0.5, ...tinyGreen },
    { timeSec: 2.5, x: wideGreen.x, y: wideGreen.y + 30 },
  ])

  await page.reload()
  await page.locator('input[type="file"]').setInputFiles(tiny)
  await expect(page.locator('[data-segment]')).toHaveCount(1)
  const [aloneTiny] = await renderedColors(page, await exportNewestUrl(page, 0), [
    { timeSec: 0.5, ...tinyGreen },
  ])

  await page.reload()
  await page.locator('input[type="file"]').setInputFiles(wide)
  await expect(page.locator('[data-segment]')).toHaveCount(1)
  const [aloneWide] = await renderedColors(page, await exportNewestUrl(page, 0), [
    { timeSec: 0.5, ...wideGreen },
  ])

  expectSameColor(mixedTiny, aloneTiny)
  expectSameColor(mixedWide, aloneWide)
})
