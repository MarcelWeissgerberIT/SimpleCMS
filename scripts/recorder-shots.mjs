#!/usr/bin/env node
/**
 * The flight recorder's screenshots (R2 brief §8): the fictional morning of tests/e2e/fixtures/recorder-story.json,
 * played through tests/e2e/helpers/recorderStory.mjs on a production build, written to .shots/recorder/ (gitignored)
 * — LOOK at each against the mocks (scratchpad killer/9-flugschreiber: mock.html, mock-2.html).
 *
 *   npx vite build --outDir node_modules/.cache/rec-shots-dist --emptyOutDir --logLevel error     # base "/"
 *   npx vite preview --host 127.0.0.1 --port 6148 --strictPort --outDir node_modules/.cache/rec-shots-dist &
 *   node scripts/recorder-shots.mjs http://127.0.0.1:6148 [shot …]
 *
 * Shots (R2):
 *   r2-window-{1440,390}-{light,dark}   the deck under the board, run 212 bracketed by its flag: the plate with its
 *                                       held note, the two held diamonds on the tape
 *   r2-read-{1440,390}-{light,dark}     "Fenster lesen" on that window, NL-1402 picked (390: the sheet)
 *   r2-read-text-1440-light             the same, NL-1401 picked (a value and its text word by word)
 *   r2-read2-390-light                  the phone's second sheet (the picked place's diff)
 *   r2-read-1440-xl / r2-window-1024-xl the biggest text size
 *   r2-report-{de,en}.md                the incident report of the window (written next to the shots)
 * Shots (R3, mock-2 / mock-3):
 *   r3-plate-1440-{light,dark}[-open]   the plate's EJECT under its cover (closed, then lifted)
 *   r3-dialog-{1440,390}-{light,dark}   the eject dialog, NL-1402 picked (390: the sheet)
 *   r3-sheet2-390-{light,dark}          the phone's second sheet (NL-1402: before → after → after the eject)
 *   r3-after-{1440,390}-{light,dark}    after the eject: the board's marks, the toast, the deck's after-state
 *   r3-dialog-1440-xl / r3-dialog-1024  the biggest text size, a narrower window
 * Every shot starts from a fresh context (the story, German UI unless named, no tour), the clock fixed at the story's
 * 08:05:40. Nothing leaves the machine: every request to another host is refused. Browser errors are printed; any makes
 * the exit code 1.
 */
import { chromium } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { playStoryPage, storyTime } from '../tests/e2e/helpers/recorderStory.mjs'

const BASE = (process.argv[2] || 'http://127.0.0.1:6148').replace(/\/$/, '')
const ONLY = new Set(process.argv.slice(3))
const OUT = '.shots/recorder'
mkdirSync(OUT, { recursive: true })
const story = JSON.parse(readFileSync('tests/e2e/fixtures/recorder-story.json', 'utf8'))

const browser = await chromium.launch()
let failed = false

/** A fresh context at the story's morning: the story played, the board open, the deck open with run 212 bracketed. */
async function open({ width = 1440, height = 900, dark = false, mobile = false, xl = false, lang = 'de' } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: mobile ? 2 : 1,
    colorScheme: dark ? 'dark' : 'light',
    isMobile: mobile,
    hasTouch: mobile,
    locale: lang === 'de' ? 'de-DE' : 'en-US',
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
  await page.clock.install({ time: storyTime(story, story.setupAt) })
  await page.goto(`${BASE}/app/?e2e#/`)
  await page.waitForFunction(() => !!window.__one && !!window.__oneRecorder && !document.getElementById('boot'), null, { timeout: 60_000 })
  await page.evaluate(({ dark, lang }) => window.__one.workspace.getState().updateSettings({ language: lang, theme: dark ? 'dark' : 'light' }), { dark, lang })
  await playStoryPage(page, story, { wipeSetup: true })
  await page.evaluate((id) => (window.location.hash = `#/p/${id}`), story.database.id)
  await page.locator('#main .db-tabs [role="tab"]', { hasText: 'Board' }).click()
  await page.locator('#main .dbb').first().waitFor()
  await page.evaluate(() => {
    const ui = window.__one.ui.getState()
    for (const t of ui.toasts) ui.dismissToast(t.id)
  })
  await page.keyboard.press('Control+Alt+z')
  await page.locator('.deck .lane').first().waitFor()
  await page.waitForTimeout(500)
  await page.locator('.lane[data-lane^="agent:"] .flag').first().click()
  await page.waitForFunction(() => /\d/.test(document.querySelector('.deck .win .mtr b')?.textContent ?? ''))
  await page.locator('.deck .held').first().waitFor()
  await page.mouse.move(width - 2, 2)
  await page.waitForTimeout(500)
  return { ctx, page, errors }
}

