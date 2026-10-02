#!/usr/bin/env node
/**
 * Screenshot helper for visual QA.
 *   node scripts/shot.mjs <url> <out.png> [--w 1440] [--h 900] [--dark] [--full] [--wait 800]
 *        [--mobile] [--eval "<js run in page before shot>"] [--click "<css selector>"] [--type "text"]
 *        [--clear-storage]
 * Prints console errors from the page. Uses the preinstalled Chromium (PLAYWRIGHT_BROWSERS_PATH).
 */
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const url = args[0]
const out = args[1]
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`)
  if (i < 0) return def
  const v = args[i + 1]
  return v === undefined || v.startsWith('--') ? true : v
}
if (!url || !out) {
  console.error('usage: node scripts/shot.mjs <url> <out.png> [options]')
  process.exit(1)
}
const mobile = !!opt('mobile', false)
const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: Number(opt('w', mobile ? 390 : 1440)), height: Number(opt('h', mobile ? 844 : 900)) },
  deviceScaleFactor: mobile ? 2 : 1,
  colorScheme: opt('dark', false) ? 'dark' : 'light',
  isMobile: mobile,
  hasTouch: mobile,
})
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(url, { waitUntil: 'networkidle' })
if (opt('clear-storage', false)) {
  await page.evaluate(async () => {
    localStorage.clear()
    const dbs = (await indexedDB.databases?.()) ?? []
    await Promise.all(dbs.map((d) => new Promise((r) => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = r })))
  })
  await page.reload({ waitUntil: 'networkidle' })
}
const click = opt('click', null)
if (click) await page.click(String(click))
const type = opt('type', null)
if (type) await page.keyboard.type(String(type))
const js = opt('eval', null)
if (js) await page.evaluate(String(js))
await page.waitForTimeout(Number(opt('wait', 800)))
await page.screenshot({ path: out, fullPage: !!opt('full', false) })
if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'))
console.log('saved', out)
await browser.close()
