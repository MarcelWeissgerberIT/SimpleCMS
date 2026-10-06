#!/usr/bin/env node
/**
 * The pictures of "What's new" (src/app/help/changelog): real screenshots of the app, made reproducibly.
 *
 *   CHANGELOG_DRAFT=1 npx vite build --outDir node_modules/.cache/cl-shots-dist --emptyOutDir   # base "/"
 *   npx vite preview --host 127.0.0.1 --port 5315 --strictPort --outDir node_modules/.cache/cl-shots-dist &
 *   node scripts/changelog-shots.mjs http://127.0.0.1:5315 [shot …]
 *
 * (CHANGELOG_DRAFT=1 lets the build pass while a new entry's picture does not exist yet.)
 *
 * Shots: quick-capture, one-script-everywhere, file-ai, one-script, transform, ai-edit, db-commands, gmail-one-click, memory, grips-footer, block-select, split-to-page, image-ai, claude-reads, redo, ai-terminal, mcp-codewords, mcp-tidy-up, slash-menu, turn-into-database,
 * custom-agents, gmail, help-centre, mcp-servers, feed-blocks — each named like its image. Every shot starts from a fresh, seeded
 * workspace in English, light theme, 1440 × 900 at device scale 2; the crop of the relevant area is scaled
 * to 1440 px wide and saved as public/assets/shots/changelog/<shot>.webp (≤ 150 KB: the quality steps down
 * until it fits), its pixel size goes into sizes.json next to it (the public /help/changelog/ page reads it).
 *
 * Nothing leaves the machine: api.anthropic.com is mocked (streamed answers, structured JSON, scripted
 * tool-use runs — never a real request), Gmail and Google's sign-in script are in-memory stand-ins, the MCP
 * bridge for the tidy-up shot is the repository's own public/mcp/one-mcp.mjs on a local port. Browser errors
 * are printed; a shot that fails or logs errors makes the script exit with code 1. KEEP=1 keeps the PNGs in
 * .shots/changelog. Needs python3 with Pillow (WebP encoding), like scripts/capture-shots.mjs.
 */
import { chromium } from 'playwright'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const LOCAL = (process.argv[2] || 'http://127.0.0.1:5315').replace(/\/$/, '')
const ONLY = process.argv.slice(3)
const OUT = process.env.OUT || 'public/assets/shots/changelog'
const TMP = '.shots/changelog'
const SIZES = `${OUT}/sizes.json`
mkdirSync(OUT, { recursive: true })
mkdirSync(TMP, { recursive: true })

const W = 1440
const H = 900
const SCALE = 2
/** final width of every picture */
const OUT_W = 1440
const MAX_BYTES = 150 * 1024

const DAY_MS = 86_400_000
const isoDay = (n = 0) => {
  const d = new Date(Date.now() + n * DAY_MS)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------------ */
/* Claude API mock                                                     */
/* ------------------------------------------------------------------ */

const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
let msgSeq = 0

/** One streamed assistant message: text, thinking, tool_use and MCP blocks. */
function sseTurn(blocks, usage = { input: 1800, output: 120 }) {
  const stop = blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'
  let body = ev('message_start', {
    message: { id: `msg_cl_${++msgSeq}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: usage.input, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  })
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      body += ev('content_block_start', { index, content_block: { type: 'text', text: '' } })
      for (const chunk of b.text.match(/.{1,18}/gs)) body += ev('content_block_delta', { index, delta: { type: 'text_delta', text: chunk } })
    } else if (b.type === 'thinking') {
      body += ev('content_block_start', { index, content_block: { type: 'thinking', thinking: '', signature: '' } })
      body += ev('content_block_delta', { index, delta: { type: 'thinking_delta', thinking: b.text } })
      body += ev('content_block_delta', { index, delta: { type: 'signature_delta', signature: 'sig-cl' } })
    } else if (b.type === 'mcp_tool_use') {
      body += ev('content_block_start', { index, content_block: { type: 'mcp_tool_use', id: b.id, name: b.name, server_name: b.server, input: {} } })
      body += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } })
    } else if (b.type === 'mcp_tool_result') {
      body += ev('content_block_start', { index, content_block: { type: 'mcp_tool_result', tool_use_id: b.id, is_error: false, content: [{ type: 'text', text: b.text }] } })
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

const jsonMessage = (value, model = 'claude-opus-5-5') => ({
  id: `msg_cl_${++msgSeq}`,
  type: 'message',
  role: 'assistant',
  model,
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 900, output_tokens: 400 },
})

/**
 * api.anthropic.com → canned answers. `turns`: tool-use runs, one step per request (agent, terminal);
 * `json(body)`: the structured answer of a non-streaming request; `text(body)`: a streamed answer.
 */
async function mockClaude(ctx, { turns, json, text } = {}) {
  let step = 0
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (req.method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [{ type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-01-01T00:00:00Z' }], has_more: false }) })
    let body = {}
    try {
      body = JSON.parse(req.postData() || '{}')
    } catch {}
    const stream = { status: 200, headers: { ...cors, 'content-type': 'text/event-stream' } }
    try {
      if (!body.stream) return await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(jsonMessage(json ? json(body) : 'ok', body.model)) })
      if (body.tools?.some((t) => t.name) && turns) {
        const next = turns[step++] ?? (() => sseTurn([{ type: 'text', text: 'Done.' }]))
        await sleep(700)
        return await route.fulfill({ ...stream, body: await next(body) })
      }
      return await route.fulfill({ ...stream, body: sseTurn([{ type: 'text', text: text ? text(body) : 'Done.' }]) })
    } catch {
      /* the page went away mid-request */
    }
  })
}

/** The usage prompt One writes for a knowledge base (shown in the MCP shots). */
const ATLAS_GUIDE = '**Atlas** is the team knowledge base: decisions, specs and project records.\n- Find records with `atlas_search` (query, project), read one with `atlas_get` (ref).\n- Check plans against `atlas_constraints` before proposing changes.'

/* ------------------------------------------------------------------ */
/* Browser                                                              */
/* ------------------------------------------------------------------ */

let errors = []

async function freshPage(browser, { claude, setup, viewport } = {}) {
  const ctx = await browser.newContext({
    viewport: viewport ?? { width: W, height: H },
    deviceScaleFactor: SCALE,
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'Europe/Berlin',
    serviceWorkers: 'block',
  })
  await mockClaude(ctx, claude)
  // no team server behind this static build: answer the app's probe like a static host's HTML fallback
  await ctx.route(`${LOCAL}/api/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html>' }))
  if (setup) await setup(ctx)
  const page = await ctx.newPage()
  page.setDefaultNavigationTimeout(60_000)
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text().slice(0, 200)}`))
  page.on('response', (r) => r.status() >= 400 && r.url().startsWith(LOCAL) && errors.push(`HTTP ${r.status()}: ${r.url()}`))
  await page.goto(`${LOCAL}/app/?e2e`, { waitUntil: 'networkidle' })
  await page.evaluate(async () => {
    localStorage.clear()
    const dbs = (await indexedDB.databases?.()) ?? []
    await Promise.all(dbs.map((d) => new Promise((r) => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = r })))
    // the help's "What's new" LED stays off in these pictures
    localStorage.setItem('one.help.seen-changelog', '9999-12-31-shots')
  })
  await page.goto(`${LOCAL}/app/?e2e`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!window.__one)
  await page.evaluate(() => window.__one.workspace.getState().updateSettings({ theme: 'light', language: 'en', aiApiKey: 'sk-ant-demo-key', userName: 'Marcel' }))
  await page.waitForTimeout(600)
  return { ctx, page }
}

const pageIdByTitle = (page, title) =>
  page.evaluate((title) => Object.values(window.__one.workspace.getState().pages).find((p) => p.title === title && !p.trashed)?.id, title)

async function openPage(page, idOrTitle) {
  const id = (await pageIdByTitle(page, idOrTitle)) ?? idOrTitle
  await page.evaluate((id) => (window.location.hash = `#/p/${id}`), id)
  await page.locator('#main .pv-title').waitFor()
  await page.waitForTimeout(900)
  return id
}

/** Create a page from TipTap JSON (through the store) and return its id. */
const createPage = (page, title, content, extra = {}) =>
  page.evaluate(
    ({ title, content, extra }) => {
      const s = window.__one.workspace.getState()
      const id = s.createPage({ title, parentId: null, ...extra })
      if (content) s.setContent(id, content, 'seed')
      return id
    },
    { title, content, extra },
  )

/** A resting UI: no focus ring, nothing hovered. */
async function rest(page) {
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined))
  await page.mouse.move(W + 40, H + 40)
  await page.waitForTimeout(500)
}

/** Select from the start of `from` to the end of `to` inside the main editor (DOM range). */
async function selectRange(page, from, to = from) {
  const ed = page.locator('#main .ProseMirror').first()
  for (let attempt = 0; attempt < 5; attempt++) {
    await ed.evaluate((root, [a, b]) => {
      const find = (needle, end) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let node
        while ((node = walker.nextNode())) {
          const i = node.data.indexOf(needle)
          if (i >= 0) return [node, end ? i + needle.length : i]
        }
        throw new Error(`text not found: ${needle}`)
      }
      const [n1, o1] = find(a, false)
      const [n2, o2] = find(b, true)
      const r = document.createRange()
      r.setStart(n1, o1)
      r.setEnd(n2, o2)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(r)
    }, [from, to])
    await page.waitForTimeout(200)
    const got = await page.evaluate(() => window.getSelection()?.toString() ?? '')
    if (got.startsWith(from) && got.trimEnd().endsWith(to)) break
  }
  await page.mouse.move(10, 10)
  await page.waitForTimeout(400)
}

/** The box of a locator, grown by `pad` and kept inside the viewport. */
async function boxOf(locator, pad = 0) {
  const b = await locator.boundingBox()
  if (!b) throw new Error('no box')
  const vp = locator.page().viewportSize()
  const x = Math.max(0, b.x - pad)
  const y = Math.max(0, b.y - pad)
  return { x, y, width: Math.min(vp.width - x, b.width + 2 * pad), height: Math.min(vp.height - y, b.height + 2 * pad) }
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

/** Union of boxes. */
const union = (...boxes) => {
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y }
}

