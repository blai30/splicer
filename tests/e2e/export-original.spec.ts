import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

import { planSliceCopyFromIndex } from '../../src/lib/fastCopy'
import { readPacketIndex } from '../../src/lib/packetIndex'
import { probeExport } from './helpers/probeExport'

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))
// 320x240 30 fps, 4 s, a key frame every second, B-frames; AAC audio.
const gopMp4 = fixture('gop-1s.mp4')
// The same picture as VP9 with Opus.
const gopWebm = fixture('gop-1s.webm')
// 160x120 15 fps H.264, 6 s, key frames only at 0 s and 5 s, no audio.
const gop5s = fixture('gop-5s.mp4')
// 1280x720 30 fps H.264, 2 s, no audio.
const detailed720p = fixture('detailed-720p.mp4')

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const segments = (page: Page) => page.locator('[data-segment]')

async function importClip(page: Page, file: string) {
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles(file)
  await expect(segments(page)).toHaveCount(1)
  await page.locator('[data-track]').scrollIntoViewIfNeeded()
}

// Click into the segment `seconds` in (80 px/s) and set the in-point there.
async function setInPoint(page: Page, seconds: number) {
  const block = (await segments(page).first().boundingBox())!
  await page.mouse.click(block.x + seconds * 80, block.y + block.height / 2)
  await page.keyboard.press('i')
}

async function exportBytes(
  page: Page,
  extension: string
): Promise<{ href: string; bytes: Buffer }> {
  await page.getByRole('button', { name: /export video/i }).click()
  const link = page.getByRole('link', { name: new RegExp(`splicer-.*\\.${extension}`) }).first()
  await expect(link).toBeVisible({ timeout: 90_000 })
  const href = (await link.getAttribute('href'))!
  const data = await page.evaluate(async (url) => {
    const buffer = await (await fetch(url)).arrayBuffer()
    return Array.from(new Uint8Array(buffer))
  }, href)
  return { href, bytes: Buffer.from(data) }
}

const UNIT_BYTES: Record<string, number> = { B: 1, KB: 1_000, MB: 1_000_000 }

async function readEstimate(page: Page): Promise<number> {
  const summary = page.getByText(/~\s*[\d.]+ [KM]?B · video copied as is/)
  await expect(summary).toBeVisible()
  const match = (await summary.innerText()).match(/~\s*([\d.]+) ([KM]?B)/)!
  return Number(match[1]) * UNIT_BYTES[match[2]]
}

// ffprobe's codec name and a full decode that must report no errors.
function checkWithFfmpeg(path: string): string {
  const codec = execFileSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=codec_name',
    '-of',
    'csv=p=0',
    path,
  ])
    .toString()
    .trim()
  const errors = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'null', '-'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString()
  expect(errors).toBe('')
  return codec
}

test('Original copies the source packets from the key frame before the cut', async ({
  page,
}, testInfo) => {
  await importClip(page, gopMp4)
  await setInPoint(page, 1.3)
  await page.getByRole('radio', { name: 'Original (no re-encode)' }).click()

  // The cut moves back to the key frame at 1 s, on the timeline and in the panel.
  await expect(page.getByText(/Segment 1: starts at 0:01\.00, 0\.3\d s earlier/)).toBeVisible()
  await expect(page.locator('[data-copy-snap]')).toBeVisible()
  const estimate = await readEstimate(page)

  const { href, bytes } = await exportBytes(page, 'mp4')
  const probe = await probeExport(page, href)
  // 1.0 s to 4.0 s of the source.
  expect(probe.videoDurationSec).toBeCloseTo(3, 1)
  // Audio is re-encoded over the same snapped span.
  expect(probe.audioDurationSec).toBeCloseTo(3, 1)
  expect(probe.width).toBe(320)
  expect(probe.height).toBe(240)

  // The video track is the source's own packets for that span.
  const index = await readPacketIndex(new Blob([readFileSync(gopMp4)]))
  const sourceSlice = planSliceCopyFromIndex(index, 1.3, 4)!
  expect(probe.videoPackets).toBe(sourceSlice.sequenceNumbers.length)
  // Audio (about 64 kbps for 3 s) and the container come on top.
  expect(bytes.length).toBeGreaterThan(sourceSlice.byteLength)
  expect(bytes.length).toBeLessThan(sourceSlice.byteLength + 40_000)
  expect(bytes.length / estimate).toBeGreaterThan(0.9)
  expect(bytes.length / estimate).toBeLessThan(1.1)

  if (hasFfmpeg()) {
    const path = testInfo.outputPath('original.mp4')
    writeFileSync(path, bytes)
    expect(checkWithFfmpeg(path)).toBe('h264')
  }
})

