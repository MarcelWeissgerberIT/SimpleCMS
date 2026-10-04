#!/usr/bin/env node
/**
 * Records the app scenes for the promo video as 1920×1080 / 30 fps clips
 * (.shots/promo/scenes/<name>.mp4, plus <name>.json with the times of the scene's marks).
 *
 *   BASE_PATH=/ npx vite build --outDir <dist> && npx vite preview --host 127.0.0.1 --port 4740 --strictPort --outDir <dist> &
 *   node scripts/promo/record-scenes.mjs http://127.0.0.1:4740 [scene …]
 *
 * The `team` scene needs a local team-cloud server serving the same build (DEV_MODE magic links,
 * a FAKE data key — as playwright.cloud.config.ts does), at PROMO_CLOUD (default http://127.0.0.1:4745):
 *
 *   PORT=4745 HOST=127.0.0.1 DATA_DIR=<tmp> APP_DIR=<dist> PUBLIC_URL=http://127.0.0.1:4745 DEV_MODE=1 \
 *     AUTH_IP_LIMIT=1000 SIGNUP=open DATA_KEY=<32 fake bytes, base64> node server/dist/index.js
 *
 * With PROMO_LOCAL set (a build preview, e.g. http://127.0.0.1:4740) the pages are loaded under the
 * public URL and routed to that preview, so links show the real address.
 *
 * A fake cursor (with click ripple) is injected so viewers can follow the interactions. Nothing
 * leaves the machine: Claude (api.anthropic.com), the webhook endpoint and GitHub (api.github.com) are
 * mocked, the MCP scene drives the real bridge (public/mcp/one-mcp.mjs) from a local MCP client, and
 * speech recognition is a stand-in.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { zipSync, strToU8 } from 'fflate'

const PUBLIC = 'https://getonecms.com'
const LOCAL = process.env.PROMO_LOCAL?.replace(/\/$/, '')
const BASE = LOCAL ? PUBLIC : (process.argv[2] || 'http://127.0.0.1:4740').replace(/\/$/, '')
const CLOUD = (process.env.PROMO_CLOUD || 'http://127.0.0.1:4745').replace(/\/$/, '')
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

/** A Web Speech API stand-in (as tests/e2e/meeting-notes.spec.ts): window.__speech.say(text, final). */
function fakeSpeech() {
  const speech = { current: null }
  class FakeRecognition {
    lang = ''
    continuous = false
    interimResults = false
    maxAlternatives = 1
    results = []
    running = false
    onstart = null
    onresult = null
    onerror = null
    onend = null
    constructor() {
      speech.current = this
    }
    start() {
      this.running = true
      setTimeout(() => this.onstart?.(), 20)
    }
    stop() {
      if (!this.running) return
      this.running = false
      setTimeout(() => this.onend?.(), 20)
    }
    abort() {
      this.running = false
      setTimeout(() => this.onend?.(), 0)
    }
    emit(text, isFinal) {
      const last = this.results[this.results.length - 1]
      const r = Object.assign([{ transcript: text }], { isFinal })
      let index = this.results.length
      if (last && !last.isFinal) index = this.results.length - 1
      this.results[index] = r
      this.onresult?.({ resultIndex: index, results: this.results })
    }
  }
  speech.say = (text, final = true) => (speech.current?.running ? (speech.current.emit(text, final), true) : false)
  window.SpeechRecognition = FakeRecognition
  window.webkitSpeechRecognition = FakeRecognition
  window.__speech = speech
}

/* ------------------------------------------------------------------ mocks */
function sse(text) {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  let body = ev('message_start', { message: { id: 'msg_demo', type: 'message', role: 'assistant', model: 'demo', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 300, output_tokens: 1 } } })
  body += ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
  for (const chunk of text.match(/.{1,20}/gs)) body += ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: chunk } })
  body += ev('content_block_stop', { index: 0 })
  body += ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 60 } })
  body += ev('message_stop', {})
  return body
}
const IMPROVED = 'Lead with specifics — numbers, names and real examples beat clever phrasing every time.'
/** What "Claude" writes from the meeting transcript (structured output, non-streaming). */
const MEETING = {
  title: 'Launch sync',
  summary: ['The relaunch ships in two steps, the homepage first.', 'Pricing copy is final once legal signs off.'],
  decisions: ['Ship the homepage on Friday.'],
  actionItems: [
    { text: 'Send the deck to legal', owner: 'Alex', due: null },
    { text: 'Book the launch venue', owner: 'Mira', due: null },
  ],
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS' }

async function mockClaude(ctx) {
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const body = JSON.parse(req.postData() ?? '{}')
    await new Promise((r) => setTimeout(r, 650))
    if (body.stream) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse(IMPROVED) })
    return route.fulfill({
      status: 200,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'msg_demo', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(MEETING) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 600, output_tokens: 120 } }),
    })
  })
}

