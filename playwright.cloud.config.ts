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
 * The server's data lives in DATA (node_modules/.cache/cloud-data-<port>); tests may read its SQLite file
 * (workspace content in it is encrypted with DATA_KEY below — metadata like names and members is not).
 */
const PORT = Number(process.env.CLOUD_E2E_PORT) || 4500
const OUT = `node_modules/.cache/cloud-dist-${PORT}`
const DATA = `node_modules/.cache/cloud-data-${PORT}`
const ORIGIN = `http://127.0.0.1:${PORT}`
/** tests/e2e-cloud/mcp-media.spec.ts serves its made-up media host here (MEDIA_FETCH_HOSTS, DEV_MODE only) */
const MEDIA_PORT = PORT + 1000
/**
 * Encryption at rest needs a master key (docs/SELF_HOSTING.md § DATA_KEY). This one is FAKE and for
 * this throwaway test server only: 32 ASCII bytes that say what they are. Never use it anywhere else.
 */
const DATA_KEY = Buffer.from('test-only-data-key-not-a-secret!', 'utf8').toString('base64')

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
      `PORT=${PORT} HOST=127.0.0.1 DATA_DIR=${DATA} APP_DIR=${OUT} PUBLIC_URL=${ORIGIN} DEV_MODE=1 AUTH_IP_LIMIT=1000 SIGNUP=open LOG_LEVEL=warn DATA_KEY=${DATA_KEY} MEDIA_FETCH_HOSTS=media.e2e.test=127.0.0.1:${MEDIA_PORT} ` +
      `node --disable-warning=ExperimentalWarning server/dist/index.js`,
    url: `${ORIGIN}/api/health`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