test('Original joins copied segments with audio in sync', async ({ page }, testInfo) => {
  await importClip(page, gopMp4)
  await page.locator('input[type="file"]').setInputFiles(gopMp4)
  await expect(segments(page)).toHaveCount(2)
  // Second segment: in-point at 2.5 s of its clip, which snaps to 2 s.
  const second = (await segments(page).nth(1).boundingBox())!
  await page.mouse.click(second.x + 2.5 * 80, second.y + second.height / 2)
  await page.keyboard.press('i')
  await page.getByRole('radio', { name: 'Original (no re-encode)' }).click()
  await expect(page.getByText(/Segment 2: starts at 0:02\.00, 0\.5\d s earlier/)).toBeVisible()
  // 4 s of the first clip and 2 s (from the key frame) of the second.
  await expect(page.getByText(/· 0:06\.0 ·/)).toBeVisible()

  const { href, bytes } = await exportBytes(page, 'mp4')
  const probe = await probeExport(page, href)
  expect(probe.videoDurationSec).toBeCloseTo(6, 1)
  expect(probe.audioDurationSec).toBeCloseTo(6, 1)
  expect(probe.videoPackets).toBe(180)
  if (hasFfmpeg()) {
    const path = testInfo.outputPath('joined.mp4')
    writeFileSync(path, bytes)
    expect(checkWithFfmpeg(path)).toBe('h264')
  }
})

test('Original warns when a cut moves back more than 3 s', async ({ page }) => {
  await importClip(page, gop5s)
  await setInPoint(page, 4.5)
  await page.getByRole('radio', { name: 'Original (no re-encode)' }).click()
  await expect(page.getByText(/moves back more than 3 s/)).toBeVisible()
  await expect(page.getByText(/Segment 1: starts at 0:00\.00, 4\.5\d s earlier/)).toBeVisible()
})

const containers = [
  { format: 'MOV', extension: 'mov', source: gopMp4, codec: 'h264' },
  { format: 'MKV', extension: 'mkv', source: gopMp4, codec: 'h264' },
  { format: 'WebM', extension: 'webm', source: gopWebm, codec: 'vp9' },
  { format: 'MKV', extension: 'mkv', source: gopWebm, codec: 'vp9' },
]

for (const { format, extension, source, codec } of containers) {
  test(`Original copies ${codec} into ${format}`, async ({ page }, testInfo) => {
    await importClip(page, source)
    await setInPoint(page, 2.5)
    await page.getByRole('radio', { name: new RegExp(`^${format}$`) }).click()
    await page.getByRole('radio', { name: 'Original (no re-encode)' }).click()
    await expect(page.getByText(/Segment 1: starts at 0:02\.00/)).toBeVisible()

    const { href, bytes } = await exportBytes(page, extension)
    const probe = await probeExport(page, href)
    expect(probe.videoDurationSec).toBeCloseTo(2, 1)
    expect(probe.audioDurationSec).toBeCloseTo(2, 1)
    if (hasFfmpeg()) {
      const path = testInfo.outputPath(`original.${extension}`)
      writeFileSync(path, bytes)
      expect(checkWithFfmpeg(path)).toBe(codec)
    }
  })
}