/* GitHub: an in-memory repository behind api.github.com (as tests/e2e/sync.spec.ts) */
const gitSha = (data) => createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${data.length}\0`), data])).digest('hex')
const randomSha = () => createHash('sha1').update(String(Math.random())).digest('hex')
const REPO = 'acme/handbook'
async function mockGitHub(ctx) {
  const readme = Buffer.from('# Acme handbook\n')
  const blob = gitSha(readme)
  const tree0 = randomSha()
  const commit0 = randomSha()
  const repo = { head: commit0, commits: new Map([[commit0, { tree: tree0, parents: [] }]]), trees: new Map([[tree0, new Map([['README.md', blob]])]]), blobs: new Map([[blob, readme]]) }
  const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  await ctx.route('https://api.github.com/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const path = new URL(req.url()).pathname.replace(`/repos/${REPO}`, '')
    const body = req.postData() ? JSON.parse(req.postData()) : undefined
    const m = (re) => path.match(re)
    await new Promise((r) => setTimeout(r, 60))
    if (req.method() === 'GET' && path === '') return json(route, 200, { full_name: REPO, default_branch: 'main', private: true, permissions: { push: true } })
    if (req.method() === 'GET' && m(/^\/git\/ref\/heads\/main$/)) return json(route, 200, { object: { sha: repo.head } })
    let hit = m(/^\/git\/commits\/(\w+)$/)
    if (req.method() === 'GET' && hit) return json(route, 200, { sha: hit[1], tree: { sha: repo.commits.get(hit[1]).tree } })
    hit = m(/^\/git\/trees\/(\w+)$/)
    if (req.method() === 'GET' && hit) return json(route, 200, { sha: hit[1], truncated: false, tree: [...repo.trees.get(hit[1])].map(([p, sha]) => ({ path: p, mode: '100644', type: 'blob', sha })) })
    hit = m(/^\/git\/blobs\/(\w+)$/)
    if (req.method() === 'GET' && hit) return json(route, 200, { sha: hit[1], encoding: 'base64', content: repo.blobs.get(hit[1]).toString('base64') })
    if (req.method() === 'POST' && path === '/git/blobs') {
      const data = Buffer.from(body.content, 'base64')
      const sha = gitSha(data)
      repo.blobs.set(sha, data)
      return json(route, 201, { sha })
    }
    if (req.method() === 'POST' && path === '/git/trees') {
      const tree = new Map(repo.trees.get(body.base_tree))
      for (const e of body.tree) {
        if (e.content !== undefined) {
          const data = Buffer.from(e.content, 'utf8')
          const sha = gitSha(data)
          repo.blobs.set(sha, data)
          tree.set(e.path, sha)
        } else if (e.sha === null) tree.delete(e.path)
        else tree.set(e.path, e.sha)
      }
      const sha = randomSha()
      repo.trees.set(sha, tree)
      return json(route, 201, { sha })
    }
    if (req.method() === 'POST' && path === '/git/commits') {
      const sha = randomSha()
      repo.commits.set(sha, { tree: body.tree, parents: body.parents })
      return json(route, 201, { sha })
    }
    if (req.method() === 'PATCH' && path === '/git/refs/heads/main') {
      repo.head = body.sha
      return json(route, 200, { object: { sha: body.sha } })
    }
    return json(route, 404, { message: 'Not Found' })
  })
}

/* ------------------------------------------------------------------ pages */
function watch(page, who = '') {
  page.on('pageerror', (e) => console.log(`  ${who}pageerror:`, String(e).slice(0, 200)))
  page.on('console', (m) => m.type() === 'error' && console.log(`  ${who}console.error:`, m.text().slice(0, 200)))
}

async function newContext(browser, { theme = 'light', viewport = { width: W, height: H }, dpr = DPR, baseURL } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr, colorScheme: theme, locale: 'en-US', timezoneId: 'Europe/Berlin', serviceWorkers: 'block', baseURL })
  await ctx.addInitScript(CURSOR_SCRIPT)
  if (LOCAL && !baseURL)
    await ctx.route(`${PUBLIC}/**`, async (route) => route.fulfill({ response: await route.fetch({ url: route.request().url().replace(PUBLIC, LOCAL) }) }))
  // a static host has no team server: answer the app's probe like one (an HTML fallback), not with a 404
  if (!baseURL) await ctx.route('**/api/config', (route) => route.fulfill({ status: 200, headers: { 'content-type': 'text/html' }, body: '<!doctype html>' }))
  await mockClaude(ctx)
  await ctx.route('https://n8n.acme.studio/**', (route) =>
    route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: '{"ok":true}' }),
  )
  return ctx
}

async function newPage(browser, { theme = 'light', init } = {}) {
  const ctx = await newContext(browser, { theme })
  if (init) await init(ctx)
  const page = await ctx.newPage()
  page.setDefaultTimeout(8000)
  watch(page)
  await page.goto(`${BASE}/app/?e2e`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!window.__one)
  await page.evaluate((theme) => window.__one.workspace.getState().updateSettings({ theme, language: 'en', aiApiKey: 'sk-ant-demo', userName: 'Marcel' }), theme)
  await park(page, W / 2, H / 2)
  await page.waitForTimeout(900)
  return { ctx, page }
}

const idOf = (page, title) => page.evaluate((title) => Object.values(window.__one.workspace.getState().pages).find((p) => p.title === title && !p.trashed)?.id, title)
const go = async (page, hash, wait = 1200) => {
  await page.evaluate((h) => (window.location.hash = h), hash)
  await page.waitForTimeout(wait)
}
const openSettings = async (page, tab) => {
  await page.evaluate(() => window.__one.ui.getState().openModal({ type: 'settings' }))
  await page.getByRole('tab', { name: tab }).click()
  await page.waitForTimeout(500)
}

/* ------------------------------------------------------------------ motion helpers */
const cursors = new WeakMap()
const cur = (page) => cursors.get(page) ?? { x: W / 2, y: H / 2 }
/** Put the cursor somewhere without an animated move. */
async function park(page, x, y) {
  await page.mouse.move(x, y)
  cursors.set(page, { x, y })
}
async function moveTo(page, x, y, ms = 450) {
  const steps = Math.max(8, Math.round(ms / 16))
  const from = cur(page)
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e)
    await page.waitForTimeout(ms / steps)
  }
  cursors.set(page, { x, y })
}
async function centerOf(locator) {
  const b = await locator.boundingBox()
  if (!b) throw new Error('no box')
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b }
}
async function clickOn(page, locator, { ms = 450, pause = 120, modifiers, dx = 0, dy = 0 } = {}) {
  const c = await centerOf(locator)
  await moveTo(page, c.x + dx, c.y + dy, ms)
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
/** Scroll (no input events) so `locator` sits `top` px from the viewport top. */
const scrollTop = (locator, top) =>
  locator.evaluate((el, top) => {
    let p = el.parentElement
    while (p && !(p.scrollHeight > p.clientHeight && /auto|scroll/.test(getComputedStyle(p).overflowY))) p = p.parentElement
    ;(p || document.scrollingElement).scrollTop += el.getBoundingClientRect().top - top
  }, top)
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
/** Starts a screencast of `page`; returns stop() → frames [{ data, t }]. */
async function screencast(page, maxWidth, maxHeight) {
  const cdp = await page.context().newCDPSession(page)
  const frames = []
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    frames.push({ data, t: metadata.timestamp })
    try {
      await cdp.send('Page.screencastFrameAck', { sessionId })
    } catch {}
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth, maxHeight, everyNthFrame: 1 })
  return async () => {
    await cdp.send('Page.stopScreencast')
    await cdp.detach()
    return frames
  }
}

