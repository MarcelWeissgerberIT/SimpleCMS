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

const shots = {
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

  /** Settings → Claude AI → MCP servers: a connected knowledge base, its details open. */
  async 'mcp-servers'(browser) {
    const { ctx, page } = await freshPage(browser)
    await page.evaluate((guide) => window.__one.workspace.getState().updateSettings({ mcpServers: [{ id: 'srvkb00001', name: 'atlas', url: 'https://kb.acme.studio/mcp', token: '', enabled: true, prompt: guide, promptSource: 'auto', tools: ['atlas_search', 'atlas_get', 'atlas_constraints'], checkedAt: Date.now() - 3 * 60_000, scope: 'own' }] }), ATLAS_GUIDE)
    await page.evaluate(() => window.__one.ui.getState().openModal({ type: 'settings', tab: 'ai' }))
    const section = page.getByTestId('mcp-servers')
    await section.waitFor()
    // the details: name, codeword, usage prompt, tools
    await section.locator('.mcps-card[data-server="atlas"]').getByRole('button', { name: /ATLAS/ }).click()
    await page.waitForTimeout(400)
    await scrollToTop(section.locator('h3, h2').filter({ hasText: 'MCP servers' }).first(), 70)
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
