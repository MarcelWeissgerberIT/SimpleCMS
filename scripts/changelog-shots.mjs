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
 * Shots: mirror, models, search, terminal-pipelines, cloud-worker, one-picker, pipelines, legacy-modernise, coding-live, text-size, mcp-media, coding-setup, free-board, building-blocks, workspace-settings, diagram-viewer, coding-pipeline, pages-per-item, design-import, tour, quick-capture, script-templates, one-script-everywhere, file-ai, one-script, transform, ai-edit, db-commands, gmail-one-click, memory, grips-footer, block-select, split-to-page, image-ai, claude-reads, redo, ai-terminal, mcp-codewords, mcp-tidy-up, slash-menu, turn-into-database,
 * custom-agents, gmail, help-centre, mcp-servers, feed-blocks — each named like its image. Every shot starts from a fresh, seeded
 * workspace in English, light theme, 1440 × 900 at device scale 2; the crop of the relevant area is scaled
 * to 1440 px wide and saved as public/assets/shots/changelog/<shot>.webp (≤ 150 KB: the quality steps down
 * until it fits), its pixel size goes into sizes.json next to it (the public /help/changelog/ page reads it).
 *
 * Nothing leaves the machine: api.anthropic.com is mocked (streamed answers, structured JSON, scripted
 * tool-use runs — never a real request), Gmail and Google's sign-in script are in-memory stand-ins, the MCP
 * bridge for the tidy-up shot is the repository's own public/mcp/one-mcp.mjs on a local port, the coding shot runs
 * public/mcp/one-worker.mjs with the fake Claude Code CLI against a temp repo and a local bare remote, the cloud-worker
 * shot runs the repository's own team server (server/, bundled into node_modules/.cache/cl-shots-server; DEV_MODE,
 * a throwaway data folder, localhost:5346 or ONE_SERVER_PORT) serving the app build in ONE_APP_DIR (default
 * node_modules/.cache/cl-shots-dist — set it when the preview serves another folder). Browser errors
 * are printed; a shot that fails or logs errors makes the script exit with code 1. KEEP=1 keeps the PNGs in
 * .shots/changelog. Needs python3 with Pillow (WebP encoding), like scripts/capture-shots.mjs.
 */
import { chromium } from 'playwright'
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strToU8, zipSync } from 'fflate'

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
const KB_GUIDE = '**kb** is the team knowledge base: decisions, specs and project records.\n- Find records with `kb_search` (query, project), read one with `kb_get` (ref).\n- Check plans against `kb_constraints` before proposing changes.'

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
    // no "Take the 3-minute tour" card on the Welcome page of these pictures (the tour shot starts it itself)
    localStorage.setItem('one.tour', '{"off":true}')
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

/**
 * Two crops of the same workspace in two states, side by side on the paper background (scaled to the
 * same height) — or, with `{ column: true }`, one above the other at their own size — saved like save(): 1440
 * wide, WebP <= 150 KB, its size into sizes.json.
 */
async function saveSideBySide(name, pngs, { column = false } = {}) {
  const out = `${OUT}/${name}.webp`
  const py = `
import sys, io
from PIL import Image
out, width, limit, column = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4] == '1'
parts = [Image.open(p).convert('RGB') for p in sys.argv[5:]]
pad, gap = 40, 40
if column:
    canvas = Image.new('RGB', (max(p.width for p in parts) + 2 * pad, sum(p.height for p in parts) + gap * (len(parts) - 1) + 2 * pad), (242, 240, 234))
    y = pad
    for p in parts:
        canvas.paste(p, (pad, y))
        y += p.height + gap
else:
    h = max(p.height for p in parts)
    parts = [p if p.height == h else p.resize((round(p.width * h / p.height), h), Image.LANCZOS) for p in parts]
    canvas = Image.new('RGB', (sum(p.width for p in parts) + gap * (len(parts) - 1) + 2 * pad, h + 2 * pad), (242, 240, 234))
    x = pad
    for p in parts:
        canvas.paste(p, (x, pad))
        x += p.width + gap
im = canvas.resize((width, round(canvas.height * width / canvas.width)), Image.LANCZOS)
for q in (86, 82, 78, 74, 70, 66, 62, 58):
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=q, method=6)
    if buf.tell() <= limit or q == 58:
        open(out, 'wb').write(buf.getvalue())
        print(f'{im.width}x{im.height} q{q} {buf.tell() // 1024} KB')
        break
`
  const info = execFileSync('python3', ['-c', py, out, String(OUT_W), String(MAX_BYTES), column ? '1' : '0', ...pngs]).toString().trim()
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

/*
 * The coding worker (public/mcp/one-worker.mjs) with the fake Claude Code CLI (mcp/test/fixtures/fake-claude.mjs):
 * a temp repo "website" with a local bare remote, git without the machine's global config.
 */
const WORKER = fileURLToPath(new URL('../public/mcp/one-worker.mjs', import.meta.url))
const FAKE_CLAUDE = fileURLToPath(new URL('../mcp/test/fixtures/fake-claude.mjs', import.meta.url))
const WORKER_PORT = 47388

function codingRepo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'one-shot-coding-')))
  writeFileSync(join(root, 'gitconfig'), '')
  const env = { ...process.env, GIT_CONFIG_GLOBAL: join(root, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Marcel', GIT_AUTHOR_EMAIL: 'marcel@example.invalid', GIT_COMMITTER_NAME: 'Marcel', GIT_COMMITTER_EMAIL: 'marcel@example.invalid' }
  const run = (cwd, ...args) => execFileSync('git', args, { cwd, env, stdio: 'ignore' })
  const remote = join(root, 'remote.git')
  const path = join(root, 'website')
  run(root, 'init', '-q', '--bare', '-b', 'main', remote)
  run(root, 'init', '-q', '-b', 'main', path)
  mkdirSync(join(path, 'src'))
  writeFileSync(join(path, 'README.md'), '# Website\n')
  writeFileSync(join(path, 'src', 'login.ts'), "export interface LoginResult {\n  ok: boolean\n}\n\nexport function login(user: string, password: string): LoginResult {\n  if (!user || !password) return { ok: false }\n  return { ok: true }\n}\n")
  writeFileSync(join(path, 'check.mjs'), "console.log('✓ 12 checks passed')\n")
  run(path, 'add', '-A')
  run(path, 'commit', '-qm', 'initial')
  run(path, 'remote', 'add', 'origin', remote)
  run(path, 'push', '-q', '-u', 'origin', 'main')
  return { root, path, env }
}

async function startCodingWorker(work, workspace, env = {}, repo = {}, port = WORKER_PORT) {
  const file = join(work.root, 'worker.json')
  writeFileSync(file, JSON.stringify({ workspace, name: 'studio-mac', port, pollSec: 2, repos: [{ name: 'website', path: work.path, baseBranch: 'main', testCommand: [process.execPath, 'check.mjs'], pr: 'none', maxUsdPerTask: 5, maxUsdPerDay: 25, ...repo }] }))
  const child = spawn(process.execPath, [WORKER, '--config', file], { env: { ...work.env, CLAUDE_BIN: FAKE_CLAUDE, ...env }, stdio: ['ignore', 'ignore', 'pipe'] })
  let log = ''
  child.stderr.on('data', (d) => (log += d))
  for (let i = 0; i < 100 && !/ready on ws:/.test(log); i++) await sleep(50)
  if (!/ready on ws:/.test(log)) throw new Error(`worker did not start: ${log}`)
  return child
}

/*
 * The team server for the cloud worker shot: server/ bundled from its sources with the server's own esbuild (the
 * options of server/build.mjs) into node_modules/.cache/cl-shots-server — server/dist stays as it is — and started
 * like the team-cloud e2e suite starts it (DEV_MODE: sign-in links from its dev mailbox; a throwaway data folder; a
 * FAKE data key) on localhost, serving the app build the preview serves (ONE_APP_DIR, default the README's
 * node_modules/.cache/cl-shots-dist). The downloaded cloud worker runs with the fake Claude Code CLI and its own home.
 */
const SERVER_PORT = Number(process.env.ONE_SERVER_PORT) || 5346
const APP_DIR = process.env.ONE_APP_DIR || 'node_modules/.cache/cl-shots-dist'
const CLOUD_WORKER_PORT = 47378
/** FAKE master key for this throwaway server only (as in playwright.cloud.config.ts): 32 ASCII bytes that say what they are. */
const SHOT_DATA_KEY = Buffer.from('test-only-data-key-not-a-secret!', 'utf8').toString('base64')

async function buildTeamServer() {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const out = join(root, 'node_modules/.cache/cl-shots-server')
  const esbuild = createRequire(join(root, 'server/package.json'))('esbuild')
  const { version } = JSON.parse(readFileSync(join(root, 'server/package.json'), 'utf8'))
  await esbuild.build({
    absWorkingDir: join(root, 'server'),
    entryPoints: { index: 'src/index.ts' },
    outdir: out,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'warning',
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
    define: { __VERSION__: JSON.stringify(version) },
  })
  return join(out, 'index.js')
}

async function startTeamServer(dataDir) {
  const app = resolve(APP_DIR)
  if (!existsSync(join(app, 'app', 'index.html'))) throw new Error(`no app build in ${APP_DIR} — set ONE_APP_DIR to the folder the preview serves`)
  const bundle = await buildTeamServer()
  const origin = `http://localhost:${SERVER_PORT}`
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', bundle], {
    env: { PATH: process.env.PATH ?? '', PORT: String(SERVER_PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, APP_DIR: app, PUBLIC_URL: origin, DEV_MODE: '1', AUTH_IP_LIMIT: '1000', SIGNUP: 'open', LOG_LEVEL: 'warn', DATA_KEY: SHOT_DATA_KEY, AGENTS: 'off' },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let log = ''
  child.stderr.on('data', (d) => (log += d))
  for (let i = 0; i < 300 && child.exitCode === null; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${SERVER_PORT}/api/health`)).ok) return { child, origin }
    } catch {}
    await sleep(100)
  }
  child.kill('SIGTERM')
  throw new Error(`team server did not start: ${log.slice(0, 600)}`)
}

/** The downloaded one-worker-cloud.mjs on "another computer": its own home and config, the repo as "website". */
async function startCloudWorker(file, work) {
  const home = join(work.root, 'build-box')
  mkdirSync(home)
  const config = join(home, 'worker.json')
  writeFileSync(config, JSON.stringify({ name: 'build-box', pollSec: 2, repos: [{ name: 'website', path: work.path, baseBranch: 'main', testCommand: [process.execPath, 'check.mjs'], pr: 'none', maxUsdPerTask: 5 }] }))
  const child = spawn(process.execPath, [file, '--config', config, '--no-browser'], {
    env: { PATH: process.env.PATH ?? '', HOME: home, GIT_CONFIG_GLOBAL: work.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Marcel', GIT_AUTHOR_EMAIL: 'marcel@example.invalid', GIT_COMMITTER_NAME: 'Marcel', GIT_COMMITTER_EMAIL: 'marcel@example.invalid', CLAUDE_BIN: FAKE_CLAUDE, ONE_WORKER_BROWSER: 'none', ONE_WORKER_PORT: String(CLOUD_WORKER_PORT) },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let log = ''
  child.stderr.on('data', (d) => (log += d))
  for (let i = 0; i < 200 && child.exitCode === null && !/ready \(cloud\)/.test(log); i++) await sleep(50)
  if (!/ready \(cloud\)/.test(log)) {
    child.kill('SIGTERM')
    throw new Error(`cloud worker did not start: ${log.slice(0, 600)}`)
  }
  return child
}

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

/** A small PowerPoint deck for the "Claude Design" picture: slides with titles and a theme (colours, fonts). */
function shotDeck() {
  const P = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const xml = (s) => strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${s}`)
  const rels = (list) => xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('')}</Relationships>`)
  const titles = ['Northwind launch', 'Why now', 'What ships on day one', 'Pricing', 'Next steps']
  const slide = (t, i) =>
    xml(`<p:sld ${P}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="${i ? 'title' : 'ctrTitle'}"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`)
  const colors = ['14213D', 'F6F1E7', '1D3557', 'EDE6D6', 'FC5130', '2A9D8F', 'E9C46A', '6C757D', '8E7DBE', 'D1495B', '2A9D8F', '8E7DBE']
  const slots = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']
  const files = {
    'ppt/presentation.xml': xml(`<p:presentation ${P}><p:sldIdLst>${titles.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst></p:presentation>`),
    'ppt/_rels/presentation.xml.rels': rels([['rId1', 'theme', 'theme/theme1.xml'], ...titles.map((_, i) => [`rId${i + 2}`, 'slide', `slides/slide${i + 1}.xml`])]),
    'ppt/theme/theme1.xml': xml(
      `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Northwind"><a:themeElements><a:clrScheme name="Northwind">${slots.map((s, i) => `<a:${s}><a:srgbClr val="${colors[i]}"/></a:${s}>`).join('')}</a:clrScheme><a:fontScheme name="Northwind"><a:majorFont><a:latin typeface="Fraunces"/></a:majorFont><a:minorFont><a:latin typeface="IBM Plex Sans"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`,
    ),
  }
  titles.forEach((t, i) => (files[`ppt/slides/slide${i + 1}.xml`] = slide(t, i)))
  return zipSync(files)
}

