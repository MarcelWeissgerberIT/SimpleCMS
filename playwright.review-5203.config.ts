import { defineConfig, devices } from '@playwright/test'
// temporary (review agent): run single specs against the preview on the dev port 5203
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5203/SimpleCMS/', locale: 'en-US', timezoneId: 'Europe/Berlin', colorScheme: 'light', serviceWorkers: 'block', actionTimeout: 10_000 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
})
