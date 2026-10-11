#!/usr/bin/env node
/**
 * Per-field trust's screenshots (S1): the fictional morning of tests/e2e/helpers/trustStory.mjs on a production build,
 * written to .shots/trust/*.png (gitignored) — LOOK at each against the mocks (the agent page, Tue 07:52).
 *
 *   npx vite build --outDir node_modules/.cache/trust-shots-dist --emptyOutDir --logLevel error     # base "/"
 *   npx vite preview --host 127.0.0.1 --port 5433 --strictPort --outDir node_modules/.cache/trust-shots-dist &
 *   node scripts/trust-shots.mjs http://127.0.0.1:5433 [shot …]
 *
 * Shots:
 *   agent-1440-{light,dark}       the agent page at 1440 × 900: the run's review in view (#4 discarded as wrong with its
 *                                 Undo, the first open proposal focused: caps, the orange key, the reasons row), the
 *                                 quiet "Falsch × 3" row, the aside plate; -plate: the plate whole
 *   agent-390-{light,dark}        390 × 844 (touch): "Verwerfen ▾" open on the first proposal; -full: the whole page
 *   agent-xl-1440 / agent-xl-390  the biggest text size
 * Every shot starts from a fresh context (the demo seed + the story), German UI, no tour. Nothing leaves the machine:
 * every request to another host is refused. Browser errors are printed; any makes the exit code 1.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { seedTrust } from '../tests/e2e/helpers/trustStory.mjs'

const BASE = (process.argv[2] || 'http://127.0.0.1:5433').replace(/\/$/, '')
const ONLY = new Set(process.argv.slice(3))
const OUT = '.shots/trust'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
let failed = false

/** A fresh context on the agent's page with the story; the first proposal decided as wrong, row 1 focused. */
async function open({ width = 1440, height = 900, dark = false, mobile = false, xl = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    // 2× like the mocks' shots
    deviceScaleFactor: 2,
    colorScheme: dark ? 'dark' : 'light',
    isMobile: mobile,
    hasTouch: mobile,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    serviceWorkers: 'block',
  })
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort())
  await ctx.addInitScript(({ xl }) => {
    localStorage.setItem('one.tour', '{"off":true}')
    if (xl) localStorage.setItem('one.textScale', '4')
  }, { xl })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(`console.error: ${m.text()}`))
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`))
  page.on('response', (r) => r.status() >= 400 && !r.url().endsWith('/api/config') && errors.push(`${r.status()} ${r.url()}`))
  await page.goto(`${BASE}/app/?e2e#/`)
  await page.waitForFunction(() => !!window.__one && !document.getElementById('boot'))
  // a key is set up in this browser (the no-key notice is not part of the picture)
  await page.evaluate((dark) => window.__one.workspace.getState().updateSettings({ theme: dark ? 'dark' : 'light', aiApiKey: 'vault:shots:0000' }), dark)
  await seedTrust(page)
  const row = (n) => page.locator(`li.agent-change[data-n="${n}"]`)
  await row(1).waitFor()
  await page.locator('.agt-plate .agt-row').first().waitFor()
  // #4 (Klarheit → Klar) discarded as wrong: its Undo stays in its row
  await row(4).focus()
  await page.keyboard.press(mobile ? 'f' : '1')
  await page.waitForFunction(() => document.querySelector('li.agent-change[data-n="4"]')?.getAttribute('data-status') === 'discarded')
  await page.waitForTimeout(250)
  await page.evaluate(() => {
    const ui = window.__one.ui.getState()
    for (const t of ui.toasts) ui.dismissToast(t.id)
  })
  return { ctx, page, errors, row }
}

/** Scroll the main column (as the reader would: the wheel) so `sel` sits `top` px below the window's top. */
async function scrollTo(page, sel, top = 70) {
  const y = await page.evaluate((sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? 0, sel)
  const main = await page.locator('#main').boundingBox()
  await page.mouse.move(main.x + main.width / 2, main.y + 200)
  await page.mouse.wheel(0, y - top)
  await page.waitForTimeout(300)
}

async function done({ ctx, errors }, name) {
  if (errors.length) {
    failed = true
    console.error(`✗ ${name}\n  ${errors.join('\n  ')}`)
  } else console.log(`✓ ${name}`)
  await ctx.close()
}

const shoot = async (page, name, opts = {}) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, ...opts })
}

const SHOTS = {
  async 'agent-1440'() {
    for (const dark of [false, true]) {
      const s = await open({ dark })
      await scrollTo(s.page, '.agx-detail__cols', 60)
      await s.row(1).focus()
      await s.page.waitForTimeout(200)
      await shoot(s.page, `agent-1440-${dark ? 'dark' : 'light'}`)
      await shoot(s.page, `agent-1440-${dark ? 'dark' : 'light'}-plate`, { clip: await s.page.locator('.agt-plate').boundingBox() })
      await done(s, `agent-1440-${dark ? 'dark' : 'light'}`)
    }
  },
  async 'agent-390'() {
    for (const dark of [false, true]) {
      const s = await open({ width: 390, height: 844, mobile: true, dark })
      // the reader's own touch on the column first (the column undoes scrolls nobody asked for)
      await s.page.locator('.agx-title').tap()
      await s.row(1).getByRole('button', { name: '#1 verwerfen …' }).tap()
      await s.page.waitForTimeout(500)
      await s.row(1).scrollIntoViewIfNeeded()
      await s.page.waitForTimeout(250)
      await shoot(s.page, `agent-390-${dark ? 'dark' : 'light'}`)
      await done(s, `agent-390-${dark ? 'dark' : 'light'}`)
      // the whole page: a window as tall as the page
      const f = await open({ width: 390, height: 844, mobile: true, dark })
      await f.page.locator('.agx-title').tap()
      await f.row(1).getByRole('button', { name: '#1 verwerfen …' }).tap()
      await f.page.waitForTimeout(500)
      const h = await f.page.evaluate(() => document.querySelector('#main')?.scrollHeight ?? 2000)
      await f.page.setViewportSize({ width: 390, height: Math.min(h + 80, 6000) })
      await f.page.waitForTimeout(400)
      await shoot(f.page, `agent-390-${dark ? 'dark' : 'light'}-full`)
      await done(f, `agent-390-${dark ? 'dark' : 'light'}-full`)
    }
  },
  async 'agent-xl'() {
    const a = await open({ xl: true })
    await scrollTo(a.page, '.agx-detail__cols', 60)
    await a.row(1).focus()
    await a.page.waitForTimeout(200)
    await shoot(a.page, 'agent-xl-1440')
    await done(a, 'agent-xl-1440')
    const b = await open({ width: 390, height: 844, mobile: true, xl: true })
    const h = await b.page.evaluate(() => document.querySelector('#main')?.scrollHeight ?? 2000)
    await b.page.setViewportSize({ width: 390, height: Math.min(h + 80, 6000) })
    await b.page.waitForTimeout(400)
    await shoot(b.page, 'agent-xl-390-full')
    await done(b, 'agent-xl-390-full')
  },
}

for (const [name, fn] of Object.entries(SHOTS)) {
  if (ONLY.size && !ONLY.has(name)) continue
  try {
    await fn()
  } catch (e) {
    failed = true
    console.error(`✗ ${name}: ${e?.stack ?? e}`)
  }
}
await browser.close()
process.exit(failed ? 1 : 0)