/** Frames → an H.264 clip of exactly [t0, tEnd] (the first frame stands from t0). */
function encode(frames, t0, tEnd, dir, file, w, h) {
  if (!frames.length) throw new Error('no frames recorded')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const fs = frames.filter((f, i) => i === 0 || f.t <= tEnd)
  let list = 'ffconcat version 1.0\n'
  fs.forEach((f, i) => {
    const name = `f${String(i).padStart(5, '0')}.jpg`
    writeFileSync(`${dir}/${name}`, Buffer.from(f.data, 'base64'))
    const start = i === 0 ? Math.min(f.t, t0) : f.t
    const next = i + 1 < fs.length ? fs[i + 1].t : Math.max(tEnd, f.t + 0.04)
    list += `file ${name}\nduration ${Math.max(0.001, next - start).toFixed(4)}\n`
  })
  list += `file f${String(fs.length - 1).padStart(5, '0')}.jpg\n`
  writeFileSync(`${dir}/list.ffconcat`, list)
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${dir}/list.ffconcat`, '-vf', `fps=30,scale=${w}:${h}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-crf', '14', '-preset', 'medium', file])
}
const durOf = (file) => execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim()

/** Records `page` while `run(mark)` plays; mark('name') notes a time (seconds into the clip). */
async function record(page, name, run) {
  const stop = await screencast(page, OUT_W, OUT_H)
  // force a first frame
  const c = cur(page)
  await page.mouse.move(c.x + 1, c.y)
  await page.mouse.move(c.x, c.y)
  const t0 = Date.now() / 1000
  const marks = {}
  await run((label) => (marks[label] = +(Date.now() / 1000 - t0).toFixed(2)))
  await page.waitForTimeout(150)
  const tEnd = Date.now() / 1000
  const frames = await stop()
  encode(frames, t0, tEnd, `${OUT}/${name}-frames`, `${OUT}/${name}.mp4`, OUT_W, OUT_H)
  writeFileSync(`${OUT}/${name}.json`, JSON.stringify({ length: +(tEnd - t0).toFixed(2), marks }, null, 1))
  console.log(`scene ${name}: ${frames.length} frames, ${(tEnd - t0).toFixed(1)}s wall → ${durOf(`${OUT}/${name}.mp4`)}s clip`, marks)
}

