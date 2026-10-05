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
 * Shots: ai-terminal, mcp-codewords, mcp-tidy-up, slash-menu, turn-into-database, custom-agents, gmail,
 * help-centre, mcp-servers, feed-blocks — each named like its image. Every shot starts from a fresh, seeded
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

/** The tool result Claude got back for a tool_use id. */
const toolResult = (body, id) => (body.messages ?? []).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((c) => c.type === 'tool_result' && c.tool_use_id === id)

const shots = {
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
          { type: 'tool_use', id: 'toolu_u1', name: 'update_row', input: { id: ids.n8n, properties: { Priority: 'High' } } },
          { type: 'tool_use', id: 'toolu_u2', name: 'update_row', input: { id: ids.video, properties: { Status: 'Backlog' } } },
        ]),
      () =>
        sseTurn([
          {
            type: 'text',
            text: '**Week check:** 8 projects, 3 in progress. *n8n lead-routing automation* blocks the relaunch — proposed **High** priority. *Customer onboarding video* waits on the AI assistant — proposed back to **Backlog**. Budget: €11,000 of €18,000 spent.',
          },
        ]),
    ]
    const { ctx, page } = await freshPage(browser, { claude: { turns } })
    ids.projects = await pageIdByTitle(page, 'Projects')
    ids.n8n = await pageIdByTitle(page, 'n8n lead-routing automation')
    ids.video = await pageIdByTitle(page, 'Customer onboarding video')
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
      problem = `FAILED ${name}: ${String(e?.stack ?? e).slice(0, 600)}`
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