/** A crop of `ratio` (width / height) around `box`, as wide as needed, inside the viewport. */
function frameAround(box, vp, ratio = 16 / 10, pad = 24) {
  let width = Math.max(box.width + 2 * pad, (box.height + 2 * pad) * ratio)
  let height = width / ratio
  if (width > vp.width) {
    width = vp.width
    height = Math.min(vp.height, width / ratio)
  }
  if (height > vp.height) {
    height = vp.height
    width = Math.min(vp.width, height * ratio)
  }
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const x = Math.min(Math.max(0, cx - width / 2), vp.width - width)
  const y = Math.min(Math.max(0, cy - height / 2), vp.height - height)
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

function readSizes() {
  try {
    return JSON.parse(readFileSync(SIZES, 'utf8'))
  } catch {
    return {}
  }
}

/** Screenshot (a crop in CSS px, or the viewport), scale to OUT_W wide, WebP ≤ MAX_BYTES; record the size. */
async function save(page, name, clip) {
  const png = `${TMP}/${name}.png`
  await page.screenshot({ path: png, ...(clip ? { clip } : {}) })
  const out = `${OUT}/${name}.webp`
  const py = `
import sys
from PIL import Image
src, out, width, limit = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
im = Image.open(src).convert('RGB')
h = round(im.height * width / im.width)
im = im.resize((width, h), Image.LANCZOS)
import io
for q in (86, 82, 78, 74, 70, 66, 62, 58):
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=q, method=6)
    if buf.tell() <= limit or q == 58:
        open(out, 'wb').write(buf.getvalue())
        print(f'{width}x{h} q{q} {buf.tell() // 1024} KB')
        break
`
  const info = execFileSync('python3', ['-c', py, png, out, String(OUT_W), String(MAX_BYTES)]).toString().trim()
  const [w, h] = info.split(' ')[0].split('x').map(Number)
  const sizes = readSizes()
  sizes[`${name}.webp`] = [w, h]
  const sorted = Object.fromEntries(Object.entries(sizes).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(SIZES, `${JSON.stringify(sorted, null, 2)}\n`)
  console.log('saved', out, info, `(${Math.round(statSync(out).size / 1024)} KB)`)
}

/* ------------------------------------------------------------------ */
/* Shots                                                                */
/* ------------------------------------------------------------------ */

/** Tiny TipTap JSON builders. */
const text = (t) => ({ type: 'text', text: t })
const doc = (...content) => ({ type: 'doc', content })
const para = (t) => (t ? { type: 'paragraph', content: [text(t)] } : { type: 'paragraph' })
const h = (level, t) => ({ type: 'heading', attrs: { level }, content: [text(t)] })
const li = (...content) => ({ type: 'listItem', content })

/** A pasted status report (fictional) for "Turn into database". */
const REPORT = {
  title: 'Project Delta: open high-priority items',
  intro: 'Pasted from the knowledge base on Monday.',
  source: 'Source: knowledge base, projects “Delta Core” and “Delta UI”. 12 items, grouped by topic.',
  topics: [
    ['API v1 and migration', [['/r/24701', 'Bug', 'v1 result routes registered twice', 'In progress', 'Lea Brandt'], ['/r/24702', 'Ticket', 'v1 has no audit area', 'Open', 'Tom Weber'], ['/r/24703', 'Spike', 'port the detail page to the REST framework', 'Todo', 'Tom Weber']]],
    ['Results and calibration', [['/r/24772', 'Bug', 'checkout rounding differs from the invoice', 'In progress', 'Mia Roth'], ['/r/24705', 'Ticket', 'export results as CSV', 'Open', 'Mia Roth'], ['/r/24706', 'Bug', 'rounding differs between list and detail', 'Todo', 'Mia Roth']]],
    ['Permissions', [['/r/24790', 'Bug', 'viewers can open the export dialog', 'In progress', 'Jan Vogel'], ['/r/24708', 'Ticket', 'role editor for lab leads', 'Open', 'Jan Vogel'], ['/r/24709', 'Spike', 'single sign-on for partner labs', 'Todo', 'Lea Brandt']]],
    ['Search', [['/r/24811', 'Bug', 'umlauts break the sample search', 'Open', null], ['/r/24812', 'Ticket', 'save search filters per user', 'Todo', 'Mia Roth'], ['/r/24813', 'Bug', 'result list takes 9 s with 5,000 rows', 'Open', null]]],
  ],
}

function reportDoc() {
  const line = ([ref, type, what, status, who]) => `${ref} ${type}: ${what}. ${status} · ${who ?? 'unassigned'}`
  return doc(
    para(REPORT.intro),
    h(2, REPORT.title),
    para(REPORT.source),
    { type: 'orderedList', attrs: { start: 1 }, content: REPORT.topics.map(([name, items]) => li(para(name), { type: 'bulletList', content: items.map((i) => li(para(line(i)))) })) },
    h(3, 'Notes'),
    { type: 'bulletList', content: [li(para('Two items have no assignee: /r/24811, /r/24813.')), li(para('Next review on Friday.'))] },
  )
}

function reportAnswer() {
  const all = REPORT.topics.flatMap(([, items]) => items)
  const uniq = (xs) => [...new Set(xs.filter(Boolean))]
  return {
    title: REPORT.title,
    columns: [
      { name: 'Topic', type: 'select', options: REPORT.topics.map(([n]) => n) },
      { name: 'Type', type: 'select', options: ['Bug', 'Ticket', 'Spike'] },
      { name: 'Ref', type: 'text', options: [] },
      { name: 'Status', type: 'select', options: uniq(all.map((i) => i[3])) },
      { name: 'Assignee', type: 'select', options: uniq(all.map((i) => i[4])) },
    ],
    entries: REPORT.topics.flatMap(([topic, items]) =>
      items.map(([ref, type, what, status, who]) => ({
        title: what[0].toUpperCase() + what.slice(1),
        values: [
          { column: 'Topic', value: topic },
          { column: 'Type', value: type },
          { column: 'Ref', value: ref },
          { column: 'Status', value: status },
          ...(who ? [{ column: 'Assignee', value: who }] : []),
        ],
        body: null,
      })),
    ),
    groupBy: 'Topic',
    keep: [1, 3, 5, 6],
  }
}

/** Planning notes (fictional) for the "what Claude reads" and "redo" shots. */
const PLAN = {
  goal: 'Goal: ship the relaunch in two steps — homepage and pricing first, the blog after; the CMS migration stays on the critical path.',
  budget: 'Budget: €18,000 for the quarter, €11,000 spent; the remaining burn rate covers QA and one more design iteration.',
  salary: 'Salary bands for the two new hires — confidential, HR only.',
  risks: 'Risks: the pricing copy is still open and QA needs two more days, so the go-live has a dependency on legal sign-off.',
  personal: 'Personal note: call the bank on Thursday.',
}
const planDoc = () => doc(h(2, 'Where we stand'), para(PLAN.goal), para(PLAN.budget), para(PLAN.salary), para(PLAN.risks), para(PLAN.personal), para(''))

/** Claude's rewrite of the marked passages (by their text), as the structured redo answer. */
const REDONE = {
  [PLAN.goal]: 'Goal: ship the relaunch in two steps — homepage and pricing first, the blog after. Moving to the new CMS (the system behind the site) comes first, or everything slips.',
  [PLAN.budget]: 'Budget: €18,000 for the quarter, €11,000 spent; what we spend per month still covers QA and one more design round.',
  [PLAN.risks]: 'Risks: the pricing copy is still open and QA needs two more days — and we can only go live once legal has signed off.',
}
function redoAnswer(body) {
  const prompt = String(body.messages?.[0]?.content ?? '')
  const items = [...prompt.matchAll(/<passage n="(\d+)">\n([\s\S]*?)\n<\/passage>/g)].map((m) => ({ n: Number(m[1]), markdown: REDONE[m[2].trim()] ?? m[2] }))
  return { items }
}

/** Caret on the empty last line of the open page, Space → the AI menu. */
async function openAIPanel(page) {
  const ed = page.locator('#main .ProseMirror').first()
  const ai = page.locator('.ai-panel')
  for (let attempt = 0; attempt < 4 && !(await ai.count()); attempt++) {
    await ed.locator('p').last().click()
    await ed.evaluate((root) => root.editor?.chain().focus().setTextSelection(root.editor.state.doc.content.size - 1).run())
    await page.waitForTimeout(150)
    await page.keyboard.press('Space')
    await page.waitForTimeout(500)
  }
  await ai.first().waitFor()
}

/* Gmail stand-ins: Google's token client and an in-memory mailbox (gmail.googleapis.com). */
const GIS_JS = `(() => {
  let n = 0
  window.google = { accounts: { oauth2: {
    initTokenClient(cfg) {
      return { requestAccessToken() { setTimeout(() => cfg.callback({ access_token: 'ya29.shots-token-' + (++n), expires_in: 3599, scope: cfg.scope, token_type: 'Bearer' }), 40) } }
    },
    hasGrantedAllScopes(r, ...scopes) { return scopes.every((s) => String(r.scope || '').split(' ').includes(s)) },
    revoke(token, done) { done && done() },
  } } }
})()`

const ACCOUNT = 'marcel@acme.studio'
const b64url = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const HOUR = 3_600_000

/** Fictional mails, newest first. */
const MAILS = (now) => [
  { id: 'm1', labelIds: ['INBOX', 'UNREAD'], date: now - 1 * HOUR, subject: 'Re: Relaunch QA — staging access', from: 'Sam Okafor <sam@acme.studio>', text: 'Hi Marcel,\n\ncould you give me access to staging today? I want to run the QA pass on the checkout pages before Thursday.\n\nThanks, Sam' },
  { id: 'm2', labelIds: ['INBOX', 'UNREAD'], date: now - 5 * HOUR, subject: 'Contract renewal — please sign by Friday', from: 'Lena Hoffmann <lena@northwind.example>', text: 'Hello Marcel,\n\nattached is the renewal for next year, unchanged terms. Could you sign it by Friday?\n\nBest, Lena' },
  { id: 'm3', labelIds: ['INBOX'], date: now - 26 * HOUR, subject: 'Invoice 2026-114 for September', from: 'Billing <billing@cloudhost.example>', text: 'Your invoice for September: €480.00, due on 20 October.' },
  { id: 'm4', labelIds: ['INBOX', 'UNREAD'], date: now - 30 * HOUR, subject: 'Quote for the onboarding video', from: 'Studio Lumen <hello@studiolumen.example>', text: 'Hi! Our quote: €6,000 for a five-minute video with two revision rounds. Can we talk next week?' },
  { id: 'm5', labelIds: ['INBOX'], date: now - 50 * HOUR, subject: 'Lunch on Thursday?', from: 'Mira Jensen <mira@acme.studio>', text: 'Lunch on Thursday at the usual place? 12:30?' },
  { id: 'm6', labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'], date: now - 74 * HOUR, subject: 'The week in SaaS: pricing pages that convert', from: 'SaaS Weekly <news@saasweekly.example>', text: 'This week: five pricing pages that convert, and why annual plans win.' },
  { id: 'm7', labelIds: ['INBOX'], date: now - 98 * HOUR, subject: 'New sign-in to your account', from: 'Security <no-reply@accounts.example>', text: 'A new sign-in from Chrome on macOS. If this was you, nothing to do.' },
]

/** What Claude (mocked) says about each mail. */
const SORTED = {
  m1: { category: 'Todo', priority: 'high', needsReply: true, summary: 'Sam needs staging access today for the checkout QA.' },
  m2: { category: 'Customer', priority: 'high', needsReply: true, summary: 'Northwind’s renewal, same terms — sign by Friday.' },
  m3: { category: 'Invoice', priority: 'medium', needsReply: false, summary: 'September invoice: €480, due 20 October.' },
  m4: { category: 'Todo', priority: 'medium', needsReply: true, summary: 'Video quote: €6,000, two revision rounds; wants a call.' },
  m5: { category: 'Personal', priority: 'low', needsReply: true, summary: 'Mira asks about lunch on Thursday, 12:30.' },
  m6: { category: 'Newsletter', priority: 'low', needsReply: false, summary: 'Newsletter about pricing pages.' },
  m7: { category: 'Notification', priority: 'low', needsReply: false, summary: 'New sign-in from Chrome on macOS.' },
}

class Mailbox {
  constructor(mails) {
    this.mails = mails
    this.historyId = 1000
  }
  async handle(route) {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'retry-after' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': 'authorization, accept', 'access-control-allow-methods': 'GET' } })
    const url = new URL(req.url())
    const path = url.pathname.replace('/gmail/v1/users/me/', '')
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (path === 'profile') return json(200, { emailAddress: ACCOUNT, messagesTotal: this.mails.length, historyId: String(this.historyId) })
    if (path === 'labels') return json(200, { labels: ['INBOX', 'UNREAD', 'STARRED', 'SPAM', 'TRASH', 'CATEGORY_PROMOTIONS'].map((id) => ({ id, name: id, type: 'system' })).concat([{ id: 'Label_work', name: 'Work', type: 'user' }]) })
    if (path === 'messages') {
      const after = Number((url.searchParams.get('q') ?? '').match(/after:(\d+)/)?.[1] ?? 0) * 1000
      const labelIds = url.searchParams.getAll('labelIds')
      const hits = this.mails.filter((m) => m.date >= after && labelIds.every((l) => m.labelIds.includes(l)))
      return json(200, { messages: hits.map((m) => ({ id: m.id, threadId: `t-${m.id}` })), resultSizeEstimate: hits.length })
    }
    const one = path.match(/^messages\/([^/]+)$/)
    if (one) {
      const m = this.mails.find((x) => x.id === one[1])
      if (!m) return json(404, { error: { code: 404 } })
      const headers = [
        { name: 'Subject', value: m.subject },
        { name: 'From', value: m.from },
        { name: 'To', value: `Marcel <${ACCOUNT}>` },
        { name: 'Date', value: new Date(m.date).toUTCString() },
        { name: 'Content-Type', value: 'text/plain; charset="UTF-8"' },
      ]
      return json(200, { id: m.id, threadId: `t-${m.id}`, labelIds: m.labelIds, snippet: m.text.slice(0, 80), historyId: String(this.historyId), internalDate: String(m.date), sizeEstimate: 2048, payload: { mimeType: 'text/plain', filename: '', headers, body: { size: m.text.length, data: b64url(m.text) } } })
    }
    if (path === 'history') return json(200, { history: [], historyId: String(this.historyId) })
    return json(400, { error: { code: 400 } })
  }
}

/** Bodies for three posts of the seeded "Content calendar" (the feed shows them). */
const FEED_POSTS = [
  ['Why we left Notion (and saved €2,880)', doc(para('We moved 14 people, 1,900 pages and six databases in one afternoon. The import kept every relation; the only thing we rebuilt by hand was one formula.'), { type: 'bulletList', content: [li(para('Pages open in under 100 ms, offline too.')), li(para('Claude works with our own key — no seat add-on.')), li(para('Webhooks go straight to n8n.'))] }, para('What we miss: nothing so far. What surprised us: the keyboard.'))],
  ['5 n8n automations for your workspace', doc(para('Five recipes we run every day — each one a database webhook and a few n8n nodes.'), { type: 'orderedList', attrs: { start: 1 }, content: [li(para('New lead → owner by region')), li(para('Project done → invoice draft')), li(para('Form answer → Slack thread'))] })],
  ['Local-first explained in 90 seconds', doc(para('Your workspace lives on your device first. Sync is a copy, not the source — so the app opens instantly and keeps working on a train.'), para('The script for the video is ready; recording on Thursday.'))],
]

/* The local MCP bridge (public/mcp/one-mcp.mjs) as Claude Desktop runs it: a stdio JSON-RPC child process. */
const BRIDGE = fileURLToPath(new URL('../public/mcp/one-mcp.mjs', import.meta.url))
const BRIDGE_PORT = 47398

class Bridge {
  constructor(port) {
    if (!existsSync(BRIDGE)) throw new Error('public/mcp/one-mcp.mjs is missing (npm run build:mcp)')
    this.proc = spawn(process.execPath, [BRIDGE], { env: { PATH: process.env.PATH ?? '', ONE_MCP_PORT: String(port), ONE_MCP_WAIT_MS: '8000' }, stdio: ['pipe', 'pipe', 'pipe'] })
    this.seq = 0
    this.waiting = new Map()
    let buf = ''
    this.proc.stdout.on('data', (d) => {
      buf += d.toString()
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line) continue
        try {
          const msg = JSON.parse(line)
          const done = this.waiting.get(msg.id)
          if (done) {
            this.waiting.delete(msg.id)
            done(msg)
          }
        } catch {}
      }
    })
    this.proc.stderr.on('data', () => {})
  }
  call(method, params) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`bridge: no answer to ${method}`)), 60_000)
      this.waiting.set(id, (msg) => {
        clearTimeout(timer)
        if (msg.error) reject(new Error(`bridge: ${msg.error.message}`))
        else resolve(msg.result)
      })
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }
  notify(method, params = {}) {
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
  }
  text(result) {
    return (result?.content ?? []).map((c) => c.text ?? '').join('')
  }
  close() {
    this.proc.kill()
  }
}