async function done({ ctx, errors }, name) {
  if (errors.length) {
    failed = true
    console.error(`✗ ${name}\n  ${errors.join('\n  ')}`)
  } else console.log(`✓ ${name}`)
  await ctx.close()
}

const want = (name) => !ONLY.size || ONLY.has(name) || [...ONLY].some((o) => name.startsWith(o))

const SHOTS = {}
for (const w of [1440, 390])
  for (const theme of ['light', 'dark'])
    SHOTS[`r2-window-${w}-${theme}`] = async (name) => {
      const s = await open({ width: w, height: w === 390 ? 844 : 900, dark: theme === 'dark', mobile: w === 390 })
      await s.page.screenshot({ path: `${OUT}/${name}.png` })
      await done(s, name)
    }
SHOTS['r2-window-1024-xl'] = async (name) => {
  const s = await open({ width: 1024, height: 900, xl: true })
  await s.page.screenshot({ path: `${OUT}/${name}.png` })
  await done(s, name)
}

/** "Fenster lesen" on the bracketed window, `pick` picked (by its key, e.g. NL-1402). */
async function read(s, pick = 'NL-1402') {
  await s.page.locator('.deck .dbtn--read').click()
  await s.page.locator('.modal.rec-read .plan .pi').first().waitFor()
  if (pick) {
    const more = s.page.locator('.modal.rec-read .pi--more').first()
    const item = () => s.page.locator('.modal.rec-read .pi', { hasText: pick }).first()
    if (!(await item().count()) && (await more.count())) await more.click()
    if (!s.mobile) await item().click()
  }
  await s.page.mouse.move(2, 2)
  await s.page.waitForTimeout(600)
}
for (const w of [1440, 390])
  for (const theme of ['light', 'dark'])
    SHOTS[`r2-read-${w}-${theme}`] = async (name) => {
      const s = await open({ width: w, height: w === 390 ? 844 : 900, dark: theme === 'dark', mobile: w === 390 })
      await read({ ...s, mobile: w === 390 }, w === 390 ? null : 'NL-1402')
      await s.page.screenshot({ path: `${OUT}/${name}.png` })
      await done(s, name)
    }
SHOTS['r2-read-text-1440-light'] = async (name) => {
  const s = await open()
  await read(s, 'NL-1401')
  await s.page.screenshot({ path: `${OUT}/${name}.png` })
  await done(s, name)
}
SHOTS['r2-read2-390-light'] = async (name) => {
  const s = await open({ width: 390, height: 844, mobile: true })
  await read({ ...s, mobile: true })
  await s.page.locator('.modal.rec-read .pi', { hasText: 'NL-1402' }).first().tap()
  await s.page.locator('.modal.rec-sheet2').waitFor()
  await s.page.waitForTimeout(600)
  await s.page.screenshot({ path: `${OUT}/${name}.png` })
  await done(s, name)
}
SHOTS['r2-read-1440-xl'] = async (name) => {
  const s = await open({ width: 1440, height: 900, xl: true })
  await read(s)
  await s.page.screenshot({ path: `${OUT}/${name}.png` })
  await done(s, name)
}
for (const lang of ['de', 'en'])
  SHOTS[`r2-report-${lang}`] = async (name) => {
    const s = await open({ lang })
    const download = s.page.waitForEvent('download')
    await s.page.locator('.deck .dbtn--report').click()
    await (await download).saveAs(`${OUT}/${name}.md`)
    await done(s, name)
  }

/* ---------- R3: the eject ---------- */