/* ------------------------------------------------------------------ scenes */
const scenes = {
  // Meet SimpleCMS One: Notion, rebuilt — minus the bill.
  async home(browser) {
    const { ctx, page } = await newPage(browser)
    const welcome = await idOf(page, 'Welcome to One')
    await go(page, `#/p/${welcome}`, 2200)
    await park(page, 900, 380)
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

  // A real block editor: slash commands, toggles, math, diagrams …
  async editor(browser) {
    const { ctx, page } = await newPage(browser)
    const id = await page.evaluate(() => window.__one.workspace.getState().createPage({ title: 'Launch plan', icon: { type: 'asset', value: 'kanban' } }))
    await go(page, `#/p/${id}`, 1500)
    const editor = page.locator('.ProseMirror').first()
    const box = (await editor.boundingBox()) ?? { x: 700, y: 420, width: 600, height: 40 }
    await park(page, box.x + 40, box.y + 14)
    await page.mouse.down()
    await page.mouse.up()
    await page.waitForTimeout(300)
    await record(page, 'editor-a', async (mark) => {
      await page.waitForTimeout(250)
      await type(page, '/', 0)
      await page.waitForTimeout(900)
      await type(page, 'to-do', 90)
      await page.waitForTimeout(350)
      await page.keyboard.press('Enter')
      mark('todo')
      await type(page, 'Record the demo video', 34)
      await page.keyboard.press('Enter')
      await type(page, 'Post it to the Ninja Armory', 34)
      await page.waitForTimeout(250)
      const first = page.locator('.ProseMirror li[data-checked] input, .ProseMirror li[data-type="taskItem"] input, .ProseMirror [data-type="taskItem"] input').first()
      if (await first.count()) await clickOn(page, first, { ms: 420 })
      mark('checked')
      await page.waitForTimeout(600)
    })
    // part b: the nerdy blocks on the welcome page
    const welcome = await idOf(page, 'Welcome to One')
    await go(page, `#/p/${welcome}`, 1800)
    await park(page, 700, 400)
    const nerd = page.locator('.ProseMirror').getByText('Blocks for nerds').first()
    await wheelTo(page, nerd, 70, 300, 30)
    await page.waitForTimeout(1600)
    await record(page, 'editor-b', async (mark) => {
      await moveTo(page, 640, 300, 450)
      await page.waitForTimeout(250)
      await moveTo(page, 760, 360, 400)
      // the toggle up out of the caption's way, then open it
      for (let i = 0; i < 12; i++) {
        await page.mouse.wheel(0, 16)
        await page.waitForTimeout(20)
      }
      await page.waitForTimeout(150)
      const toggle = page.locator('.ProseMirror [data-type="details"]', { hasText: 'Keyboard shortcuts' }).locator('button').first()
      await clickOn(page, toggle, { ms: 450 })
      mark('toggle')
      await page.waitForTimeout(1300)
    })
    await ctx.close()
  },

  // … and forms with logic: the seeded intake form (a question shown only for high priority, two pages).
  async forms(browser) {
    const { ctx, page } = await newPage(browser)
    const id = await idOf(page, 'Projects')
    await go(page, `#/p/${id}`, 1600)
    await page.getByRole('tab', { name: /Intake form/ }).click()
    await page.waitForTimeout(900)
    await park(page, 860, 420)
    const prio = page.locator('.fb-q__name', { hasText: /^Priority$/ }).first()
    await wheelTo(page, prio, 120, 200, 20)
    await page.waitForTimeout(900)
    await record(page, 'forms', async (mark) => {
      await page.waitForTimeout(300)
      // down through the page break to the question that is only asked for high priority
      const brk = page.locator('.fb-break').first()
      const target = (await brk.boundingBox()).y - 54
      for (let done = 0; done < target; done += 14) {
        await page.mouse.wheel(0, Math.min(14, target - done))
        await page.waitForTimeout(22)
      }
      mark('condition')
      await page.waitForTimeout(250)
      const cond = page.locator('.fb-q__if').first()
      if (await cond.count()) await moveTo(page, ...Object.values(await centerOf(cond)).slice(0, 2), 500)
      await page.waitForTimeout(1100)
    })
    await ctx.close()
  },

  // Databases with eight views, plus relations, rollups and formulas …
  async database(browser) {
    const { ctx, page } = await newPage(browser)
    const id = await idOf(page, 'Projects')
    await go(page, `#/p/${id}`, 1800)
    const db = page.locator('#main section.db').first()
    // load the lazy views once, so the recording never shows a loading state
    for (const name of [/Chart/, /Timeline/, /Board/]) {
      await page.getByRole('tab', { name }).first().click()
      await page.waitForTimeout(700)
    }
    // no wheel here: over the view tabs it would scroll the strip sideways
    await scrollTop(db, 60)
    await page.waitForTimeout(600)
    await record(page, 'database', async (mark) => {
      const card = page.getByText('Pricing page experiment').first()
      const target = page.getByText(/^In progress$/).first()
      const c = await centerOf(card)
      const tgt = await centerOf(target)
      await moveTo(page, c.x, c.y, 420)
      await page.mouse.down()
      await page.waitForTimeout(120)
      await moveTo(page, c.x + 12, c.y + 4, 120)
      await moveTo(page, tgt.x + 30, c.y + 30, 650)
      await page.waitForTimeout(180)
      await page.mouse.up()
      mark('dropped')
      await page.waitForTimeout(450)
      await clickOn(page, page.getByRole('tab', { name: /Timeline/ }).first(), { ms: 380 })
      mark('timeline')
      await page.waitForTimeout(850)
      await clickOn(page, page.getByRole('tab', { name: /Chart/ }).first(), { ms: 350 })
      mark('chart')
      await page.waitForTimeout(950)
      const add = db.getByRole('button', { name: 'Add view' }).first()
      await add.evaluate((el) => el.scrollIntoView({ block: 'nearest', inline: 'nearest' }))
      await page.waitForTimeout(250)
      await clickOn(page, add, { ms: 380 })
      mark('views')
      await page.waitForTimeout(1200)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(150)
    })
    await ctx.close()
  },

  // … and charts in three clicks: /chart → data → type → insert.
  async charts(browser) {
    const { ctx, page } = await newPage(browser)
    const id = await page.evaluate(() =>
      window.__one.workspace.getState().createPage({
        title: 'Q4 review',
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hours planned and spent per team this quarter.' }] }] },
      }),
    )
    await go(page, `#/p/${id}`, 1500)
    const para = page.locator('.ProseMirror p', { hasText: 'Hours planned' }).first()
    const newLine = async () => {
      await para.click()
      await page.keyboard.press('End')
      await page.keyboard.press('Enter')
    }
    // load the builder once (insert, cancel, undo), so the recording never waits for it
    await newLine()
    await page.keyboard.type('/chart')
    await page.waitForTimeout(400)
    await page.keyboard.press('Enter')
    await page.getByRole('dialog', { name: 'New chart' }).waitFor()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    await page.evaluate((id) => window.__one.workspace.getState().setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hours planned and spent per team this quarter.' }] }] }, 'import'), id)
    await page.waitForTimeout(600)
    await newLine()
    const pb = await para.boundingBox()
    await park(page, pb.x + 420, pb.y + 60)
    await page.waitForTimeout(400)
    await record(page, 'charts', async (mark) => {
      await page.waitForTimeout(150)
      await type(page, '/chart', 55)
      await page.waitForTimeout(300)
      await page.keyboard.press('Enter')
      const dialog = page.getByRole('dialog', { name: 'New chart' })
      await dialog.waitFor()
      await page.waitForTimeout(250)
      await clickOn(page, dialog.getByRole('radio', { name: /Enter data/ }), { ms: 380 })
      mark('click1')
      await page.waitForTimeout(600)
      await clickOn(page, dialog.getByRole('button', { name: 'Next' }), { ms: 360 })
      mark('click2')
      await page.waitForTimeout(600)
      await clickOn(page, dialog.getByRole('button', { name: 'Insert chart' }), { ms: 360 })
      mark('inserted')
      await page.waitForTimeout(400)
      for (let i = 0; i < 12; i++) {
        await page.mouse.wheel(0, 14)
        await page.waitForTimeout(18)
      }
      const bars = page.locator('.chart-block .ch-bar')
      if ((await bars.count()) > 6) await moveTo(page, ...Object.values(await centerOf(bars.nth(6))).slice(0, 2), 400)
      await page.waitForTimeout(900)
    })
    await ctx.close()
  },

  // Spreadsheets right inside your pages: sheets, formulas, coloured datasets …
  async sheets(browser) {
    const { ctx, page } = await newPage(browser)
    const id = await idOf(page, 'Budget 2026')
    await go(page, `#/p/${id}`, 2000)
    await park(page, 760, 420)
    await wheelTo(page, page.locator('.sheet').first(), 46, 120, 20)
    await page.waitForTimeout(800)
    const cell = (a) => page.locator(`.sheet [data-cell="${Number(a.slice(1)) - 1}:${a.charCodeAt(0) - 65}"]`)
    await record(page, 'sheets', async (mark) => {
      await page.waitForTimeout(150)
      await clickOn(page, cell('B3'), { ms: 420 })
      await type(page, '12000', 80)
      await page.waitForTimeout(150)
      await page.keyboard.press('Enter')
      mark('typed')
      await page.waitForTimeout(650)
      const b6 = await centerOf(cell('B6'))
      await moveTo(page, b6.x, b6.y, 380)
      await page.mouse.dblclick(b6.x, b6.y)
      mark('formula')
      await page.waitForTimeout(1100)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(100)
      for (let i = 0; i < 20; i++) {
        await page.mouse.wheel(0, 19)
        await page.waitForTimeout(18)
      }
      mark('chart')
      const bars = page.locator('.sheet .ch-bar')
      if ((await bars.count()) > 2) await moveTo(page, ...Object.values(await centerOf(bars.nth(2))).slice(0, 2), 380)
      await page.waitForTimeout(700)
      const tab = page.locator('.sheet-tab', { hasText: 'Q2' }).first()
      if (await tab.count()) {
        await clickOn(page, tab, { ms: 380 })
        mark('q2')
        await page.waitForTimeout(900)
      }
    })
    await ctx.close()
  },

  // … and your own functions, built by clicking: ⌘K → Custom functions → MARGIN, its test bench.
  async functions(browser) {
    const { ctx, page } = await newPage(browser)
    const id = await idOf(page, 'Budget 2026')
    await go(page, `#/p/${id}`, 1800)
    await park(page, 820, 470)
    await record(page, 'functions', async (mark) => {
      await page.waitForTimeout(200)
      await page.keyboard.press('Control+k')
      await page.waitForTimeout(250)
      await type(page, 'functions', 45)
      await page.waitForTimeout(300)
      await page.keyboard.press('Enter')
      const fx = page.getByRole('dialog', { name: /^Functions$/ })
      await fx.waitFor()
      mark('builder')
      await page.waitForTimeout(350)
      await clickOn(page, fx.locator('[data-sample="price"]'), { ms: 380 })
      await type(page, '120', 70)
      await clickOn(page, fx.locator('[data-sample="cost"]'), { ms: 280 })
      await type(page, '90', 70)
      mark('result')
      await page.waitForTimeout(600)
      await clickOn(page, fx.locator('[data-path="0"]'), { ms: 420 })
      mark('menu')
      await page.waitForTimeout(1000)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(150)
    })
    await ctx.close()
  },

  // Bring your team: live editing, private pages, every workspace encrypted with its own key.
  async team(browser) {
    await recordTeam(browser)
  },

  // Claude is built in …
  async ai(browser) {
    const { ctx, page } = await newPage(browser)
    const id = await idOf(page, 'Brand voice')
    await go(page, `#/p/${id}`, 1500)
    await record(page, 'ai', async (mark) => {
      await dragSelect(page, 'Numbers, names', 'examples.')
      await page.waitForTimeout(500)
      await clickOn(page, page.getByRole('button', { name: /Ask AI/i }).first(), { ms: 420 })
      await page.waitForTimeout(600)
      await clickOn(page, page.getByText(/^Improve writing/).first(), { ms: 380 })
      mark('improve')
      await page.waitForTimeout(1900)
      await clickOn(page, page.getByText(/^Replace selection/).first(), { ms: 420 })
      mark('replaced')
      await page.waitForTimeout(900)
    })
    await ctx.close()
  },

  // … and with one click, Claude Desktop can run your workspace over MCP.
  async mcp(browser) {
    await recordMcp(browser)
  },

  // It takes your meeting notes …
  async meeting(browser) {
    const { ctx, page } = await newPage(browser, { init: (c) => c.addInitScript(fakeSpeech) })
    const id = await page.evaluate(() => window.__one.workspace.getState().createPage({ title: 'Launch sync' }))
    await go(page, `#/p/${id}`, 1400)
    await page.locator('.ProseMirror').first().click()
    await type(page, '/meeting', 20)
    await page.waitForTimeout(400)
    await page.keyboard.press('Enter')
    const deck = page.locator('#main .mtg').first()
    await deck.waitFor()
    await page.waitForTimeout(400)
    await deck.locator('[data-meeting-key="record"]').click()
    await page.waitForTimeout(500)
    const say = (text, final = true) => page.evaluate(([t, f]) => window.__speech.say(t, f), [text, final])
    await say('We ship the relaunch in two steps — the homepage goes first.')
    await page.waitForTimeout(300)
    await park(page, 880, 300)
    await page.waitForTimeout(500)
    await record(page, 'meeting', async (mark) => {
      await page.waitForTimeout(200)
      await say('Alex sends the deck', false)
      await page.waitForTimeout(350)
      await say('Alex sends the deck to legal by Friday.')
      await page.waitForTimeout(300)
      await say('Mira books the venue', false)
      await page.waitForTimeout(300)
      await say('Mira books the venue for the launch.')
      await page.waitForTimeout(250)
      await clickOn(page, deck.locator('[data-meeting-key="stop"]'), { ms: 420 })
      mark('stop')
      await deck.locator('.mtg__notes').getByRole('heading', { name: 'Action items' }).waitFor({ timeout: 10000 })
      mark('notes')
      await page.waitForTimeout(300)
      for (let i = 0; i < 14; i++) {
        await page.mouse.wheel(0, 16)
        await page.waitForTimeout(18)
      }
      await page.waitForTimeout(1000)
    })
    await ctx.close()
  },

  // … syncs to GitHub …
  async sync(browser) {
    const { ctx, page } = await newPage(browser, { init: mockGitHub })
    const welcome = await idOf(page, 'Welcome to One')
    await go(page, `#/p/${welcome}`, 1200)
    await openSettings(page, /Sync$/)
    const dialog = page.getByRole('dialog')
    const gh = dialog.locator('.sy-panel').nth(1)
    await gh.getByLabel('Repository', { exact: true }).fill(REPO)
    await gh.getByLabel('Folder in the repository').fill('one')
    await gh.getByLabel('Access token').fill('github_pat_DEMO_ONLY_not_a_real_token_0000')
    await gh.getByRole('button', { name: 'Test connection' }).click()
    await gh.getByText(`Connected · ${REPO}`).waitFor()
    await page.waitForTimeout(400)
    const push = gh.getByRole('button', { name: 'Push now' })
    await gh.evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await park(page, 700, 300)
    await page.waitForTimeout(600)
    await record(page, 'sync', async (mark) => {
      await page.waitForTimeout(200)
      await clickOn(page, push, { ms: 500 })
      mark('push')
      await gh.locator('.sy-panel__state').getByText(/Up to date/).waitFor({ timeout: 10000 })
      mark('done')
      await page.waitForTimeout(1300)
    })
    await ctx.close()
  },

  // … and fires webhooks into n8n.
  async automations(browser) {
    const { ctx, page } = await newPage(browser)
    const id = await idOf(page, 'Projects')
    await go(page, `#/p/${id}`, 1600)
    await record(page, 'automations', async (mark) => {
      await clickOn(page, page.getByRole('button', { name: /Automations/i }).first(), { ms: 500 })
      await page.waitForTimeout(700)
      await clickOn(page, page.getByText(/Send new rows to n8n/).first(), { ms: 450 })
      await page.waitForTimeout(500)
      const url = page.locator('.modal input[type="url"], .modal input[placeholder*="http"]').first()
      await clickOn(page, url, { ms: 380 })
      await type(page, 'https://n8n.acme.studio/webhook/new-project', 14)
      mark('url')
      await page.waitForTimeout(250)
      await clickOn(page, page.locator('.modal').getByRole('switch').first(), { ms: 380 }).catch(() => {})
      await page.waitForTimeout(250)
      await clickOn(page, page.locator('.modal').getByRole('button', { name: /Send test/i }).first(), { ms: 400 })
      mark('sent')
      await page.waitForTimeout(1500)
    })
    await ctx.close()
  },

  // v1: Command K for everything. Pages side by side. And a live graph of how it all connects.
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

  // v1: Import from Notion in a minute. Share pages without a server.
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
      await park(viewer, 1500, 700)
      await record(viewer, 'shared', async () => {
        await moveTo(viewer, 1300, 420, 700)
        await viewer.waitForTimeout(1200)
      })
    } else console.log('  (no share link found)')
    await ctx.close()
  },
}

