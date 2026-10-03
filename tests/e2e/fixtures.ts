/**
 * Shared fixtures + helpers for the end-to-end suite.
 *
 * Every test runs in a fresh browser context (fresh IndexedDB + localStorage), so the first
 * visit of /app/ seeds the demo workspace. Setup that is not the subject of a test goes
 * through the app's test hook (window.__one = { workspace, ui, flushSave }, enabled by ?e2e).
 *
 * Browser errors (uncaught exceptions, console.error, failed same-origin requests) fail the
 * test that produced them — "no console errors" is part of the product's quality bar.
 */
import { test as base, expect, type BrowserContext, type Locator, type Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'

export { expect }

/* ------------------------------------------------------------------ */
/* Browser error watch                                                 */
/* ------------------------------------------------------------------ */

export interface ErrorLog {
  list: string[]
  /** Errors matching this pattern are expected by the current test. */
  allow: (re: RegExp) => void
  /** Watch another page (popups, second contexts). */
  watch: (page: Page) => void
}

function makeErrorLog(): ErrorLog {
  const allowed: RegExp[] = []
  const list: string[] = []
  const push = (msg: string) => {
    if (!allowed.some((re) => re.test(msg))) list.push(msg)
  }
  const watch = (page: Page) => {
    page.on('pageerror', (e) => push(`pageerror: ${e.message}`))
    page.on('console', (m) => {
      if (m.type() !== 'error') return
      push(`console.error: ${m.text()}`)
    })
  }
  return {
    list,
    allow: (re) => {
      allowed.push(re)
      // drop already-recorded matches too
      for (let i = list.length - 1; i >= 0; i--) if (re.test(list[i])) list.splice(i, 1)
    },
    watch,
  }
}

export const test = base.extend<{ errors: ErrorLog }>({
  errors: [
    async ({ page }, use) => {
      const log = makeErrorLog()
      log.watch(page)
      await use(log)
      expect.soft(log.list, 'browser errors (uncaught exceptions / console.error)').toEqual([])
    },
    { auto: true },
  ],
})

/* ------------------------------------------------------------------ */
/* Claude API mock                                                     */
/* ------------------------------------------------------------------ */

/** Server-sent event stream in the shape of the Anthropic Messages API. */
export function sse(text: string): string {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  let body = ev('message_start', {
    message: { id: 'msg_e2e', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 42, output_tokens: 1 } },
  })
  body += ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
  for (const chunk of text.match(/.{1,16}/gs) ?? []) body += ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: chunk } })
  body += ev('content_block_stop', { index: 0 })
  body += ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 24 } })
  body += ev('message_stop', {})
  return body
}

/**
 * Route api.anthropic.com to a canned stream. Never lets a real request through.
 * Returns the list of captured request bodies.
 */
export async function mockClaude(ctx: BrowserContext | Page, answer: (body: string) => string): Promise<string[]> {
  const bodies: string[] = []
  await ctx.route('https://api.anthropic.com/**', (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' } })
    const cors = { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
    // key check (models.list)
    if (req.method() === 'GET' && /\/v1\/models/.test(req.url()))
      return route.fulfill({
        status: 200,
        headers: cors,
        body: JSON.stringify({ data: [{ type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-01-01T00:00:00Z' }], has_more: false, first_id: 'claude-opus-5-5', last_id: 'claude-opus-5-5' }),
      })
    const body = req.postData() ?? ''
    bodies.push(body)
    // non-streaming calls (key test) get a plain JSON message
    if (!/"stream"\s*:\s*true/.test(body))
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
        body: JSON.stringify({ id: 'msg_e2e', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }),
      })
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: sse(answer(body)) })
  })
  return bodies
}

/* ------------------------------------------------------------------ */
/* App navigation                                                      */
/* ------------------------------------------------------------------ */

/** Open the workspace app (seeds on the first visit of a fresh context) and wait for boot. */
export async function openApp(page: Page, hash = ''): Promise<void> {
  const h = hash ? `#${hash.replace(/^#/, '')}` : ''
  await page.goto(`app/?e2e${h}`)
  await waitForApp(page)
}

export async function waitForApp(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as unknown as { __one?: unknown }).__one, null, { timeout: 30_000 })
  await expect(page.locator('#boot')).toHaveCount(0)
  await expect(page.locator('.app')).toBeVisible()
}

/** Reload the app and wait until it booted again (after making sure everything is saved). */
export async function reloadApp(page: Page): Promise<void> {
  await flush(page)
  await page.reload()
  await waitForApp(page)
}

/** Navigate (hash routing) to a page and wait for its title field. */
export async function gotoPage(page: Page, id: string): Promise<void> {
  await page.evaluate((id) => {
    window.location.hash = `#/p/${id}`
  }, id)
  await expect(page.locator('#main .pv-title')).toBeVisible()
  await page.waitForFunction((id) => window.location.hash.startsWith(`#/p/${id}`), id)
}

/** Editor of a page (by id), or the main column's editor. */
export function editorOf(page: Page, id?: string): Locator {
  return id ? page.locator(`.ProseMirror[data-page-id="${id}"]`) : page.locator('#main .pv-content .ProseMirror').first()
}

