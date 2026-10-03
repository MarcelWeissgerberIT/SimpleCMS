#!/usr/bin/env node
/**
 * Captures the real product screenshots used on the landing page
 * (public/assets/shots/*.webp, 1600×1000) and the Open Graph card (public/assets/og.png).
 *
 *   npm run build:pages && npx vite preview --port 4173 --strictPort &   # base "/"
 *   node scripts/capture-shots.mjs http://127.0.0.1:4173 [shot …]
 *
 * Shots: hero, database, timeline, agenda, form, ai, autofill, automations, website, graph, og.
 * OUT=<dir> writes somewhere else (for a look before replacing); KEEP=1 keeps the PNGs in .shots/capture.
 *
 * Every shot starts from a fresh, seeded workspace. The Claude API is mocked (a canned streaming
 * answer for writing, structured JSON for autofill), so the AI shots need no key and no network.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'

// Local server to read from (`npm run build:pages` + `vite preview`, base "/").
const LOCAL = (process.argv[2] || 'http://127.0.0.1:4173').replace(/\/$/, '')
// Pages are loaded under the public URL so links/payloads in the shots show it; requests are routed to LOCAL.
const PUBLIC = 'https://getonecms.com'
const BASE = PUBLIC
const OUT = process.env.OUT || 'public/assets/shots'
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

/** AI autofill answers ("Summary" column on Projects), keyed by row title. */
const SUMMARIES = {
  'Website relaunch': 'New marketing site, 60 % done; QA on staging before the launch date.',
  'Import our Notion workspace': 'Done: all pages and six databases moved over in one import.',
  'n8n lead-routing automation': 'Webhook from Projects into n8n routes new leads to the right owner.',
  'Q4 content calendar': 'Six posts across newsletter, LinkedIn and YouTube; most drafts written.',
  'Customer onboarding video': 'Five-minute walkthrough for new customers; waits for the AI assistant.',
  'Pricing page experiment': 'A/B test of two pricing layouts after the relaunch ships.',
  'AI support assistant': 'Claude answers common support questions from the team wiki.',
  'Brand refresh': 'Finished: new logo, colours and type, rolled out in September.',
}

async function routeToLocal(ctx) {
  await ctx.route(`${PUBLIC}/**`, async (route) => {
    const url = route.request().url().replace(PUBLIC, LOCAL)
    try {
      const response = await route.fetch({ url })
      await route.fulfill({ response })
    } catch {
      // the page or context went away mid-request (a shot finished): nothing to deliver
      await route.abort().catch(() => {})
    }
  })
}

async function freshPage(browser, { theme = 'light', lang = 'en' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: theme, locale: lang === 'de' ? 'de-DE' : 'en-US', serviceWorkers: 'block' })
  await routeToLocal(ctx)
  await ctx.route('https://api.anthropic.com/**', (route) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const body = route.request().postData() || ''
    let json = {}
    try {
      json = JSON.parse(body)
    } catch {}
    if (!json.stream) {
      // structured output (autofill): {"value": …} for the row named in the prompt
      const prompt = String(json.messages?.[0]?.content ?? '')
      const title = prompt.match(/^# (.+)$/m)?.[1] ?? ''
      const text = JSON.stringify({ value: SUMMARIES[title] ?? null })
      const message = { id: 'msg_demo', type: 'message', role: 'assistant', model: json.model, content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 420, output_tokens: 24 } }
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(message) })
    }
    const answer = /summar/i.test(body) ? AI_ANSWER : IMPROVED
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', ...cors }, body: sse(answer) })
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

/** Open a database page on one of its view tabs. */
async function openDbView(page, title, tab) {
  const id = await pageIdByTitle(page, title)
  await page.goto(`${BASE}/app/?e2e#/p/${id}`)
  await page.waitForTimeout(1200)
  if (tab) {
    await page.locator('#main section.db').first().getByRole('tab').filter({ hasText: tab }).first().click()
    await page.waitForTimeout(1000)
  }
  return id
}