/* ------------------------------------------------------------------ MCP: a local MCP client drives the real bridge */
const MCP_PORT = 47741
async function recordMcp(browser) {
  const { Client } = await import(resolve('mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'))
  const { StdioClientTransport } = await import(resolve('mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js'))
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('public/mcp/one-mcp.mjs')],
    env: { PATH: process.env.PATH ?? '', ONE_MCP_PORT: String(MCP_PORT), ONE_MCP_WAIT_MS: '15000' },
    stderr: 'pipe',
  })
  // the clientInfo name Claude Desktop sends
  let bridgeLog = ''
  transport.stderr?.on('data', (d) => (bridgeLog += d.toString()))
  const client = new Client({ name: 'claude-ai', version: '1.0.0' })
  await client.connect(transport)
  const { ctx, page } = await newPage(browser, {
    init: (c) => c.addInitScript((port) => localStorage.setItem('one.mcp', JSON.stringify({ enabled: false, mode: 'ask', port })), MCP_PORT),
  })
  try {
    const id = await idOf(page, 'Projects')
    await go(page, `#/p/${id}`, 1600)
    await wheelTo(page, page.locator('#main section.db').first(), 60, 120, 20)
    await openSettings(page, /Agents · MCP/)
    const modal = page.getByRole('dialog')
    const add = modal.getByRole('link', { name: /Add to Claude Desktop/ }).first()
    const allow = modal.getByRole('switch', { name: 'Allow AI agents on this computer' })
    await park(page, 900, 300)
    // the switch and the key both in view
    await wheelTo(page, allow, 105, 40, 30)
    await page.waitForTimeout(700)
    let call = null
    await record(page, 'mcp', async (mark) => {
      await page.waitForTimeout(200)
      await clickOn(page, add, { ms: 500 })
      mark('add')
      await page.waitForTimeout(700)
      await clickOn(page, allow, { ms: 500 })
      await page.getByTestId('mcp-state').getByText(/Connected/).waitFor({ timeout: 15000 })
      mark('connected')
      await page.waitForTimeout(900)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(250)
      const dbId = await idOf(page, 'Projects')
      call = client.callTool({ name: 'one_create_row', arguments: { databaseId: dbId, title: 'Podcast launch', properties: { Status: 'In progress', Priority: 'High', Tags: ['Marketing'] }, markdown: '## Plan\n\n- [ ] Book two guests\n- [ ] Record episode 1' } })
      const card = page.getByRole('alertdialog')
      await card.waitFor({ timeout: 10000 })
      mark('card')
      await page.waitForTimeout(1300)
      await clickOn(page, card.getByRole('button', { name: /Approve/ }), { ms: 500 })
      mark('approved')
      await call
      await page.waitForTimeout(1400)
    })
  } catch (e) {
    await page.screenshot({ path: `${OUT}/mcp-error.png` }).catch(() => {})
    console.log('  bridge:', bridgeLog.slice(-600))
    throw e
  } finally {
    await client.close().catch(() => {})
    await ctx.close()
  }
}

