#!/usr/bin/env node
/**
 * Captures the real product screenshots used on the landing page and in the README
 * (public/assets/shots/*.webp, 1600×1000) and the Open Graph card (public/assets/og.png).
 *
 *   npm run build:pages && npx vite preview --port 4173 --strictPort &   # base "/"
 *   node scripts/capture-shots.mjs http://127.0.0.1:4173 [shot …]
 *
 * Shots: hero, database, timeline, agenda, inbox, form, forms, ai, meeting, agent, autofill,
 * automations, synced, website, graph — and og (the landing's Open Graph card, only when named).
 * OUT=<dir> writes somewhere else (for a look before replacing); KEEP=1 keeps the PNGs in .shots/capture.
 *
 * Every frame is the app in a 1600×1000 viewport, rendered at device scale 2 and downsampled to
 * 1600×1000 (crisper type and hairlines than a 1× render). Every shot starts from a fresh, seeded
 * workspace in English. Nothing leaves the machine: the Claude API is mocked (streaming answers for
 * writing, structured JSON for autofill and meeting notes, a scripted tool-use run for the agent)
 * and speech recognition is a stand-in that never opens a microphone. Browser errors are printed;
 * a shot that fails or logs errors makes the script exit with code 1.
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
/** Render scale; the saved WebP is always W×H. */
const SCALE = 2
const QUALITY = 84

const DAY_MS = 86_400_000
/** "2026-10-08" for today + n days (local time). */
const isoDay = (n = 0) => {
  const d = new Date(Date.now() + n * DAY_MS)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** Days from today to the next weekday (0 = Sunday … 6 = Saturday), at least 1. */
const untilWeekday = (dow) => ((dow - new Date().getDay() + 7) % 7) || 7

/* ------------------------------------------------------------------ */
/* Claude API mock                                                     */
/* ------------------------------------------------------------------ */

const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`

/** One streamed text answer (writing, summaries). */
function sse(text) {
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

let msgSeq = 0
/** One streamed agent turn: text, progress notes (thinking) and tool calls (input as input_json_delta). */
function sseTurn(blocks, usage) {
  const stop = blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'
  let body = ev('message_start', {
    message: {
      id: `msg_demo_${++msgSeq}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: usage.input, output_tokens: 1, cache_read_input_tokens: usage.cacheRead, cache_creation_input_tokens: usage.cacheWrite },
    },
  })
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      body += ev('content_block_start', { index, content_block: { type: 'text', text: '' } })
      for (const chunk of b.text.match(/.{1,18}/gs)) body += ev('content_block_delta', { index, delta: { type: 'text_delta', text: chunk } })
    } else if (b.type === 'thinking') {
      body += ev('content_block_start', { index, content_block: { type: 'thinking', thinking: '', signature: '' } })
      body += ev('content_block_delta', { index, delta: { type: 'thinking_delta', thinking: b.text } })
      body += ev('content_block_delta', { index, delta: { type: 'signature_delta', signature: 'sig-demo' } })
    } else {
      body += ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } })
      for (const chunk of JSON.stringify(b.input).match(/.{1,24}/gs)) body += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: chunk } })
    }
    body += ev('content_block_stop', { index })
  })
  body += ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: usage.output } })
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

/** What the meeting notes shot "heard" (offsets in ms into the recording). */
const TRANSCRIPT = [
  [48_000, 'Staging looks good. I still have to test the checkout pages and the 404 page.'],
  [221_000, 'Can QA be done by Thursday? Then we launch in two weeks, as planned.'],
  [302_000, 'Thursday works, as long as nobody touches the pricing copy again.'],
  [451_000, 'The n8n webhook is live on staging. New leads land with the right owner.'],
  [555_000, 'Then let’s ship the homepage and pricing first and move the blog in step two.'],
  [768_000, 'Agreed, two steps. Mira, can you update the newsletter to match?'],
  [860_000, 'Sure, I’ll send the draft on Wednesday.'],
  [1_085_000, 'Budget check: we’re at eleven thousand of eighteen.'],
  [1_297_000, 'So it’s a go. Sam switches the webhook to production on launch day.'],
]
const MEETING_MS = 1_342_000

