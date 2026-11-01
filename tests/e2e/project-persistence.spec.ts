import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))
const tiny = fixture('tiny.mp4')
const tall = fixture('tall-silent.mp4')

// What the autosave has stored: segment counts and the clip ids with files.
async function storedProject(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ basic: number; advanced: number; media: string[] } | null>((resolve) => {
        const request = indexedDB.open('splicer-project')
        request.onerror = () => resolve(null)
        request.onsuccess = () => {
          const database = request.result
          if (!database.objectStoreNames.contains('project')) {
            database.close()
            resolve(null)
            return
          }
          const transaction = database.transaction(['project', 'media'])
          const project = transaction.objectStore('project').get('current')
          const media = transaction.objectStore('media').getAllKeys()
          transaction.oncomplete = () => {
            database.close()
            const record = project.result
            resolve(
              record
                ? {
                    basic: record.timeline.length,
                    advanced: record.advancedSegments.length,
                    media: media.result as string[],
                  }
                : null
            )
          }
        }
      })
  )
}

async function forgetStoredFile(page: Page, clipIndex: number) {
  await page.evaluate(
    (index) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('splicer-project')
        request.onsuccess = () => {
          const database = request.result
          const transaction = database.transaction(['project', 'media'], 'readwrite')
          const project = transaction.objectStore('project').get('current')
          project.onsuccess = () => {
            transaction.objectStore('media').delete(project.result.clips[index].id)
          }
          transaction.oncomplete = () => {
            database.close()
            resolve()
          }
          transaction.onerror = () => reject(transaction.error)
        }
      }),
    clipIndex
  )
}

test('restores both editors after a reload', async ({ page }) => {
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles([tiny, tall])
  await expect(page.locator('[data-segment]')).toHaveCount(2)
  await page.getByRole('tab', { name: 'Advanced' }).click()
  await page.locator('input[type="file"]').setInputFiles(tiny)
  await expect(page.locator('[data-advanced-segment]')).toHaveCount(1)

  await expect
    .poll(() => storedProject(page))
    .toEqual({ basic: 2, advanced: 1, media: expect.any(Array) })
  expect((await storedProject(page))?.media).toHaveLength(3)

  await page.reload()
  const banner = page.getByRole('region', { name: 'Saved project' })
  await expect(banner).toContainText('3 clips, 3 segments')
  // Nothing comes back until the user asks.
  await expect(page.locator('[data-advanced-segment]')).toHaveCount(0)
  await banner.getByRole('button', { name: 'Restore' }).click()
  await expect(banner).toHaveCount(0)
  await expect(page.locator('[data-advanced-segment]')).toHaveCount(1)
  await page.getByRole('tab', { name: 'Basic' }).click()
  await expect(page.locator('[data-segment]')).toHaveCount(2)
  await expect(page.locator('[data-segment]').first()).toContainText('tiny')
  await expect(page.locator('[data-segment]').nth(1)).toContainText('tall-silent')

  // The restored clips play and export like freshly imported ones.
  await page.getByRole('button', { name: /export video/i }).click()
  await expect(page.getByRole('link', { name: /splicer-.*\.mp4/ })).toBeVisible({
    timeout: 90_000,
  })
})

test('discarding the saved project starts over', async ({ page }) => {
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles(tiny)
  await expect.poll(async () => (await storedProject(page))?.basic).toBe(1)

  await page.reload()
  await page
    .getByRole('region', { name: 'Saved project' })
    .getByRole('button', { name: 'Discard' })
    .click()
  await expect(page.getByRole('region', { name: 'Saved project' })).toHaveCount(0)
  await expect(page.locator('[data-segment]')).toHaveCount(0)
  await expect.poll(() => storedProject(page)).toBeNull()

  await page.reload()
  await expect(page.getByRole('tab', { name: 'Basic' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Saved project' })).toHaveCount(0)
})

test('keeps the project when a stored file is missing and relinks it', async ({ page }) => {
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles([tiny, tall])
  await expect.poll(async () => (await storedProject(page))?.media.length).toBe(2)
  await forgetStoredFile(page, 1)

  await page.reload()
  await page
    .getByRole('region', { name: 'Saved project' })
    .getByRole('button', { name: 'Restore' })
    .click()
  await expect(page.locator('[data-segment]')).toHaveCount(1)
  const relink = page.getByRole('region', { name: 'Clips to relink' })
  await expect(relink).toContainText('tall-silent.mp4')
  // An edit before the relink, so undo has a snapshot from before it.
  await page.locator('[data-segment]').first().click()
  await page.keyboard.press('m')
  await expect(page.locator('[data-segment]').first()).toHaveAccessibleName(/muted/i)

  // The wrong file is refused and the clip stays listed.
  await relink.getByLabel('Relink tall-silent.mp4').setInputFiles(tiny)
  await expect(relink.getByRole('alert')).toContainText('does not match')

  await relink.getByLabel('Relink tall-silent.mp4').setInputFiles(tall)
  await expect(relink).toHaveCount(0)
  await expect(page.locator('[data-segment]')).toHaveCount(2)
  await expect(page.locator('[data-segment]').nth(1)).toContainText('tall-silent')
  await expect.poll(async () => (await storedProject(page))?.media.length).toBe(2)

  // Undo steps back over the mute only; the relinked segment stays.
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.locator('[data-segment]').first()).not.toHaveAccessibleName(/muted/i)
  await expect(page.locator('[data-segment]')).toHaveCount(2)
  await expect(page.locator('[data-segment]').nth(1)).toContainText('tall-silent')
})

test('a second tab does not save over the first', async ({ page, context }) => {
  await page.goto('/splicer/')
  await page.locator('input[type="file"]').setInputFiles([tiny, tall])
  await expect.poll(async () => (await storedProject(page))?.media.length).toBe(2)

  const second = await context.newPage()
  await second.goto('/splicer/')
  await expect(second.getByText(/open in another tab/)).toBeVisible()
  // No offer to restore or discard what the first tab owns.
  await expect(second.getByRole('region', { name: 'Saved project' })).toHaveCount(0)
  await second.locator('input[type="file"]').setInputFiles(tiny)
  await expect(second.locator('[data-segment]')).toHaveCount(1)
  await second.waitForTimeout(1500)
  expect(await storedProject(page)).toEqual({ basic: 2, advanced: 0, media: expect.any(Array) })
  expect((await storedProject(page))?.media).toHaveLength(2)
  await second.close()
})