/* ------------------------------------------------------------------ team: two people, two browsers, one local cloud server */
const TW = 780 // CSS px per browser (desktop layout from 768)
const TH = 860
const TDPR = 1.2 // → 936×1032 per window; side by side with 16 px gutters = 1920 wide
const GAP = 16
const BAND = 32

const api = (page, method, path, body) =>
  page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(path, { method, credentials: 'same-origin', headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      const text = await res.text()
      let json = null
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        json = text
      }
      return { status: res.status, json }
    },
    { method, path, body },
  )

/** Signs a person in through the server's dev mailbox (DEV_MODE), as tests/e2e-cloud/fixtures.ts does. */
async function cloudPerson(browser, name, mail) {
  const ctx = await newContext(browser, { viewport: { width: TW, height: TH }, dpr: TDPR, baseURL: CLOUD })
  const page = await ctx.newPage()
  page.setDefaultTimeout(10000)
  watch(page, `${name}: `)
  await page.goto('/app/?e2e')
  await page.waitForFunction(() => !!window.__one)
  const before = (await (await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(mail)}`)).json()).length
  const r = await api(page, 'POST', '/api/auth/request', { email: mail, redirect: '/app/' })
  if (r.status >= 300) throw new Error(`sign-in request failed: ${r.status}`)
  let link = null
  for (let i = 0; i < 40 && !link; i++) {
    const list = await (await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(mail)}`)).json()
    if (list.length > before) link = [...list].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0].link
    else await page.waitForTimeout(250)
  }
  await page.goto(link)
  await page.waitForTimeout(1200)
  await api(page, 'PATCH', '/api/me', { name })
  return { ctx, page }
}

