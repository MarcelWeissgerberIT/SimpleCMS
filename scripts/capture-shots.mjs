#!/usr/bin/env node
/**
 * Captures the real product screenshots used on the landing page
 * (public/assets/shots/*.webp, 1600×1000) and the Open Graph card (public/assets/og.png).
 *
 *   npx vite --port 5300 --strictPort &      # any running dev/preview server
 *   node scripts/capture-shots.mjs http://127.0.0.1:5300
 *
 * Every shot starts from a fresh, seeded workspace. The Claude API is mocked with a
 * canned streaming answer so the AI shots don't need a key or network.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'

// Local server to read from (a `npm run build:pages` + `vite preview` serves under /SimpleCMS/).
const LOCAL = (process.argv[2] || 'http://127.0.0.1:4173/SimpleCMS').replace(/\/$/, '')
// Pages are loaded under the public URL so links/payloads in the shots show it; requests are routed to LOCAL.
const PUBLIC = 'https://marcelweissgerberit.github.io/SimpleCMS'
const BASE = PUBLIC
const OUT = 'public/assets/shots'
const TMP = '.shots/capture'
const ONLY = process.argv.slice(3)
mkdirSync(OUT, { recursive: true })
mkdirSync(TMP, { recursive: true })

const W = 1600
const H = 1000

function sse(text) {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  let body = ev('message_start', {
    message: { id: 'msg_demo', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 412, output_tokens: 1 } },
  })
  body += ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
  for (const chunk of text.match(/.{1,24}/gs)) body += ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: chunk } })
  body += ev('content_block_stop', { index: 0 })
  body += ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 120 } })
  body += ev('message_stop', {})
  return body
}

const IMPROVED = `Lead with specifics — numbers, names and real examples beat clever phrasing every time.`
const AI_ANSWER = `**Summary**\n\n- The relaunch goes live in two weeks; Alex owns final QA on staging.\n- Sam connects the project webhook to n8n so new leads route automatically.\n- Mira's newsletter draft is done — budget check moves to next week.\n\n**Open questions:** who signs off on the pricing page experiment?`

async function routeToLocal(ctx) {
  await ctx.route(`${PUBLIC}/**`, async (route) => {
    const url = route.request().url().replace(PUBLIC, LOCAL)
    const response = await route.fetch({ url })
    await route.fulfill({ response })
  })
}

async function freshPage(browser, { theme = 'light', lang = 'en' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: theme, locale: lang === 'de' ? 'de-DE' : 'en-US', serviceWorkers: 'block' })
  await routeToLocal(ctx)
  await ctx.route('https://api.anthropic.com/**', (route) => {
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' } })
    const body = route.request().postData() || ''
    const answer = /summar/i.test(body) ? AI_ANSWER : IMPROVED
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: sse(answer) })
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('  pageerror:', String(e).slice(0, 200)))
  await page.goto(`${BASE}/app/?e2e`, { waitUntil: 'networkidle' })
  await page.evaluate(async () => {
    localStorage.clear()
    const dbs = (await indexedDB.databases?.()) ?? []
    await Promise.all(dbs.map((d) => new Promise((r) => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = r })))
  })
  await page.goto(`${BASE}/app/?e2e`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!window.__one)
  await page.evaluate(({ theme, lang }) => {
    const s = window.__one.workspace.getState()
    s.updateSettings({ theme, language: lang, aiApiKey: 'sk-ant-demo-key', userName: 'Marcel' })
  }, { theme, lang })
  await page.waitForTimeout(600)
  return { ctx, page }
}

const pageIdByTitle = (page, title) =>
  page.evaluate((title) => Object.values(window.__one.workspace.getState().pages).find((p) => p.title === title && !p.trashed)?.id, title)

async function save(page, name, clip) {
  const png = `${TMP}/${name}.png`
  await page.screenshot({ path: png, clip })
  execFileSync('python3', ['-c', `from PIL import Image; Image.open('${png}').convert('RGB').save('${OUT}/${name}.webp', quality=86, method=6)`])
  console.log('saved', `${OUT}/${name}.webp`)
}

async function selectText(page, text) {
  const loc = page.locator('.ProseMirror').getByText(text, { exact: false }).first()
  await loc.scrollIntoViewIfNeeded()
  await loc.evaluate((el, text) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      const i = node.data.indexOf(text)
      if (i >= 0) {
        const r = document.createRange()
        r.setStart(node, i)
        r.setEnd(node, i + text.length)
        const sel = window.getSelection()
        sel.removeAllRanges()
        sel.addRange(r)
        return
      }
    }
  }, text)
  await page.mouse.move(10, 10)
  await page.waitForTimeout(500)
}

/** Select from the start of `fromText` to the end of `toText` (may span blocks). */
async function selectRange(page, fromText, toText) {
  await page.locator('.ProseMirror').first().evaluate((root, [a, b]) => {
    const find = (text, end) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let node
      while ((node = walker.nextNode())) {
        const i = node.data.indexOf(text)
        if (i >= 0) return [node, end ? i + text.length : i]
      }
      throw new Error('text not found: ' + text)
    }
    const [n1, o1] = find(a, false)
    const [n2, o2] = find(b, true)
    const r = document.createRange()
    r.setStart(n1, o1)
    r.setEnd(n2, o2)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(r)
  }, [fromText, toText])
  await page.mouse.move(10, 10)
  await page.waitForTimeout(600)
}