/* ------------------------------------------------------------------ */
/* Store access (window.__one)                                         */
/* ------------------------------------------------------------------ */

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Run a function against the workspace store state in the page. */
export async function wsEval<R, A = undefined>(page: Page, fn: (s: AnyState, arg: A) => R, arg?: A): Promise<R> {
  return page.evaluate(
    ({ src, arg }) => {
      const s = (window as unknown as { __one: { workspace: { getState: () => AnyState } } }).__one.workspace.getState()
      // eslint-disable-next-line no-new-func
      return new Function('s', 'arg', `return (${src})(s, arg)`)(s, arg)
    },
    { src: fn.toString(), arg: arg as A },
  ) as Promise<R>
}

/** Same for the UI store. */
export async function uiEval<R, A = undefined>(page: Page, fn: (s: AnyState, arg: A) => R, arg?: A): Promise<R> {
  return page.evaluate(
    ({ src, arg }) => {
      const s = (window as unknown as { __one: { ui: { getState: () => AnyState } } }).__one.ui.getState()
      // eslint-disable-next-line no-new-func
      return new Function('s', 'arg', `return (${src})(s, arg)`)(s, arg)
    },
    { src: fn.toString(), arg: arg as A },
  ) as Promise<R>
}

/** Wait out the editor's write debounce, then force the IndexedDB save. */
export async function flush(page: Page): Promise<void> {
  await page.waitForTimeout(450)
  await page.evaluate(() => (window as unknown as { __one: { flushSave: () => Promise<void> } }).__one.flushSave())
}

export async function pageIdByTitle(page: Page, title: string): Promise<string> {
  const id = await wsEval(page, (s, title) => (Object.values(s.pages) as AnyState[]).find((p) => p.title === title && !p.trashed)?.id ?? null, title)
  if (!id) throw new Error(`no page titled "${title}"`)
  return id
}

export async function pageById(page: Page, id: string): Promise<AnyState> {
  return wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.pages[id] ?? null)), id)
}

/** Plain text of a page (store cache maintained by setContent). */
export async function plainOf(page: Page, id: string): Promise<string> {
  return wsEval(page, (s, id) => s.pages[id]?.plain ?? '', id)
}

/** Create a page through the store (optionally with TipTap JSON content) and return its id. */
export async function createPage(page: Page, input: { title: string; content?: JSONContent; parentId?: string | null }): Promise<string> {
  const id = await wsEval(
    page,
    (s, input) => {
      const id = s.createPage({ title: input.title, parentId: input.parentId ?? null })
      if (input.content) s.setContent(id, input.content, 'e2e')
      return id
    },
    input,
  )
  await flush(page)
  return id
}

/** Tiny TipTap JSON builders. */
export const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })
export const para = (text: string): JSONContent => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' })
export const heading = (level: number, text: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] })

/** Node type names at the top level of a page's content. */
export async function topLevelTypes(page: Page, id: string): Promise<string[]> {
  return wsEval(page, (s, id) => ((s.pages[id]?.content?.content ?? []) as AnyState[]).map((n) => n.type), id)
}

/** All node type names anywhere in a page's content. */
export async function allTypes(page: Page, id: string): Promise<string[]> {
  return wsEval(
    page,
    (s, id) => {
      const out: string[] = []
      const walk = (n: AnyState) => {
        out.push(n.type)
        ;(n.content ?? []).forEach(walk)
      }
      if (s.pages[id]?.content) walk(s.pages[id].content)
      return out
    },
    id,
  )
}

/** Wait until the stored content of a page satisfies a predicate on its plain text. */
export async function waitForPlain(page: Page, id: string, re: RegExp, timeout = 10_000): Promise<void> {
  await expect.poll(() => plainOf(page, id), { timeout }).toMatch(re)
}

/**
 * Select a text range inside the editor (first occurrence of `text`). ProseMirror can re-sync
 * its own selection to the DOM right after a focus change, so the range is set again until the
 * selection holds (prefer selectLine() for whole lines: keyboard selection never races).
 */
export async function selectText(page: Page, editor: Locator, text: string): Promise<void> {
  const select = () =>
    editor.evaluate((root, text) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let node: Node | null
      while ((node = walker.nextNode())) {
        const data = (node as Text).data
        const i = data.indexOf(text)
        if (i >= 0) {
          const r = document.createRange()
          r.setStart(node, i)
          r.setEnd(node, i + text.length)
          const sel = window.getSelection()!
          sel.removeAllRanges()
          sel.addRange(r)
          return
        }
      }
      throw new Error(`text not found in editor: ${text}`)
    }, text)
  for (let attempt = 0; attempt < 5; attempt++) {
    await select()
    // ProseMirror picks up DOM selection changes on selectionchange; give it a frame
    await page.waitForTimeout(150)
    if ((await page.evaluate(() => window.getSelection()?.toString() ?? '')) === text) return
  }
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? ''), 'editor selection').toBe(text)
}

/** Select a whole line with the keyboard (click it, End, Shift+Home) and check the selection. */
export async function selectLine(page: Page, line: Locator): Promise<void> {
  const expected = (await line.innerText()).trim()
  await line.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Shift+Home')
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().trim() ?? ''), { message: 'keyboard selection' }).toBe(expected)
}

/** Sidebar tree row (pages section) by title. */
export function sidebarRow(page: Page, title: string): Locator {
  return page.locator('.sb section[aria-label="Pages"] .sb-row', { has: page.locator('.sb-row__title', { hasText: new RegExp(`^${escapeRe(title)}$`) }) })
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Mod key for shortcuts (tests run on Linux Chromium → Control). */
export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