async function openCloud(page, wsId, hash = '') {
  await page.goto(`/app/?e2e&w=${wsId}${hash}`)
  await page.waitForFunction(() => !!window.__one, null, { timeout: 30000 })
  await page.waitForFunction(() => window.__one.cloud.useCloud.getState().status === 'online', null, { timeout: 30000 })
  await page.evaluate(() => window.__one.workspace.getState().updateSettings({ theme: 'light', language: 'en' }))
}

/** The dark frame around the two windows: a label over each one. */
async function teamFrame(browser, file) {
  const font = (p) => `file://${resolve('node_modules', p)}`
  const html = `<!doctype html><html><head><style>
@font-face { font-family: Mono; src: url('${font('@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2')}') format('woff2'); font-weight: 100 800; }
* { box-sizing: border-box; margin: 0; }
html, body { width: ${OUT_W}px; height: ${OUT_H}px; background: #111110; overflow: hidden; }
.l { position: absolute; top: 0; height: ${BAND}px; display: flex; align-items: center; gap: 10px; font: 600 14px Mono, monospace; letter-spacing: .08em; text-transform: uppercase; color: #ece9e2; }
.led { width: 9px; height: 9px; border-radius: 50%; background: #ff4f00; box-shadow: 0 0 0 3px rgba(255,79,0,.2); }
.dim { color: #8a867e; }
.r { right: ${GAP}px; }
.win { position: absolute; top: ${BAND}px; width: ${TW * TDPR}px; height: ${TH * TDPR}px; outline: 1px solid rgba(236,233,226,.22); }
</style></head><body>
<div class="l" style="left:${GAP}px"><span class="led"></span>Browser A · Marcel</div>
<div class="l" style="left:${GAP * 2 + TW * TDPR}px"><span class="led"></span>Browser B · Mira</div>
<div class="l r dim">Own server · encrypted at rest · one key per workspace</div>
<div class="win" style="left:${GAP}px"></div><div class="win" style="left:${GAP * 2 + TW * TDPR}px"></div>
</body></html>`
  const page = await browser.newPage({ viewport: { width: OUT_W, height: OUT_H } })
  const tmp = resolve(OUT, '_frame.html')
  writeFileSync(tmp, html)
  await page.goto(`file://${tmp}`)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: file })
  await page.close()
  rmSync(tmp)
}