test('Original is unavailable with a reason when a setting needs a re-encode', async ({ page }) => {
  await importClip(page, gopMp4)
  const original = page.getByRole('radio', { name: 'Original (no re-encode)' })
  await expect(original).not.toHaveAttribute('aria-disabled')
  await page.getByRole('radio', { name: /^30 fps$/ }).click()
  await expect(original).toHaveAttribute('aria-disabled', 'true')
  await expect(original).toHaveAttribute('title', /FPS must be Original/)
  // aria-disabled keeps it hoverable for the tooltip; a click does nothing.
  await original.click({ force: true })
  await expect(original).toHaveAttribute('aria-checked', 'false')

  // WebM cannot hold this H.264 source.
  await page
    .getByRole('radio', { name: /^Original$/ })
    .first()
    .click()
  await page.getByRole('radio', { name: /^WebM$/ }).click()
  await expect(original).toHaveAttribute('title', /WebM cannot hold H\.264/)
})

test('360p caps the output size', async ({ page }) => {
  await importClip(page, detailed720p)
  await page
    .getByRole('radiogroup', { name: 'Resolution' })
    .getByRole('radio', { name: '360p' })
    .click()
  await expect(page.getByText(/640×360 ·/)).toBeVisible()
  const { href } = await exportBytes(page, 'mp4')
  const probe = await probeExport(page, href)
  expect(probe.width).toBe(640)
  expect(probe.height).toBe(360)
})

test('a resolution cap scales an Advanced composition rather than cropping it', async ({
  page,
}) => {
  await page.goto('/splicer/')
  await page.getByRole('tab', { name: 'Advanced' }).click()
  // A 1280x720 canvas with the 320x240 clip fitted in the middle (960x720).
  await page.getByRole('button', { name: '720p' }).click()
  await page.locator('input[type="file"]').setInputFiles(fixture('tiny.mp4'))
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible()
  await page
    .getByRole('radiogroup', { name: 'Resolution' })
    .getByRole('radio', { name: '360p' })
    .click()
  await expect(page.getByText(/640×360 ·/)).toBeVisible()
  const { href } = await exportBytes(page, 'mp4')
  const probe = await probeExport(page, href)
  expect(probe.width).toBe(640)
  expect(probe.height).toBe(360)

  // Scaled by half: the pillarbox ends at x = 80 and the clip's cyan bar
  // shows at x = 150. A crop would show black there.
  const [pillarbox, picture] = await page.evaluate(async (url) => {
    const video = document.createElement('video')
    video.muted = true
    video.src = url
    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve
      video.onerror = reject
    })
    video.currentTime = 0.5
    await new Promise((resolve) => (video.onseeked = resolve))
    const canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight)
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    context.drawImage(video, 0, 0)
    video.removeAttribute('src')
    return [40, 150].map((x) => Array.from(context.getImageData(x, 180, 1, 1).data.slice(0, 3)))
  }, href)
  expect(Math.max(...pillarbox)).toBeLessThan(30)
  expect(picture[1]).toBeGreaterThan(200)
  expect(picture[2]).toBeGreaterThan(200)
})

test('Target size lowers the resolution to fit and lands under the size', async ({ page }) => {
  await importClip(page, detailed720p)
  await page.getByRole('radio', { name: 'Target size' }).click()
  const custom = page.getByLabel('Custom target size in megabytes')
  await custom.fill('0.2')
  await custom.press('Enter')
  await custom.blur()
  // 0.2 MB over 2 s is under what H.264 can reach at 720p.
  await expect(page.getByText(/To fit 200 KB: 852×480/)).toBeVisible()
  const { href, bytes } = await exportBytes(page, 'mp4')
  const probe = await probeExport(page, href)
  expect(probe.height).toBe(480)
  expect(bytes.length).toBeLessThanOrEqual(200_000 * 1.03)
  expect(bytes.length).toBeGreaterThan(200_000 * 0.6)
})