/** A resting UI: no focus ring, nothing hovered. */
async function rest(page, x = W - 4, y = H - 4) {
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined))
  await page.mouse.move(x, y)
  await page.waitForTimeout(600)
}

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
    // nothing hovered (an empty stretch of the top bar)
    await page.mouse.move(W / 2, 22)
    await page.waitForTimeout(800)
    await save(page, 'graph')
    await ctx.close()
  },

  async automations(browser) {
    const { ctx, page } = await freshPage(browser)
    const id = await pageIdByTitle(page, 'Projects')
    await page.goto(`${BASE}/app/?e2e#/p/${id}`)
    await page.waitForTimeout(1200)
    // the seeded "Notify when Status → Done" automation, plus a webhook action into n8n
    await page.evaluate((databaseId) => window.__one.ui.getState().openModal({ type: 'automations', databaseId }), id)
    await page.waitForTimeout(1000)
    await page.locator('.modal').getByRole('button', { name: 'Add action' }).click()
    await page.waitForTimeout(300)
    await page.getByRole('menuitem', { name: /Send webhook/ }).or(page.getByRole('button', { name: /Send webhook/ })).first().click()
    await page.waitForTimeout(500)
    const url = page.locator('.modal input[type="url"], .modal input[placeholder*="http"]').last()
    if (await url.count()) {
      await url.fill('https://n8n.acme.studio/webhook/project-done')
      await url.press('Tab')
    } else console.log('  (no webhook URL field)')
    // a resting UI: no focus ring, nothing hovered
    await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined))
    await page.mouse.move(W - 4, H - 4)
    await page.waitForTimeout(800)
    await save(page, 'automations')
    await ctx.close()
  },

  async timeline(browser) {
    const { ctx, page } = await freshPage(browser)
    await openDbView(page, 'Projects', 'Timeline')
    await rest(page)
    await save(page, 'timeline')
    await ctx.close()
  },

  async agenda(browser) {
    const { ctx, page } = await freshPage(browser)
    await page.goto(`${BASE}/app/?e2e#/agenda`)
    await page.waitForTimeout(1500)
    await page.locator('.ag').waitFor()
    await page.keyboard.press('m') // month view
    await page.waitForTimeout(800)
    await rest(page)
    await save(page, 'agenda')
    await ctx.close()
  },

  async form(browser) {
    const { ctx, page } = await freshPage(browser)
    const id = await pageIdByTitle(page, 'Projects')
    // shared answers go to an n8n webhook (the bar shows its host)
    await page.evaluate((id) => {
      const s = window.__one.workspace.getState()
      const view = s.databases[id].views.find((v) => v.type === 'form')
      s.updateView(id, view.id, { form: { ...view.form, webhookUrl: 'https://n8n.acme.studio/webhook/project-intake' } })
    }, id)
    await openDbView(page, 'Projects', 'Intake form')
    const db = page.locator('#main section.db').first()
    const fill = db.getByRole('radio', { name: 'Fill' })
    if (await fill.count()) {
      await fill.click()
      await page.waitForTimeout(500)
      await db.getByRole('textbox').first().fill('Partner portal')
      for (const answer of ['In progress', 'High', 'Alex']) {
        await db.locator('label', { hasText: answer }).first().click({ timeout: 3000 }).catch(() => console.log(`  (no "${answer}" option)`))
      }
    } else console.log('  (no fill mode switch)')
    // the form, not the page header, fills the frame
    await db.evaluate((el) => {
      let p = el.parentElement
      while (p && !(p.scrollHeight > p.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(p).overflowY))) p = p.parentElement
      if (p) p.scrollTop = el.getBoundingClientRect().top - p.getBoundingClientRect().top + p.scrollTop - 8
    })
    await rest(page)
    await save(page, 'form')
    await ctx.close()
  },

  async autofill(browser) {
    const { ctx, page } = await freshPage(browser)
    const id = await openDbView(page, 'Projects', 'All projects')
    await page.evaluate((id) => window.__one.workspace.getState().addProperty(id, { type: 'text', name: 'Summary' }), id)
    await page.waitForTimeout(600)
    const db = page.locator('#main section.db').first()
    await db.locator('.dbt-hcell__btn', { hasText: 'Summary' }).click()
    await page.getByRole('menuitem', { name: /AI autofill/ }).click()
    const dlg = page.getByRole('dialog', { name: /AI autofill/ })
    await dlg.waitFor()
    await dlg.getByRole('button', { name: /Fill all rows/ }).click()
    await dlg.getByRole('table', { name: 'Proposed values' }).waitFor({ timeout: 20_000 })
    await page.waitForTimeout(600)
    await rest(page, 4, H - 4)
    await save(page, 'autofill')
    await ctx.close()
  },

  async website(browser) {
    const { ctx, page } = await freshPage(browser)
    const home = await pageIdByTitle(page, 'Team wiki')
    await page.goto(`${BASE}/app/?e2e#/p/${home}`)
    await page.waitForTimeout(1200)
    await page.evaluate((pageId) => window.__one.ui.getState().openModal({ type: 'export', pageId }), home)
    await page.waitForTimeout(800)
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: /Website/ }).click()
    await page.waitForTimeout(300)
    const title = dialog.getByLabel(/Site title/)
    if (await title.count()) await title.fill('Acme handbook')
    const base = dialog.getByLabel(/Base URL/)
    if (await base.count()) {
      await base.fill('handbook.acme.studio')
      await base.press('Tab')
    }
    await rest(page)
    await save(page, 'website')
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
