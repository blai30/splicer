import { readFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'

test('links a web app manifest scoped to the site base', async ({ page, request }) => {
  await page.goto('/splicer/')
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(href).toBe('/splicer/manifest.webmanifest')
  const manifestUrl = new URL(href!, page.url())
  const response = await request.get(manifestUrl.href)
  expect(response.ok()).toBe(true)
  const manifest = await response.json()

  expect(manifest.display).toBe('standalone')
  expect(new URL(manifest.start_url, manifestUrl).pathname).toBe('/splicer/')
  expect(new URL(manifest.scope, manifestUrl).pathname).toBe('/splicer/')
  expect(new URL(manifest.file_handlers[0].action, manifestUrl).pathname).toBe('/splicer/')
  expect(Object.keys(manifest.file_handlers[0].accept)).toContain('video/mp4')

  const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes)
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']))
  for (const icon of manifest.icons) {
    const iconResponse = await request.get(new URL(icon.src, manifestUrl).href)
    expect(iconResponse.ok(), icon.src).toBe(true)
  }
})

test('imports videos the installed app was launched with', async ({ page }) => {
  const bytes = [...readFileSync(new URL('../fixtures/tiny.mp4', import.meta.url))]
  // Stand in for Chromium's launch queue, which only exists in an installed app.
  await page.addInitScript((fileBytes: number[]) => {
    const file = new File([new Uint8Array(fileBytes)], 'launched.mp4', { type: 'video/mp4' })
    Object.defineProperty(window, 'launchQueue', {
      value: {
        setConsumer(consumer: (params: unknown) => void) {
          consumer({ files: [{ kind: 'file', getFile: async () => file }] })
        },
      },
    })
  }, bytes)
  await page.goto('/splicer/')
  await expect(page.locator('[data-segment]')).toHaveCount(1)
  await expect(page.locator('[data-segment]')).toContainText('launched')
})
