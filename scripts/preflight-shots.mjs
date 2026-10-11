#!/usr/bin/env node
/**
 * Preflight's screenshots (design §19): the fictional morning of tests/e2e/helpers/preflightStory.mjs on a production
 * build, written to .shots/preflight/*.png (gitignored) — LOOK at each against the mocks.
 *
 *   npx vite build --outDir node_modules/.cache/pf-shots-dist --emptyOutDir --logLevel error     # base "/"
 *   npx vite preview --host 127.0.0.1 --port 6147 --strictPort --outDir node_modules/.cache/pf-shots-dist &
 *   node scripts/preflight-shots.mjs http://127.0.0.1:6147 [shot …]
 *
 * Shots (pass 1 — the plate and the strip):
 *   plate-1440-{light,dark}        #/ at 1440 × 900, the plate lit, the rule card beside it
 *   plate-390-{light,dark}         390 × 844 (isMobile): the viewport, and -full the whole page
 *   plate-c1000 / plate-c999       the stage container at 1000 / 999 px; plate-640 the 640 px window
 *   plate-xl-1280 / plate-xl-390   the biggest text size (one.textScale = 4)
 *   mc-{dark,acked,lit}-{1440,390} MASTER CAUTION on a page route in its three states (the top of the window)
 *   strip-{1440,390}               the strip with lit pips
 * Every shot starts from a fresh context (the demo seed + the story), German UI, no tour, the blink stopped. Nothing
 * leaves the machine: every request to another host is refused. Browser errors are printed; any makes the exit code 1.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { seedMorning, waitPreflight } from '../tests/e2e/helpers/preflightStory.mjs'

const BASE = (process.argv[2] || 'http://127.0.0.1:6147').replace(/\/$/, '')
const ONLY = new Set(process.argv.slice(3))
const OUT = '.shots/preflight'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
let failed = false

/** A fresh context + page, seeded with the story (or not), on "#/". */
async function open({ width = 1440, height = 900, dark = false, mobile = false, xl = false, story = true, parts } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: mobile ? 2 : 1,
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
  // a failed load is reported with its address below; the app asks the origin for a team server (api/config) — none here
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(`console.error: ${m.text()}`))
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`))
  page.on('response', (r) => r.status() >= 400 && !r.url().endsWith('/api/config') && errors.push(`${r.status()} ${r.url()}`))
  await page.goto(`${BASE}/app/?e2e#/`)
  await waitPreflight(page)
  await page.evaluate((dark) => window.__one.workspace.getState().updateSettings({ language: 'de', theme: dark ? 'dark' : 'light' }), dark)
  if (story) await seedMorning(page, parts ? { parts } : {})
  else {
    await page.evaluate(() => (window.location.hash = '#/'))
    await page.evaluate(() => window.__onePreflight.flush())
  }
  await page.evaluate(() => window.__onePreflight.noBlink())
  // the seeding's own toasts ("Coding database created") are not part of the picture
  await page.evaluate(() => {
    const ui = window.__one.ui.getState()
    for (const t of ui.toasts) ui.dismissToast(t.id)
  })
  await page.waitForTimeout(700)
  return { ctx, page, errors }
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

/** The stage container's width now. */
const stageWidth = (page) => page.evaluate(() => document.querySelector('.stage-col')?.getBoundingClientRect().width ?? 0)

const SHOTS = {
  async 'plate-1440'() {
    for (const dark of [false, true]) {
      const s = await open({ dark })
      await s.page.locator('.pf-cap[data-lamp="proposals"]').focus()
      await s.page.waitForTimeout(250)
      await shoot(s.page, `plate-1440-${dark ? 'dark' : 'light'}`)
      await done(s, `plate-1440-${dark ? 'dark' : 'light'}`)
    }
  },
  async 'plate-390'() {
    for (const dark of [false, true]) {
      const s = await open({ width: 390, height: 844, mobile: true, dark })
      await shoot(s.page, `plate-390-${dark ? 'dark' : 'light'}`)
      await shoot(s.page, `plate-390-${dark ? 'dark' : 'light'}-full`, { fullPage: true })
      await done(s, `plate-390-${dark ? 'dark' : 'light'}`)
    }
  },
  async 'plate-containers'() {
    for (const target of [1000, 999]) {
      const s = await open({ width: 1260 })
      // size the window so the stage container is exactly `target` px wide
      for (let i = 0; i < 3; i++) {
        const w = await stageWidth(s.page)
        const vw = s.page.viewportSize().width
        if (Math.round(w) === target) break
        await s.page.setViewportSize({ width: Math.round(vw + target - w), height: 900 })
        await s.page.waitForTimeout(200)
      }
      console.log(`  stage ${Math.round(await stageWidth(s.page))} px`)
      await shoot(s.page, `plate-c${target}`)
      await done(s, `plate-c${target}`)
    }
    const s = await open({ width: 640, height: 900 })
    await shoot(s.page, 'plate-640')
    await shoot(s.page, 'plate-640-full', { fullPage: true })
    await done(s, 'plate-640')
  },
  async 'plate-xl'() {
    const a = await open({ width: 1280, height: 800, xl: true })
    await shoot(a.page, 'plate-xl-1280')
    await shoot(a.page, 'plate-xl-1280-full', { fullPage: true })
    await done(a, 'plate-xl-1280')
    const b = await open({ width: 390, height: 844, mobile: true, xl: true })
    await shoot(b.page, 'plate-xl-390')
    await shoot(b.page, 'plate-xl-390-full', { fullPage: true })
    await done(b, 'plate-xl-390')
  },
  async mc() {
    for (const [width, height, mobile] of [[1440, 900, false], [390, 844, true]]) {
      const clip = { x: 0, y: 0, width, height: mobile ? 120 : 96 }
      // dark: nothing lit (no story)
      const d = await open({ width, height, mobile, story: false })
      const toPage = async (page) => {
        const id = await page.evaluate(() => Object.values(window.__one.workspace.getState().pages).find((p) => /^Team.?wiki$/i.test(p.title))?.id)
        await page.evaluate((id) => (window.location.hash = `#/p/${id}`), id)
        await page.locator('#main .pv-title').waitFor()
        await page.waitForTimeout(300)
      }
      await toPage(d.page)
      await shoot(d.page, `mc-dark-${width}`, { clip })
      await done(d, `mc-dark-${width}`)
      // lit (new lamps) and acknowledged (lit, nothing new)
      const l = await open({ width, height, mobile })
      await toPage(l.page)
      await shoot(l.page, `mc-lit-${width}`, { clip })
      await l.page.getByTestId('pf-mc').click()
      await l.page.waitForTimeout(300)
      // MASTER CAUTION with nothing new opens the plate: back to the page for the acknowledged state
      await toPage(l.page)
      await shoot(l.page, `mc-acked-${width}`, { clip })
      await done(l, `mc-${width}`)
    }
  },
  async strip() {
    for (const [width, height, mobile] of [[1440, 900, false], [390, 844, true]]) {
      const s = await open({ width, height, mobile })
      await s.page.evaluate(() => window.__onePreflight.fold())
      await s.page.getByTestId('pf-strip').waitFor()
      await s.page.waitForTimeout(250)
      await shoot(s.page, `strip-${width}`)
      await done(s, `strip-${width}`)
    }
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