/** Claude's (mocked) meeting notes for TRANSCRIPT — dates relative to the day of the capture. */
const meetingSummary = () => ({
  title: 'Relaunch go/no-go',
  summary: [
    'The relaunch is a go: homepage and pricing ship first, the blog follows in a second step.',
    'Staging looks good; the checkout pages and the 404 page still need QA.',
    'The n8n webhook routes new leads to the right owner on staging.',
    'Budget: about €11,000 of €18,000 spent.',
  ],
  decisions: ['Ship the relaunch in two steps, homepage and pricing first.', 'No more changes to the pricing copy before launch.'],
  actionItems: [
    { text: 'Finish QA of the checkout and 404 pages', owner: 'Alex', due: isoDay(untilWeekday(4)) },
    { text: 'Send the updated newsletter draft', owner: 'Mira', due: isoDay(untilWeekday(3)) },
    { text: 'Switch the n8n webhook to production', owner: 'Sam', due: isoDay(14) },
  ],
})

const AGENT_TASK = 'Make a project for each open action item in this week’s sync notes'

/** The agent's run: search → read (with a progress note) → two staged rows → final answer. */
function agentScript(ids) {
  return [
    () => sseTurn([{ type: 'tool_use', id: 'toolu_1', name: 'search_pages', input: { query: 'weekly sync notes' } }], { input: 2600, output: 60, cacheRead: 0, cacheWrite: 2400 }),
    () =>
      sseTurn(
        [
          { type: 'thinking', text: 'Found the weekly sync. Reading its action items next.' },
          { type: 'tool_use', id: 'toolu_2', name: 'read_page', input: { id: ids.meeting } },
        ],
        { input: 400, output: 70, cacheRead: 2400, cacheWrite: 300 },
      ),
    () => sseTurn([{ type: 'tool_use', id: 'toolu_3', name: 'list_databases', input: {} }], { input: 700, output: 40, cacheRead: 2700, cacheWrite: 200 }),
    () =>
      sseTurn(
        [
          { type: 'thinking', text: 'Two open items: QA (Alex) and the n8n webhook (Sam). Mira’s draft is done.' },
          {
            type: 'tool_use',
            id: 'toolu_4',
            name: 'create_row',
            input: { database_id: ids.projects, title: 'Final QA on staging', properties: { Status: 'Backlog', Priority: 'High', Owner: ['Alex'], Timeline: { start: isoDay(1), end: isoDay(4) } }, markdown: 'From the weekly sync: run the final QA pass on staging before the relaunch goes live.' },
          },
          { type: 'tool_use', id: 'toolu_5', name: 'create_row', input: { database_id: ids.projects, title: 'Connect webhook to n8n', properties: { Status: 'Backlog', Priority: 'Medium', Owner: ['Sam'], Tags: ['Ops', 'Automation'] } } },
        ],
        { input: 900, output: 260, cacheRead: 2900, cacheWrite: 600 },
      ),
    () =>
      sseTurn([{ type: 'text', text: 'Staged **2 new projects** from the weekly sync: *Final QA on staging* (Alex, high priority) and *Connect webhook to n8n* (Sam). Mira’s newsletter draft is already done, so it gets no row.' }], {
        input: 300,
        output: 60,
        cacheRead: 3500,
        cacheWrite: 200,
      }),
  ]
}

/**
 * api.anthropic.com → canned answers. Agent runs (requests with tools) follow `agent`, one step per
 * request; structured requests get autofill / meeting JSON; streaming ones a written answer.
 */
async function mockClaude(ctx, { agent } = {}) {
  let agentStep = 0
  await ctx.route('https://api.anthropic.com/**', (route) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const body = route.request().postData() || ''
    let json = {}
    try {
      json = JSON.parse(body)
    } catch {}
    const stream = { status: 200, headers: { ...cors, 'content-type': 'text/event-stream' } }
    if (json.tools?.length && agent) {
      const step = agent[agentStep++] ?? (() => sseTurn([{ type: 'text', text: 'Done.' }], { input: 100, output: 10, cacheRead: 0, cacheWrite: 0 }))
      // a believable run time on the panel's clock
      return new Promise((r) => setTimeout(r, 1400)).then(() => route.fulfill({ ...stream, body: step() })).catch(() => {})
    }
    if (!json.stream) {
      let value
      if (/meeting transcripts/i.test(JSON.stringify(json.system ?? ''))) value = meetingSummary()
      else {
        // structured output (autofill): {"value": …} for the row named in the prompt
        const prompt = String(json.messages?.[0]?.content ?? '')
        const title = prompt.match(/^# (.+)$/m)?.[1] ?? ''
        value = { value: SUMMARIES[title] ?? null }
      }
      const message = { id: 'msg_demo', type: 'message', role: 'assistant', model: json.model, content: [{ type: 'text', text: JSON.stringify(value) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 420, output_tokens: 24 } }
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(message) })
    }
    return route.fulfill({ ...stream, body: sse(/summar/i.test(body) ? AI_ANSWER : IMPROVED) })
  })
}

