import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end suite (tests/e2e). It exercises the real GitHub Pages deploy shape:
 * a production build with base /SimpleCMS/, served by `vite preview` under that base.
 *
 * The build goes to its own folder (inside node_modules, so it is never committed and
 * never collides with `dist/` or other local servers). Set E2E_SKIP_BUILD=1 to reuse the
 * last e2e build while iterating on test code.
 *
 *   npm run test:e2e
 *   E2E_SKIP_BUILD=1 npx playwright test tests/e2e/editor.spec.ts
 */
const PORT = 4180
const BASE_PATH = '/SimpleCMS/'
const OUT_DIR = 'node_modules/.cache/e2e-dist'

const build = process.env.E2E_SKIP_BUILD ? '' : `npx vite build --outDir ${OUT_DIR} --emptyOutDir --logLevel error && `

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}${BASE_PATH}`,
    locale: 'en-US',
    timezoneId: 'Europe/Berlin',
    colorScheme: 'light',
    // determinism: no offline service worker between tests (tests/e2e/offline.spec.ts opts back in)
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
  },
  webServer: {
    command: `${build}npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort --outDir ${OUT_DIR}`,
    env: { BASE_PATH },
    url: `http://127.0.0.1:${PORT}${BASE_PATH}app/`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
})
