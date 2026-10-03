#!/usr/bin/env node
/**
 * Records the app scenes for the 60-second promo video as 1920×1080 / 30 fps clips
 * (.shots/promo/scenes/<name>.mp4) using the Chrome DevTools screencast.
 *
 *   npx vite --port 5300 --strictPort &
 *   node scripts/promo/record-scenes.mjs http://127.0.0.1:5300 [scene …]
 *
 * With PROMO_LOCAL set (a `build:pages` preview, e.g. http://127.0.0.1:4173/SimpleCMS) the pages are
 * loaded under the public GitHub Pages URL and routed to that preview, so links show the real address.
 *
 * A fake cursor (with click ripple) is injected so viewers can follow the interactions.
 * The Claude API and the webhook endpoint are mocked — no network calls, no key needed.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { zipSync, strToU8 } from 'fflate'

const PUBLIC = 'https://getonecms.com'
const LOCAL = process.env.PROMO_LOCAL?.replace(/\/$/, '')
const BASE = LOCAL ? PUBLIC : (process.argv[2] || 'http://127.0.0.1:5300').replace(/\/$/, '')
const ONLY = process.argv.slice(3)
// Recorded at 1280×720 CSS px with devicePixelRatio 1.5 → crisp 1920×1080 frames with a UI
// that is 1.5× larger than a plain 1080p capture (readable on phones).
const W = 1280
const H = 720
const DPR = 1.5
const OUT_W = 1920
const OUT_H = 1080
const OUT = '.shots/promo/scenes'
mkdirSync(OUT, { recursive: true })

/* ------------------------------------------------------------------ cursor */
const CURSOR_SCRIPT = `
(() => {
  const install = () => {
    if (document.getElementById('__cursor')) return
    const c = document.createElement('div')
    c.id = '__cursor'
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M3 2 L3 21 L8.2 16.4 L11.6 24 L15 22.5 L11.7 15 L18.5 15 Z" fill="#121210" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: 2147483647, pointerEvents: 'none', transform: 'translate(-100px,-100px)', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.25))' })
    c.firstChild.setAttribute('width', '22'); c.firstChild.setAttribute('height', '22')
    document.documentElement.appendChild(c)
    const st = document.createElement('style')
    st.textContent = '@keyframes __rip{from{transform:translate(-50%,-50%) scale(.2);opacity:.9}to{transform:translate(-50%,-50%) scale(1);opacity:0}}'
    document.documentElement.appendChild(st)
    addEventListener('pointermove', (e) => { c.style.transform = 'translate(' + (e.clientX - 3) + 'px,' + (e.clientY - 2) + 'px)' }, true)
    addEventListener('pointerdown', (e) => {
      const r = document.createElement('div')
      Object.assign(r.style, { position: 'fixed', left: e.clientX + 'px', top: e.clientY + 'px', width: '46px', height: '46px', borderRadius: '50%', border: '3px solid #ff4f00', zIndex: 2147483646, pointerEvents: 'none', animation: '__rip 420ms ease-out forwards' })
      document.documentElement.appendChild(r)
      setTimeout(() => r.remove(), 500)
    }, true)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install)
  else install()
})()
`

/* ------------------------------------------------------------------ mocks */
function sse(text) {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  let body = ev('message_start', { message: { id: 'msg_demo', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 300, output_tokens: 1 } } })
  body += ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
  for (const chunk of text.match(/.{1,20}/gs)) body += ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: chunk } })
  body += ev('content_block_stop', { index: 0 })
  body += ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 60 } })
  body += ev('message_stop', {})
  return body
}
const IMPROVED = 'Lead with specifics — numbers, names and real examples beat clever phrasing every time.'

