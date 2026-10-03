import { defineConfig, devices } from '@playwright/test'

/**
 * Team-cloud end-to-end suite (tests/e2e-cloud): the real server (server/, DEV_MODE=1, fresh
 * DATA_DIR) serving an app build with base "/" — the shape of a cloud deployment.
 *
 *   npx playwright test -c playwright.cloud.config.ts
 *   CLOUD_E2E_PORT=4520 npx playwright test -c playwright.cloud.config.ts   (parallel suites)
 *   CLOUD_E2E_SKIP_BUILD=1 …   reuse the last app + server build while iterating on tests
 *
 * Sign-in links come from the dev mailbox (GET /api/dev/mailbox), see tests/e2e-cloud/fixtures.ts.
 * The server's data lives in DATA (node_modules/.cache/cloud-data-<port>); tests may read its SQLite file.
 */
const PORT = Number(process.env.CLOUD_E2E_PORT) || 4500
const OUT = `node_modules/.cache/cloud-dist-${PORT}`
const DATA = `node_modules/.cache/cloud-data-${PORT}`
const ORIGIN = `http://127.0.0.1:${PORT}`

const build = process.env.CLOUD_E2E_SKIP_BUILD
  ? ''
  : `BASE_PATH=/ npx vite build --outDir ${OUT} --emptyOutDir --logLevel error && (cd server && npm run build --silent) && `

export default defineConfig({
  testDir: './tests/e2e-cloud',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `${ORIGIN}/`,
    locale: 'en-US',
    timezoneId: 'Europe/Berlin',
    colorScheme: 'light',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command:
      `${build}rm -rf ${DATA} && ` +
      // AUTH_IP_LIMIT (DEV_MODE only): every test signs people in from 127.0.0.1 — deployments keep 20 per 15 min
      `PORT=${PORT} HOST=127.0.0.1 DATA_DIR=${DATA} APP_DIR=${OUT} PUBLIC_URL=${ORIGIN} DEV_MODE=1 AUTH_IP_LIMIT=1000 SIGNUP=open LOG_LEVEL=warn ` +
      `node --disable-warning=ExperimentalWarning server/dist/index.js`,
    url: `${ORIGIN}/api/health`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
