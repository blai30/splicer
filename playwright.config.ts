import { defineConfig, devices } from '@playwright/test'

// Drives the production preview build (base path /splicer/, COOP/COEP headers
// set by astro preview). The webServer builds and serves automatically.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4321/splicer/',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm build && pnpm preview',
    url: 'http://localhost:4321/splicer/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