async function newPage(browser, { theme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, colorScheme: theme, locale: 'en-US', serviceWorkers: 'block' })
  await ctx.addInitScript(CURSOR_SCRIPT)
  if (LOCAL)
    await ctx.route(`${PUBLIC}/**`, async (route) => route.fulfill({ response: await route.fetch({ url: route.request().url().replace(PUBLIC, LOCAL) }) }))
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' } })
    await new Promise((r) => setTimeout(r, 700))
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: sse(IMPROVED) })
  })
  await ctx.route('https://n8n.acme.studio/**', (route) =>
    route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: '{"ok":true}' }),
  )
  const page = await ctx.newPage()
  page.setDefaultTimeout(6000)
  page.on('pageerror', (e) => console.log('  pageerror:', String(e).slice(0, 160)))
  await page.goto(`${BASE}/app/?e2e`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!window.__one)
  await page.evaluate((theme) => window.__one.workspace.getState().updateSettings({ theme, language: 'en', aiApiKey: 'sk-ant-demo', userName: 'Marcel' }), theme)
  await page.mouse.move(W / 2, H / 2)
  await page.waitForTimeout(900)
  return { ctx, page }
}

const idOf = (page, title) => page.evaluate((title) => Object.values(window.__one.workspace.getState().pages).find((p) => p.title === title && !p.trashed)?.id, title)
const go = async (page, hash, wait = 1200) => {
  await page.evaluate((h) => (window.location.hash = h), hash)
  await page.waitForTimeout(wait)
}

/* ------------------------------------------------------------------ motion helpers */
let cursor = { x: W / 2, y: H / 2 }
async function moveTo(page, x, y, ms = 450) {
  const steps = Math.max(8, Math.round(ms / 16))
  const from = { ...cursor }
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e)
    await page.waitForTimeout(ms / steps)
  }
  cursor = { x, y }
}
async function centerOf(locator) {
  const b = await locator.boundingBox()
  if (!b) throw new Error('no box')
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b }
}
async function clickOn(page, locator, { ms = 450, pause = 120, modifiers } = {}) {
  const c = await centerOf(locator)
  await moveTo(page, c.x, c.y, ms)
  await page.waitForTimeout(pause)
  if (modifiers) for (const m of modifiers) await page.keyboard.down(m)
  await page.mouse.down()
  await page.mouse.up()
  if (modifiers) for (const m of modifiers) await page.keyboard.up(m)
}
const type = (page, text, delay = 42) => page.keyboard.type(text, { delay })
/** Scroll with the wheel (real input) until `locator` sits ~`top` px from the viewport top. */
async function wheelTo(page, locator, top = 90, step = 120, pause = 16) {
  for (let i = 0; i < 80; i++) {
    const b = await locator.boundingBox()
    if (!b) return
    const d = b.y - top
    if (Math.abs(d) < step / 2) return
    await page.mouse.wheel(0, Math.sign(d) * Math.min(step, Math.abs(d)))
    await page.waitForTimeout(pause)
  }
}
/** Drag-select from the start of `from` to the end of `to` inside the editor (real mouse drag). */
async function dragSelect(page, from, to) {
  const pts = await page.locator('.ProseMirror').first().evaluate((root, [a, b]) => {
    const find = (text, end) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let n
      while ((n = w.nextNode())) {
        const i = n.data.indexOf(text)
        if (i >= 0) {
          const r = document.createRange()
          r.setStart(n, end ? i + text.length - 1 : i)
          r.setEnd(n, end ? i + text.length : i + 1)
          const rect = r.getBoundingClientRect()
          return { x: end ? rect.right - 1 : rect.left + 1, y: rect.top + rect.height / 2 }
        }
      }
      return null
    }
    return [find(a, false), find(b, true)]
  }, [from, to])
  if (!pts[0] || !pts[1]) throw new Error('dragSelect: text not found')
  await moveTo(page, pts[0].x, pts[0].y, 450)
  await page.mouse.down()
  await moveTo(page, pts[1].x, pts[1].y, 420)
  await page.mouse.up()
}

