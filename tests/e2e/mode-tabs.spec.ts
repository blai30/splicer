import { expect, test } from '@playwright/test'

test('switches between Basic and Advanced and remembers the choice', async ({ page }) => {
  await page.goto('/splicer/')

  // Basic is the default mode on first visit.
  await expect(page.getByRole('tab', { name: 'Basic' })).toHaveAttribute('aria-selected', 'true')

  // Switching to Advanced shows the placeholder.
  await page.getByRole('tab', { name: 'Advanced' }).click()
  await expect(page.getByText(/multi-track compositor/i)).toBeVisible()

  // The choice is remembered across reloads.
  await page.reload()
  await expect(page.getByRole('tab', { name: 'Advanced' })).toHaveAttribute('aria-selected', 'true')
})