/** Web Speech API stand-in (runs in the page): the meeting deck finds an engine, no microphone is ever opened. */
function fakeSpeech() {
  class FakeRecognition {
    lang = ''
    continuous = false
    interimResults = false
    maxAlternatives = 1
    onstart = null
    onresult = null
    onerror = null
    onend = null
    start() {
      setTimeout(() => this.onstart?.(), 20)
    }
    stop() {
      setTimeout(() => this.onend?.(), 20)
    }
    abort() {}
  }
  window.SpeechRecognition = FakeRecognition
  window.webkitSpeechRecognition = FakeRecognition
}

/* ------------------------------------------------------------------ */
/* Browser                                                              */
/* ------------------------------------------------------------------ */

async function routeToLocal(ctx) {
  await ctx.route(`${PUBLIC}/**`, async (route) => {
    // no team server behind this static build: answer the app's probe like a static host's HTML fallback
    if (new URL(route.request().url()).pathname.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html>' })
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

/** Browser errors of the current shot. */
let errors = []

async function freshPage(browser, { theme = 'light', lang = 'en', agent } = {}) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE, colorScheme: theme, locale: lang === 'de' ? 'de-DE' : 'en-US', serviceWorkers: 'block' })
  await routeToLocal(ctx)
  await mockClaude(ctx, { agent })
  await ctx.addInitScript(fakeSpeech)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text().slice(0, 200)}`))
  page.on('response', (r) => r.status() >= 400 && errors.push(`HTTP ${r.status()}: ${r.url()}`))
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

async function openPage(page, title) {
  const id = await pageIdByTitle(page, title)
  await page.goto(`${BASE}/app/?e2e#/p/${id}`)
  await page.waitForTimeout(1200)
  return id
}

/** Open a database page on one of its view tabs. */
async function openDbView(page, title, tab) {
  const id = await openPage(page, title)
  if (tab) {
    await page.locator('#main section.db').first().getByRole('tab').filter({ hasText: tab }).first().click()
    await page.waitForTimeout(1000)
  }
  return id
}

/** A resting UI: no focus ring, nothing hovered (the pointer on an empty stretch of the top bar). */
async function rest(page, x = Math.round(W * 0.62), y = 26) {
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined))
  await page.mouse.move(x, y)
  await page.waitForTimeout(600)
}

/** Scroll the nearest scrolling ancestor of `locator` so its top sits `offset` px below the container's top. */
async function scrollToTop(locator, offset = 8) {
  await locator.evaluate((el, offset) => {
    let p = el.parentElement
    while (p && !(p.scrollHeight > p.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(p).overflowY))) p = p.parentElement
    if (p) p.scrollTop = el.getBoundingClientRect().top - p.getBoundingClientRect().top + p.scrollTop - offset
  }, offset)
  await locator.page().waitForTimeout(400)
}