/* ------------------------------------------------------------------ screencast recorder */
async function record(page, name, run) {
  const cdp = await page.context().newCDPSession(page)
  const frames = []
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    frames.push({ data, t: metadata.timestamp })
    try {
      await cdp.send('Page.screencastFrameAck', { sessionId })
    } catch {}
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: OUT_W, maxHeight: OUT_H, everyNthFrame: 1 })
  // force a first frame
  await page.mouse.move(cursor.x + 1, cursor.y)
  await page.mouse.move(cursor.x, cursor.y)
  const t0 = Date.now() / 1000
  await run()
  await page.waitForTimeout(150)
  const tEnd = Date.now() / 1000
  await cdp.send('Page.stopScreencast')
  await cdp.detach()
  if (!frames.length) throw new Error('no frames recorded')

  const dir = `${OUT}/${name}-frames`
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  let list = 'ffconcat version 1.0\n'
  frames.forEach((f, i) => {
    const file = `f${String(i).padStart(5, '0')}.jpg`
    writeFileSync(`${dir}/${file}`, Buffer.from(f.data, 'base64'))
    const next = i + 1 < frames.length ? frames[i + 1].t : Math.max(tEnd, f.t + 0.04)
    list += `file ${file}\nduration ${Math.max(0.001, next - f.t).toFixed(4)}\n`
  })
  list += `file f${String(frames.length - 1).padStart(5, '0')}.jpg\n`
  writeFileSync(`${dir}/list.ffconcat`, list)
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${dir}/list.ffconcat`, '-vf', `fps=30,scale=${OUT_W}:${OUT_H}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-crf', '14', '-preset', 'medium', `${OUT}/${name}.mp4`])
  const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', `${OUT}/${name}.mp4`]).toString().trim()
  console.log(`scene ${name}: ${frames.length} frames, ${(tEnd - t0).toFixed(1)}s wall → ${dur}s clip`)
}

