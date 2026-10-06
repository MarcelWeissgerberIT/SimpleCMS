#!/usr/bin/env node
/**
 * The install assets of the web app manifest (public/manifest.webmanifest), made reproducibly.
 *
 *   node scripts/pwa-assets.mjs icons
 *   node scripts/pwa-assets.mjs screens http://127.0.0.1:5315    # a dev server or a preview of a "/" build
 *
 * icons   → public/assets/icons/app-icon-maskable.png (512) + app-icon-maskable-192.png: the app icon on paper,
 *           inside the maskable safe zone (a circle of 80 % — Android crops to any shape); also the home-screen
 *           icon on iOS (apple-touch-icon). shortcut-*.png (192): the long-press shortcuts' glyphs (lucide, ink
 *           on paper with the signal LED).
 * screens → public/assets/shots/install/one-wide.webp (1440 × 900) and one-narrow.webp (390 × 844 at 2×): the
 *           richer install dialog (Chrome). A fresh seeded workspace in English, light theme; nothing leaves the
 *           machine. Needs python3 with Pillow (WebP encoding), like scripts/changelog-shots.mjs.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'

const MODE = process.argv[2]
const PAPER = '#f2f0ea'
const INK = '#121210'
const SIGNAL = '#ff4f00'
const ICONS = 'public/assets/icons'
const SHOTS = 'public/assets/shots/install'
const TMP = '.shots/pwa'

/** The SVG of a lucide icon (its node list from lucide-react), stroked in `color`. */
async function lucideSvg(name, color, stroke = 1.75) {
  const mod = await import(`lucide-react/dist/esm/icons/${name}.mjs`)
  const body = mod.__iconData.node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
}

async function icons() {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const app = `data:image/png;base64,${readFileSync(`${ICONS}/app-icon.png`).toString('base64')}`
  const render = async (html, size, out) => {
    await page.setViewportSize({ width: size, height: size })
    await page.setContent(`<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px;background:${PAPER};overflow:hidden">${html}</body></html>`)
    await page.waitForFunction(() => [...document.images].every((i) => i.complete))
    await page.screenshot({ path: out, omitBackground: false })
    console.log('saved', out)
  }
  // maskable: the tile at 78 % — its rounded corners stay inside the 80 % safe circle
  for (const size of [512, 192]) {
    const s = Math.round(size * 0.78)
    const o = Math.round((size - s) / 2)
    await render(`<img src="${app}" style="position:absolute;left:${o}px;top:${o}px;width:${s}px;height:${s}px">`, size, `${ICONS}/app-icon-maskable${size === 512 ? '' : '-192'}.png`)
  }
  // shortcuts: an ink glyph with the signal LED, inside the safe zone
  const glyphs = { capture: 'pen-line', page: 'file-plus-corner', search: 'search', terminal: 'square-terminal' }
  for (const [name, icon] of Object.entries(glyphs)) {
    const svg = await lucideSvg(icon, INK, 1.6)
    const html = `<div style="position:absolute;left:52px;top:52px;width:88px;height:88px">${svg.replace('<svg ', '<svg width="88" height="88" ')}</div><i style="position:absolute;left:140px;top:38px;width:14px;height:14px;border-radius:99px;background:${SIGNAL}"></i>`
    await render(html, 192, `${ICONS}/shortcut-${name}.png`)
  }
  await browser.close()
}

/** PNG → WebP (≤ 140 KB: the quality steps down until it fits). */
function webp(png, out) {
  const py = `
import sys, io
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB')
for q in (84, 80, 76, 72, 68, 64, 60):
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=q, method=6)
    if buf.tell() <= 140 * 1024 or q == 60:
        open(out, 'wb').write(buf.getvalue())
        print(f'{im.width}x{im.height} q{q} {buf.tell() // 1024} KB')
        break
`
  console.log('saved', out, execFileSync('python3', ['-c', py, png, out]).toString().trim())
}

async function freshContext(browser, base, opts) {
  const ctx = await browser.newContext({ colorScheme: 'light', locale: 'en-US', timezoneId: 'Europe/Berlin', serviceWorkers: 'block', ...opts })
  // no request leaves the machine: Claude, Google
  await ctx.route(/^https:\/\/(api\.anthropic\.com|accounts\.google\.com|www\.googleapis\.com|gmail\.googleapis\.com)\//, (r) => r.abort())
  await ctx.route(`${base}/api/**`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html>' }))
  const page = await ctx.newPage()
  await page.goto(`${base}/app/?e2e`, { waitUntil: 'networkidle' })
  await page.evaluate(async () => {
    localStorage.clear()
    const dbs = (await indexedDB.databases?.()) ?? []
    await Promise.all(dbs.map((d) => new Promise((r) => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = r })))
    localStorage.setItem('one.help.seen-changelog', '9999-12-31-shots')
  })
  await page.goto(`${base}/app/?e2e`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!window.__one)
  await page.evaluate(() => window.__one.workspace.getState().updateSettings({ theme: 'light', language: 'en', userName: 'Marcel' }))
  await page.waitForTimeout(600)
  return { ctx, page }
}

const openTitled = async (page, title) => {
  const id = await page.evaluate((title) => Object.values(window.__one.workspace.getState().pages).find((p) => p.title === title && !p.trashed)?.id, title)
  await page.evaluate((id) => (window.location.hash = `#/p/${id}`), id)
  await page.locator('#main .pv-title').waitFor()
  await page.waitForTimeout(900)
}

async function screens(base) {
  mkdirSync(SHOTS, { recursive: true })
  mkdirSync(TMP, { recursive: true })
  const browser = await chromium.launch()
  {
    const { ctx, page } = await freshContext(browser, base, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
    await openTitled(page, 'Projects')
    await page.mouse.move(1500, 1000)
    await page.screenshot({ path: `${TMP}/wide.png` })
    webp(`${TMP}/wide.png`, `${SHOTS}/one-wide.webp`)
    await ctx.close()
  }
  {
    const { ctx, page } = await freshContext(browser, base, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    await openTitled(page, 'Reading list')
    await page.getByRole('button', { name: 'Quick capture' }).first().tap()
    const sheet = page.getByRole('dialog', { name: 'Quick capture' })
    await sheet.waitFor()
    await sheet.getByRole('textbox').fill('Call the venue about Friday\n- ask for the projector\n- confirm 40 seats')
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${TMP}/narrow.png` })
    webp(`${TMP}/narrow.png`, `${SHOTS}/one-narrow.webp`)
    await ctx.close()
  }
  await browser.close()
  rmSync(TMP, { recursive: true, force: true })
}

if (MODE === 'icons') await icons()
else if (MODE === 'screens') await screens((process.argv[3] || 'http://127.0.0.1:5315').replace(/\/$/, ''))
else {
  console.error('usage: node scripts/pwa-assets.mjs icons | screens <base url>')
  process.exit(1)
}