async function recordTeam(browser) {
  // the switcher shows the address: clean ones, so the server needs a fresh DATA_DIR per recording
  const A = await cloudPerson(browser, 'Marcel', 'marcel@acme.studio')
  const B = await cloudPerson(browser, 'Mira', 'mira@acme.studio')
  try {
    const me = await api(A.page, 'GET', '/api/me')
    if (me.json.workspaces.length > 1) throw new Error('the cloud server has data from an earlier recording: restart it with a fresh DATA_DIR')
    const own = me.json.workspaces.find((w) => w.personal)
    if (own) await api(A.page, 'PATCH', `/api/workspaces/${own.id}`, { name: 'Marcel’s space' })
    const ws = await api(A.page, 'POST', '/api/workspaces', { name: 'Acme Studio' })
    const wsId = ws.json.id
    const inv = await api(A.page, 'POST', `/api/workspaces/${wsId}/invites`, { role: 'member' })
    await api(B.page, 'POST', `/api/invites/${inv.json.link.split('#/invite/')[1]}/accept`, {})
    await openCloud(A.page, wsId)
    const ids = await A.page.evaluate(() => {
      const s = window.__one.workspace.getState()
      const t = (text) => ({ type: 'text', text })
      const task = (text, checked) => ({ type: 'taskItem', attrs: { checked }, content: [{ type: 'paragraph', content: [t(text)] }] })
      const plan = s.createPage({ title: 'Launch plan', icon: { type: 'asset', value: 'kanban' } })
      s.setContent(
        plan,
        {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [t('Everything for the October launch, in one place.')] },
            { type: 'heading', attrs: { level: 2 }, content: [t('This week')] },
            { type: 'taskList', content: [task('Final pricing page', true), task('Record the demo video', false), task('Brief the press list', false)] },
            { type: 'heading', attrs: { level: 2 }, content: [t('Notes')] },
            { type: 'paragraph' },
          ],
        },
        'import',
      )
      s.createPage({ title: 'Team wiki', icon: { type: 'asset', value: 'binder' } })
      s.createPage({ title: 'Weekly sync', icon: { type: 'asset', value: 'notepad' } })
      s.createPage({ title: 'Brand voice', icon: { type: 'asset', value: 'microphone' } })
      return { plan }
    })
    const priv = await A.page.evaluate(() => window.__one.cloud.createPrivatePage({ title: 'Salary review 2027' }))
    await A.page.evaluate(
      ([id]) =>
        window.__one.workspace.getState().setContent(
          id,
          { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Only Marcel can open this page — the server keeps it in his private documents.' }] }] },
          'import',
        ),
      [priv],
    )
    await openCloud(B.page, wsId)
    await B.page.waitForFunction((id) => !!window.__one.workspace.getState().pages[id], ids.plan, { timeout: 20000 })
    for (const P of [A, B]) await P.page.evaluate((h) => (window.location.hash = h), `#/p/${ids.plan}`)
    await A.page.waitForTimeout(2500)
    const edA = A.page.locator(`.ProseMirror[data-page-id="${ids.plan}"]`)
    const notes = edA.locator('p').last()
    const nb = await notes.boundingBox()
    await park(A.page, nb.x + 120, nb.y + nb.height / 2 + 40)
    await park(B.page, 600, 620)
    await A.page.waitForTimeout(800)

    const frameP = `${OUT}/team-frame.png`
    await teamFrame(browser, frameP)
    const w = TW * TDPR
    const h = TH * TDPR
    const stopA = await screencast(A.page, w, h)
    const stopB = await screencast(B.page, w, h)
    for (const P of [A, B]) {
      const c = cur(P.page)
      await P.page.mouse.move(c.x + 1, c.y)
      await P.page.mouse.move(c.x, c.y)
    }
    const t0 = Date.now() / 1000
    const marks = {}
    const mark = (label) => (marks[label] = +(Date.now() / 1000 - t0).toFixed(2))
    // Marcel types — Mira sees it live, with his caret
    await A.page.waitForTimeout(300)
    await clickOn(A.page, notes, { ms: 450, dx: -40 })
    await type(A.page, 'Launch party: Friday, 5 pm at the studio.', 45)
    mark('typed')
    await A.page.waitForTimeout(400)
    // Mira ticks a box — Marcel sees it
    const boxB = B.page.locator(`.ProseMirror[data-page-id="${ids.plan}"] li[data-checked]`, { hasText: 'Record the demo video' }).locator('input[type="checkbox"]').first()
    await clickOn(B.page, boxB, { ms: 500 })
    mark('ticked')
    await A.page.waitForTimeout(900)
    // private pages: only Marcel's sidebar lists his
    await clickOn(A.page, A.page.getByTestId('private-section').locator('.sb-row', { hasText: 'Salary review 2027' }), { ms: 550 })
    mark('private')
    await A.page.waitForTimeout(1400)
    // the switcher: his own space, the team workspace
    await clickOn(A.page, A.page.locator('aside.sb .sb-head__ws'), { ms: 500 })
    mark('switcher')
    await A.page.waitForTimeout(1600)
    await A.page.keyboard.press('Escape')
    await A.page.waitForTimeout(200)
    const tEnd = Date.now() / 1000
    const [fa, fb] = [await stopA(), await stopB()]
    encode(fa, t0, tEnd, `${OUT}/team-a-frames`, `${OUT}/team-a.mp4`, w, h)
    encode(fb, t0, tEnd, `${OUT}/team-b-frames`, `${OUT}/team-b.mp4`, w, h)
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-loop', '1', '-framerate', '30', '-i', frameP, '-i', `${OUT}/team-a.mp4`, '-i', `${OUT}/team-b.mp4`,
      '-filter_complex', `[0:v][1:v]overlay=${GAP}:${BAND}:shortest=1[x];[x][2:v]overlay=${GAP * 2 + w}:${BAND}:shortest=1,format=yuv420p[v]`,
      '-map', '[v]', '-c:v', 'libx264', '-crf', '14', '-preset', 'medium', '-r', '30', `${OUT}/team.mp4`,
    ])
    writeFileSync(`${OUT}/team.json`, JSON.stringify({ length: +(tEnd - t0).toFixed(2), marks }, null, 1))
    console.log(`scene team: ${fa.length}+${fb.length} frames, ${(tEnd - t0).toFixed(1)}s wall → ${durOf(`${OUT}/team.mp4`)}s clip`, marks)
  } catch (e) {
    await A.page.screenshot({ path: `${OUT}/team-error-a.png` }).catch(() => {})
    await B.page.screenshot({ path: `${OUT}/team-error-b.png` }).catch(() => {})
    throw e
  } finally {
    await A.ctx.close()
    await B.ctx.close()
  }
}

const browser = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } })
for (const [name, run] of Object.entries(scenes)) {
  if (ONLY.length ? !ONLY.includes(name) : ['command', 'importshare'].includes(name)) continue
  try {
    await run(browser)
  } catch (e) {
    console.log(`FAILED ${name}:`, String(e).split('\n').slice(0, 4).join(' | '))
  }
}
await browser.close()
