import { expect, test } from '@playwright/test'

test('loads without a service worker controller or a forced reload', async ({ page }) => {
  let loads = 0
  page.on('load', () => {
    loads += 1
  })
  await page.goto('/splicer/')
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('tab', { name: 'Basic' })).toBeVisible()
  // Give a registering worker time to take control and reload, as the old
  // coi-serviceworker did on the first visit.
  await page.waitForTimeout(1000)
  expect(loads).toBe(1)
  const state = await page.evaluate(async () => ({
    controlled: navigator.serviceWorker.controller !== null,
    isolated: window.crossOriginIsolated,
  }))
  expect(state).toEqual({ controlled: false, isolated: false })
})

test('the old coi-serviceworker URL now unregisters itself', async ({ page }) => {
  await page.goto('/splicer/')
  // A returning visitor's registration updates to the stub, which removes it.
  const remaining = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register(
      new URL('coi-serviceworker.min.js', location.href).href
    )
    await new Promise<void>((resolve) => {
      const worker = registration.installing ?? registration.waiting ?? registration.active
      if (!worker || worker.state === 'activated' || worker.state === 'redundant') resolve()
      else
        worker.addEventListener('statechange', () => {
          if (worker.state === 'activated' || worker.state === 'redundant') resolve()
        })
    })
    for (let attempt = 0; attempt < 50; attempt++) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      if (!registrations.some((entry) => entry.active?.scriptURL.includes('coi-serviceworker')))
        return 0
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return 1
  })
  expect(remaining).toBe(0)
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull()
})