/** A minimal, valid PDF with `pages` pages (the "Claude for files" picture: its page count shows in the panel). */
function shotPdf(pages) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${3 + i} 0 R`).join(' ')}] /Count ${pages} >>`]
  for (let i = 0; i < pages; i++) objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>')
  let out = '%PDF-1.4\n'
  const offsets = []
  objs.forEach((o, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(out)
}

/** The table in the "Claude for images" picture — and what Claude (mocked) reads out of it. */
const VOLUMES = { title: 'Volumes', header: ['Reagent', 'Volume (µl)', 'Wells'], rows: [['Buffer', '50', 'A1–A12'], ['Enzyme', '2,5', 'B1–B12'], ['Sample', '10', 'C1–C12'], ['Water', '37,5', 'D1–D12']] }

/** Draw the volume table as a PNG (runs in the page; returns base64): a printed sheet with hairlines. */
function drawVolumeTable(t) {
  const w = 960
  const h = 520
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  g.fillStyle = '#fbfaf6'
  g.fillRect(0, 0, w, h)
  g.fillStyle = '#1a1a18'
  g.font = '600 30px Georgia, serif'
  g.fillText('Protocol P1 — volumes per well', 48, 70)
  g.font = '18px Georgia, serif'
  g.fillStyle = '#5a5850'
  g.fillText('Run 14 · 96-well plate · prepared on ice', 48, 104)
  const x = [48, 360, 620, 912]
  const top = 140
  const rowH = 62
  g.strokeStyle = '#2a2a28'
  g.lineWidth = 2
  g.strokeRect(x[0], top, x[3] - x[0], rowH * (t.rows.length + 1))
  g.lineWidth = 1
  for (let i = 1; i <= t.rows.length; i++) {
    g.beginPath()
    g.moveTo(x[0], top + i * rowH)
    g.lineTo(x[3], top + i * rowH)
    g.stroke()
  }
  for (const xi of x.slice(1, 3)) {
    g.beginPath()
    g.moveTo(xi, top)
    g.lineTo(xi, top + rowH * (t.rows.length + 1))
    g.stroke()
  }
  ;[t.header, ...t.rows].forEach((row, i) => {
    g.font = i === 0 ? 'bold 22px Georgia, serif' : '22px Georgia, serif'
    g.fillStyle = '#1a1a18'
    row.forEach((cell, j) => g.fillText(cell, x[j] + 20, top + i * rowH + 40))
  })
  return c.toDataURL('image/png').split(',')[1]
}

/** The tool result Claude got back for a tool_use id. */
const toolResult = (body, id) => (body.messages ?? []).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((c) => c.type === 'tool_result' && c.tool_use_id === id)

const shots = {
  /** One memory: the memory database above, the AI terminal below with Claude's proposals after a task ("REMEMBER? · 2"). */
  async memory(browser) {
    const proposals = {
      memories: [
        { type: 'preference', text: 'CNSX reports are written in German, with numbers first.', topics: ['CNSX'], body: '' },
        { type: 'procedure', text: 'Weekly CNSX report: done, next steps, risks.', topics: ['CNSX'], body: '1. Pull the numbers from Projects\n2. Three sections: done, next steps, risks\n3. One line per item, owner in brackets' },
      ],
    }
    const turns = [() => sseTurn([{ type: 'text', text: 'Drafted the outline for the CNSX report: **Done**, **Next steps**, **Risks** — numbers first, as in last week’s report.' }])]
    const { ctx, page } = await freshPage(browser, { claude: { turns, json: (body) => (String(body.system ?? '').includes('remember') ? proposals : 'ok') } })
    // the memory, set up in Settings, with a few entries
    await page.evaluate(() => window.__one.ui.getState().openModal({ type: 'settings', tab: 'ai' }))
    await page.getByTestId('memory-settings').getByRole('button', { name: 'Set up memory' }).click()
    await page.keyboard.press('Escape')
    const memId = await page.evaluate(() => {
      const s = window.__one.workspace.getState()
      const db = Object.values(s.databases).find((d) => d.system === 'memory')
      const prop = (n) => db.properties.find((p) => p.name === n)
      const type = (n) => prop('Type').options.find((o) => o.name === n).id
      const topics = prop('Topics')
      s.updateProperty(db.id, topics.id, { options: [{ id: 'tp-atlas', name: 'Atlas', color: 'blue' }, { id: 'tp-launch', name: 'Launch', color: 'green' }] })
      const add = (title, t, tps) => s.createRow(db.id, { title, properties: { [prop('Type').id]: type(t), [prop('Active').id]: true, [topics.id]: tps, [prop('Source').id]: 'AI terminal · 2026-10-02' } })
      add('Atlas is the team knowledge base for decisions and specs.', 'Fact', ['tp-atlas'])
      add('Answers are short: bullets first, no preamble.', 'Preference', [])
      add('We launch on Tuesdays, never on Fridays.', 'Decision', ['tp-launch'])
      return db.id
    })
    await openPage(page, memId)
    await page.keyboard.press('Control+j')
    const term = page.getByRole('region', { name: 'AI terminal' })
    await term.waitFor()
    const prompt = term.getByRole('textbox', { name: 'Task for the agent' })
    await prompt.fill('Draft the weekly CNSX report outline')
    await prompt.press('Enter')
    await term.getByTestId('term-memory').getByRole('list').waitFor({ timeout: 30_000 })
    await prompt.focus()
    await page.keyboard.press('Alt+ArrowUp')
    await page.waitForTimeout(300)
    await prompt.press('Tab')
    await page.waitForTimeout(500)
    await page.mouse.move(W + 40, H + 40)
    await save(page, 'memory')
    await ctx.close()
  },

  /** ⌘J: a reference from the page, the task, the step log and a staged board with its rows. */
  async 'ai-terminal'(browser) {
    const ids = {}
    let dbId = ''
    const turns = [
      () =>
        sseTurn([
          { type: 'thinking', text: 'The action items are on the open page. A board grouped by status fits.' },
          {
            type: 'tool_use',
            id: 'toolu_db',
            name: 'create_database',
            input: { title: 'Open items', parent_id: ids.weekly, columns: [{ name: 'Status', type: 'select', options: ['Todo', 'Doing', 'Done'] }, { name: 'Owner', type: 'text' }, { name: 'Due', type: 'date' }], view: 'board', group_by: 'Status' },
          },
        ]),
      (body) => {
        dbId = /New database id: ([\w-]+)/.exec(String(toolResult(body, 'toolu_db')?.content ?? ''))?.[1] ?? ''
        return sseTurn([
          { type: 'tool_use', id: 'toolu_r1', name: 'create_row', input: { database_id: dbId, title: 'Final QA on staging', properties: { Status: 'Todo', Owner: 'Alex', Due: isoDay(3) } } },
          { type: 'tool_use', id: 'toolu_r2', name: 'create_row', input: { database_id: dbId, title: 'Connect webhook to n8n', properties: { Status: 'Doing', Owner: 'Sam', Due: isoDay(2) } } },
          { type: 'tool_use', id: 'toolu_r3', name: 'create_row', input: { database_id: dbId, title: 'Draft the newsletter', properties: { Status: 'Done', Owner: 'Mira' } } },
        ])
      },
      () => sseTurn([{ type: 'text', text: 'Staged a board **Open items** under this page, grouped by Status, with the three action items — Mira’s newsletter is already done.' }]),
    ]
    const { ctx, page } = await freshPage(browser, { claude: { turns } })
    ids.weekly = await openPage(page, 'Weekly sync — notes')
    await page.locator('#main .ProseMirror').first().click()
    await selectRange(page, 'final QA on staging', 'draft the newsletter')
    await page.keyboard.press('Control+Shift+j')
    const term = page.getByRole('region', { name: 'AI terminal' })
    await term.waitFor()
    const prompt = term.getByRole('textbox', { name: 'Task for the agent' })
    await prompt.fill('Make a board of the open items on this page')
    await prompt.press('Enter')
    await term.locator('.term-head__status').filter({ hasText: 'Done' }).waitFor({ timeout: 30_000 })
    await page.waitForTimeout(800)
    // a taller dock, its log from the task down; the page shows the action items above it
    await prompt.focus()
    await page.keyboard.press('Alt+ArrowUp')
    await page.keyboard.press('Alt+ArrowUp')
    await page.waitForTimeout(400)
    // the page's selection collapses (a click at the end of a line), the dock keeps its task
    await page.locator('#main .ProseMirror').first().evaluate((root) => {
      const ed = root.editor
      ed?.commands.setTextSelection(1)
      ed?.commands.blur()
    })
    await scrollToTop(page.locator('#main :is(h1, h2, h3)', { hasText: 'Decisions' }).first(), 24)
    const box = await term.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, -6000)
    await page.waitForTimeout(500)
    await rest(page)
    await save(page, 'ai-terminal')
    await ctx.close()
  },

  /** The AI menu with "atlas: …" typed: the chip names the server that answers first. */
  async 'mcp-codewords'(browser) {
    const { ctx, page } = await freshPage(browser)
    await page.evaluate((guide) => window.__one.workspace.getState().updateSettings({ mcpServers: [{ id: 'srvkb00001', name: 'atlas', url: 'https://kb.acme.studio/mcp', token: '', enabled: true, prompt: guide, promptSource: 'auto', tools: ['atlas_search', 'atlas_get', 'atlas_constraints'], checkedAt: Date.now() - 3 * 60_000, scope: 'own', codeword: 'atlas' }] }), ATLAS_GUIDE)
    const id = await createPage(page, 'Launch plan', doc(h(2, 'Relaunch'), para('Homepage and pricing ship first, the blog follows in a second step.'), para('Open: the final launch date and who signs off on the pricing copy.'), para('')), { icon: { type: 'asset', value: 'megaphone' } })
    await openPage(page, id)
    const ask = page.getByPlaceholder('Ask Claude to write anything…')
    for (let attempt = 0; attempt < 4 && !(await ask.count()); attempt++) {
      await page.locator('#main .ProseMirror p').last().click()
      await page.keyboard.press('End')
      await page.keyboard.press('Space')
      await page.waitForTimeout(600)
    }
    await ask.pressSequentially('atlas: when do we launch?', { delay: 8 })
    const panel = page.locator('.ai-panel').first()
    await panel.getByTestId('mcp-codeword-chip').waitFor()
    await page.waitForTimeout(400)
    await page.mouse.move(W + 40, H + 40)
    const box = union(await boxOf(panel), await boxOf(page.locator('#main :is(h1, h2, h3)', { hasText: 'Relaunch' }).first()))
    await save(page, 'mcp-codewords', frameAround(box, { width: W, height: H }, 16 / 10, 40))
    await ctx.close()
  },

  /** References like /r/24772 stay plain text; the "/" menu opens where "/" was just typed. */
  async 'slash-menu'(browser) {
    const { ctx, page } = await freshPage(browser)
    const content = doc(
      h(2, 'Open tickets'),
      { type: 'bulletList', content: [li(para('Checkout rounding differs from the invoice — /r/24772')), li(para('Viewers can open the export dialog — /r/24790')), li(para('Umlauts break the sample search — /r/24811'))] },
      para('Status and owners are in the knowledge base: /r/24772, /r/24790, /r/24811.'),
      para(''),
    )
    const id = await createPage(page, 'Release checklist', content, { icon: { type: 'asset', value: 'binder' } })
    await openPage(page, id)
    // the caret in the middle of a reference: no menu
    await page.locator('#main .ProseMirror li p').first().click()
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(300)
    // a "/" typed on the empty line: the menu (room below it: the list at the top of the view)
    await scrollToTop(page.locator('#main :is(h1, h2, h3)', { hasText: 'Open tickets' }).first(), 70)
    await page.locator('#main .ProseMirror > p').last().click()
    await page.keyboard.type('/')
    const menu = page.locator('.slash')
    await menu.waitFor()
    await page.waitForTimeout(400)
    await page.mouse.move(W + 40, H + 40)
    const box = union(await boxOf(menu), await boxOf(page.locator('#main :is(h1, h2, h3)', { hasText: 'Open tickets' }).first()))
    await save(page, 'slash-menu', frameAround(box, { width: W, height: H }, 16 / 10, 32))
    await ctx.close()
  },

  /** A nested list item hovered: its grip in the gutter column left of the page, off the marker; the footer under the page. */
  async 'grips-footer'(browser) {
    const VH = H
    const { ctx, page } = await freshPage(browser)
    const ul = (...items) => ({ type: 'bulletList', content: items })
    const id = await createPage(
      page,
      'Plate prep',
      doc(
        para('Steps for the dilution run. Each step is one line — drag a line by its grip to reorder.'),
        { type: 'orderedList', attrs: { start: 1 }, content: [
          li(para('Check the deck layout'), ul(li(para('Tips 200 µl in slot 1')), li(para('Reservoir in slot 3')))),
          li(para('Mount the 5-channel adapter'), ul(li(para('Mix ½ well volume, start at column 10')), li(para('Dispense with blowout')))),
          li(para('Unload the adapter')),
        ] },
        h(2, 'After the run'),
        para('Photograph the plate and attach the picture to the run log. Note any well that looks off — colour, volume or bubbles.'),
        para('Tips go back into the tip box from column 1; leave three columns free between used and unused tips.'),
      ),
      { icon: { type: 'asset', value: 'binder' } },
    )
    // a page that links here: "Linked from" in the footer
    await createPage(page, 'Lab week 41', doc(para('This week: '), { type: 'pageLink', attrs: { pageId: id } }))
    await openPage(page, id)
    const ed = page.locator('#main .ProseMirror').first()
    const item = ed.locator('li li p', { hasText: 'Mix ½ well volume' }).first()
    await item.waitFor()
    // the footer under the page: scrolled to the end, the list above it stays in view
    const foot = page.locator('#main .spec').first()
    await foot.waitFor()
    await page.mouse.move(W / 2, VH / 2)
    await page.mouse.wheel(0, 1200)
    await page.waitForTimeout(600)
    const ib = await item.boundingBox()
    await page.mouse.move(ib.x + 40, ib.y + ib.height / 2)
    await page.waitForTimeout(500)
    const box = union(await boxOf(ed.locator('li', { hasText: 'Mount the 5-channel adapter' }).first()), await boxOf(page.locator('#main .pv-links').first()), await boxOf(foot))
    const left = Math.round((await page.locator('.sb').first().boundingBox())?.width ?? 0) + 1
    const top = Math.max(6, Math.round(box.y - 24))
    await save(page, 'grips-footer', { x: left, y: top, width: W - left, height: Math.min(VH - top, Math.round(box.y + box.height + 24 - top)) })
    await ctx.close()
  },

  /** The AI terminal's review of edits (edit_page): a paragraph changed word by word, a removed block, a new list item; unchanged blocks folded. */
  async 'ai-edit'(browser) {
    const ids = {}
    const DAY = 'We met on Monday and agreed to ship version 2.4 at the end of the month, together with the new pricing page.'
    const LEGACY = 'Legacy note: the old CSV export stays until the migration is done.'
    // the ref read_page put before a text ("⟦b3⟧\nWe met …" or "- ⟦b7⟧ Fix …")
    const refOf = (read, snippet) => [...read.slice(0, read.indexOf(snippet)).matchAll(/⟦(b\d+)⟧/g)].at(-1)?.[1]
    const turns = [
      () =>
        sseTurn([
          { type: 'thinking', text: 'The notes still say Monday and 2.4. Read the page with refs, then change only those blocks.' },
          { type: 'tool_use', id: 'toolu_read', name: 'read_page', input: { id: ids.notes, refs: true } },
        ]),
      (body) => {
        const read = String(toolResult(body, 'toolu_read')?.content ?? '')
        return sseTurn([
          {
            type: 'tool_use',
            id: 'toolu_edit',
            name: 'edit_page',
            input: {
              id: ids.notes,
              edits: [
                { op: 'replace', from: refOf(read, DAY), markdown: 'We met on Tuesday and agreed to ship version 2.5 in the second week of November, together with the new pricing page.' },
                { op: 'delete', from: refOf(read, LEGACY) },
                { op: 'insert_after', ref: refOf(read, 'Fix the login bug'), markdown: '- Write the release notes (Mira)' },
              ],
            },
          },
        ])
      },
      () => sseTurn([{ type: 'text', text: 'Staged three edits: the new day and version, the legacy note removed, the release notes added to the next steps.' }]),
    ]
    const { ctx, page } = await freshPage(browser, { claude: { turns } })
    ids.notes = await createPage(
      page,
      'Release sync',
      doc(
        para('Attendees: Mara, Sam, Alex, Mira.'),
        para(DAY),
        para(LEGACY),
        para('Budget stays at 40k; design review on Thursday.'),
        h(2, 'Next steps'),
        { type: 'bulletList', content: [li(para('Final QA on staging')), li(para('Fix the login bug')), li(para('Draft the newsletter'))] },
        para('Notes taken by Sam.'),
      ),
      { icon: { type: 'asset', value: 'binder' } },
    )
    await openPage(page, ids.notes)
    await page.keyboard.press('Control+j')
    const term = page.getByRole('region', { name: 'AI terminal' })
    await term.waitFor()
    const prompt = term.getByRole('textbox', { name: 'Task for the agent' })
    await prompt.fill('The release moved: Tuesday, 2.5, second week of November. Fix the notes, drop the legacy note, add the release notes to the next steps.')
    await prompt.press('Enter')
    await term.locator('.term-change[data-kind="edit"]').nth(2).waitFor({ timeout: 30_000 })
    await term.locator('.term-head__status').filter({ hasText: 'Done' }).waitFor({ timeout: 30_000 })
    // a taller dock: the first edit in full and the removed block of the second, the page's title above
    await prompt.focus()
    for (let i = 0; i < 3; i++) await page.keyboard.press('Alt+ArrowUp')
    await page.waitForTimeout(400)
    await term.locator('.term-change[data-kind="edit"]').first().evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await page.waitForTimeout(300)
    await rest(page)
    await save(page, 'ai-edit')
    await ctx.close()
  },

  /** The ⌘ key of the Mails database in the sidebar: its command menu, "Sync now" with the last sync's time. */
  async 'db-commands'(browser) {
    const box = new Mailbox(MAILS(Date.now()))
    const setup = async (ctx) => {
      await ctx.route('https://accounts.google.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: GIS_JS }))
      await ctx.route('https://gmail.googleapis.com/**', (route) => box.handle(route))
    }
    const { ctx, page } = await freshPage(browser, { setup })
    await page.evaluate((from) => window.__one.workspace.getState().updateSettings({ mail: { clientId: '123456789012-shotsclientid0001.apps.googleusercontent.com', from } }), isoDay(-10))
    // a first sync (a token without Google's window: the mail test hook) creates the Mails database
    await page.evaluate((account) => window.__oneMail.setToken('ya29.shots-token-db', account), ACCOUNT)
    await page.evaluate(() => window.__oneMail.sync())
    await page.waitForFunction(() => window.__oneMail?.state().phase === 'idle' && !!window.__one.workspace.getState().settings.mail?.databaseId, null, { timeout: 30_000 })
    await page.locator('.toast button[aria-label]').last().click().catch(() => {})
    const dbId = await page.evaluate(() => window.__one.workspace.getState().settings.mail.databaseId)
    await openPage(page, dbId)
    const row = page.locator('.sb section[aria-label="Pages"] .sb-row').filter({ has: page.locator(`a[href="#/p/${dbId}"]`) })
    await row.hover()
    await page.waitForTimeout(200)
    await row.getByTestId('tree-commands').click()
    const menu = page.locator('.popover.cmd-menu')
    await menu.getByRole('menuitem', { name: 'Sync now' }).hover()
    await page.waitForTimeout(400)
    // the sidebar from the left edge, the menu and a part of the Mails table: 16 : 10
    const area = union(await boxOf(row, 8), await boxOf(menu, 16))
    const width = 1040
    const height = Math.round(width / 1.6)
    const y = Math.min(Math.max(0, Math.round(area.y + area.height / 2 - height / 2)), H - height)
    await save(page, 'db-commands', { x: 0, y, width, height })
    await ctx.close()
  },

  /** Settings → Mail with One's own Google access: "Ready · One access", Google's warning in one line, Connect Gmail; the own client folded away. */
  async 'gmail-one-click'(browser) {
    const { ctx, page } = await freshPage(browser)
    // One's built-in Google client at this origin through the mail test hook (?e2e only) — nothing is sent to Google
    await page.evaluate(() => window.__oneMail.builtin('123456789012-shotsoneaccess01.apps.googleusercontent.com'))
    await page.evaluate(() => window.__one.ui.getState().openModal({ type: 'settings', tab: 'mail' }))
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByTestId('mail-one-access').waitFor()
    await page.waitForTimeout(400)
    await rest(page)
    await save(page, 'gmail-one-click', await boxOf(dialog))
    await ctx.close()
  },

  /** A list of steps selected → Ask AI → Transform into… → Diagram: the drawn flowchart in the preview, the strip of forms above it. */
  async transform(browser) {
    // a client onboarding checklist (fictional); Claude's answer is canned like in tests/e2e/ai-transform.spec.ts
    const intro = 'How we onboard a new client:'
    const note = 'Usually done within two weeks.'
    const steps = ['Sign the contract', 'Send the welcome pack', 'Kick-off call within five days', 'Is the data export ready? If not, chase their IT team', 'Import the data', 'Go live and hand over to support']
    const flow = [
      'flowchart TD',
      '  s1["Sign the contract"] --> s2["Send welcome pack"]',
      '  s2 --> s3["Kick-off call"]',
      '  s3 --> s4{"Data export ready?"}',
      '  s4 -->|no| s5["Chase their IT team"]',
      '  s5 --> s4',
      '  s4 -->|yes| s6["Import the data"]',
      '  s6 --> s7["Go live, hand over"]',
    ].join('\n')
    const answer = (body) => {
      const system = typeof body.system === 'string' ? body.system : JSON.stringify(body.system ?? '')
      return system.includes('Mermaid diagram') ? { diagram: 'flowchart', code: flow, keep: [1], left: [note] } : {}
    }
    const { ctx, page } = await freshPage(browser, { claude: { json: answer } })
    const id = await createPage(page, 'Client onboarding', doc(para(intro), { type: 'orderedList', attrs: { start: 1 }, content: steps.map((x) => li(para(x))) }, para(note), para('')), { icon: { type: 'asset', value: 'binder' } })
    await openPage(page, id)
    await page.locator('#main .ProseMirror p', { hasText: intro }).first().click()
    await selectRange(page, intro, note)
    await page.locator('[aria-label="Formatting"]').first().getByRole('button', { name: /^Ask AI$/ }).click()
    const ai = page.locator('.ai-panel').first()
    await ai.waitFor()
    await ai.getByRole('option', { name: /^Transform into…/ }).click()
    await ai.getByRole('option', { name: /^Diagram/ }).click()
    const plate = page.getByTestId('transform-plate')
    await plate.locator('svg').first().waitFor({ timeout: 20_000 })
    await page.waitForTimeout(900)
    // drawn left to right (a local option: no new request)
    await page.getByTestId('transform-direction').getByRole('button', { name: 'Left to right' }).click()
    await page.waitForTimeout(1200)
    // the preview scrolled to the drawing; the strip of forms stays on top (sticky)
    const strip = (await page.getByTestId('transform-forms').boundingBox())?.height ?? 80
    await scrollToTop(plate, Math.round(strip) + 8)
    await page.mouse.move(W + 40, H + 40)
    // the page column only (no cut-off sidebar): from the selected list down to the panel's foot
    const box = union(await boxOf(ai), await boxOf(page.locator('#main .ProseMirror p', { hasText: intro }).first()))
    const left = Math.round((await page.locator('.sb').first().boundingBox())?.width ?? 0) + 1
    const top = Math.max(0, Math.round(box.y - 20))
    await save(page, 'transform', { x: left, y: top, width: W - left, height: Math.min(H - 30 - top, Math.round(box.y + box.height + 12 - top)) })
    await ctx.close()
  },

  /** One Script: a query in the editor (a chip for the database), the query builder and the live result table. */
  async 'one-script'(browser) {
    const { ctx, page } = await freshPage(browser)
    const id = await page.evaluate(() => {
      const s = window.__one.workspace.getState()
      const db = Object.values(s.pages).find((p) => p.kind === 'database' && p.title === 'Projects')
      const id = 'scshot1'
      const now = Date.now()
      const code = `# Open projects with high priority, soonest first\ndb(@[Projects](p:${db.id}))\n  .where(Status != "Done", Priority = "High")\n  .sort(Timeline)\n  .limit(5)\n`
      s.upsertScript({ id, name: 'Urgent projects', code, kind: 'query', createdAt: now, updatedAt: now })
      return id
    })
    await page.evaluate((id) => (window.location.hash = `#/scripts/${id}`), id)
    await page.locator('.sc-code__input').waitFor()
    await page.getByTestId('sc-live-count').waitFor()
    await page.locator('.sc-live tbody tr').first().waitFor()
    await page.waitForTimeout(600)
    await rest(page)
    const left = Math.round((await page.locator('.sb').first().boundingBox())?.width ?? 0) + 1
    const live = await boxOf(page.locator('.sc-live'))
    const head = await boxOf(page.locator('.sc-head'))
    const top = Math.max(0, Math.round(head.y - 12))
    await save(page, 'one-script', { x: left, y: top, width: W - left, height: Math.min(H - 30 - top, Math.round(live.y + live.height + 16 - top)) })
    await ctx.close()
  },

  /** Claude for files: a mail's PDF attachment → the AI key → Summarise: what was sent, the summary, its keys. */
  async 'file-ai'(browser) {
    // a fictional invoice; Claude's summary is canned like in tests/e2e/file-ai.spec.ts
    const summary = [
      'An **invoice** from Acme Studio GmbH to Northwind, dated 30 September 2025, for the website relaunch (September).',
      '',
      '- Design and prototyping: 18 h · **1,710.00 €**',
      '- Hosting, October–December: **300.50 €**',
      '- Total incl. 19 % VAT: **2,392.49 €**',
      '- Payment within 14 days — due **14 October 2025**',
      '',
      '**To do:** pay by 14 October; reference *2025-117*.',
    ].join('\n')
    const answer = (body) => (/Summarise the file/.test(JSON.stringify(body.messages ?? '')) ? summary : 'Done.')
    const { ctx, page } = await freshPage(browser, { claude: { text: answer }, viewport: { width: W, height: 1200 } })
    const id = await page.evaluate(async (pdf) => {
      const one = window.__one
      const save = async (data, type, name) => one.files.saveFile(new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], { type }), name)
      const invoice = await save(pdf, 'application/pdf', 'invoice-2025-117.pdf')
      const report = await save(btoa('PK'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Relaunch report.docx')
      const s = one.workspace.getState()
      const id = s.createPage({ title: 'Invoice 2025-117 · Acme Studio', parentId: null, icon: { type: 'asset', value: 'notepad' } })
      const p = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
      s.setContent(
        id,
        {
          type: 'doc',
          content: [
            p('From billing@acme.example — “The relaunch report, and your invoice for September. Thanks again!”'),
            { type: 'fileBlock', attrs: { src: report, name: 'Relaunch report.docx', size: 23_904, display: null } },
            { type: 'fileBlock', attrs: { src: invoice, name: 'invoice-2025-117.pdf', size: atob(pdf).length, display: 'file' } },
            { type: 'paragraph' },
          ],
        },
        'mail',
      )
      return id
    }, Buffer.from(shotPdf(2)).toString('base64'))
    await openPage(page, id)
    const ed = page.locator('#main .ProseMirror').first()
    const card = ed.locator('.file-view', { hasText: 'invoice-2025-117.pdf' }).first()
    await card.hover()
    await card.getByTestId('file-ai-key').click()
    await page.getByRole('menuitem', { name: /^Summarise/ }).click()
    const ai = page.getByRole('dialog', { name: 'Ask Claude' })
    await ai.getByTestId('ai-file-meta').waitFor()
    await ai.getByText('To do:').waitFor({ timeout: 20_000 })
    await page.waitForTimeout(700)
    await page.mouse.move(W + 40, H + 40)
    // the page column only (no cut-off sidebar): from the mail's line to the panel's foot
    const box = union(await boxOf(ed.locator('p').first()), await boxOf(ai))
    const left = Math.round((await page.locator('.sb').first().boundingBox())?.width ?? 0) + 1
    const top = Math.max(0, Math.round(box.y - 28))
    await save(page, 'file-ai', { x: left, y: top, width: W - left, height: Math.min(1200 - 30 - top, Math.round(box.y + box.height + 24 - top)) })
    await ctx.close()
  },

  /** One Script everywhere: "Ask Claude" next to a query — the request, Claude's checked draft with its row count. */
  async 'one-script-everywhere'(browser) {
    let dbId = ''
    const draft = () => `Here is the query:\n\n\`\`\`one\n# Open, high priority — soonest first\ndb(@[Projects](p:${dbId}))\n  .where(Status != "Done", Priority = "High")\n  .sort(Timeline)\n\`\`\``
    const { ctx, page } = await freshPage(browser, { claude: { text: () => draft() } })
    const id = await page.evaluate(() => {
      const s = window.__one.workspace.getState()
      const db = Object.values(s.pages).find((p) => p.kind === 'database' && p.title === 'Projects')
      const id = 'scshot2'
      const now = Date.now()
      s.upsertScript({ id, name: 'Projects to chase', code: `# Every project\ndb(@[Projects](p:${db.id}))\n`, kind: 'query', createdAt: now, updatedAt: now })
      return { id, db: db.id }
    })
    dbId = id.db
    await page.evaluate((id) => (window.location.hash = `#/scripts/${id}`), id.id)
    await page.locator('.sc-code__input').waitFor()
    await page.getByTestId('sc-live-count').waitFor()
    const ask = page.getByTestId('sc-ask')
    await ask.getByRole('textbox').fill('only the open ones with high priority, soonest first')
    await ask.getByTestId('sc-ask-go').click()
    await ask.getByTestId('sc-ask-draft').waitFor({ timeout: 20_000 })
    await page.waitForTimeout(500)
    await rest(page)
    const left = Math.round((await page.locator('.sb').first().boundingBox())?.width ?? 0) + 1
    const head = await boxOf(page.locator('.sc-head'))
    const side = await boxOf(page.locator('.sc-bench__side'))
    const live = await boxOf(page.locator('.sc-live'))
    const top = Math.max(0, Math.round(head.y - 12))
    const bottom = Math.max(live.y + live.height, side.y + Math.min(side.height, 520))
    await save(page, 'one-script-everywhere', { x: left, y: top, width: W - left, height: Math.min(H - 30 - top, Math.round(bottom + 16 - top)) })
    await ctx.close()
  },

  /**
   * Quick capture at phone width, three screens side by side: a page with the capture key, the sheet with a
   * note, a photo and its target, the saved Clippings page. Composed on paper at 1440 × 900.
   */
  async 'quick-capture'(browser) {
    const PHONE = { width: 390, height: 844 }
    const { ctx, page } = await freshPage(browser, { viewport: PHONE })
    const shots = []
    const snap = async () => shots.push((await page.screenshot()).toString('base64'))
    await openPage(page, 'Team wiki')
    await rest(page)
    await page.getByTestId('capture-fab').waitFor()
    await snap()
    await page.getByTestId('capture-fab').click()
    const sheet = page.getByRole('dialog', { name: 'Quick capture' })
    await sheet.waitFor()
    await sheet.getByRole('textbox').fill('Call the venue about Friday\n- ask for the projector\n- confirm **40** seats')
    await sheet.getByTestId('capture-photo').setInputFiles({ name: 'venue.webp', mimeType: 'image/webp', buffer: readFileSync('public/assets/covers/concrete.webp') })
    await sheet.locator('.qcap__thumb').waitFor()
    await page.waitForTimeout(500)
    await snap()
    await sheet.getByRole('button', { name: /^Save/ }).click()
    await page.locator('.toast', { hasText: 'Saved to Clippings' }).getByRole('button', { name: 'Open' }).click()
    await page.locator('#main .pv-title').waitFor()
    await page.locator('#main .ProseMirror img').first().waitFor()
    await page.waitForTimeout(900)
    await rest(page)
    await snap()
    await ctx.close()

    const board = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE, colorScheme: 'light' })
    const out = await board.newPage()
    const labels = ['01 · The key', '02 · Quick capture · Mod+Shift+K', '03 · Saved to Clippings']
    await out.setContent(`<!doctype html><html><body style="margin:0;width:${W}px;height:${H}px;background:#f2f0ea;display:flex;align-items:center;justify-content:center;gap:56px;font:500 10.5px/1 ui-monospace,'DejaVu Sans Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:#55524b">${shots
      .map((b64, i) => `<figure style="margin:0;display:flex;flex-direction:column;gap:12px"><figcaption>${labels[i]}</figcaption><img src="data:image/png;base64,${b64}" style="display:block;width:${Math.round((780 * PHONE.width) / PHONE.height)}px;height:780px;border-radius:8px;box-shadow:0 0 0 1px rgba(18,18,16,.2),0 24px 48px -24px rgba(18,18,16,.35)"></figure>`)
      .join('')}</body></html>`)
    await out.waitForFunction(() => [...document.images].every((i) => i.complete))
    await save(out, 'quick-capture')
    await board.close()
  },

  /** Several blocks selected (text, image, table): the wash on each, the pinned grip, the count chip. */
  async 'block-select'(browser) {
    const { ctx, page } = await freshPage(browser)
    const cell = (tag, t) => ({ type: tag, content: [para(t)] })
    const table = { type: 'table', content: [['Slot', 'Labware', 'Volume'], ['1', 'Tips 200 µl', '—'], ['2', '96-well plate', '50 µl'], ['3', 'Reservoir', '12 ml']].map((r, i) => ({ type: 'tableRow', content: r.map((t) => cell(i === 0 ? 'tableHeader' : 'tableCell', t)) })) }
    const id = await createPage(
      page,
      'Run sheet',
      doc(para('Before the run: check the deck against this sheet.'), para('The deck as it was set up on Monday — slots 1 to 3:'), { type: 'image', attrs: { src: 'assets/covers/aluminum.webp', alt: 'The deck', width: 520 } }, table, para('After the run, photograph the plate.')),
      { icon: { type: 'asset', value: 'binder' } },
    )
    await openPage(page, id)
    const ed = page.locator('#main .ProseMirror').first()
    await ed.locator('img').first().waitFor()
    await page.waitForTimeout(500)
    // Esc on the line selects its block; Shift+↓ twice grows the range over the image and the table
    await ed.locator('p', { hasText: 'The deck as it was set up' }).click()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowDown')
    await page.getByTestId('selection-count').filter({ hasText: '3 blocks' }).waitFor()
    await scrollToTop(ed.locator('p', { hasText: 'Before the run' }).first(), 40)
    await page.mouse.move(W - 5, H - 20)
    await page.waitForTimeout(300)
    // the selection as it stays: wash, pinned grip and the count chip (the menu, once open, takes their place)
    const chip = await boxOf(page.getByTestId('selection-count'))
    const box = union(chip, await boxOf(ed.locator('p', { hasText: 'Before the run' }).first()), await boxOf(ed.locator('p', { hasText: 'After the run' }).first()))
    const left = Math.round((await page.locator('.sb').first().boundingBox())?.width ?? 0) + 1
    const top = Math.max(0, Math.round(box.y - 28))
    await save(page, 'block-select', { x: left, y: top, width: W - left, height: Math.round(box.y + box.height + 28 - top) })
    await ctx.close()
  },

  /** Three blocks turned into a page: one link in their place, the new sub-page in the sidebar, the toast. */
  async 'split-to-page'(browser) {
    const { ctx, page } = await freshPage(browser)
    const id = await createPage(
      page,
      'Project notes',
      doc(
        para('Weekly notes for the relaunch. The plan has grown, so it gets its own page.'),
        h(2, 'Launch plan'),
        para('Homepage and pricing ship first, the blog follows in a second step.'),
        { type: 'bulletList', content: [li(para('QA on staging until Thursday')), li(para('Pricing copy signed off by legal')), li(para('Webhook to n8n switched to production'))] },
        h(2, 'Open questions'),
        para('Who signs off on the pricing page experiment?'),
      ),
      { icon: { type: 'asset', value: 'notepad' } },
    )
    await openPage(page, id)
    const ed = page.locator('#main .ProseMirror').first()
    // Esc on the heading, Shift+↓ twice: heading, paragraph, list
    await ed.locator('h2, h3', { hasText: 'Launch plan' }).click()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowDown')
    await page.getByTestId('selection-count').filter({ hasText: '3 blocks' }).waitFor()
    await page.keyboard.press('Control+Alt+9')
    await page.locator('.toast', { hasText: /Moved to a new page/ }).waitFor({ timeout: 10_000 })
    // the sidebar shows the new sub-page under its parent
    const row = page.locator('.sb section[aria-label="Pages"] .sb-row', { has: page.locator('.sb-row__title', { hasText: /^Project notes$/ }) }).first()
    const toggle = row.locator('.sb-row__toggle')
    if ((await toggle.getAttribute('aria-label')) === 'Expand') await toggle.click()
    await page.waitForTimeout(500)
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
    await page.mouse.move(W + 40, H + 40)
    await page.waitForTimeout(400)
    await save(page, 'split-to-page')
    await ctx.close()
  },

  /** Claude for images: an image of a volume table → the AI key → Image → table: the rows, ready to insert. */
  async 'image-ai'(browser) {
    const tableAnswer = (body) => {
      const content = body.messages?.[0]?.content
      const text = Array.isArray(content) ? content.map((b) => (b.type === 'text' ? b.text : '')).join('\n') : String(content ?? '')
      if (/Find every table/.test(text)) return JSON.stringify({ tables: [VOLUMES] })
      return 'Done.'
    }
    const { ctx, page } = await freshPage(browser, { claude: { text: tableAnswer, json: tableAnswer }, viewport: { width: W, height: 1300 } })
    const id = await createPage(page, 'Protocol P1', doc(para('Deck layout and volumes for run P1, photographed from the lab binder.'), { type: 'image', attrs: { src: null, width: 560 } }, para('')), { icon: { type: 'asset', value: 'notepad' } })
    await openPage(page, id)
    const png = await page.evaluate(drawVolumeTable, VOLUMES)
    const chooser = page.waitForEvent('filechooser')
    const ed = page.locator('#main .ProseMirror').first()
    await ed.locator('.media-empty').getByRole('button', { name: /Upload/ }).click()
    await (await chooser).setFiles({ name: 'protocol-p1.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
    const fig = ed.locator('.image-view').first()
    await fig.locator('img').waitFor()
    await page.waitForTimeout(600)
    await scrollToTop(fig, 90)
    await fig.hover()
    await fig.getByTestId('image-ai-key').click()
    await page.getByRole('menuitem', { name: /Image → table/ }).click()
    const ai = page.getByRole('dialog', { name: 'Ask Claude' })
    await ai.getByTestId('ai-image-tables').waitFor({ timeout: 20_000 })
    await page.waitForTimeout(700)
    await page.mouse.move(W + 40, H + 40)
    // the page column only (no cut-off sidebar): from the picture's top to the panel's foot
    const box = union(await boxOf(fig), await boxOf(ai))
    const left = Math.round((await page.locator('.sb').first().boundingBox())?.width ?? 0) + 1
    const top = Math.max(0, Math.round(box.y - 6))
    await save(page, 'image-ai', { x: left, y: top, width: W - left, height: Math.round(box.y + box.height + 28 - top) })
    await ctx.close()
  },

  /** What Claude reads: the AI menu's reads line → "Mark blocks…" → boxes in the gutter, the bar counts. */
  async 'claude-reads'(browser) {
    const { ctx, page } = await freshPage(browser)
    const id = await createPage(page, 'Q4 planning', planDoc(), { icon: { type: 'asset', value: 'calendar' } })
    await openPage(page, id)
    await openAIPanel(page)
    const ai = page.locator('.ai-panel').first()
    await ai.locator('.ai-cmd__input').fill('Draft a status update for the team')
    await page.getByTestId('ai-reads').click()
    await ai.getByRole('option', { name: /Mark blocks/ }).click()
    const layer = page.getByTestId('ctx-layer')
    await layer.waitFor()
    await page.keyboard.press('n')
    const rows = layer.getByRole('option')
    for (const i of [0, 1, 2, 4]) await rows.nth(i).click()
    // the keyboard ring on the next block, as with j / k
    await page.keyboard.press('j')
    await page.waitForTimeout(400)
    await page.mouse.move(W + 40, H + 40)
    const bar = page.getByTestId('ctx-bar')
    const box = union(await boxOf(page.locator('#main .pv-title').first()), await boxOf(layer), await boxOf(bar))
    await save(page, 'claude-reads', frameAround(box, { width: W, height: H }, 16 / 10, 28))
    await ctx.close()
  },

  /** Redo with instructions: three passages marked, instructions given, the review — one passage at a time. */
  async redo(browser) {
    const { ctx, page } = await freshPage(browser, { claude: { json: redoAnswer } })
    const id = await createPage(page, 'Q4 planning', planDoc(), { icon: { type: 'asset', value: 'calendar' } })
    await openPage(page, id)
    // a selection → Ask AI → Redo with instructions…: its block comes marked; two more by click
    await page.locator('#main .ProseMirror p', { hasText: 'Goal:' }).first().click()
    await selectRange(page, 'ship the relaunch')
    await page.locator('[aria-label="Formatting"]').first().getByRole('button', { name: /^Ask AI$/ }).click()
    const ai = page.locator('.ai-panel').first()
    await ai.getByRole('option', { name: /Redo with instructions/ }).click()
    const layer = page.getByTestId('ctx-layer')
    await layer.waitFor()
    const rows = layer.getByRole('option')
    await rows.nth(2).click()
    await rows.nth(4).click()
    await page.keyboard.press('Enter')
    const card = page.getByTestId('redo-setup')
    await card.waitFor()
    await page.keyboard.type('Shorter, informal, explain the jargon.')
    await card.getByRole('button', { name: /Save as preset/ }).click()
    await page.waitForTimeout(200)
    await card.getByRole('textbox', { name: 'Instructions' }).press('Control+Enter')
    const review = page.getByTestId('redo-review')
    await review.waitFor({ timeout: 20_000 })
    await page.waitForTimeout(700)
    await page.mouse.move(W + 40, H + 40)
    await save(page, 'redo', frameAround(union(await boxOf(page.locator('.ai-panel').first()), await boxOf(page.locator('#main .pv-title').first())), { width: W, height: H }, 16 / 10, 28))
    await ctx.close()
  },

  /** #/agents/<id>: a weekly agent, run once — its report and two proposals waiting for review. */
  async 'custom-agents'(browser) {
    const ids = {}
    const turns = [
      () => sseTurn([{ type: 'thinking', text: 'Checking Projects for overdue and stuck rows.' }, { type: 'tool_use', id: 'toolu_q', name: 'query_database', input: { database_id: ids.projects } }]),
      () =>
        sseTurn([
          { type: 'tool_use', id: 'toolu_u1', name: 'update_row', input: { id: ids.video, properties: { Priority: 'Medium' } } },
          { type: 'tool_use', id: 'toolu_u2', name: 'update_row', input: { id: ids.pricing, properties: { Priority: 'Low' } } },
        ]),
      () =>
        sseTurn([
          {
            type: 'text',
            text: '**Week check:** 8 projects, 2 in progress, 2 in review. *Customer onboarding video* starts in 9 days and is still in the backlog — proposed **Medium** priority. *Pricing page experiment* waits for the relaunch — proposed **Low**. Overdue: none.',
          },
        ]),
    ]
    const { ctx, page } = await freshPage(browser, { claude: { turns } })
    ids.projects = await pageIdByTitle(page, 'Projects')
    ids.video = await pageIdByTitle(page, 'Customer onboarding video')
    ids.pricing = await pageIdByTitle(page, 'Pricing page experiment')
    await page.evaluate((projects) => {
      const now = Date.now()
      window.__one.workspace.getState().upsertAgent({
        id: 'ag-weekly',
        name: 'Weekly project check',
        icon: { type: 'asset', value: 'kanban' },
        instructions: 'Every Monday, go through Projects: flag rows that are overdue or stuck, propose a new priority or status where it helps, and write a short report with the budget.',
        trigger: { type: 'schedule', every: 'week', at: '08:00', weekday: 1, tz: 'Europe/Berlin' },
        scope: { everything: false, pages: [], databases: [projects] },
        write: 'stage',
        output: null,
        mcpServers: [],
        runner: 'browser',
        model: null,
        effort: null,
        maxRunUsd: 0.5,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
    }, ids.projects)
    await page.evaluate(() => (window.location.hash = '#/agents/ag-weekly'))
    await page.locator('.agx-dhead').waitFor()
    await page.getByRole('button', { name: 'Run now' }).click()
    const run = page.locator('.agx-run').first()
    try {
      await page.waitForFunction(() => document.querySelector('.agx-run')?.getAttribute('data-status') === 'staged', null, { timeout: 30_000 })
    } catch (e) {
      await page.screenshot({ path: `${TMP}/custom-agents-debug.png` })
      console.log('  run status:', await run.getAttribute('data-status').catch(() => 'none'))
      throw e
    }
    await page.waitForTimeout(800)
    await rest(page)
    await save(page, 'custom-agents')
    await ctx.close()
  },

  /** Gmail → the "Mails" database, organised by Claude (category, priority, needs reply, summary). */
  async gmail(browser) {
    const box = new Mailbox(MAILS(Date.now()))
    const organise = (body) => {
      const prompt = String(body.messages?.[0]?.content ?? '')
      const ids = [...prompt.matchAll(/<mail id="([^"]+)">/g)].map((m) => m[1])
      return { mails: ids.map((id) => ({ id, ...(SORTED[id] ?? { category: 'Notification', priority: 'low', needsReply: false, summary: '' }) })) }
    }
    const setup = async (ctx) => {
      await ctx.route('https://accounts.google.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: GIS_JS }))
      await ctx.route('https://gmail.googleapis.com/**', (route) => box.handle(route))
    }
    const { ctx, page } = await freshPage(browser, { claude: { json: organise }, setup })
    const from = isoDay(-10)
    await page.evaluate((from) => window.__one.workspace.getState().updateSettings({ mail: { clientId: '123456789012-shotsclientid0001.apps.googleusercontent.com', from } }), from)
    await page.evaluate(() => window.__one.ui.getState().openModal({ type: 'settings' }))
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('tab', { name: /Mail$/ }).click()
    await dialog.getByRole('button', { name: 'Connect Gmail' }).click()
    await dialog.getByTestId('mail-account').waitFor()
    await dialog.getByRole('switch', { name: 'Organise new mails with Claude' }).click()
    await dialog.getByRole('button', { name: 'Sync now' }).click()
    await page.waitForFunction(() => window.__oneMail?.state().phase === 'idle' && Object.values(window.__one.workspace.getState().pages).some((p) => p.title === 'Contract renewal — please sign by Friday'), null, { timeout: 30_000 })
    await page.waitForTimeout(500)
    await page.keyboard.press('Escape')
    const dbId = await page.evaluate(() => window.__one.workspace.getState().settings.mail.databaseId)
    // the Inbox table shows what Claude filled in (Properties → shown columns, as a person would set them)
    await page.evaluate((dbId) => {
      const s = window.__one.workspace.getState()
      const db = s.databases[dbId]
      const id = (name) => db.properties.find((p) => p.name === name)?.id
      const view = db.views.find((v) => v.type === 'table')
      s.updateView(dbId, view.id, { visibleProperties: ['Category', 'Priority', 'Needs reply', 'Summary'].map(id).filter(Boolean) })
    }, dbId)
    await openPage(page, dbId)
    const db = page.locator('#main section.db').first()
    await scrollToTop(db, 12)
    await page.locator('.toast button[aria-label]').last().click().catch(() => {})
    await rest(page)
    await save(page, 'gmail')
    await ctx.close()
  },

  /** A database open in the sidebar (its entries), its feed view: posts with their content. */
  async 'feed-blocks'(browser) {
    const { ctx, page } = await freshPage(browser)
    const dbId = await page.evaluate((posts) => {
      const s = window.__one.workspace.getState()
      const pages = Object.values(s.pages).filter((p) => !p.trashed)
      const cal = pages.find((p) => p.title === 'Content calendar' && p.kind === 'database')
      const db = s.databases[cal.id]
      const date = db.properties.find((p) => p.type === 'date')
      const channel = db.properties.find((p) => p.name === 'Channel')
      for (const [title, content] of posts) {
        const row = pages.find((p) => p.title === title && p.databaseId === cal.id)
        if (row) s.setContent(row.id, content, 'seed')
      }
      const viewId = s.addView(cal.id, { type: 'feed', name: 'Feed', feed: { dateProperty: date.id, order: 'oldest', content: true }, visibleProperties: [channel.id, db.properties.find((p) => p.name === 'Status').id] })
      // the feed first: the view the database opens on
      const views = window.__one.workspace.getState().databases[cal.id].views
      s.updateDatabase(cal.id, { views: [views.find((v) => v.id === viewId), ...views.filter((v) => v.id !== viewId)] })
      return cal.id
    }, FEED_POSTS)
    await openPage(page, dbId)
    const row = page.locator('.sb section[aria-label="Pages"] .sb-row', { has: page.locator('.sb-row__title', { hasText: /^Content calendar$/ }) }).first()
    const toggle = row.locator('.sb-row__toggle')
    if ((await toggle.getAttribute('aria-label')) === 'Expand') await toggle.click()
    await page.waitForTimeout(600)
    await scrollToTop(page.locator('#main section.db').first(), 12)
    await rest(page)
    await save(page, 'feed-blocks')
    await ctx.close()
  },

  /** Claude Desktop (the repository's own MCP bridge, driven over stdio) asks to trash "Projects" with its rows. */
  async 'mcp-tidy-up'(browser) {
    const bridge = new Bridge(BRIDGE_PORT)
    try {
      await bridge.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-ai', version: '1.0.0' } })
      bridge.notify('notifications/initialized')
      const { ctx, page } = await freshPage(browser)
      const projects = await pageIdByTitle(page, 'Projects')
      await openPage(page, projects)
      await page.evaluate(() => window.__one.ui.getState().openModal({ type: 'settings' }))
      await page.getByRole('tab', { name: /Agents · MCP/ }).click()
      const port = page.getByLabel('Port', { exact: true })
      await port.fill(String(BRIDGE_PORT))
      await port.press('Enter')
      await page.getByRole('switch', { name: 'Allow AI agents on this computer' }).click()
      await page.getByTestId('mcp-state').filter({ hasText: 'Connected' }).waitFor({ timeout: 20_000 })
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'detached' })
      // the workspace this tab offers, then the change that waits for approval
      let workspace = null
      for (let i = 0; i < 20 && !workspace; i++) {
        const listed = JSON.parse(bridge.text(await bridge.call('tools/call', { name: 'one_list_workspaces', arguments: {} })) || '{}')
        workspace = listed.workspaces?.[0]?.id ?? null
        if (!workspace) await sleep(300)
      }
      const pending = bridge.call('tools/call', { name: 'one_trash_page', arguments: { id: projects, workspace } })
      const card = page.getByRole('alertdialog')
      await card.waitFor({ timeout: 20_000 })
      await page.waitForTimeout(600)
      await page.mouse.move(W + 40, H + 40)
      await save(page, 'mcp-tidy-up', frameAround(await boxOf(card), { width: W, height: H }, 16 / 10, 120))
      // nothing is written: rejected
      await page.keyboard.press('Escape')
      await pending
      await ctx.close()
    } finally {
      bridge.close()
    }
  },

  /** A pasted report selected → Ask AI → Turn into database: the preview (columns, group by, board). */
  async 'turn-into-database'(browser) {
    const { ctx, page } = await freshPage(browser, { claude: { json: reportAnswer } })
    const id = await createPage(page, 'Delta report', reportDoc(), { icon: { type: 'asset', value: 'binder' } })
    await openPage(page, id)
    await page.locator('#main .ProseMirror p', { hasText: REPORT.intro }).first().click()
    await selectRange(page, REPORT.intro, 'Next review on Friday.')
    await page.locator('[aria-label="Formatting"]').first().getByRole('button', { name: /^Ask AI$/ }).click()
    const ai = page.locator('.ai-panel').first()
    await ai.waitFor()
    await ai.getByRole('option', { name: /Turn into database/ }).click()
    const pv = page.getByTestId('todb-preview')
    await pv.waitFor({ timeout: 20_000 })
    await page.waitForTimeout(600)
    // from the columns down: group by, board or table, the first entries
    await scrollToTop(pv.locator('.todb__cols'), 34)
    await page.mouse.move(W + 40, H + 40)
    await save(page, 'turn-into-database', await boxOf(ai))
    await ctx.close()
  },

  /** The help sheet beside a page, on an article with steps (searched from the sheet). */
  async 'help-centre'(browser) {
    const { ctx, page } = await freshPage(browser)
    await openPage(page, 'Weekly sync — notes')
    await rest(page)
    await page.keyboard.press('?')
    const help = page.getByRole('dialog', { name: 'Help' })
    await help.waitFor()
    await page.waitForTimeout(400)
    await help.getByRole('searchbox').fill('share link password')
    await page.waitForTimeout(400)
    await help.getByRole('searchbox').press('Enter')
    await help.locator('.help-art__title', { hasText: 'Share links' }).waitFor()
    await rest(page)
    await save(page, 'help-centre')
    await ctx.close()
  },

  /** Settings → Claude AI → MCP servers: a knowledge base, connected (LED), with its tools. */
  async 'mcp-servers'(browser) {
    const { ctx, page } = await freshPage(browser)
    await page.evaluate((guide) => window.__one.workspace.getState().updateSettings({ mcpServers: [{ id: 'srvkb00001', name: 'atlas', url: 'https://kb.acme.studio/mcp', token: '', enabled: true, prompt: guide, promptSource: 'auto', tools: ['atlas_search', 'atlas_get', 'atlas_constraints'], checkedAt: Date.now() - 3 * 60_000, scope: 'own' }] }), ATLAS_GUIDE)
    await page.evaluate(() => window.__one.ui.getState().openModal({ type: 'settings', tab: 'ai' }))
    const section = page.getByTestId('mcp-servers')
    await section.waitFor()
    await scrollToTop(section, 24)
    await rest(page)
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await save(page, 'mcp-servers', await boxOf(dialog))
    await ctx.close()
  },
}

const browser = await chromium.launch()
let failed = 0
for (const [name, run] of Object.entries(shots)) {
  if (ONLY.length && !ONLY.includes(name)) continue
  for (let attempt = 1; attempt <= 2; attempt++) {
    errors = []
    let problem = ''
    try {
      await run(browser)
    } catch (e) {
      problem = `FAILED ${name}: ${String(e?.stack ?? e).slice(0, 600)}${errors.length ? `\n  browser errors:\n  ${errors.join('\n  ')}` : ''}`
    }
    if (!problem && errors.length) problem = `ERRORS in ${name}:\n  ${errors.join('\n  ')}`
    if (!problem) break
    console.log(problem)
    if (attempt === 2) failed++
    else console.log(`  retrying ${name}`)
  }
}
await browser.close()
if (!process.env.KEEP) rmSync(TMP, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