/** Lift the cover (desktop) and open the eject dialog; `pick` picked (desktop). */
async function ejectDialog(s, { mobile = false, pick = 'NL-1402' } = {}) {
  await s.page.locator('.deck .eject__key:not([disabled])').waitFor()
  if (mobile) await s.page.locator('.deck .eject__key').tap()
  else {
    await s.page.locator('.deck .eject__cover').click()
    await s.page.waitForTimeout(300)
    await s.page.locator('.deck .eject__key').click()
  }
  await s.page.locator('.modal.rec-eject .plan .pi').first().waitFor({ timeout: 30_000 })
  if (pick && !mobile) {
    const item = () => s.page.locator('.modal.rec-eject .pi', { hasText: pick }).first()
    const more = s.page.locator('.modal.rec-eject .plan__g[data-group="rows"] .pi--more')
    if (!(await item().count()) && (await more.count())) await more.click()
    await item().click()
  }
  await s.page.mouse.move(2, 2)
  await s.page.waitForTimeout(700)
}
for (const theme of ['light', 'dark'])
  SHOTS[`r3-plate-1440-${theme}`] = async (name) => {
    const s = await open({ dark: theme === 'dark' })
    await s.page.locator('.deck .eject__cover').waitFor()
    await s.page.screenshot({ path: `${OUT}/${name}.png` })
    await s.page.locator('.deck .eject__cover').click()
    await s.page.waitForTimeout(400)
    await s.page.screenshot({ path: `${OUT}/${name}-open.png` })
    await done(s, name)
  }
for (const w of [1440, 390])
  for (const theme of ['light', 'dark'])
    SHOTS[`r3-dialog-${w}-${theme}`] = async (name) => {
      const mobile = w === 390
      const s = await open({ width: w, height: mobile ? 844 : 900, dark: theme === 'dark', mobile })
      await ejectDialog(s, { mobile })
      await s.page.screenshot({ path: `${OUT}/${name}.png` })
      await done(s, name)
    }
for (const theme of ['light', 'dark'])
  SHOTS[`r3-sheet2-390-${theme}`] = async (name) => {
    const s = await open({ width: 390, height: 844, dark: theme === 'dark', mobile: true })
    await ejectDialog(s, { mobile: true })
    await s.page.waitForTimeout(500)
    await s.page.locator('.modal.rec-eject .pi', { hasText: 'NL-1402' }).first().tap()
    await s.page.locator('.modal.rec-sheet2').waitFor()
    await s.page.waitForTimeout(600)
    await s.page.screenshot({ path: `${OUT}/${name}.png` })
    await done(s, name)
  }
for (const w of [1440, 390])
  for (const theme of ['light', 'dark'])
    SHOTS[`r3-after-${w}-${theme}`] = async (name) => {
      const mobile = w === 390
      const s = await open({ width: w, height: mobile ? 844 : 900, dark: theme === 'dark', mobile })
      await ejectDialog(s, { mobile, pick: null })
      if (mobile) await s.page.locator('.modal.rec-eject .btn--eject').tap()
      else await s.page.locator('.modal.rec-eject .btn--eject').click()
      await s.page.locator('.deck .win--out').waitFor({ timeout: 30_000 })
      await s.page.locator('.toast[data-glyph]').waitFor()
      await s.page.mouse.move(2, 2)
      await s.page.waitForTimeout(800)
      await s.page.screenshot({ path: `${OUT}/${name}.png` })
      await done(s, name)
    }
SHOTS['r3-dialog-1440-xl'] = async (name) => {
  const s = await open({ width: 1440, height: 900, xl: true })
  await ejectDialog(s)
  await s.page.screenshot({ path: `${OUT}/${name}.png` })
  await done(s, name)
}
SHOTS['r3-dialog-1024'] = async (name) => {
  const s = await open({ width: 1024, height: 768 })
  await ejectDialog(s)
  await s.page.screenshot({ path: `${OUT}/${name}.png` })
  await done(s, name)
}

for (const [name, fn] of Object.entries(SHOTS)) if (want(name)) await fn(name).catch((e) => {
  failed = true
  console.error(`✗ ${name}: ${e.message}`)
})
await browser.close()
process.exit(failed ? 1 : 0)