const shots = {
  async hero(browser) {
    const { ctx, page } = await freshPage(browser, { theme: 'dark' })
    const id = await pageIdByTitle(page, 'Weekly sync — notes')
    await page.goto(`${BASE}/app/?e2e#/p/${id}`)
    await page.waitForTimeout(1500)
    await selectRange(page, 'Agenda', 'Budget check')
    await page.getByRole('button', { name: /Ask AI/i }).first().click()
    await page.waitForTimeout(600)
    await page.getByText(/^Summari[sz]e/).first().click()
    await page.waitForTimeout(2500)
    await save(page, 'hero')
    await ctx.close()
  },

  async database(browser) {
    const { ctx, page } = await freshPage(browser)
    const id = await pageIdByTitle(page, 'Projects')
    await page.goto(`${BASE}/app/?e2e#/p/${id}`)
    await page.waitForTimeout(1500)
    const row = await pageIdByTitle(page, 'Website relaunch')
    await page.evaluate((row) => window.__one.ui.getState().openPeek(row), row)
    await page.waitForTimeout(1500)
    await save(page, 'database')
    await ctx.close()
  },

  async ai(browser) {
    const { ctx, page } = await freshPage(browser)
    const id = await pageIdByTitle(page, 'Brand voice')
    await page.goto(`${BASE}/app/?e2e#/p/${id}`)
    await page.waitForTimeout(1500)
    await selectText(page, 'Numbers, names, examples.')
    await page.getByRole('button', { name: /Ask AI/i }).first().click()
    await page.waitForTimeout(600)
    await page.getByText(/^Improve writing/).first().click()
    await page.waitForTimeout(2500)
    await save(page, 'ai')
    await ctx.close()
  },

  async graph(browser) {
    const { ctx, page } = await freshPage(browser)
    await page.goto(`${BASE}/app/?e2e#/graph`)
    await page.waitForTimeout(1500)
    await page.getByRole('switch', { name: /rows/i }).first().click().catch(() => console.log('  (no rows switch)'))
    await page.waitForTimeout(4000)
    const zoomIn = page.getByRole('button', { name: /zoom in/i }).first()
    if (await zoomIn.count()) {
      await zoomIn.click()
      await page.waitForTimeout(400)
    }
    await page.waitForTimeout(800)
    await save(page, 'graph')
    await ctx.close()
  },

  async automations(browser) {
    const { ctx, page } = await freshPage(browser)
    const id = await pageIdByTitle(page, 'Projects')
    await page.goto(`${BASE}/app/?e2e#/p/${id}`)
    await page.waitForTimeout(1200)
    await page.evaluate((databaseId) => window.__one.ui.getState().openModal({ type: 'automations', databaseId }), id)
    await page.waitForTimeout(1000)
    await page.getByText(/Send new rows to n8n/).first().click()
    await page.waitForTimeout(800)
    const url = page.locator('input[type="url"], input[placeholder*="http"]').first()
    if (await url.count()) {
      await url.fill('https://n8n.acme.studio/webhook/new-project')
      await url.press('Tab')
    }
    await page.locator('.modal').getByRole('switch').first().click().catch(() => console.log('  (no enable switch)'))
    await page.waitForTimeout(800)
    await save(page, 'automations')
    await ctx.close()
  },

  async og(browser) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2, colorScheme: 'dark', serviceWorkers: 'block' })
    await routeToLocal(ctx)
    const page = await ctx.newPage()
    await page.goto(`${BASE}/?skip`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2500)
    await page.screenshot({ path: `${TMP}/og@2x.png` })
    execFileSync('python3', ['-c', `from PIL import Image; Image.open('${TMP}/og@2x.png').convert('RGB').resize((1200,630), Image.LANCZOS).save('public/assets/og.png', optimize=True)`])
    console.log('saved public/assets/og.png')
    await ctx.close()
  },
}

const browser = await chromium.launch()
for (const [name, run] of Object.entries(shots)) {
  if (ONLY.length && !ONLY.includes(name)) continue
  try {
    await run(browser)
  } catch (e) {
    console.log(`FAILED ${name}:`, String(e).slice(0, 400))
  }
}
await browser.close()
if (!process.env.KEEP) rmSync(TMP, { recursive: true, force: true })