/* ------------------------------------------------------------------ scenes */
const scenes = {
  // Meet SimpleCMS One. Notion, rebuilt — minus the bill.
  async home(browser) {
    const { ctx, page } = await newPage(browser)
    const welcome = await idOf(page, 'Welcome to One')
    await go(page, `#/p/${welcome}`, 2200)
    await page.mouse.move(900, 380)
    cursor = { x: 900, y: 380 }
    await record(page, 'home', async () => {
      await page.waitForTimeout(900)
      for (let i = 0; i < 46; i++) {
        await page.mouse.wheel(0, 14)
        await page.waitForTimeout(40)
      }
      await page.waitForTimeout(900)
    })
    await ctx.close()
  },

  // A real block editor: slash commands, drag handles, toggles, code, math and diagrams.
  async editor(browser) {
    const { ctx, page } = await newPage(browser)
    const id = await page.evaluate(() => window.__one.workspace.getState().createPage({ title: 'Launch plan', icon: { type: 'emoji', value: '🚀' } }))
    await go(page, `#/p/${id}`, 1500)
    const editor = page.locator('.ProseMirror').first()
    const box = (await editor.boundingBox()) ?? { x: 700, y: 420, width: 600, height: 40 }
    await page.mouse.move(box.x + 40, box.y + 14)
    cursor = { x: box.x + 40, y: box.y + 14 }
    await page.mouse.down()
    await page.mouse.up()
    await page.waitForTimeout(300)
    await record(page, 'editor-a', async () => {
      await page.waitForTimeout(250)
      await type(page, '/', 0)
      await page.waitForTimeout(900)
      await type(page, 'to', 90)
      await page.waitForTimeout(350)
      await page.keyboard.press('Enter')
      await type(page, 'Record the demo video', 34)
      await page.keyboard.press('Enter')
      await type(page, 'Post it to the Ninja Armory', 34)
      await page.waitForTimeout(250)
      const first = page.locator('.ProseMirror li[data-checked] input, .ProseMirror li[data-type="taskItem"] input, .ProseMirror [data-type="taskItem"] input').first()
      if (await first.count()) await clickOn(page, first, { ms: 420 })
      await page.waitForTimeout(600)
    })
    // part b: the nerdy blocks on the welcome page
    const welcome = await idOf(page, 'Welcome to One')
    await go(page, `#/p/${welcome}`, 1800)
    await page.mouse.move(700, 400)
    cursor = { x: 700, y: 400 }
    const nerd = page.locator('.ProseMirror').getByText('Blocks for nerds').first()
    await wheelTo(page, nerd, 70, 300, 30)
    await page.waitForTimeout(1600)
    await record(page, 'editor-b', async () => {
      await moveTo(page, 640, 300, 500)
      await page.waitForTimeout(400)
      await moveTo(page, 700, 420, 500)
      await page.waitForTimeout(500)
      const handle = page.locator('[class*="drag"], [data-drag-handle]').first()
      if (await handle.count()) {
        const c = await centerOf(handle).catch(() => null)
        if (c) await moveTo(page, c.x, c.y, 380)
      }
      await page.waitForTimeout(900)
    })
    await ctx.close()
  },

  // Databases with seven views, plus relations, rollups and formulas.
  async database(browser) {
    const { ctx, page } = await newPage(browser)
    const id = await idOf(page, 'Projects')
    await go(page, `#/p/${id}`, 1800)
    await record(page, 'database', async () => {
      const card = page.getByText('Pricing page experiment').first()
      const target = page.getByText(/^In progress$/).first()
      const c = await centerOf(card)
      const tgt = await centerOf(target)
      await moveTo(page, c.x, c.y, 500)
      await page.mouse.down()
      await page.waitForTimeout(160)
      await moveTo(page, c.x + 12, c.y + 4, 160)
      await moveTo(page, tgt.x + 30, c.y + 30, 800)
      await page.waitForTimeout(250)
      await page.mouse.up()
      await page.waitForTimeout(500)
      await clickOn(page, page.getByRole('tab', { name: /Timeline/ }).first(), { ms: 420 })
      await page.waitForTimeout(1100)
      await clickOn(page, page.getByRole('tab', { name: /Chart/ }).first(), { ms: 380 })
      await page.waitForTimeout(1300)
    })
    await ctx.close()
  },

  // Command K for everything. Pages side by side. And a live graph of how it all connects.
  async command(browser) {
    const { ctx, page } = await newPage(browser)
    const welcome = await idOf(page, 'Welcome to One')
    await go(page, `#/p/${welcome}`, 1500)
    await record(page, 'command', async () => {
      await page.waitForTimeout(250)
      await page.keyboard.press('Control+k')
      await page.waitForTimeout(500)
      await type(page, 'wiki', 110)
      await page.waitForTimeout(450)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(900)
      const link = page.locator('.ProseMirror').getByText('Onboarding').first()
      await clickOn(page, link, { ms: 450, modifiers: ['Alt'] })
      await page.waitForTimeout(1300)
      await clickOn(page, page.locator('nav, aside').getByText(/^Graph$/).first(), { ms: 450 })
      await page.waitForTimeout(1600)
      await moveTo(page, 1180, 520, 600)
      await page.waitForTimeout(700)
    })
    await ctx.close()
  },

  // Claude is built in. Bring your own key, and pay only for what you use.
  async ai(browser) {
    const { ctx, page } = await newPage(browser)
    const id = await idOf(page, 'Brand voice')
    await go(page, `#/p/${id}`, 1500)
    await record(page, 'ai', async () => {
      await dragSelect(page, 'Numbers, names', 'examples.')
      await page.waitForTimeout(500)
      await clickOn(page, page.getByRole('button', { name: /Ask AI/i }).first(), { ms: 420 })
      await page.waitForTimeout(600)
      await clickOn(page, page.getByText(/^Improve writing/).first(), { ms: 380 })
      await page.waitForTimeout(1900)
      await clickOn(page, page.getByText(/^Replace selection/).first(), { ms: 420 })
      await page.waitForTimeout(900)
    })
    await ctx.close()
  },

  // Every database fires webhooks into n8n, Make or Zapier. Free.
  async automations(browser) {
    const { ctx, page } = await newPage(browser)
    const id = await idOf(page, 'Projects')
    await go(page, `#/p/${id}`, 1600)
    await record(page, 'automations', async () => {
      await clickOn(page, page.getByRole('button', { name: /Automations/i }).first(), { ms: 500 })
      await page.waitForTimeout(700)
      await clickOn(page, page.getByText(/Send new rows to n8n/).first(), { ms: 450 })
      await page.waitForTimeout(500)
      const url = page.locator('.modal input[type="url"], .modal input[placeholder*="http"]').first()
      await clickOn(page, url, { ms: 380 })
      await type(page, 'https://n8n.acme.studio/webhook/new-project', 14)
      await page.waitForTimeout(250)
      await clickOn(page, page.locator('.modal').getByRole('switch').first(), { ms: 380 }).catch(() => {})
      await page.waitForTimeout(250)
      await clickOn(page, page.locator('.modal').getByRole('button', { name: /Send test/i }).first(), { ms: 400 })
      await page.waitForTimeout(1500)
    })
    await ctx.close()
  },

  // Import from Notion in a minute. Share pages without a server. It even works offline.
  async importshare(browser) {
    const { ctx, page } = await newPage(browser)
    const root = 'Export-2c9f'
    const notes = 'Q4 Planning 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d'
    const tasks = 'Roadmap 9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d'
    const enc = (s) => encodeURIComponent(s)
    const zip = zipSync({
      [`${root}/${notes}.md`]: strToU8(`# Q4 Planning\n\nOur plan for the quarter. See the [Roadmap](${enc(notes)}/${enc(tasks)}.csv).\n\n- [ ] Ship v2\n- [x] Hire designer\n`),
      [`${root}/${notes}/${tasks}.csv`]: strToU8('﻿Name,Status,Owner,Due\nPricing v2,In progress,Alex,"October 20, 2026"\nOnboarding revamp,Not started,Mira,"November 3, 2026"\nAPI launch,Done,Sam,"September 30, 2026"\n'),
    })
    await page.locator('.sb').getByRole('button', { name: /^Import/ }).click()
    await page.waitForTimeout(700)
    await record(page, 'import', async () => {
      await page.waitForTimeout(300)
      const chooser = page.waitForEvent('filechooser')
      await clickOn(page, page.getByRole('dialog').getByRole('button', { name: 'Choose files' }), { ms: 450 })
      await (await chooser).setFiles([{ name: 'Notion-Export.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) }])
      await page.getByRole('dialog').getByText(/Import complete/).waitFor({ timeout: 20000 })
      await page.waitForTimeout(900)
      await clickOn(page, page.getByRole('dialog').getByRole('button', { name: 'View import' }), { ms: 420 })
      await page.waitForTimeout(1300)
    })
    // share
    const id = await idOf(page, 'Brand voice')
    await go(page, `#/p/${id}`, 1300)
    let link = ''
    await record(page, 'share', async () => {
      await clickOn(page, page.getByRole('button', { name: /^Share$/ }).first(), { ms: 500 })
      await page.waitForTimeout(1400)
      link = await page.evaluate(() => [...document.querySelectorAll('input, textarea')].map((e) => e.value).find((v) => v.includes('#/s/')) || '')
      await page.waitForTimeout(400)
    })
    if (link) {
      const viewer = await ctx.newPage()
      await viewer.goto(link, { waitUntil: 'networkidle' })
      await viewer.waitForTimeout(1200)
      await viewer.mouse.move(1500, 700)
      cursor = { x: 1500, y: 700 }
      await record(viewer, 'shared', async () => {
        await moveTo(viewer, 1300, 420, 700)
        await viewer.waitForTimeout(1200)
      })
    } else console.log('  (no share link found)')
    await ctx.close()
  },
}

const browser = await chromium.launch()
for (const [name, run] of Object.entries(scenes)) {
  if (ONLY.length && !ONLY.includes(name)) continue
  try {
    cursor = { x: W / 2, y: H / 2 }
    await run(browser)
  } catch (e) {
    console.log(`FAILED ${name}:`, String(e).split('\n').slice(0, 4).join(' | '))
  }
}
await browser.close()
