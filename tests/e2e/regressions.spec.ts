import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))
const tiny = fixture('tiny.mp4')
const tall = fixture('tall-silent.mp4')
const wide = fixture('wide-stereo48k.mp4')

async function exportAndWait(page: Page, linkIndex = 0) {
  await page.getByRole('button', { name: /export video/i }).click()
  await expect(page.getByRole('link', { name: /splicer-.*\.mp4/ }).nth(linkIndex)).toBeVisible({
    timeout: 90_000,
  })
}

test('deleting in Basic does not break a clip used by Advanced', async ({ page }) => {
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles(tiny)
  await expect(page.locator('[data-segment]')).toHaveCount(1)

  await page.getByRole('tab', { name: 'Advanced' }).click()
  await page.locator('input[type="file"]').setInputFiles(tiny)
  await expect(page.locator('[data-advanced-segment]')).toHaveCount(1)

  await page.getByRole('tab', { name: 'Basic' }).click()
  await page.getByRole('button', { name: 'Delete selected segment' }).click()
  await expect(page.locator('[data-segment]')).toHaveCount(0)

  await page.getByRole('tab', { name: 'Advanced' }).click()
  await expect(page.locator('[data-advanced-segment]')).toContainText('tiny')
  await exportAndWait(page)
  await expect(page.getByText(/export failed/i)).toHaveCount(0)
})

test('exports mixed sizes, rates, and a silent clip in one Basic timeline', async ({ page }) => {
  await page.goto('/splicer/')
  // 320x180 @ 48 kHz stereo, 160x284 without audio, 320x240 @ 44.1 kHz mono.
  await page.locator('input[type="file"]').setInputFiles([wide, tall, tiny])
  await expect(page.locator('[data-segment]')).toHaveCount(3)
  // The first clip sets the frame; the others are letterboxed into it.
  await expect(page.getByText(/^320×180 ·/)).toBeVisible()
  await exportAndWait(page)
  await expect(page.getByText(/export failed/i)).toHaveCount(0)
  await expect(page.getByRole('cell', { name: '320×180' })).toBeVisible()
})

test('canceling an export settles immediately and allows a new export', async ({ page }) => {
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles([wide, wide, wide, wide])
  await expect(page.locator('[data-segment]')).toHaveCount(4)
  await page.getByRole('button', { name: /export video/i }).click()
  await page.getByRole('button', { name: /cancel export/i }).click()
  await expect(page.getByRole('button', { name: /export video/i })).toBeEnabled()
  await expect(page.getByText(/export failed/i)).toHaveCount(0)
  await exportAndWait(page)
})

test('reports a file that cannot be imported', async ({ page }) => {
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'broken.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('definitely not a video'),
  })
  await expect(page.getByRole('alert')).toContainText('broken.mp4')
  await page.getByRole('button', { name: 'Dismiss import errors' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('a file dropped anywhere imports into the active editor', async ({ page }) => {
  await page.goto('/splicer/')
  await page.getByRole('tab', { name: 'Advanced' }).click()
  const bytes = readFileSync(tiny)
  const dataTransfer = await page.evaluateHandle((data) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([new Uint8Array(data)], 'tiny.mp4', { type: 'video/mp4' }))
    return transfer
  }, Array.from(bytes))
  // Drop on the site header, outside every editor panel.
  const header = page.locator('header')
  await header.dispatchEvent('dragenter', { dataTransfer })
  await header.dispatchEvent('dragover', { dataTransfer })
  await header.dispatchEvent('drop', { dataTransfer })
  await expect(page.locator('[data-advanced-segment]')).toHaveCount(1)
  await expect(page).toHaveURL(/\/splicer\/$/)
})

test('the last Advanced track cannot be removed', async ({ page }) => {
  await page.goto('/splicer/')
  await page.getByRole('tab', { name: 'Advanced' }).click()
  await expect(page.getByRole('button', { name: 'Remove Track 1' })).toBeDisabled()
})

test('mode tabs support arrow-key navigation', async ({ page }) => {
  await page.goto('/splicer/')
  await page.getByRole('tab', { name: 'Basic' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Advanced' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab', { name: 'Advanced' })).toBeFocused()
})

test('the layout does not scroll horizontally on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 })
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles(tiny)
  await expect(page.locator('[data-segment]')).toHaveCount(1)
  for (const tab of ['Basic', 'Advanced']) {
    await page.getByRole('tab', { name: tab }).click()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    )
    expect(overflow, `${tab} overflows`).toBeLessThanOrEqual(0)
  }
})