/** The HTML export of the "Claude Design" picture: tokens as CSS custom properties, Google Fonts, a type scale. */
const SHOT_DESIGN_HTML = `<!doctype html><html><head><title>Northwind launch</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@600&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Mono&display=swap" rel="stylesheet">
<style>
:root { --paper: #F6F1E7; --ink: #14213D; --brand: #FC5130; --teal: #2A9D8F; --sand: #E9C46A; --muted: #6C757D; --line: #DDD5C4; --radius-sm: 6px; --radius-lg: 14px; --space-1: 4px; --space-2: 8px; --space-4: 16px; --space-6: 24px; --space-10: 40px; }
body { font-family: 'IBM Plex Sans', sans-serif; font-size: 17px; background: var(--paper); color: var(--ink); padding: 40px; }
h1 { font-family: 'Fraunces', serif; font-size: 56px; }
h2 { font-family: 'Fraunces', serif; font-size: 36px; }
h3 { font-size: 24px; }
.card { border: 1px solid var(--line); border-radius: var(--radius-lg); padding: 24px; gap: 16px; }
.pill { background: var(--brand); color: #fff; border-radius: 999px; padding: 8px 16px; }
small { font-size: 14px; color: var(--muted); }
code { font-family: 'IBM Plex Mono', monospace; font-size: 14px; }
</style></head>
<body><h1>Northwind launch</h1><p>Ship faster with Northwind — the new planner for small teams, out on <strong>November 3</strong>.</p>
<div class="card"><h2>What's new</h2><ul><li>Plans that follow your calendar</li><li>Offline mode</li><li>One-click handover</li></ul></div></body></html>`

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
  /**
   * "Integrations unlock the mirror recipe": an integration profile (fictional "Tracker", matched by the server's
   * tested tools and name) makes the recipe appear; its own path — setup (source "tracker", below Team wiki), the
   * editor's placeholders replaced, a run (Claude mocked: upsert_rows by Key, a note, the state), Apply all — then the
   * person sets My priority on rows. Above: Workspace → Integrations with the active profile; below: the Board by
   * Clarity (sidebar folded for the width).
   */
  async mirror(browser) {
    const ids = { db: '' }
    const items = [
      ['8216', 'Export to CSV drops the last row', 'Ready', 'High', 'Jonas Berg', ['export'], 2, '', false, false, 'Clear', 'Steps to reproduce and a test file are attached.'],
      ['8219', 'Dark mode for the settings page', 'Ready', 'Low', 'Mira Lenz', ['ui'], 1, '', false, false, 'Clear', 'Final designs and acceptance criteria are linked.'],
      ['8224', 'Keyboard shortcut to archive', 'Open', 'Low', 'Jonas Berg', ['ui'], 0, '', false, false, 'Clear', 'Small and fully described.'],
      ['8215', 'Login fails after password reset', 'In review', 'High', 'Mira Lenz', ['auth'], 4, 'Mira Lenz: Can you confirm the reset link expiry?', true, true, 'Open questions', 'The expiry of the reset link is not decided yet.'],
      ['8226', 'Upload stalls at 99 %', 'Open', 'Medium', 'Ada Okafor', ['files'], 5, 'Ada Okafor: Which browser shows it?', true, true, 'Open questions', 'Ada asks which browser shows it.'],
      ['8217', 'Slow search on phones', 'Open', 'Medium', 'Ada Okafor', ['search'], 6, 'Ada Okafor: Waiting for the index rebuild.', true, false, 'Blocked', 'Needs the index rebuild of the platform team first.'],
      ['8221', 'Invoice PDF shows the wrong VAT', 'In progress', 'High', 'Lukas Brandt', ['billing'], 3, 'Lukas Brandt: The fix is in review.', false, false, 'In progress elsewhere', 'Lukas works on it in the billing team.'],
      ['8202', 'Onboarding checklist for new teams', 'Closed', 'Medium', 'Mira Lenz', ['onboarding'], 7, 'Mira Lenz: Shipped.', false, false, 'Done', 'Closed in the source on 6 October.'],
    ]
    const rows = items.map(([key, title, status, prio, owner, tags, comments, last, isNew, waiting, clarity, why]) => ({
      key,
      title,
      properties: {
        Link: `https://tracker.example.com/items/${key}`,
        'Source status': status,
        'Source priority': prio,
        Owner: owner,
        Tags: tags,
        'Changed at': isoDay(-1),
        Comments: comments,
        ...(last ? { 'Last comment': last, 'Last comment at': isoDay(-1) } : {}),
        'New comment': isNew,
        'Waiting on me': waiting,
        Clarity: clarity,
        Why: why,
      },
    }))
    const turns = [
      () => sseTurn([{ type: 'thinking', text: 'Reading my state, then the open items of the tracker.' }, { type: 'tool_use', id: 'toolu_s', name: 'agent_state_get', input: {} }]),
      () => sseTurn([{ type: 'tool_use', id: 'toolu_u', name: 'upsert_rows', input: { database_id: ids.db, key_property: 'Key', rows } }]),
      () =>
        sseTurn([
          { type: 'tool_use', id: 'toolu_n', name: 'notify_me', input: { text: '3 items became ready: #8216, #8219, #8224.' } },
          { type: 'tool_use', id: 'toolu_x', name: 'agent_state_set', input: { json: JSON.stringify({ last: new Date().toISOString(), comments: Object.fromEntries(items.map((i) => [i[0], i[6]])) }) } },
        ]),
      () => sseTurn([{ type: 'text', text: '**8 items mirrored**, all new. **Waiting on you:** #8215 (reset link expiry), #8226 (which browser). **Ready:** #8216, #8219, #8224. **Blocked:** #8217. Nothing was written to the tracker.' }]),
    ]
    const { ctx, page } = await freshPage(browser, { claude: { turns } })
    await page.evaluate(() =>
      window.__one.workspace.getState().updateSettings({
        mcpServers: [
          { id: 'm-tracker', name: 'tracker', url: 'https://tracker.example.com/mcp', token: '', enabled: true, prompt: '', tools: ['list_items', 'get_item', 'search_items', 'list_comments', 'whoami', 'create_item', 'update_item', 'add_comment'], checkedAt: Date.now() },
        ],
      }),
    )
    // the integration profile the person added: it unlocks the agent features and brings the recipe
    await page.evaluate(() =>
      window.__one.workspace.getState().upsertIntegration({
        schema: 'one.integration/1',
        id: 'tracker',
        name: 'Tracker',
        description: 'Our team tracker: its open items, mirrored every weekday.',
        match: { tools: ['list_items', 'get_item'], name: 'tracker' },
        unlocks: ['keys', 'onlyByHand', 'upsert', 'toolAllowList', 'agentState', 'notify'],
        recipes: [{ kind: 'mirror', name: { en: 'Mirror tracker items', de: 'Tracker-Einträge spiegeln' }, description: { en: 'The open items of the tracker → a database, every weekday. Your own fields stay yours.', de: 'Die offenen Einträge des Trackers → eine Datenbank, jeden Werktag. Deine eigenen Felder bleiben deine.' } }],
      }),
    )
    // the recipe: setup → the database and its report page → the editor with the draft
    await page.evaluate(() => (window.location.hash = '#/agents'))
    await page.locator('.agx-start [data-recipe="tracker:mirror"]').click()
    const setup = page.locator('.agx-mir')
    await setup.locator('.agx-pick').click()
    await page.getByRole('menuitem', { name: 'Team wiki' }).click()
    await setup.getByRole('button', { name: 'Create database and agent' }).click()
    await page.locator('.agx-editor').waitFor()
    ids.db = await pageIdByTitle(page, 'Tracker')
    for (const text of ['list_items with project WEB and status open', 'get_item with the id, comments included', 'the user "marcel"', 'acceptance criteria written, no open question, nothing blocking']) {
      await page.locator('.agx-ph__btn').first().click()
      await page.keyboard.insertText(text)
    }
    await page.getByRole('button', { name: 'Create agent', exact: true }).click()
    await page.locator('.agx-dhead').waitFor()
    await page.getByRole('button', { name: 'Run now' }).click()
    await page.waitForFunction(() => document.querySelector('.agx-run')?.getAttribute('data-status') === 'staged', null, { timeout: 30_000 })
    await page.getByRole('button', { name: 'Apply all' }).first().click()
    await page.waitForFunction((db) => Object.values(window.__one.workspace.getState().pages).filter((p) => p.databaseId === db).length === 8, ids.db, { timeout: 10_000 })
    // the person's own priorities (only by hand)
    await page.evaluate((dbId) => {
      const s = window.__one.workspace.getState()
      const prop = s.databases[dbId].properties.find((p) => p.name === 'My priority')
      const rowsOf = Object.values(s.pages).filter((p) => p.databaseId === dbId)
      for (const [title, name] of [['Export to CSV', 'P1'], ['Login fails', 'P1'], ['Keyboard shortcut', 'P2'], ['Dark mode', 'P3'], ['Upload stalls', 'P2']]) {
        const row = rowsOf.find((r) => r.title.startsWith(title))
        const opt = prop.options.find((o) => o.name === name)
        if (row && opt) s.setRowProperty(row.id, prop.id, opt.id)
      }
      s.updateSettings({ sidebarCollapsed: true })
    }, ids.db)
    for (const b of await page.locator('.toast__close').all()) await b.click().catch(() => {})
    await page.evaluate((id) => (window.location.hash = `#/p/${id}`), ids.db)
    await page.locator('.dbc').first().waitFor()
    await page.waitForTimeout(900)
    await rest(page)
    // the title, the view tabs and the board down to the last card that fits
    const top = await boxOf(page.locator('#main .pv-title').first())
    const y = Math.max(0, Math.round(top.y - 28))
    // down to the status bar (not into it)
    const foot = Math.round((await page.locator('footer.status').first().boundingBox())?.y ?? H)
    const board = `${TMP}/mirror-board.png`
    await page.screenshot({ path: board, clip: { x: 0, y, width: W, height: Math.min(560, foot - y) } })
    // Workspace → Integrations: the active profile, what it unlocks, its recipe
    await page.evaluate(() => (window.location.hash = '#/workspace/integrations'))
    await page.locator('[data-testid="int-row"]').first().waitFor()
    await rest(page)
    const head = await boxOf(page.locator('#wsp-section-title').first())
    const row = await boxOf(page.locator('[data-testid="int-row"]').first())
    const left = Math.round(head.x - 24)
    const profile = `${TMP}/mirror-profile.png`
    await page.screenshot({ path: profile, clip: { x: left, y: Math.round(head.y - 20), width: Math.round(row.x + row.width + 24 - left), height: Math.round(row.y + row.height + 20 - (head.y - 20)) } })
    await saveSideBySide('mirror', [profile, board], { column: true })
    await ctx.close()
  },

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
      s.updateProperty(db.id, topics.id, { options: [{ id: 'tp-web', name: 'Website', color: 'blue' }, { id: 'tp-launch', name: 'Launch', color: 'green' }] })
      const add = (title, t, tps) => s.createRow(db.id, { title, properties: { [prop('Type').id]: type(t), [prop('Active').id]: true, [topics.id]: tps, [prop('Source').id]: 'AI terminal · 2026-10-02' } })
      add('Decisions and specs live in the team knowledge base.', 'Fact', ['tp-web'])
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

  /** The AI menu with "kb: …" typed: the chip names the server that answers first. */
  async 'mcp-codewords'(browser) {
    const { ctx, page } = await freshPage(browser)
    await page.evaluate((guide) => window.__one.workspace.getState().updateSettings({ mcpServers: [{ id: 'srvkb00001', name: 'kb', url: 'https://kb.example.com/mcp', token: '', enabled: true, prompt: guide, promptSource: 'auto', tools: ['kb_search', 'kb_get', 'kb_constraints'], checkedAt: Date.now() - 3 * 60_000, scope: 'own', codeword: 'kb' }] }), KB_GUIDE)
    const id = await createPage(page, 'Launch plan', doc(h(2, 'Relaunch'), para('Homepage and pricing ship first, the blog follows in a second step.'), para('Open: the final launch date and who signs off on the pricing copy.'), para('')), { icon: { type: 'asset', value: 'megaphone' } })
    await openPage(page, id)
    const ask = page.getByPlaceholder('Ask Claude to write anything…')
    for (let attempt = 0; attempt < 4 && !(await ask.count()); attempt++) {
      await page.locator('#main .ProseMirror p').last().click()
      await page.keyboard.press('End')
      await page.keyboard.press('Space')
      await page.waitForTimeout(600)
    }
    await ask.pressSequentially('kb: when do we launch?', { delay: 8 })
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
    await page.locator('.toast__close').last().click().catch(() => {})
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

  /** One Script templates + autocomplete: the template gallery, next to the editor suggesting a Status's options. */
  async 'script-templates'(browser) {
    const { ctx, page } = await freshPage(browser)
    const id = await page.evaluate(() => {
      const s = window.__one.workspace.getState()
      const db = Object.values(s.pages).find((p) => p.kind === 'database' && p.title === 'Projects')
      const now = Date.now()
      const code = [
        '# Open projects with high priority, soonest first',
        `let open = db(@[Projects](p:${db.id}))`,
        '  .where(Priority = "High", Status != "Done")',
        '  .sort(Timeline)',
        '',
        '# Ready for a look: move each one to review',
        'for p in open.rows {',
        '  p.set(Status:',
      ].join('\n')
      s.upsertScript({ id: 'scshot3', name: 'Projects to review', code, kind: 'script', createdAt: now, updatedAt: now })
      return 'scshot3'
    })
    // the editor: after "set(Status:" the options of the status, as texts
    await page.evaluate((id) => (window.location.hash = `#/scripts/${id}`), id)
    const ta = page.locator('.sc-code__input')
    await ta.waitFor()
    await ta.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type(' ', { delay: 40 })
    await page.locator('.sc-complete').waitFor()
    for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowDown')
    await page.mouse.move(W + 40, H + 40)
    await page.waitForTimeout(500)
    const code = await boxOf(page.locator('.sc-code'))
    const editor = { x: code.x, y: code.y, width: code.width, height: code.height }
    const a = `${TMP}/script-templates-editor.png`
    await page.screenshot({ path: a, clip: editor })
    // the gallery: categories and cards (each says what it touches and which database it uses)
    await page.evaluate(() => (window.location.hash = '#/scripts'))
    await page.getByTestId('sc-new-template').click()
    await page.getByTestId('sc-gallery').waitFor()
    await rest(page)
    await page.locator('.sc-gal__cards').evaluate((el) => (el.scrollTop = 0))
    // a cut-out of the dialog: square corners (no scrim showing in them)
    await page.locator('.sc-gal-modal').evaluate((el) => (el.style.borderRadius = '0'))
    const modal = await boxOf(page.locator('.sc-gal-modal'))
    const preview = await boxOf(page.getByTestId('sc-gallery-preview'))
    const b = `${TMP}/script-templates-gallery.png`
    await page.screenshot({ path: b, clip: { x: modal.x, y: modal.y, width: preview.x - modal.x + 1, height: Math.min(modal.height, editor.height) } })
    await saveSideBySide('script-templates', [b, a])
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

  /** "A sub-page for every ticket": the knowledge base (MCP, mocked) → create_pages (one call) → the table; applied: the page with its links, the sub-pages in the sidebar, the terminal's log below. */
  async 'pages-per-item'(browser) {
    const tickets = [
      ['CHK-101', 'Card declined', 'In progress', 'Lea'],
      ['CHK-102', 'Coupon on mobile', 'Open', 'Tom'],
      ['CHK-103', 'Tax rounds twice', 'Open', 'Mia'],
      ['CHK-104', 'Address timeout', 'Done', 'Jan'],
      ['CHK-105', 'Guest cart lost', 'In progress', 'Lea'],
      ['CHK-106', 'Wallet flicker', 'Open', 'Tom'],
      ['CHK-107', 'Invoice VAT ID', 'Done', 'Mia'],
      ['CHK-108', 'Late shipping costs', 'Open', 'Jan'],
    ]
    const title = (t) => `${t[0]} ${t[1]}`
    const ids = {}
    const turns = [
      () =>
        sseTurn([
          { type: 'thinking', text: 'Find the checkout tickets in kb, then one page per ticket under the open page.' },
          { type: 'mcp_tool_use', id: 'mcptoolu_1', server: 'kb', name: 'kb_search', input: { query: 'checkout', project: 'shop' } },
          { type: 'mcp_tool_result', id: 'mcptoolu_1', text: tickets.map((t) => t.join(' | ')).join('\n') },
          { type: 'tool_use', id: 'toolu_cur', name: 'get_current_page', input: {} },
        ]),
      () =>
        sseTurn([
          {
            type: 'tool_use',
            id: 'toolu_pages',
            name: 'create_pages',
            input: { parent_id: ids.main, pages: tickets.map((t) => ({ title: title(t), markdown: `**Status:** ${t[2]}\n\n**Owner:** ${t[3]}\n\nFrom kb, ${t[0]}.` })) },
          },
        ]),
      (body) => {
        const got = [...String(toolResult(body, 'toolu_pages')?.content ?? '').matchAll(/→ id: ([\w-]+)/g)].map((m) => m[1])
        const rows = tickets.map((t, i) => `| [${title(t)}](#/p/${got[i]}) | ${t[2]} | ${t[3]} |`)
        return sseTurn([{ type: 'tool_use', id: 'toolu_table', name: 'append_to_page', input: { id: ids.main, markdown: `| Ticket | Status | Owner |\n|---|---|---|\n${rows.join('\n')}` } }])
      },
      () => sseTurn([{ type: 'text', text: 'Staged **8 sub-pages** under Checkout review — one per ticket in kb — and a table on this page that links them with status and owner.' }]),
    ]
    const { ctx, page } = await freshPage(browser, { claude: { turns } })
    await page.evaluate((guide) => window.__one.workspace.getState().updateSettings({ mcpServers: [{ id: 'srvkb00001', name: 'kb', url: 'https://kb.example.com/mcp', token: '', enabled: true, prompt: guide, promptSource: 'auto', tools: ['kb_search', 'kb_get'], checkedAt: Date.now() - 3 * 60_000 }] }), KB_GUIDE)
    ids.main = await createPage(page, 'Checkout review', doc(para('Everything the knowledge base knows about the checkout, one page per ticket.')), { icon: { type: 'asset', value: 'binder' } })
    await openPage(page, ids.main)
    await page.keyboard.press('Control+j')
    const term = page.getByRole('region', { name: 'AI terminal' })
    await term.waitFor()
    const prompt = term.getByRole('textbox', { name: 'Task for the agent' })
    await prompt.fill('Analyse the checkout topic in kb and create a sub-page for every ticket, linked in a table on this page')
    await prompt.press('Enter')
    await term.locator('.term-head__status').filter({ hasText: 'Done' }).waitFor({ timeout: 30_000 })
    await term.getByRole('button', { name: 'Apply all' }).click()
    await page.locator('.toast', { hasText: /changes applied/ }).waitFor({ timeout: 10_000 })
    await page.locator('#main .ProseMirror table .mention__page').first().waitFor()
    // the sub-pages in the sidebar, under the page
    const row = page.locator('.sb section[aria-label="Pages"] .sb-row', { has: page.locator('.sb-row__title', { hasText: /^Checkout review$/ }) }).first()
    const toggle = row.locator('.sb-row__toggle')
    if ((await toggle.getAttribute('aria-label')) === 'Expand') await toggle.click()
    // the page and its sub-pages in view (the sidebar has more sections above it than it used to)
    await row.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    // the toast steps aside; the page shows its table above the dock
    await page.locator('.toast', { hasText: /changes applied/ }).getByRole('button', { name: /close|dismiss/i }).click().catch(() => {})
    await scrollToTop(page.locator('#main .ProseMirror p', { hasText: 'Everything the knowledge base knows' }).first(), 28)
    // the log from the task down: the knowledge-base call, one call for all pages, the table
    const box = await term.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, -6000)
    await page.waitForTimeout(500)
    await rest(page)
    await save(page, 'pages-per-item')
  },

  /** The guided tour, step 4 of 8: the hairline frame around a database's view tabs, the placard under it. */
  async tour(browser) {
    const { ctx, page } = await freshPage(browser)
    // started like anyone would after "Not now": ⌘K → Start the tour
    await page.keyboard.press('Control+k')
    await page.locator('.pal-input input').fill('Start the tour')
    await page.waitForTimeout(300)
    await page.keyboard.press('Enter')
    await page.locator('.tour-placard').waitFor()
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(700)
      await page.locator('.tour-placard__next').click()
    }
    await page.locator('#main .db-tabs').waitFor()
    await page.locator('.tour-placard__label', { hasText: 'Step 04 / 08' }).waitFor()
    await page.waitForTimeout(1200)
    await rest(page)
    const left = Math.round((await page.locator('.sb').first().boundingBox())?.width ?? 0) + 1
    const box = union(await boxOf(page.locator('.tour-frame')), await boxOf(page.locator('.tour-placard')), await boxOf(page.locator('#main .pv-title')))
    const top = Math.max(0, Math.round(box.y - 28))
    await save(page, 'tour', { x: left, y: top, width: W - left, height: Math.min(H - 30 - top, Math.round(box.y + box.height + 36 - top)) })
  },

  /** "Take over from Claude Design": the HTML export, the deck and two screenshots added; the tokens read from them; the options. */
  async 'design-import'(browser) {
    const { ctx, page } = await freshPage(browser, { viewport: { width: W, height: 1240 } })
    await page.evaluate(() => window.__one.ui.getState().openModal({ type: 'import' }))
    const dialog = page.getByRole('dialog')
    await page.locator('.io-src[data-source="design"]').click()
    const step = dialog.getByTestId('design-import')
    const add = async (slot, files) => {
      const chooser = page.waitForEvent('filechooser')
      await step.locator(`.io-slot[data-slot="${slot}"] .btn`).click()
      await (await chooser).setFiles(files)
      await page.waitForTimeout(300)
    }
    await add('html', { name: 'northwind-launch.html', mimeType: 'text/html', buffer: Buffer.from(SHOT_DESIGN_HTML) })
    await add('pptx', { name: 'Northwind launch deck.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from(shotDeck()) })
    await add('shots', [
      { name: 'home.webp', mimeType: 'image/webp', buffer: readFileSync('public/assets/shots/changelog/file-ai.webp') },
      { name: 'settings.webp', mimeType: 'image/webp', buffer: readFileSync('public/assets/shots/changelog/memory.webp') },
    ])
    await step.getByRole('switch', { name: 'Describe the screenshots with Claude' }).click()
    await step.getByRole('switch', { name: 'Save the style to One memory' }).click()
    await step.getByTestId('design-tokens').locator('.io-tokens__swatches li').first().waitFor()
    await rest(page)
    const box = await boxOf(page.locator('.modal').first(), 20)
    await save(page, 'design-import', box)
    await ctx.close()
  },

  /** "one:" in page text: the pages on the same level and inside the page, before any search. */
  async 'one-picker'(browser) {
    const { ctx, page } = await freshPage(browser)
    try {
      const here = await page.evaluate(() => {
        const s = window.__one.workspace.getState()
        const mk = (title, parentId) => s.createPage({ title, parentId })
        const release = mk('Release 4.2', null)
        mk('Sample view review', release)
        mk('Rollout checklist', release)
        mk('Customer feedback', release)
        const draft = mk('Release notes draft', release)
        mk('Screenshots', draft)
        s.setContent(draft, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'What changed for teams since 4.1.' }] }, { type: 'paragraph' }] }, 'shot')
        return draft
      })
      await page.evaluate((id) => (window.location.hash = `#/p/${id}`), here)
      const editor = page.locator('#main .ProseMirror').first()
      await editor.locator('p').last().click()
      await page.keyboard.type('Built on the findings in one:')
      await page.getByTestId('ref-menu').waitFor()
      await rest(page)
      const box = union(await boxOf(page.locator('#main .pv-title')), await boxOf(page.getByTestId('ref-menu')))
      await save(page, 'one-picker', { x: Math.max(0, box.x - 40), y: Math.max(0, box.y - 30), width: Math.min(W - box.x + 40, 980), height: box.height + 70 })
    } finally {
      await ctx.close()
    }
  },

  /**
   * Business analysis: a task without a repo after the worker wrote Analysis and Specification — the switch
   * Coding · Business analysis · QA, the panel waiting at "Approve spec", "Then: Coding" ticked, the page it
   * mentions under "Goes along". The repository's worker with the fake Claude Code CLI — no API, no real host.
   */
  /**
   * "Explain the code": the task ran Overview · Static analysis · Components · Documentation check (the worker with the
   * fake Claude Code CLI, FAKE:DEMOEXPLAIN — no API); a component's page, the documentation tree in the sidebar.
   */
  async 'explain-code'(browser) {
    const work = codingRepo()
    const { ctx, page } = await freshPage(browser, { viewport: { width: W, height: H } })
    let worker = null
    try {
      await page.evaluate(() => window.__one.ui.getState().openModal({ type: 'settings' }))
      await page.getByRole('tab', { name: 'Coding worker' }).click()
      const init = await page.locator('.cw-code pre').filter({ hasText: 'init --workspace' }).first().textContent()
      const lint = [process.execPath, '-e', "console.log('src/InvoiceRun.cs(212,9): warning CA1305: The behavior of ToString could vary'); console.log('src/TaxTable.cs(48,5): warning CS0618: TaxRate.Old is obsolete'); process.exit(1)"]
      worker = await startCodingWorker(work, /--workspace (\S+)/.exec(init)[1], {}, { analyzeCommand: lint })
      const port = page.getByLabel('Port', { exact: true })
      await port.fill(String(WORKER_PORT))
      await port.press('Enter')
      await page.getByRole('switch', { name: 'Connect to a coding worker on this computer' }).click()
      await page.getByTestId('coding-conn').filter({ hasText: 'Connected' }).waitFor({ timeout: 20_000 })
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'detached' })
      await page.evaluate(() => (window.location.hash = '#/coding'))
      await page.getByTestId('coding-setup-explain').click()
      await page.getByText('Coding database created.').waitFor({ state: 'detached', timeout: 20_000 })
      await page.getByTestId('coding-new').click()
      await page.getByTestId('coding-new-title').fill('Billing service')
      await page.getByTestId('coding-new-repo').fill('website')
      await page.getByTestId('coding-new-goal').fill('How does invoicing work, and where does the money get rounded? FAKE:DEMOEXPLAIN')
      await page.getByTestId('coding-create').click()
      await page.getByTestId('coding-panel').waitFor()
      await page.locator('.ctk-code').filter({ hasText: /· Approve documentation$/i }).waitFor({ timeout: 90_000 })
      // the documentation page: written by the pipeline, the intro, a page per component
      const root = await page.evaluate(() => Object.values(window.__one.workspace.getState().pages).find((p) => p.title === 'Billing service · Components' && !p.trashed)?.id)
      await page.evaluate((id) => (window.location.hash = `#/p/${id}`), root)
      await page.getByText('Payment import').last().waitFor()
      await rest(page)
      const last = await page.getByText('Payment import').last().boundingBox()
      await save(page, 'explain-code', { x: 0, y: 0, width: W, height: Math.min(H, Math.round(last.y + last.height + 60)) })
    } finally {
      worker?.kill('SIGTERM')
      await ctx.close()
      rmSync(work.root, { recursive: true, force: true })
    }
  },

  async pipelines(browser) {
    const work = codingRepo()
    const { ctx, page } = await freshPage(browser, { viewport: { width: W, height: H + 200 } })
    let worker = null
    try {
      await page.evaluate(() => window.__one.ui.getState().openModal({ type: 'settings' }))
      await page.getByRole('tab', { name: 'Coding worker' }).click()
      const init = await page.locator('.cw-code pre').filter({ hasText: 'init --workspace' }).first().textContent()
      worker = await startCodingWorker(work, /--workspace (\S+)/.exec(init)[1])
      const port = page.getByLabel('Port', { exact: true })
      await port.fill(String(WORKER_PORT))
      await port.press('Enter')
      await page.getByRole('switch', { name: 'Connect to a coding worker on this computer' }).click()
      await page.getByTestId('coding-conn').filter({ hasText: 'Connected' }).waitFor({ timeout: 20_000 })
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'detached' })
      // the page the task refers to
      const policy = await page.evaluate(() => {
        const s = window.__one.workspace.getState()
        const id = s.createPage({ title: 'Approval policy 2026', parentId: null })
        s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Invoices above 5,000 EUR need the cost-centre owner\'s sign-off.' }] }] }, 'shot')
        return id
      })
      await page.evaluate(() => (window.location.hash = '#/coding/spec'))
      await page.getByTestId('coding-setup').click()
      await page.getByText('Business analysis database created.').waitFor({ state: 'detached', timeout: 20_000 })
      await page.getByTestId('coding-new').click()
      await page.getByTestId('coding-new-title').fill('Invoice approval flow')
      await page.getByTestId('coding-new-then-coding').click()
      await page.getByRole('checkbox').uncheck()
      await page.getByTestId('coding-create').click()
      const panel = page.getByTestId('coding-panel')
      await panel.waitFor()
      const id = await page.evaluate(() => window.location.hash.replace('#/p/', ''))
      await page.evaluate(({ id, policy }) => {
        const s = window.__one.workspace.getState()
        s.setContent(id, { type: 'doc', content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Invoices above the limit wait for days in e-mail threads. Describe the approval flow along ' }, { type: 'mention', attrs: { id: policy, label: 'Approval policy 2026', kind: 'page' } }, { type: 'text', text: '. FAKE:DEMODOC' }] },
        ] }, 'shot')
      }, { id, policy })
      await page.getByTestId('coding-run').click()
      await page.locator('.ctk-code').filter({ hasText: /· Approve spec$/i }).waitFor({ timeout: 60_000 })
      await scrollToTop(panel, 28)
      await rest(page)
      const top = await boxOf(panel, 20)
      const refs = await page.getByTestId('coding-refs').boundingBox()
      await save(page, 'pipelines', { ...top, y: Math.max(0, top.y - 4), height: refs.y + refs.height + 20 - top.y })
    } finally {
      worker?.kill('SIGTERM')
      await ctx.close()
      rmSync(work.root, { recursive: true, force: true })
    }
  },

  /**
   * The pipeline editor with the template "Modernise legacy code" picked: Analysis · Design · Test design (plan
   * stages with their own instructions), Approve concept, Write tests, Tests on the old code, Rebuild … — no worker.
   */
  async 'legacy-modernise'(browser) {
    const { ctx, page } = await freshPage(browser, { viewport: { width: W, height: H + 260 } })
    try {
      await page.evaluate(() => (window.location.hash = '#/coding'))
      // a fresh workspace has no Coding database yet: "Set up" makes it
      await page.getByTestId('coding-setup').click()
      await page.getByText('Coding database created.').waitFor({ state: 'detached', timeout: 20_000 })
      await page.getByTestId('coding-pipeline-open').click()
      await page.getByTestId('coding-template-modernise').click()
      const dialog = page.getByRole('dialog')
      await dialog.locator('.cpe-name').nth(2).waitFor()
      // open the Analysis stage: its instructions show what Claude Code is asked for
      await dialog.locator('.cpe-row').nth(2).locator('button[aria-expanded]').first().click().catch(() => {})
      await rest(page)
      await save(page, 'legacy-modernise', await boxOf(dialog, 16))
    } finally {
      await ctx.close()
    }
  },

  /**
   * A coding task while Implement runs: the now-line (the worker's last line, how long ago), Step x/y, the cost
   * estimate and the changed file. "Review only" approvals, so the plan gate passes by itself; the repository's own
   * worker with the fake Claude Code CLI at a working pace — no API, no real host.
   */
  async 'coding-live'(browser) {
    const work = codingRepo()
    // taller: the panel down to its counters fits above the status bar
    const { ctx, page } = await freshPage(browser, { viewport: { width: W, height: H + 300 } })
    let worker = null
    try {
      await page.evaluate(() => localStorage.setItem('one.coding.approvals', 'review'))
      await page.evaluate(() => window.__one.ui.getState().openModal({ type: 'settings' }))
      await page.getByRole('tab', { name: 'Coding worker' }).click()
      const init = await page.locator('.cw-code pre').filter({ hasText: 'init --workspace' }).first().textContent()
      worker = await startCodingWorker(work, /--workspace (\S+)/.exec(init)[1], { ONE_WORKER_LIVE_GIT_MS: '500' })
      const port = page.getByLabel('Port', { exact: true })
      await port.fill(String(WORKER_PORT))
      await port.press('Enter')
      await page.getByRole('switch', { name: 'Connect to a coding worker on this computer' }).click()
      await page.getByTestId('coding-conn').filter({ hasText: 'Connected' }).waitFor({ timeout: 20_000 })
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'detached' })
      await page.evaluate(() => (window.location.hash = '#/coding'))
      await page.getByTestId('coding-new').click()
      await page.getByTestId('coding-new-title').fill('Show the login error under the field')
      await page.getByTestId('coding-new-repo').fill('website')
      await page.getByTestId('coding-new-goal').fill('A wrong password fails silently. Name the field and say what is wrong. FAKE:DEMOLIVE')
      await page.getByTestId('coding-new-criteria').fill('The message names the field\nShort passwords are explained')
      await page.getByTestId('coding-create').click()
      const panel = page.getByTestId('coding-panel')
      await panel.waitFor()
      await page.getByTestId('coding-files').waitFor({ timeout: 60_000 })
      await page.getByTestId('coding-steps').filter({ hasText: /Step ([6-9]|\d\d)\// }).waitFor({ timeout: 30_000 })
      await scrollToTop(panel, 28)
      await rest(page)
      // the panel down to the counters (its tabs and the log below stay out)
      const top = await boxOf(panel, 20)
      const chips = await page.locator('.ctk-chips').boundingBox()
      await save(page, 'coding-live', { ...top, height: chips.y + chips.height + 20 - top.y })
    } finally {
      worker?.kill('SIGTERM')
      await ctx.close()
      rmSync(work.root, { recursive: true, force: true })
    }
  },

  /**
   * The coding pipeline: a task waiting at Review — the stage timeline, Approve / Rework, the diff of the change.
   * The repository's own worker (public/mcp/one-worker.mjs) with the fake Claude Code CLI against a temp repo and a
   * local bare remote — no API, no real host.
   */
  async 'coding-pipeline'(browser) {
    const work = codingRepo()
    const { ctx, page } = await freshPage(browser)
    let worker = null
    try {
      await page.evaluate(() => window.__one.ui.getState().openModal({ type: 'settings' }))
      await page.getByRole('tab', { name: 'Coding worker' }).click()
      const init = await page.locator('.cw-code pre').filter({ hasText: 'init --workspace' }).first().textContent()
      worker = await startCodingWorker(work, /--workspace (\S+)/.exec(init)[1])
      const port = page.getByLabel('Port', { exact: true })
      await port.fill(String(WORKER_PORT))
      await port.press('Enter')
      await page.getByRole('switch', { name: 'Connect to a coding worker on this computer' }).click()
      await page.getByTestId('coding-conn').filter({ hasText: 'Connected' }).waitFor({ timeout: 20_000 })
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'detached' })
      await page.evaluate(() => (window.location.hash = '#/coding'))
      await page.getByTestId('coding-new').click()
      await page.getByTestId('coding-new-title').fill('Show the login error under the field')
      await page.getByTestId('coding-new-repo').fill('website')
      await page.getByTestId('coding-new-goal').fill('A wrong password fails silently. Name the field and say what is wrong. FAKE:DEMO')
      await page.getByTestId('coding-new-criteria').fill('The message names the field\nShort passwords are explained')
      await page.getByTestId('coding-create').click()
      const panel = page.getByTestId('coding-panel')
      await panel.waitFor()
      await page.getByTestId('coding-approve').click({ timeout: 30_000 })
      await panel.locator('.ctk-code', { hasText: /Review$/ }).waitFor({ timeout: 60_000 })
      await page.getByTestId('coding-tab-diff').click()
      await page.locator('.cd-row--add').first().waitFor()
      await scrollToTop(panel, 28)
      await rest(page)
      await save(page, 'coding-pipeline', await boxOf(panel, 20))
    } finally {
      worker?.kill('SIGTERM')
      await ctx.close()
      rmSync(work.root, { recursive: true, force: true })
    }
  },

  /** Workspace settings → People: the plate, the rail, everyone with where they are used, Sam about to merge into Sam Rivera. */
  async 'workspace-settings'(browser) {
    const { ctx, page } = await freshPage(browser)
    // a page that @mentions Sam, so the merge has rows and a mention to carry over
    const sam = await page.evaluate(() => window.__one.workspace.getState().people.find((p) => p.name === 'Sam')?.id)
    await createPage(page, 'Launch checklist', doc({ type: 'paragraph', content: [{ type: 'text', text: 'Ask ' }, { type: 'mention', attrs: { id: sam, label: 'Sam', kind: 'person' } }, { type: 'text', text: ' for the release notes.' }] }))
    await page.evaluate(() => {
      const s = window.__one.workspace.getState()
      s.updateSettings({ workspaceName: 'North Star' })
      s.addPerson('Grace Hopper')
      s.addPerson('Sam Rivera')
    })
    await page.evaluate(() => (window.location.hash = '#/workspace/people'))
    const main = page.getByTestId('workspace-page')
    await main.waitFor()
    const row = (name) => page.getByTestId('ws-person').filter({ has: page.locator('.tm-row__name > span:first-child', { hasText: new RegExp(`^${name}$`) }) })
    await row('Alex').getByTestId('ws-use').click()
    await row('Sam').getByRole('button', { name: 'Actions for Sam' }).click()
    await page.getByRole('menuitem', { name: 'Merge into' }).click()
    await page.getByRole('menuitem', { name: 'Sam Rivera', exact: true }).click()
    await row('Sam').locator('.tm-confirm').waitFor()
    await rest(page)
    const left = Math.round((await page.locator('.sb').first().boundingBox())?.width ?? 0) + 1
    const end = await boxOf(row('Mira'))
    await save(page, 'workspace-settings', { x: left, y: 60, width: W - left, height: Math.round(end.y + end.height + 1 - 60) })
  },

  /**
   * Building blocks: the own type "IBAN" in #/kit — the index of types, its display with preview, its validate
   * script in the One Script editor tried on a row (refused). Everything through the store.
   */
  async 'building-blocks'(browser) {
    const { ctx, page } = await freshPage(browser)
    const dbId = await page.evaluate(() => {
      const s = window.__one.workspace.getState()
      const st = () => window.__one.workspace.getState()
      s.upsertList({ id: 'lights', name: 'Traffic light', items: [{ id: 'g', name: 'Green', color: 'green' }, { id: 'y', name: 'Yellow', color: 'yellow' }, { id: 'r', name: 'Red', color: 'red' }], createdAt: 1, updatedAt: 1 })
      s.upsertList({ id: 'states', name: 'Federal states', items: ['Bayern', 'Berlin', 'Hamburg', 'Hessen', 'Sachsen'].map((name, i) => ({ id: `s${i}`, name, color: ['blue', 'red', 'pink', 'yellow', 'green'][i] })), createdAt: 2, updatedAt: 2 })
      s.upsertPropType({
        id: 'iban',
        name: 'IBAN',
        base: 'text',
        icon: { type: 'lucide', value: 'landmark', color: 'blue' },
        description: 'A bank account — checked when typed, shown in groups of four.',
        display: { style: 'badge', color: 'blue' },
        scripts: {
          validate: '# A valid IBAN: 15–34 characters, check digits mod 97 = 1\nlet s = upper(replace(value, " ", ""))\nlet answer = true\nif value and (len(s) < 15 or len(s) > 34) {\n  answer = "Not a valid IBAN"\n}\nanswer',
          format: '# Upper case in groups of four\nlet s = upper(replace(text(value), " ", ""))\nlet out = ""\nlet i = 0\nwhile i < len(s) {\n  out = out + slice(s, i, i + 4) + " "\n  i = i + 4\n}\ntrim(out)',
        },
        createdAt: 1,
        updatedAt: 1,
      })
      s.upsertPropType({ id: 'health', name: 'Health', base: 'select', listId: 'lights', display: { style: 'led', color: 'green' }, scripts: { value: 'let n = row.Score\nlet light = null\nif n != null {\n  light = "Green"\n  if n < 70 { light = "Yellow" }\n  if n < 40 { light = "Red" }\n}\nlight' }, createdAt: 2, updatedAt: 2 })
      s.upsertPropType({ id: 'eur', name: 'Revenue', base: 'number', numberFormat: 'comma', display: { suffix: '€', style: 'badge', color: 'green' }, createdAt: 3, updatedAt: 3 })
      const db = s.createDatabase({ title: 'Accounts', parentId: null })
      const iban = s.addProperty(db, { type: 'text', name: 'IBAN', custom: 'iban' })
      const health = s.addProperty(db, { type: 'select', name: 'Health', custom: 'health', listId: 'lights', options: st().kit.lists.lights.items })
      const score = s.addProperty(db, { type: 'number', name: 'Score' })
      const state = s.addProperty(db, { type: 'select', name: 'State', listId: 'states', options: st().kit.lists.states.items })
      const eur = s.addProperty(db, { type: 'number', name: 'Revenue', custom: 'eur', numberFormat: 'comma' })
      const d = st().databases[db]
      const title = d.properties.find((p) => p.type === 'title').id
      s.updateView(db, d.views[0].id, { visibleProperties: [title, iban, health, score, state, eur] })
      const rows = [['ACME GmbH', 82, 'de89370400440532013000', 's0', 12500], ['Nordwind AG', 55, 'DE02120300000000202051', 's2', 4800], ['Bergbau KG', 31, 'de44500105175407324931', 's4', 990], ['Kontor 7', 91, 'DE75512108001245126199', 's1', 22000], ['Lindenhof eG', 64, 'de12500105170648489890', 's3', 7300]]
      for (const [t, sc, ib, stv, a] of rows) s.createRow(db, { title: t, properties: { [score]: sc, [iban]: ib, [state]: stv, [eur]: a } })
      return db
    })
    // the database first: the value script fills Health (the cells show the formatted IBANs)
    await openPage(page, dbId)
    await page.locator('.kt-val__led').nth(4).waitFor({ timeout: 20_000 })
    // the type: its display and its validate script, tried on a row
    await page.evaluate(() => (window.location.hash = '#/kit/types/iban'))
    const editor = page.getByTestId('kt-type-editor')
    await editor.waitFor()
    await page.getByTestId('kt-binding-validate').click()
    await page.getByTestId('kt-test-value').fill('DE00 1234')
    await page.getByTestId('kt-test-run').click()
    await page.getByTestId('kt-test-result').waitFor()
    await scrollToTop(page.locator('.kt-detail .kt-sec').nth(1), 16)
    await rest(page)
    const detail = await boxOf(page.locator('.kt-detail'))
    const result = await boxOf(page.getByTestId('kt-test-result'))
    const top = (await boxOf(page.locator('.kt-detail .kt-sec').nth(1))).y - 10
    await save(page, 'building-blocks', { x: detail.x - 28, y: top, width: detail.width + 56, height: result.y + result.height + 24 - top })
    await ctx.close()
  },

  /** A wide Mermaid flowchart open large at 125 %: the zoom keys and Download SVG on top, the minimap with its frame. */
  async 'diagram-viewer'(browser) {
    const flow = [
      'flowchart LR',
      '  A[Request in] --> B{Triage}',
      '  B -->|Bug| C[Reproduce]',
      '  B -->|Feature| D[Scope]',
      '  B -->|Question| E[Answer in thread]',
      '  C --> F[Write failing test]',
      '  F --> G[Fix]',
      '  G --> H[Code review]',
      '  D --> I[Design spec]',
      '  I --> J[Estimate]',
      '  J --> K{Fits the sprint?}',
      '  K -->|Yes| L[Build]',
      '  K -->|No| M[Backlog]',
      '  L --> H',
      '  H --> N{Approved?}',
      '  N -->|Changes| G',
      '  N -->|Yes| O[Merge]',
      '  O --> P[CI pipeline]',
      '  P --> Q{Green?}',
      '  Q -->|No| R[Fix the build]',
      '  R --> P',
      '  Q -->|Yes| S[Staging deploy]',
      '  S --> T[Smoke tests]',
      '  T --> U[QA sign-off]',
      '  U --> V[Release notes]',
      '  V --> W[Production deploy]',
      '  W --> X[Monitor 24 h]',
      '  X --> Y{Incidents?}',
      '  Y -->|Yes| Z[Rollback]',
      '  Y -->|No| AA[Close ticket]',
      '  Z --> C',
      '  E --> AA',
    ].join('\n')
    const { ctx, page } = await freshPage(browser)
    const id = await createPage(page, 'Release process', doc(para('How a request becomes a release — from triage to the closed ticket.'), { type: 'mermaid', attrs: { code: flow } }), { icon: { type: 'asset', value: 'binder' } })
    await openPage(page, id)
    await page.locator('#main .mermaid-view__svg svg').waitFor({ timeout: 20_000 })
    await page.getByTestId('mermaid-open').click()
    await page.locator('.dv__content svg').waitFor({ timeout: 20_000 })
    await page.waitForTimeout(400)
    // 100 %, one step in (125 %), then a click on the minimap brings the review loop into view
    await page.getByTestId('viewer-stage').focus()
    await page.keyboard.press('1')
    await page.keyboard.press('+')
    await page.waitForTimeout(400)
    const map = await boxOf(page.locator('.dv-mini__map'))
    await page.mouse.click(map.x + map.width * 0.36, map.y + map.height * 0.5)
    await rest(page)
    await save(page, 'diagram-viewer', await boxOf(page.locator('.modal.dv-modal'), 16))
  },

  /** A free board: lanes with cards of three record types (Lead, Bug, Idea) and a plain card — each with its own fields. */
  async 'free-board'(browser) {
    const { ctx, page } = await freshPage(browser)
    const dbId = await page.evaluate(() => {
      const W = window.__one.workspace
      const s = W.getState()
      s.upsertRecordType({ id: 'lead', name: 'Lead', color: 'orange', properties: [{ id: 'mail', name: 'Email', type: 'email' }, { id: 'value', name: 'Deal value', type: 'number', numberFormat: 'euro' }, { id: 'stage', name: 'Stage', type: 'select', options: [{ id: 'warm', name: 'Warm', color: 'orange' }, { id: 'cold', name: 'Cold', color: 'blue' }] }], createdAt: 0, updatedAt: 0 })
      s.upsertRecordType({ id: 'bug', name: 'Bug', color: 'red', properties: [{ id: 'sev', name: 'Severity', type: 'select', options: [{ id: 'p1', name: 'P1', color: 'red' }, { id: 'p2', name: 'P2', color: 'yellow' }] }, { id: 'area', name: 'Area', type: 'text' }], createdAt: 0, updatedAt: 0 })
      s.upsertRecordType({ id: 'idea', name: 'Idea', color: 'green', properties: [{ id: 'votes', name: 'Votes', type: 'number' }], createdAt: 0, updatedAt: 0 })
      const lane = { id: 'fbl', name: 'Lane', type: 'select', options: [{ id: 'l1', name: 'Inbox', color: 'gray' }, { id: 'l2', name: 'Doing', color: 'orange' }, { id: 'l3', name: 'Done', color: 'green' }] }
      const view = { id: 'fbv', name: 'Free board', type: 'board', free: true, groupBy: 'fbl', filter: null, sorts: [], visibleProperties: [], openIn: 'peek', hiddenGroups: [] }
      const dbId = s.createDatabase({ title: 'Launch board', parentId: null, icon: { type: 'asset', value: 'binder' }, properties: [{ id: 'fbt', name: 'Name', type: 'title' }, lane], views: [view] })
      const st = () => W.getState()
      for (const t of ['lead', 'bug', 'idea']) st().attachRecordType(dbId, t)
      const prop = (name) => st().databases[dbId].properties.find((x) => x.name === name).id
      const add = (title, laneId, type, vals) => {
        const id = st().createRow(dbId, { title, properties: { fbl: laneId } })
        if (type) st().setRecordType(id, type)
        for (const [k, v] of Object.entries(vals)) st().setRowProperty(id, prop(k), v)
      }
      add('ACME Corp.', 'l1', 'lead', { Email: 'buy@acme.example', 'Deal value': 12000, Stage: 'warm' })
      add('Login loops on Safari', 'l1', 'bug', { Severity: 'p1', Area: 'Auth' })
      add('Dark mode for exports', 'l1', 'idea', { Votes: 14 })
      add('Globex', 'l2', 'lead', { Email: 'ops@globex.example', 'Deal value': 4800, Stage: 'cold' })
      add('Slow table scroll', 'l2', 'bug', { Severity: 'p2', Area: 'Tables' })
      add('Write the launch post', 'l2', null, {})
      add('Initech', 'l3', 'lead', { Email: 'hi@initech.example', 'Deal value': 900 })
      add('Keyboard moves for cards', 'l3', 'idea', { Votes: 9 })
      return dbId
    })
    await openPage(page, dbId)
    const board = page.locator('#main .dbb-wrap')
    await board.locator('.fb-card__type').first().waitFor()
    await rest(page)
    const tabs = await boxOf(page.locator('#main .db-bar'))
    const b = await boxOf(board)
    const left = Math.round((await page.locator('.sb').first().boundingBox())?.width ?? 0) + 1
    const top = Math.max(0, Math.round(tabs.y - 24))
    // above the status bar
    await save(page, 'free-board', { x: left, y: top, width: W - left, height: Math.min(H - 34 - top, Math.round(b.y + b.height + 16 - top)) })
    await ctx.close()
  },

  /**
   * Settings → Coding worker, the three steps done: the worker downloaded for this workspace (built in the
   * browser with its preset), started from a temp home with three repos (fake Claude Code, a fake browser that
   * only notes the setup page's address), two repos ticked on that page — and the card's live state.
   */
  async 'coding-setup'(browser) {
    const work = codingRepo()
    const home = join(work.root, 'home')
    const repo = (name, files) => {
      const dir = join(home, 'code', name)
      mkdirSync(dir, { recursive: true })
      for (const [n, t] of Object.entries(files)) writeFileSync(join(dir, n), t)
      for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-qm', 'initial'], ['remote', 'add', 'origin', `git@github.com:studio/${name}.git`]]) execFileSync('git', args, { cwd: dir, env: work.env, stdio: 'ignore' })
    }
    repo('website', { 'package.json': '{"scripts":{"test":"vitest run"}}', 'pnpm-lock.yaml': '' })
    repo('api', { 'go.mod': 'module api\n' })
    repo('docs', { 'README.md': '# Docs\n' })
    // how One shows this worker (the setup page keeps it when it writes the file)
    mkdirSync(join(home, '.config', 'one'), { recursive: true })
    writeFileSync(join(home, '.config', 'one', 'worker.json'), JSON.stringify({ name: 'studio-mac', repos: [] }))
    const opened = join(work.root, 'opened.txt')
    const opener = join(work.root, 'open.mjs')
    writeFileSync(opener, `#!${process.execPath}\nimport { appendFileSync } from 'node:fs'\nappendFileSync(${JSON.stringify(opened)}, process.argv[2] + '\\n')\n`)
    chmodSync(opener, 0o755)
    const { ctx, page } = await freshPage(browser)
    let worker = null
    try {
      await page.evaluate(() => window.__one.ui.getState().openModal({ type: 'settings' }))
      await page.getByRole('tab', { name: 'Coding worker' }).click()
      const settings = page.getByTestId('coding-settings')
      const port = page.getByLabel('Port', { exact: true })
      await port.fill(String(WORKER_PORT))
      await port.press('Enter')
      const [download] = await Promise.all([page.waitForEvent('download'), settings.getByTestId('coding-download').click()])
      const file = join(work.root, 'one-worker.mjs')
      await download.saveAs(file)
      worker = spawn(process.execPath, [file], { env: { ...work.env, HOME: home, CLAUDE_BIN: FAKE_CLAUDE, ONE_WORKER_BROWSER: opener }, stdio: ['ignore', 'ignore', 'ignore'] })
      await settings.getByTestId('coding-card-live').filter({ hasText: 'Connected' }).waitFor({ timeout: 20_000 })
      for (let i = 0; i < 100 && !existsSync(opened); i++) await sleep(100)
      const setup = await ctx.newPage()
      setup.on('pageerror', (e) => errors.push(`setup pageerror: ${String(e).slice(0, 200)}`))
      setup.on('console', (m) => m.type() === 'error' && errors.push(`setup console.error: ${m.text().slice(0, 200)}`))
      await setup.goto(readFileSync(opened, 'utf8').split('\n')[0])
      await setup.getByRole('checkbox', { name: 'website' }).check()
      await setup.getByRole('checkbox', { name: 'api' }).check()
      await setup.locator('#save').click()
      await setup.locator('#note.saved').waitFor()
      await setup.close()
      await page.bringToFront()
      await settings.getByTestId('coding-card-live').filter({ hasText: '2 repos' }).waitFor({ timeout: 10_000 })
      // the tab from its top: the lead, then the card
      await scrollToTop(settings, 0)
      await rest(page)
      await save(page, 'coding-setup', await boxOf(page.getByRole('dialog', { name: 'Settings' })))
      // the link looked for the worker between the download and its start: expected, not an error
      errors = errors.filter((e) => !/WebSocket connection to 'ws:\/\/127\.0\.0\.1/.test(e))
    } finally {
      worker?.kill('SIGTERM')
      await ctx.close()
      rmSync(work.root, { recursive: true, force: true })
    }
  },

  /**
   * /generate image on a page: an image service (a made-up MCP server, its job polled by Claude), four results
   * as cards — previewed on a click, two picked for "Insert selected". The MCP blocks are streamed by a mock,
   * the pictures come from a made-up host (the repository's own covers); nothing leaves the machine.
   */
  async 'mcp-media'(browser) {
    const MEDIA = 'https://cdn.studio.test'
    const covers = ['dunes', 'grain', 'paper-folds', 'concrete'].map((n) => readFileSync(`public/assets/covers/${n}.webp`))
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    // taller than the other shots: the four results fit in the menu
    const viewport = { width: W, height: 1180 }
    const { ctx, page } = await freshPage(browser, {
      viewport,
      setup: async (ctx) => {
        // the generation request streams the MCP calls (registered after mockClaude, so it answers first)
        await ctx.route('https://api.anthropic.com/**', async (route) => {
          const req = route.request()
          if (req.method() !== 'POST' || !/"stream"\s*:\s*true/.test(req.postData() || '') || !/"mcp_servers"/.test(req.postData() || '')) return route.fallback()
          await sleep(500)
          const images = covers.map((_, i) => ({ url: `${MEDIA}/jobs/7f3/v${i + 1}.webp`, width: 1600, height: 900 }))
          await route.fulfill({
            status: 200,
            headers: { ...cors, 'content-type': 'text/event-stream' },
            body: sseTurn([
              { type: 'mcp_tool_use', id: 'mcptoolu_cl1', server: 'studio', name: 'generate_image', input: { prompt: 'dunes at dusk, wide, quiet light', aspect_ratio: '16:9', num_images: 4 } },
              { type: 'mcp_tool_result', id: 'mcptoolu_cl1', text: JSON.stringify({ job_id: 'job-7f3', status: 'queued' }) },
              { type: 'mcp_tool_use', id: 'mcptoolu_cl2', server: 'studio', name: 'get_job', input: { job_id: 'job-7f3' } },
              { type: 'mcp_tool_result', id: 'mcptoolu_cl2', text: JSON.stringify({ status: 'completed', output: { images } }) },
              { type: 'text', text: '4 results.' },
            ]),
          })
        })
        await ctx.route(`${MEDIA}/**`, (route) => {
          const n = Number(/v(\d)\.webp$/.exec(route.request().url())?.[1] ?? 0)
          return n ? route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'image/webp' }, body: covers[n - 1] }) : route.fulfill({ status: 404, headers: cors, body: '' })
        })
      },
    })
    await page.evaluate(() =>
      window.__one.workspace.getState().updateSettings({
        mcpServers: [{ id: 'srvstudio1', name: 'studio', url: 'https://mcp.studio.test/mcp', token: 'studio-demo-token', enabled: true, prompt: 'Makes images and short videos; jobs are polled with get_job.', promptSource: 'auto', tools: ['generate_image', 'generate_video', 'get_job'], checkedAt: Date.now() - 5 * 60_000, codeword: 'studio' }],
      }),
    )
    const id = await createPage(
      page,
      'Launch moodboard',
      doc(para('Pictures for the launch page — warm, quiet, lots of room for the headline.'), para(''), h(2, 'Headline options'), para('Notes that write themselves.'), para('One page for everything your team knows.'), para('Paper, ink, and nothing in between.')),
      { icon: { type: 'asset', value: 'megaphone' } },
    )
    await openPage(page, id)
    const ed = page.locator('#main .ProseMirror').first()
    await ed.locator('p').nth(1).click()
    await page.keyboard.type('/generate image')
    await page.waitForTimeout(400)
    await page.keyboard.press('Enter')
    const setup = page.getByTestId('gen-setup')
    await setup.waitFor()
    await setup.getByTestId('gen-prompt').fill('dunes at dusk, wide, quiet light')
    await setup.getByRole('radio', { name: '16:9' }).click()
    await setup.getByRole('radio', { name: '4', exact: true }).click()
    await setup.getByTestId('gen-run').click()
    const panel = page.getByRole('dialog', { name: 'Ask Claude' })
    await panel.getByTestId('media-card').nth(3).waitFor({ timeout: 20_000 })
    await panel.getByTestId('media-preview-all').click()
    await panel.locator('[data-testid="media-card"][data-preview] img').nth(3).waitFor()
    for (const n of [1, 3]) await panel.locator(`[data-testid="media-card"][data-url$="v${n}.webp"]`).getByRole('checkbox').check()
    await page.mouse.move(W - 5, viewport.height - 60)
    await page.waitForTimeout(700)
    const left = Math.round((await page.locator('.sb').first().boundingBox())?.width ?? 0) + 1
    const box = union(await boxOf(page.locator('#main .pv-title').first()), await boxOf(panel))
    const top = Math.max(0, Math.round(box.y - 40))
    // down to the menu's foot, never into the status bar
    const floor = Math.round((await page.locator('footer.status').boundingBox())?.y ?? viewport.height) - 1
    await save(page, 'mcp-media', { x: left, y: top, width: W - left, height: Math.min(floor, Math.round(box.y + box.height + 28)) - top })
    await ctx.close()
  },

  /**
   * Text size + panels that fit, side by side at text size L: Settings → Appearance with the stepped fader,
   * and the colour-rules panel of Projects made bigger with its corner grip (focused: the orange hatch).
   */
  async 'text-size'(browser) {
    const { ctx, page } = await freshPage(browser, { setup: (ctx) => ctx.addInitScript(() => localStorage.setItem('one.textScale', '3')) })
    // the fader: Settings → Appearance
    await page.evaluate(() => window.__one.ui.getState().openModal({ type: 'settings', tab: 'appearance' }))
    const fader = page.getByTestId('text-size')
    await fader.waitFor()
    await rest(page)
    const pane = await boxOf(page.locator('.st__body'))
    const f = await boxOf(fader)
    const a = `${TMP}/text-size-fader.png`
    await page.screenshot({ path: a, clip: { x: pane.x, y: pane.y, width: pane.width, height: Math.round(f.y + f.height + 24 - pane.y) } })
    await page.keyboard.press('Escape')
    // the colour rules: the seeded one plus a rule with two conditions; the panel made bigger by keys
    await openPage(page, 'Projects')
    const db = page.locator('#main section.db').first()
    await db.getByRole('tab', { name: /All projects/ }).click()
    await db.getByRole('toolbar', { name: 'Database toolbar' }).getByRole('button', { name: 'More' }).click()
    await page.getByRole('menuitem', { name: /^Colour rules/ }).click()
    const panel = page.locator('.db-rcpanel')
    for (const props of [['Priority', 'Owner']]) {
      await panel.getByRole('button', { name: 'Add colour rule' }).click()
      const rule = panel.locator('.db-rcrule').last()
      for (const p of props) {
        await rule.getByRole('button', { name: 'Add condition' }).click()
        await page.getByRole('menuitem', { name: p }).first().click()
      }
    }
    await page.mouse.move(W + 40, H + 40)
    const grip = page.getByRole('button', { name: 'Resize' })
    await grip.focus()
    for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Shift+ArrowDown')
    await page.waitForTimeout(400)
    const p = await boxOf(panel, 2)
    const b = `${TMP}/text-size-panel.png`
    await page.screenshot({ path: b, clip: p })
    await saveSideBySide('text-size', [a, b])
    await ctx.close()
  },

  /**
   * The industrial toggle switches: the page menu (⋯) of Welcome to One with Full width on and the other toggles off,
   * once in Paper and once in Carbon, side by side.
   */
  async switches(browser) {
    const { ctx, page } = await freshPage(browser)
    const id = await openPage(page, 'Welcome to One')
    await page.evaluate((id) => window.__one.workspace.getState().updatePage(id, { settings: { ...window.__one.workspace.getState().pages[id].settings, fullWidth: true } }), id)
    const shots = []
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => window.__one.workspace.getState().updateSettings({ theme }), theme)
      await page.waitForTimeout(300)
      await page.getByRole('button', { name: 'Page options' }).click()
      const menu = page.getByRole('menu', { name: 'Page options' })
      await menu.locator('.pm-toggle').first().waitFor()
      await page.mouse.move(W - 10, H - 10)
      await rest(page)
      // the toggle rows only, so the levers are big enough to see
      const m = await boxOf(menu)
      const rows = menu.locator('.pm-toggle')
      const first = await rows.first().boundingBox()
      const last = await rows.last().boundingBox()
      const png = `${TMP}/switches-${theme}.png`
      await page.screenshot({ path: png, clip: { x: m.x, y: Math.max(0, first.y - 10), width: m.width, height: Math.round(last.y + last.height + 10 - first.y + 10) } })
      shots.push(png)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
    }
    await saveSideBySide('switches', shots)
    await ctx.close()
  },

  /** Workspace settings → Look with the Blueprint preset picked (the whole tab previews it before Save). */
  async look(browser) {
    const { ctx, page } = await freshPage(browser)
    await page.evaluate(() => (window.location.hash = '#/workspace/look'))
    const section = page.getByTestId('look-section')
    await section.waitFor()
    await page.getByTestId('look-preset-blueprint').click()
    await page.getByTestId('look-bar').waitFor()
    await page.mouse.move(W - 10, 10)
    await rest(page)
    const colours = await page.getByTestId('look-signal').boundingBox()
    await save(page, 'look', { x: 0, y: 0, width: W, height: Math.min(H, Math.round(colours.y + colours.height + 16)) })
    await ctx.close()
  },

  /**
   * ⌘K with three filters as chips (In: Projects · not Status: Done · Priority: High) and the entries they find,
   * each with the values it was found by; the sidebar's RECENT | FREQUENT section on FREQUENT behind it. The visit
   * counts are this device's own list (localStorage one.shell.visits:local:local, as frecency.ts stores it): a week of
   * use written in before the app starts, so FREQUENT has something to rank.
   */
  async search(browser) {
    const { ctx, page } = await freshPage(browser)
    const ids = await page.evaluate(() => {
      const pages = Object.values(window.__one.workspace.getState().pages)
      const id = (title) => pages.find((p) => p.title === title && !p.trashed)?.id
      return { projects: id('Projects'), weekly: id('Weekly sync — notes'), budget: id('Budget 2026'), relaunch: id('Website relaunch'), voice: id('Brand voice'), welcome: id('Welcome to One') }
    })
    // [score, last counted visit, visits] per page — the stored form of frecency.ts
    const now = Date.now()
    const visits = { [ids.projects]: [7.4, now - 2 * HOUR, 11], [ids.weekly]: [5.1, now - 20 * HOUR, 7], [ids.relaunch]: [3.6, now - 5 * HOUR, 5], [ids.budget]: [2.8, now - 2 * DAY_MS, 4], [ids.voice]: [1.9, now - 3 * DAY_MS, 3] }
    await page.evaluate((e) => {
      localStorage.setItem('one.shell.visits:local:local', JSON.stringify({ v: 1, e }))
      localStorage.setItem('one.shell.visited', JSON.stringify({ tab: 'frequent', open: true }))
    }, visits)
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForFunction(() => !!window.__one)
    await openPage(page, ids.welcome)
    await page.getByTestId('visited-section').getByRole('tab', { name: 'Frequent' }).waitFor()
    await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined))
    await page.keyboard.press('Control+k')
    const pal = page.getByRole('dialog', { name: 'Command palette' })
    await pal.getByRole('combobox').waitFor()
    await page.keyboard.type('in:projects -status:done priority:high ', { delay: 12 })
    await pal.locator('.pal-chips [role="listitem"]').nth(2).waitFor()
    await pal.locator('.pal-item--page').first().waitFor()
    await page.waitForTimeout(500)
    await page.mouse.move(W - 10, H - 10)
    await page.waitForTimeout(300)
    // the palette and the sidebar down to the end of FREQUENT (the page below stays out)
    const box = union(await boxOf(pal), await boxOf(page.getByTestId('visited-section')))
    await save(page, 'search', { x: 0, y: 0, width: W, height: Math.min(H, Math.round(box.y + box.height + 4)) })
    await ctx.close()
  },

  /**
   * The AI terminal driving the coding pipeline: /pipelines (the task waiting at Approve plan first, the worker
   * connected), then a task in plain words → list_pipelines, create_task with start: true → the staged card shows the
   * whole task page as Claude Code reads it and STARTS WORKER, held out of "Apply all". The repository's own worker
   * with the fake Claude Code CLI (nothing runs: the gate waits for a person, the new task is only staged); Claude
   * mocked.
   */
  async 'terminal-pipelines'(browser) {
    const port = 47379
    const turns = [
      () => sseTurn([{ type: 'thinking', text: 'One coding task in website, started right away as asked. First the project and the repos the worker announced.' }, { type: 'tool_use', id: 'toolu_lp', name: 'list_pipelines', input: { kind: 'coding' } }]),
      () =>
        sseTurn([
          {
            type: 'tool_use',
            id: 'toolu_ct',
            name: 'create_task',
            input: {
              title: 'Export invoices as CSV',
              repo: 'website',
              goal: 'Finance wants the invoices of a month as one CSV file for the tax adviser.\n\nAdd **Export CSV** to the invoices list: one row per invoice — number, date, customer, net, VAT, gross. Use the filters that are set on the list.',
              criteria: ['The file opens in Excel and Numbers with umlauts intact', 'Amounts use a dot as decimal separator', 'An empty month gives a file with the header row only'],
              priority: 'high',
              start: true,
            },
          },
        ]),
      () => sseTurn([{ type: 'text', text: 'Staged **Export invoices as CSV** for website — it starts in *Ready* once you apply it on its own.' }]),
    ]
    const work = codingRepo()
    // tall: the dock holds the readout, the task and the whole staged card
    const { ctx, page } = await freshPage(browser, { claude: { turns }, viewport: { width: W, height: 1560 } })
    let worker = null
    try {
      await page.evaluate(() => window.__one.ui.getState().openModal({ type: 'settings' }))
      await page.getByRole('tab', { name: 'Coding worker' }).click()
      const init = await page.locator('.cw-code pre').filter({ hasText: 'init --workspace' }).first().textContent()
      worker = await startCodingWorker(work, /--workspace (\S+)/.exec(init)[1], {}, {}, port)
      const portField = page.getByLabel('Port', { exact: true })
      await portField.fill(String(port))
      await portField.press('Enter')
      await page.getByRole('switch', { name: 'Connect to a coding worker on this computer' }).click()
      await page.getByTestId('coding-conn').filter({ hasText: 'Connected' }).waitFor({ timeout: 20_000 })
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'detached' })
      await page.evaluate(() => (window.location.hash = '#/coding'))
      await page.getByTestId('coding-setup').click()
      await page.getByText('Coding database created.').waitFor({ state: 'detached', timeout: 20_000 })
      // two tasks of the person's own: one waits at the plan gate, one in the backlog
      await page.evaluate(() => {
        const s = window.__one.workspace.getState()
        const db = Object.values(s.databases).find((d) => d.system === 'coding')
        const prop = (n) => db.properties.find((p) => p.name === n)
        let repo = prop('Repo')
        if (!(repo.options ?? []).some((o) => o.name === 'website')) s.updateProperty(db.id, repo.id, { options: [...(repo.options ?? []), { id: 'opt-website', name: 'website', color: 'blue' }] })
        repo = window.__one.workspace.getState().databases[db.id].properties.find((p) => p.name === 'Repo')
        const stage = (n) => prop('Stage').options.find((o) => o.name === n).id
        const web = repo.options.find((o) => o.name === 'website').id
        const p = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
        s.createRow(db.id, { title: 'Show the login error under the field', properties: { [prop('Stage').id]: stage('Approve plan'), [repo.id]: web }, content: { type: 'doc', content: [p('A wrong password fails silently. Name the field and say what is wrong.'), { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Plan' }] }, p('1. Return the field name from login(). 2. Show the message under the field. 3. Test both cases.')] } })
        s.createRow(db.id, { title: 'Dark mode for the settings page', properties: { [prop('Stage').id]: stage('Backlog'), [repo.id]: web }, content: { type: 'doc', content: [p('The settings page ignores Carbon. Use the theme tokens.')] } })
      })
      await page.waitForTimeout(600)
      await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined))
      await page.keyboard.press('Control+j')
      const term = page.getByRole('region', { name: 'AI terminal' })
      await term.waitFor()
      const prompt = term.getByRole('textbox', { name: 'Task for the agent' })
      await prompt.fill('/pipelines')
      await prompt.press('Enter')
      await term.getByTestId('term-pipelines').locator('.term-pipe').nth(1).waitFor()
      await prompt.fill('Create a task to export the invoices as CSV in the website repo and start it')
      await prompt.press('Enter')
      await term.locator('.term-head__status').filter({ hasText: 'Done' }).waitFor({ timeout: 30_000 })
      await term.locator('.term-changes li[data-i="0"]').waitFor()
      await page.waitForTimeout(800)
      // a dock just tall enough for the readout, the task and the whole staged card (⌥↑ steps)
      await prompt.focus()
      const scroll = term.locator('.term-scroll')
      for (let i = 0; i < 12 && (await scroll.evaluate((el) => el.scrollHeight > el.clientHeight + 2)); i++) {
        await page.keyboard.press('Alt+ArrowUp')
        await page.waitForTimeout(150)
      }
      await page.waitForTimeout(400)
      const box = await term.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.wheel(0, -6000)
      await page.waitForTimeout(500)
      await rest(page)
      await save(page, 'terminal-pipelines', await boxOf(term))
    } finally {
      worker?.kill('SIGTERM')
      await ctx.close()
      rmSync(work.root, { recursive: true, force: true })
    }
  },

  /**
   * The cloud worker: a team workspace on the repository's own team server (started here, see startTeamServer),
   * Settings → Coding worker → Where the worker runs: Cloud — "Download one-worker-cloud.mjs", that file started on
   * "another computer" (its own home folder, the fake Claude Code CLI) dials the server's relay, and the card reads
   * Connected · build-box · 1 repo · via cloud. Signed in through the server's dev mailbox; Claude mocked; nothing
   * leaves this machine.
   */
  async 'cloud-worker'(browser) {
    const work = codingRepo()
    let server = null
    let worker = null
    let ctx = null
    try {
      server = await startTeamServer(join(work.root, 'server-data'))
      const { origin } = server
      ctx = await browser.newContext({ viewport: { width: W, height: H + 260 }, deviceScaleFactor: SCALE, colorScheme: 'light', locale: 'en-US', timezoneId: 'Europe/Berlin', serviceWorkers: 'block', acceptDownloads: true })
      await mockClaude(ctx)
      const page = await ctx.newPage()
      page.setDefaultNavigationTimeout(60_000)
      page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`))
      // a relay socket the browser closes on its way is its own network log line, not the app's
      page.on('console', (m) => m.type() === 'error' && !/WebSocket connection to .*\/coding\//.test(m.text()) && errors.push(`console.error: ${m.text().slice(0, 200)}`))
      // (the team app keeps its sockets and polls going: wait for what is needed, never for network idle)
      await page.goto(`${origin}/app/?e2e`, { waitUntil: 'load' })
      await page.evaluate(() => {
        localStorage.setItem('one.help.seen-changelog', '9999-12-31-shots')
        localStorage.setItem('one.tour', '{"off":true}')
      })
      // sign in with the server's own magic link (its dev mailbox), create the team workspace
      const asked = await page.evaluate(async (email) => (await fetch('/api/auth/request', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, redirect: '/app/' }) })).status, ACCOUNT)
      if (asked >= 300) throw new Error(`sign-in request: HTTP ${asked}`)
      let link = ''
      for (let i = 0; i < 50 && !link; i++) {
        const list = await (await fetch(`http://127.0.0.1:${SERVER_PORT}/api/dev/mailbox?to=${encodeURIComponent(ACCOUNT)}`)).json()
        link = list[0]?.link ?? ''
        if (!link) await sleep(100)
      }
      if (!link) throw new Error('no sign-in mail')
      await page.goto(link, { waitUntil: 'load' })
      await page.waitForFunction(async () => (await fetch('/api/me', { credentials: 'same-origin' })).ok, null, { timeout: 20_000, polling: 300 })
      const wsId = await page.evaluate(async () => {
        const res = await fetch('/api/workspaces', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Acme Studio' }) })
        return (await res.json()).id
      })
      await page.goto(`${origin}/app/?e2e&w=${wsId}`, { waitUntil: 'load' })
      await page.waitForFunction(() => !!window.__one)
      await page.waitForFunction(() => window.__one.cloud.useCloud.getState().status === 'online', null, { timeout: 30_000 })
      await page.evaluate(() => window.__one.workspace.getState().updateSettings({ theme: 'light', language: 'en', userName: 'Marcel' }))
      await page.waitForTimeout(600)
      // Settings → Coding worker → Cloud → the download, started on that computer
      await page.evaluate(() => window.__one.ui.getState().openModal({ type: 'settings' }))
      await page.getByRole('tab', { name: 'Coding worker' }).click()
      await page.getByTestId('coding-settings').waitFor()
      await page.getByTestId('coding-via-cloud').click()
      await page.getByTestId('coding-cloud-card').waitFor()
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('coding-cloud-download').click()])
      const file = join(work.root, 'one-worker-cloud.mjs')
      await download.saveAs(file)
      worker = await startCloudWorker(file, work)
      await page.getByTestId('coding-conn').filter({ hasText: 'via cloud' }).filter({ hasText: 'Connected' }).waitFor({ timeout: 30_000 })
      await page.waitForTimeout(600)
      await rest(page)
      // two views of the tab, side by side: Local | Cloud with the download, and the live line with the worker panel
      const dialog = page.getByRole('dialog', { name: 'Settings' })
      const via = dialog.locator('section.cw-panel', { has: page.getByTestId('coding-via') })
      const step1 = dialog.locator('.cs-steps > li').first()
      const live = page.getByTestId('coding-cloud-live')
      // the worker panel down to its switch (this headless browser refuses notifications, so the next row says so)
      const allow = dialog.locator('section.cw-panel', { has: page.getByTestId('coding-conn') }).locator('.cw-switch').first()
      const parts = []
      // [name, first, last, space above, space below]: each view ends where its part ends
      for (const [name, first, last, above, below] of [['a', via, step1, 6, 1], ['b', live, allow, 1, 4]]) {
        await scrollToTop(first, 24)
        await rest(page)
        const box = union(await boxOf(first), await boxOf(last))
        const png = `${TMP}/cloud-worker-${name}.png`
        await page.screenshot({ path: png, clip: { x: box.x - 16, y: box.y - above, width: box.width + 32, height: box.height + above + below } })
        parts.push(png)
      }
      await saveSideBySide('cloud-worker', parts, { column: true })
    } finally {
      // both children gone before the next attempt (their ports free again)
      const gone = (child) => new Promise((r) => (child.exitCode !== null || child.signalCode !== null ? r() : (child.once('exit', r), child.kill('SIGTERM'))))
      if (worker) await gone(worker)
      await ctx?.close()
      if (server) await gone(server.child)
      rmSync(work.root, { recursive: true, force: true })
    }
  },

  /** The pipeline editor: Plan open with its Model (Fable), the chips of Plan and Implement (Sonnet) in their rows. */
  async models(browser) {
    const { ctx, page } = await freshPage(browser, { viewport: { width: W, height: H + 160 } })
    await page.evaluate(() => (window.location.hash = '#/coding'))
    await page.getByTestId('coding-setup').click()
    await page.getByTestId('coding-pipeline-open').click()
    const rows = page.getByTestId('coding-pipeline').locator('> li')
    const implement = rows.nth(4)
    await implement.locator('.cpe-more').click()
    await implement.getByTestId('coding-pipeline-model').selectOption('sonnet')
    await implement.locator('.cpe-more').click()
    const plan = rows.nth(2)
    await plan.locator('.cpe-more').click()
    await plan.getByTestId('coding-pipeline-model').selectOption('claude-fable-5-1')
    await plan.getByTestId('coding-pipeline-chip').waitFor()
    // the "Coding database created" toast goes first
    for (const b of await page.locator('.toast__close').all()) await b.click().catch(() => {})
    await page.locator('.toast').first().waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {})
    await rest(page)
    // the stages from Ready to Implement (between their rules), across the whole dialog
    const dialog = await boxOf(page.getByRole('dialog'))
    const from = await rows.nth(1).boundingBox()
    const to = await rows.nth(4).boundingBox()
    await save(page, 'models', { x: dialog.x, y: Math.round(from.y - 1), width: dialog.width, height: Math.round(to.y + to.height + 1 - (from.y - 1)) })
    await ctx.close()
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
    await page.locator('.toast__close').last().click().catch(() => {})
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
    await page.evaluate((guide) => window.__one.workspace.getState().updateSettings({ mcpServers: [{ id: 'srvkb00001', name: 'kb', url: 'https://kb.example.com/mcp', token: '', enabled: true, prompt: guide, promptSource: 'auto', tools: ['kb_search', 'kb_get', 'kb_constraints'], checkedAt: Date.now() - 3 * 60_000, scope: 'own' }] }), KB_GUIDE)
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
