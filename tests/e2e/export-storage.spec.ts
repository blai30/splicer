import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

import { probeExport } from './helpers/probeExport'

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))
// 1280x720 30 fps, 2 s, ~1.5 Mbps, no audio: large enough to stream.
const detailed720p = fixture('detailed-720p.mp4')
// 320x240 30 fps, 2 s, ~46 kbps with audio.
const tiny = fixture('tiny.mp4')

// Files under exports/ in the origin private file system, with sizes.
function storedExports(page: Page) {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const exportsDir = await root.getDirectoryHandle('exports', { create: true })
    const files: { path: string; size: number }[] = []
    for await (const [folderName, folder] of exportsDir.entries()) {
      if (folder.kind !== 'directory') continue
      for await (const [fileName, file] of (folder as FileSystemDirectoryHandle).entries()) {
        if (file.kind !== 'file') continue
        const size = (await (file as FileSystemFileHandle).getFile()).size
        files.push({ path: `${folderName}/${fileName}`, size })
      }
    }
    return files
  })
}

test('streams an export to disk and deletes it with its record', async ({ page }) => {
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles(detailed720p)
  await expect(page.locator('[data-segment]')).toHaveCount(1)
  await page.getByRole('button', { name: /export video/i }).click()
  const link = page.getByRole('link', { name: /splicer-.*\.mp4/ })
  await expect(link).toHaveCount(1, { timeout: 90_000 })

  const stored = await storedExports(page)
  expect(stored).toHaveLength(1)
  const probe = await probeExport(page, (await link.getAttribute('href'))!)
  expect(stored[0].size).toBe(probe.bytes)
  expect(probe.videoPackets).toBe(60)
  expect(probe.videoDurationSec).toBeCloseTo(2, 2)
  // Fast start survives streaming: the index is reserved ahead of the media.
  expect(probe.boxes.slice(0, 2)).toEqual(['ftyp', 'moov'])
  expect(probe.boxes.indexOf('moov')).toBeLessThan(probe.boxes.indexOf('mdat'))

  await page.getByRole('button', { name: /^Remove splicer-/ }).click()
  await expect.poll(() => storedExports(page)).toHaveLength(0)
})

test('streams WebM with audio in sync', async ({ page }) => {
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles(tiny)
  await expect(page.locator('[data-segment]')).toHaveCount(1)
  await page.getByRole('radio', { name: /^WebM$/ }).click()
  await page.getByRole('button', { name: /export video/i }).click()
  const link = page.getByRole('link', { name: /splicer-.*\.webm/ })
  await expect(link).toHaveCount(1, { timeout: 90_000 })
  expect(await storedExports(page)).toHaveLength(1)
  const probe = await probeExport(page, (await link.getAttribute('href'))!)
  expect(probe.videoPackets).toBe(60)
  expect(Math.abs(probe.audioDurationSec! - probe.videoDurationSec)).toBeLessThan(0.05)
})

test('a small MP4 stays in memory with an exact fast-start index', async ({ page }) => {
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles(tiny)
  await expect(page.locator('[data-segment]')).toHaveCount(1)
  await page.getByRole('button', { name: /export video/i }).click()
  const link = page.getByRole('link', { name: /splicer-.*\.mp4/ })
  await expect(link).toHaveCount(1, { timeout: 90_000 })
  expect(await storedExports(page)).toHaveLength(0)
  const probe = await probeExport(page, (await link.getAttribute('href'))!)
  expect(probe.boxes).toEqual(['ftyp', 'moov', 'mdat'])
})

// A WebM source has no packet index to bound a reserved MP4 index with, so a
// small export is built in memory to keep its index up front.
test('an MP4 from a WebM source keeps fast start', async ({ page }) => {
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles(tiny)
  await expect(page.locator('[data-segment]')).toHaveCount(1)
  await page.getByRole('radio', { name: /^WebM$/ }).click()
  await page.getByRole('button', { name: /export video/i }).click()
  const webmLink = page.getByRole('link', { name: /splicer-.*\.webm/ })
  await expect(webmLink).toHaveCount(1, { timeout: 90_000 })
  const webmBytes = await page.evaluate(
    async (url) => {
      return Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer()))
    },
    (await webmLink.getAttribute('href'))!
  )

  await page.reload()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'source.webm',
    mimeType: 'video/webm',
    buffer: Buffer.from(webmBytes),
  })
  await expect(page.locator('[data-segment]')).toHaveCount(1)
  await page.getByRole('radio', { name: /^MP4$/ }).click()
  await page.getByRole('button', { name: /export video/i }).click()
  const mp4Link = page.getByRole('link', { name: /splicer-.*\.mp4/ })
  await expect(mp4Link).toHaveCount(1, { timeout: 90_000 })
  const probe = await probeExport(page, (await mp4Link.getAttribute('href'))!)
  expect(probe.boxes).toEqual(['ftyp', 'moov', 'mdat'])
  expect(probe.videoPackets).toBe(60)
})

test('a canceled export leaves no file behind', async ({ page }) => {
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles([tiny, tiny, tiny, tiny])
  await expect(page.locator('[data-segment]')).toHaveCount(4)
  // WebM always streams.
  await page.getByRole('radio', { name: /^WebM$/ }).click()
  await page.getByRole('button', { name: /export video/i }).click()
  // Cancel once frames are being written, so the partial file exists.
  await expect
    .poll(async () => Number(await page.getByRole('progressbar').getAttribute('aria-valuenow')))
    .toBeGreaterThan(0)
  await expect.poll(() => storedExports(page)).toHaveLength(1)
  await page.getByRole('button', { name: /cancel export/i }).click()
  await expect(page.getByRole('button', { name: /export video/i })).toBeEnabled()
  await expect.poll(() => storedExports(page), { timeout: 10_000 }).toHaveLength(0)
})

test('removes exports left behind by a closed tab on the next load', async ({ page }) => {
  await page.goto('/splicer/')
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const exportsDir = await root.getDirectoryHandle('exports', { create: true })
    const folder = await exportsDir.getDirectoryHandle('closed-tab', { create: true })
    await folder.getFileHandle('export-left-over.mp4', { create: true })
  })
  await page.reload()
  await expect.poll(() => storedExports(page)).toHaveLength(0)
})