async function save(page, name) {
  const png = `${TMP}/${name}.png`
  await page.screenshot({ path: png })
  execFileSync('python3', ['-c', `from PIL import Image; Image.open('${png}').convert('RGB').resize((${W}, ${H}), Image.LANCZOS).save('${OUT}/${name}.webp', quality=${QUALITY}, method=6)`])
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

/** Centre / edge of the first element matching `selector` (optionally containing `text`), in viewport px. */
async function anchorOf(page, selector, text, where = 'center') {
  const loc = text ? page.locator(selector, { hasText: text }).first() : page.locator(selector).first()
  const b = await loc.boundingBox()
  if (!b) return null
  const x = where === 'left' ? b.x : where === 'right' ? b.x + b.width : b.x + b.width / 2
  return [Math.round(x), Math.round(b.y + b.height / 2)]
}

/* ------------------------------------------------------------------ */
/* Shots                                                                */
/* ------------------------------------------------------------------ */

const shots = {
  async hero(browser) {
    const { ctx, page } = await freshPage(browser, { theme: 'dark' })
    await openPage(page, 'Weekly sync — notes')
    await selectRange(page, 'Agenda', 'Budget check')
    await page.getByRole('button', { name: /Ask AI/i }).first().click()
    await page.waitForTimeout(600)
    await page.getByText(/^Summari[sz]e/).first().click()
    await page.waitForTimeout(2500)
    // where the landing's callouts point (src/landing/site/figures.ts → HERO_CALLOUTS: tx, ty)
    const marks = {
      A: await anchorOf(page, '#main .ProseMirror h2', 'Agenda', 'left'),
      B: await anchorOf(page, '.sb-row:has(.sb-row__db) >> nth=1 >> .sb-row__db'),
      C: await anchorOf(page, '.sb-nav .kbd'),
      D: await anchorOf(page, '.ai-model', null, 'right'),
    }
    console.log('  hero callout targets (1600×1000):', JSON.stringify(marks))
    await save(page, 'hero')
    await ctx.close()
  },

  async database(browser) {
    const { ctx, page } = await freshPage(browser)
    await openPage(page, 'Projects')
    const row = await pageIdByTitle(page, 'Website relaunch')
    await page.evaluate((row) => window.__one.ui.getState().openPeek(row), row)
    await page.waitForTimeout(1500)
    await rest(page)
    await save(page, 'database')
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

  /** Inbox: reminders that came due (dates in pages and in date properties), the next ones scheduled. */
  async inbox(browser) {
    const { ctx, page } = await freshPage(browser)
    await page.evaluate(({ today, nineDaysAgo }) => {
      const s = window.__one.workspace.getState()
      const pages = Object.values(s.pages).filter((p) => !p.trashed)
      const byTitle = (t) => pages.find((p) => p.title === t)
      const propOf = (row, name) => s.databases[row.databaseId].properties.find((p) => p.name === name)
      // scheduled: reminders on the next posts' publish dates
      for (const [title, code] of [
        ['Local-first explained in 90 seconds', '-1d'],
        ['October product update', '-2d'],
      ]) {
        const row = byTitle(title)
        const p = propOf(row, 'Publish date')
        s.setRowProperty(row.id, p.id, { ...row.properties[p.id], reminder: code })
      }
      // arrived: reminders that came due today and on the days before, each at its due time
      const now = Date.now()
      const due = (iso, minutesBefore) => {
        const [d, time = '09:00'] = iso.split('T')
        const [y, mo, da] = d.split('-').map(Number)
        const [h, mi] = time.split(':').map(Number)
        return Math.min(new Date(y, mo - 1, da, h, mi - minutesBefore).getTime(), now - 5 * 60_000)
      }
      const sync = byTitle('Weekly sync — notes')
      const post = byTitle('Why we left Notion (and saved €2,880)')
      const n8n = byTitle('n8n lead-routing automation')
      const q4 = byTitle('Q4 content calendar')
      const onboarding = byTitle('Onboarding')
      const pub = propOf(post, 'Publish date')
      const tl = propOf(n8n, 'Timeline')
      // the stand-up at 09:30 (or the last half hour before that, an hour ago, on an early capture)
      const t = new Date(now - 60 * 60_000)
      const early = t.getHours() < 9 || (t.getHours() === 9 && t.getMinutes() < 30)
      const standup = early ? `${today}T${String(t.getHours()).padStart(2, '0')}:${t.getMinutes() < 30 ? '00' : '30'}` : `${today}T09:30`
      const item = (id, page, iso, code, before, extra) => ({ id, kind: 'reminder', pageId: page.id, at: due(iso, before), iso, code, ...extra })
      return window.__oneInbox.inject([
        item(`r:m:${sync.id}:${standup}:-15m`, sync, standup, '-15m', 15, { excerpt: 'Stand-up with Alex and Sam — bring the QA numbers' }),
        item(`r:p:${post.id}:${pub.id}`, post, post.properties[pub.id].start, '-2d', 2 * 24 * 60, { propId: pub.id }),
        item(`r:p:${q4.id}:${tl.id}`, q4, q4.properties[tl.id].start, 'at', 0, { propId: tl.id, read: true }),
        item(`r:p:${n8n.id}:${tl.id}`, n8n, n8n.properties[tl.id].start, 'at', 0, { propId: tl.id, read: true }),
        item(`r:m:${onboarding.id}:${nineDaysAgo}:at`, onboarding, nineDaysAgo, 'at', 0, { excerpt: 'Set up Tooling & automations', read: true }),
      ])
    }, { today: isoDay(0), nineDaysAgo: isoDay(-9) })
    await page.goto(`${BASE}/app/?e2e#/inbox`)
    await page.waitForTimeout(1500)
    await page.locator('.ibx').waitFor()
    await rest(page)
    await save(page, 'inbox')
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
    await scrollToTop(db)
    await rest(page)
    await save(page, 'form')
    await ctx.close()
  },

  /** Form builder: conditional questions wired in the gutter, a page break, the logic editor open. */
  async forms(browser) {
    const { ctx, page } = await freshPage(browser)
    const id = await pageIdByTitle(page, 'Projects')
    // besides the seeded "Budget only for high priority": "Owner" once work has started
    await page.evaluate((id) => {
      const s = window.__one.workspace.getState()
      const db = s.databases[id]
      const prop = (name) => db.properties.find((p) => p.name === name)
      const status = prop('Status')
      const view = db.views.find((v) => v.type === 'form')
      const questions = { ...view.form.questions, [prop('Owner').id]: { ...(view.form.questions[prop('Owner').id] ?? {}), showIf: { op: 'and', conditions: [{ q: status.id, op: 'is_not', value: status.options[0].id }] } } }
      s.updateView(id, view.id, { form: { ...view.form, questions, webhookUrl: 'https://n8n.acme.studio/webhook/project-intake' } })
    }, id)
    await openDbView(page, 'Projects', 'Intake form')
    const db = page.locator('#main section.db').first()
    await db.getByRole('radio', { name: 'Build' }).click().catch(() => console.log('  (no build mode switch)'))
    await page.waitForTimeout(600)
    // § 02 Questions at the top: Status → Owner wired, Priority → Budget running down past the page break
    await scrollToTop(db.locator('.fb-qwrap').locator('xpath=..'), 16)
    // the owner question: its rail lights up (hover without scrolling)
    const owner = await db.locator('.fb-q__li[data-logic]').first().boundingBox()
    await page.mouse.move(owner.x + owner.width - 120, owner.y + 40)
    await page.waitForTimeout(500)
    await save(page, 'forms')
    await ctx.close()
  },

  async ai(browser) {
    const { ctx, page } = await freshPage(browser)
    await openPage(page, 'Brand voice')
    await selectText(page, 'Numbers, names, examples.')
    await page.getByRole('button', { name: /Ask AI/i }).first().click()
    await page.waitForTimeout(600)
    await page.getByText(/^Improve writing/).first().click()
    await page.waitForTimeout(2500)
    await save(page, 'ai')
    await ctx.close()
  },

  /** AI meeting notes: a recorded meeting (transcript open) and the notes Claude wrote from it. */
  async meeting(browser) {
    const { ctx, page } = await freshPage(browser)
    const id = await page.evaluate(({ transcript, ms }) => {
      const s = window.__one.workspace.getState()
      const meetings = Object.values(s.pages).find((p) => p.title === 'Meetings' && p.kind === 'database')
      const db = s.databases[meetings.id]
      const prop = (name) => db.properties.find((p) => p.name === name)
      const people = s.people ?? []
      const person = (name) => people.find((p) => p.name === name)?.id
      // the last weekday morning that is over: 10:00, a few minutes of pauses
      const day = new Date()
      if (day.getHours() < 11) day.setDate(day.getDate() - 1)
      while (day.getDay() === 0 || day.getDay() === 6) day.setDate(day.getDate() - 1)
      day.setHours(10, 0, 0, 0)
      const start = day.getTime()
      const end = start + ms + 3 * 60_000
      const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
      const meeting = {
        type: 'meetingNotes',
        attrs: { id: 'mtg-demo', title: '', status: 'idle', language: 'en-US', startedAt: start, endedAt: end, duration: ms, transcript: transcript.map(([t, text]) => ({ t, text })), recordedBy: null },
        content: [{ type: 'paragraph' }],
      }
      return s.createRow(meetings.id, {
        title: 'Relaunch go/no-go',
        properties: { [prop('Date').id]: { start: iso }, [prop('Type').id]: prop('Type').options[0].id, [prop('Attendees').id]: ['Alex', 'Sam', 'Mira'].map(person).filter(Boolean) },
        content: { type: 'doc', content: [meeting, { type: 'paragraph' }] },
      })
    }, { transcript: TRANSCRIPT, ms: MEETING_MS })
    await page.goto(`${BASE}/app/?e2e#/p/${id}`)
    await page.waitForTimeout(1500)
    const deck = page.locator('#main .mtg').first()
    await deck.locator('[data-meeting-key="summarize"]').click()
    await page.locator('#main').getByRole('heading', { name: 'Action items' }).waitFor({ timeout: 20_000 })
    await page.waitForTimeout(800)
    // the transcript folds away once the notes are written: open it again, from its first line
    await deck.locator('.mtg__tx-toggle').click()
    await page.waitForTimeout(500)
    await deck.locator('.mtg__tx-list').evaluate((el) => (el.scrollTop = 0))
    await scrollToTop(deck, 24)
    await rest(page)
    await save(page, 'meeting')
    await ctx.close()
  },

  /** Workspace agent (⌘J): step log and two staged rows, nothing written yet. */
  async agent(browser) {
    const ids = {}
    const { ctx, page } = await freshPage(browser, { agent: agentScript(ids) })
    ids.meeting = await openPage(page, 'Weekly sync — notes')
    ids.projects = await pageIdByTitle(page, 'Projects')
    await page.keyboard.press('Control+j')
    const panel = page.getByRole('dialog', { name: 'Agent' })
    await panel.waitFor()
    const field = panel.getByRole('textbox', { name: 'Task for the agent' })
    await field.fill(AGENT_TASK)
    await field.press('Enter')
    await panel.getByRole('heading', { name: '2 proposed changes' }).waitFor({ timeout: 20_000 })
    await page.waitForTimeout(1200)
    // from the task down: the step log, the answer, the first staged rows
    const box = await panel.boundingBox()
    await page.mouse.move(box.x + box.width / 2, H / 2)
    await page.mouse.wheel(0, -4000)
    await page.waitForTimeout(600)
    await rest(page, W / 2 - 200, 26)
    await save(page, 'agent')
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

  async automations(browser) {
    const { ctx, page } = await freshPage(browser)
    const id = await openPage(page, 'Projects')
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
    await rest(page)
    await save(page, 'automations')
    await ctx.close()
  },

  /** Synced block: the brand principles on "Brand voice" and, live, inside the meeting notes (stacked panes). */
  async synced(browser) {
    const { ctx, page } = await freshPage(browser)
    await openPage(page, 'Brand voice')
    const sync = await pageIdByTitle(page, 'Weekly sync — notes')
    await page.evaluate((id) => window.__one.ui.getState().openPane(id), sync)
    await page.waitForTimeout(1500)
    const blocks = page.locator('[data-type="synced-block"]')
    const original = blocks.first()
    const reference = blocks.last()
    // the copy level with the original (a pane scrolls by wheel only)
    const delta = (await reference.boundingBox()).y - (await original.boundingBox()).y
    await page.mouse.move(W - 300, H / 2)
    await page.mouse.wheel(0, delta)
    await page.waitForTimeout(700)
    // both lit, as if pointed at: the frame and the tag ("Synced · 2 pages" / "Synced from Brand voice")
    for (const block of [original, reference]) await block.evaluate((el) => el.classList.add('is-open'))
    await page.mouse.move(W / 2 + 120, 26)
    await page.waitForTimeout(600)
    await save(page, 'synced')
    await ctx.close()
  },

  async website(browser) {
    const { ctx, page } = await freshPage(browser)
    const home = await openPage(page, 'Team wiki')
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
let failed = 0
for (const [name, run] of Object.entries(shots)) {
  if (ONLY.length ? !ONLY.includes(name) : name === 'og') continue
  errors = []
  try {
    await run(browser)
  } catch (e) {
    failed++
    console.log(`FAILED ${name}:`, String(e).slice(0, 400))
  }
  if (errors.length) {
    failed++
    console.log(`ERRORS in ${name}:\n  ${errors.join('\n  ')}`)
  }
}
await browser.close()
if (!process.env.KEEP) rmSync(TMP, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
