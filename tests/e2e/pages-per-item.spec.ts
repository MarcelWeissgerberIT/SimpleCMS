/**
 * "A sub-page for every ticket, linked in a table on the main page" — the AI terminal and the AI menu.
 *
 *  - AI terminal: create_pages stages one page per item in ONE call (ids back in order), the table on the
 *    open page links them; after Apply the links are page mentions that open the sub-page. A mocked Atlas
 *    MCP server (made-up URL; Anthropic runs MCP calls inside the response, so only api.anthropic.com is
 *    mocked) returns 30 tickets. The tool-call limit ends a task as "Limit reached" with Continue (key,
 *    ↵ on an empty prompt, /continue, /weiter): the same task, a fresh budget, nothing staged twice.
 *  - AI menu: an own request is routed by its words — "make a sub-page out of this" runs Turn into page,
 *    "one page per item" runs Sub-page per item, "as a board" offers Turn into database, work in Atlas
 *    goes to the AI terminal (with the selection as a reference); a writing request stays a request.
 *  - Sub-page per item (no Claude): a bullet list with nested details, heading sections, a table; the
 *    toast's Undo and ⌘Z; a private parent; 390 px.
 *
 * Nothing reaches api.anthropic.com: every request gets a scripted SSE answer.
 */
import type { BrowserContext, Locator, Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, gotoPage, createPage, wsEval, editorOf, doc, para, heading, pageById, MOD } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/* ------------------------------------------------------------------ */
/* Claude API mock                                                     */
/* ------------------------------------------------------------------ */

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'mcp_tool_use'; id: string; server: string; name: string; input: Record<string, unknown> }
  | { type: 'mcp_tool_result'; id: string; text: string }

let seq = 0

/** One streamed assistant message (Messages API SSE): text, tool_use and MCP blocks. */
function sseMessage(blocks: Block[]): string {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  const stop = blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'
  let body = ev('message_start', {
    message: { id: `msg_ppi_${++seq}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 1 } },
  })
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      body += ev('content_block_start', { index, content_block: { type: 'text', text: '' } })
      for (const chunk of b.text.match(/.{1,24}/gs) ?? []) body += ev('content_block_delta', { index, delta: { type: 'text_delta', text: chunk } })
    } else if (b.type === 'tool_use' || b.type === 'mcp_tool_use') {
      const start = b.type === 'tool_use' ? { type: 'tool_use', id: b.id, name: b.name, input: {} } : { type: 'mcp_tool_use', id: b.id, name: b.name, server_name: b.server, input: {} }
      body += ev('content_block_start', { index, content_block: start })
      for (const chunk of JSON.stringify(b.input).match(/.{1,400}/gs) ?? []) body += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: chunk } })
    } else {
      body += ev('content_block_start', { index, content_block: { type: 'mcp_tool_result', tool_use_id: b.id, is_error: false, content: [{ type: 'text', text: b.text }] } })
    }
    body += ev('content_block_stop', { index })
  })
  body += ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 120 } })
  body += ev('message_stop', {})
  return body
}

type Step = (body: AnyState) => string

/** api.anthropic.com → request n gets script[n] (later ones a short answer). Returns the request bodies. */
async function mockClaude(ctx: BrowserContext, script: Step[]): Promise<AnyState[]> {
  const bodies: AnyState[] = []
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (req.method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [], has_more: false, first_id: null, last_id: null }) })
    const body = JSON.parse(req.postData() ?? '{}')
    bodies.push(body)
    const step = script[bodies.length - 1] ?? (() => sseMessage([{ type: 'text', text: 'Done.' }]))
    try {
      await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: step(body) })
    } catch {
      /* aborted */
    }
  })
  return bodies
}

/** The text of a tool result Claude got back, by tool_use id. */
function toolResult(body: AnyState, id: string): string {
  const block = (body.messages as AnyState[]).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((c: AnyState) => c.type === 'tool_result' && c.tool_use_id === id)
  if (!block) return ''
  return typeof block.content === 'string' ? block.content : (block.content as AnyState[]).map((c) => c.text ?? '').join('')
}

/** The last user turn's text (a task, or a continuation). */
const lastUserText = (body: AnyState) => JSON.stringify((body.messages as AnyState[]).filter((m) => m.role === 'user').at(-1)?.content ?? '')

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const KEY = 'sk-ant-e2e-test-key'
const ATLAS = { id: 'srvatlas01', name: 'atlas', url: 'https://mcp.example.test/api/atlas/mcp', token: 'atlas-e2e-token-ppi-0001', enabled: true, prompt: 'Atlas is the team tracker. Find tickets with atlas_search.', promptSource: 'auto', tools: ['atlas_search'], checkedAt: 1 }

const STATUS = ['Open', 'In progress', 'Done']
const OWNER = ['Ana', 'Ben', 'Cleo']
const TICKETS = Array.from({ length: 30 }, (_, i) => ({ key: `ATL-${101 + i}`, title: `Checkout issue ${i + 1}`, status: STATUS[i % 3], owner: OWNER[i % 3] }))
const ticketTitle = (x: (typeof TICKETS)[number]) => `${x.key} ${x.title}`

const terminal = (page: Page, name = 'AI terminal') => page.getByRole('region', { name })
const prompt = (page: Page, label = 'Task for the agent') => terminal(page, label === 'Task for the agent' ? 'AI terminal' : 'KI-Terminal').getByRole('textbox', { name: label })

async function runTask(page: Page, task: string, opts: { region?: string; label?: string } = {}) {
  await page.keyboard.press(`${MOD}+j`)
  const field = terminal(page, opts.region).getByRole('textbox', { name: opts.label ?? 'Task for the agent' })
  await expect(field).toBeFocused()
  await field.fill(task)
  await field.press('Enter')
}

const text = (s: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text: s, ...(marks ? { marks } : {}) })
const li = (...content: JSONContent[]): JSONContent => ({ type: 'listItem', content })
const ul = (...items: JSONContent[]): JSONContent => ({ type: 'bulletList', content: items })
const cell = (type: 'tableHeader' | 'tableCell', s: string): JSONContent => ({ type, content: [para(s)] })
const row = (type: 'tableHeader' | 'tableCell', ...cells: string[]): JSONContent => ({ type: 'tableRow', content: cells.map((c) => cell(type, c)) })
const texts = (n: AnyState): string => (n.text ?? (n.type === 'mention' ? `@${n.attrs?.label ?? ''}` : '')) + (n.content ?? []).map(texts).join('')
/** Top-level block types of the stored page (an empty trailing line left out). */
const topTypes = (page: Page, id: string) =>
  wsEval(
    page,
    (s, id) => {
      const list = (s.pages[id]?.content?.content ?? []) as AnyState[]
      const last = list[list.length - 1]
      return (last?.type === 'paragraph' && !last.content?.length ? list.slice(0, -1) : list).map((n) => n.type)
    },
    id,
  )
const contentOf = (page: Page, id: string) => wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.pages[id]?.content ?? null)), id)
const childrenOf = (page: Page, id: string) =>
  wsEval(page, (s, id) => (Object.values(s.pages) as AnyState[]).filter((p) => p.parentId === id && !p.trashed && !p.databaseId).sort((a, b) => a.order - b.order).map((p) => ({ id: p.id, title: p.title, origin: p.contentOrigin })), id)
const toast = (page: Page, re: RegExp) => page.locator('.toast').filter({ hasText: re })

/** The rows of the first table on a page: cells as text (mentions as "@label") and the mention ids of the first column. */
async function tableOf(page: Page, id: string): Promise<{ cells: string[][]; links: string[] }> {
  const c = await contentOf(page, id)
  const find = (n: AnyState): AnyState | null => (n.type === 'table' ? n : ((n.content ?? []) as AnyState[]).map(find).find(Boolean) ?? null)
  const table = find(c)
  if (!table) return { cells: [], links: [] }
  const rows = table.content as AnyState[]
  return {
    cells: rows.map((r) => (r.content as AnyState[]).map((x) => texts(x).trim())),
    links: rows.slice(1).map((r) => {
      const m = ((r.content[0].content?.[0]?.content ?? []) as AnyState[]).find((x) => x.type === 'mention')
      return m?.attrs?.id ?? ''
    }),
  }
}

/** Select from the start of `from` to the end of `to` with a DOM range (ProseMirror picks it up). */
async function selectRange(page: Page, ed: Locator, from: string, to: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await ed.evaluate(
      (root, [a, b]) => {
        const find = (needle: string) => {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
          let node: Node | null
          while ((node = walker.nextNode())) {
            const i = (node as Text).data.indexOf(needle)
            if (i >= 0) return { node, i }
          }
          throw new Error(`text not found: ${needle}`)
        }
        const s = find(a)
        const e = find(b)
        const r = document.createRange()
        r.setStart(s.node, s.i)
        r.setEnd(e.node, e.i + b.length)
        const sel = window.getSelection()!
        sel.removeAllRanges()
        sel.addRange(r)
      },
      [from, to] as const,
    )
    await page.waitForTimeout(150)
    const got = await page.evaluate(() => window.getSelection()?.toString() ?? '')
    if (got.startsWith(from) && got.trimEnd().endsWith(to)) return
  }
  throw new Error('selection did not hold')
}

/** Select `from` … `to`, then the bubble toolbar's Ask AI: resolves with the AI panel. */
async function askAI(page: Page, ed: Locator, from: string, to: string, de = false): Promise<Locator> {
  await ed.locator('p, li, h2, h3, td, th', { hasText: from }).first().click()
  await selectRange(page, ed, from, to)
  await page.locator('[aria-label="Formatting"], [aria-label="Formatierung"]').first().getByRole('button', { name: de ? /^KI fragen$/ : /^Ask AI$/ }).click()
  const ai = page.locator('.ai-panel')
  await expect(ai).toBeVisible()
  await expect(ai.locator('.ai-cmd__input')).toBeFocused()
  return ai
}

/** A bullet list of three tickets with nested details ("Status: …", "Owner: …" and a note). */
const TICKET_LIST = ul(
  li(para('ATL-1 Login fails on Safari'), ul(li(para('Status: Open')), li(para('Owner: Ana'))), para('Users see a blank page after the redirect.')),
  li(para('ATL-2 Cart total is off'), ul(li(para('Status: Done')), li(para('Owner: Ben')))),
  li(para('ATL-3 Coupon field missing'), ul(li(para('Status: Open')), li(para('Owner: Cleo')))),
)

/* ------------------------------------------------------------------ */

test.describe('Pages per item', () => {
  test('AI terminal + mocked Atlas MCP: 30 tickets → create_pages (one call) + a table on the open page; Apply → 30 sub-pages, the table links them', async ({ page, context }) => {
    await openApp(page)
    await wsEval(page, (s, atlas) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', mcpServers: [atlas] }), ATLAS)
    const main = await createPage(page, { title: 'Checkout review', content: doc(para('Topic: checkout reliability.')) })
    await gotoPage(page, main)

    const bodies = await mockClaude(context, [
      // Atlas (run by Anthropic inside the response), then the open page
      () =>
        sseMessage([
          { type: 'mcp_tool_use', id: 'mcptoolu_1', server: 'atlas', name: 'atlas_search', input: { query: 'checkout' } },
          { type: 'mcp_tool_result', id: 'mcptoolu_1', text: TICKETS.map((x) => `${x.key} | ${x.title} | ${x.status} | ${x.owner}`).join('\n') },
          { type: 'tool_use', id: 'toolu_cur', name: 'get_current_page', input: {} },
        ]),
      // every ticket a page, in ONE call
      () =>
        sseMessage([
          {
            type: 'tool_use',
            id: 'toolu_pages',
            name: 'create_pages',
            input: { parent_id: main, pages: TICKETS.map((x) => ({ title: ticketTitle(x), markdown: `**Status:** ${x.status}\n\n**Owner:** ${x.owner}\n\nFrom Atlas: ${x.key}.` })) },
          },
        ]),
      // the table on the main page, with the ids create_pages returned
      (body) => {
        const ids = [...toolResult(body, 'toolu_pages').matchAll(/→ id: ([\w-]+)/g)].map((m) => m[1])
        const rows = TICKETS.map((x, i) => `| [${ticketTitle(x)}](#/p/${ids[i]}) | ${x.status} | ${x.owner} |`)
        return sseMessage([{ type: 'tool_use', id: 'toolu_table', name: 'append_to_page', input: { id: main, markdown: `## Tickets\n\n| Ticket | Status | Owner |\n|---|---|---|\n${rows.join('\n')}` } }])
      },
      () => sseMessage([{ type: 'text', text: 'Staged **30 sub-pages** under Checkout review and a table that links them.' }]),
    ])

    await runTask(page, 'Analyse the topic in Atlas with me and create a One sub-page for every ticket and link them in a table on the main page')
    const term = terminal(page)
    await expect(term.locator('.term-head__status')).toHaveText('Done', { timeout: 30_000 })
    // three tool calls: the page, the pages (ONE call), the table — plus the MCP call
    await expect(term.locator('.term-step[data-tool]')).toHaveCount(3)
    await expect(term.locator('.term-step[data-tool="create_pages"]')).toContainText('Checkout review · 30× page')
    await expect(term.locator('.term-step[data-tool="create_pages"]')).toContainText('Staged #1–30')
    await expect(term.locator('.term-step--mcp')).toHaveCount(1)
    await expect(term.locator('#term-review-title')).toHaveText('31 proposed changes')
    expect(bodies).toHaveLength(4)
    // the request: the tool, the rule in the system prompt, Atlas attached
    expect((bodies[0].tools as AnyState[]).some((x) => x.name === 'create_pages')).toBe(true)
    expect(String(JSON.stringify(bodies[0].system))).toContain('ONE create_pages call')
    expect(bodies[0].mcp_servers.map((x: AnyState) => x.name)).toEqual(['atlas'])
    expect(toolResult(bodies[2], 'toolu_pages')).toContain('Staged 30 pages')

    // nothing written yet; Apply all → 30 sub-pages in order + the table
    expect(await childrenOf(page, main)).toEqual([])
    await term.getByRole('button', { name: 'Apply all' }).click()
    await expect(toast(page, /31 changes applied/)).toBeVisible()
    const kids = await childrenOf(page, main)
    expect(kids.map((k) => k.title)).toEqual(TICKETS.map(ticketTitle))
    const sub = await pageById(page, kids[0].id)
    expect(texts(sub.content)).toContain('Status: Open')
    const table = await tableOf(page, main)
    expect(table.cells[0]).toEqual(['Ticket', 'Status', 'Owner'])
    expect(table.cells).toHaveLength(31)
    // the links are page mentions (not "#/p/…" text), one per sub-page, in order
    expect(table.links).toEqual(kids.map((k) => k.id))
    expect(table.cells[1]).toEqual([`@${ticketTitle(TICKETS[0])}`, 'Open', 'Ana'])
    expect(JSON.stringify(await contentOf(page, main))).not.toContain('#/p/')

    // in the page: a mention in a table cell opens the sub-page
    await page.keyboard.press('Escape')
    const ed = editorOf(page, main)
    const mention = ed.locator('table .mention__page').first()
    await expect(mention).toHaveText(new RegExp(ticketTitle(TICKETS[0])))
    await expect(ed.locator('table .mention__page')).toHaveCount(30)
    await mention.click()
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(`#/p/${kids[0].id}`)
  })

  test('limit + Continue: a task over the tool-call limit stops as "Limit reached"; Continue (key, ↵, /continue) resumes it with a fresh budget, nothing staged twice', async ({ page, context }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    const main = await createPage(page, { title: 'Reading list', content: doc(para('Books for the team.')) })
    await gotoPage(page, main)
    const books = Array.from({ length: 42 }, (_, i) => `Book ${i + 1}`)
    const one = (title: string, i: number, run = 'b'): Block => ({ type: 'tool_use', id: `toolu_${run}${i}`, name: 'create_page', input: { title, markdown: `Notes on ${title}.`, parent_id: main } })
    const bodies = await mockClaude(context, [
      // one page per call (the pattern that ran out before): 42 calls, the limit is 40
      () => sseMessage(books.map((b, i) => one(b, i))),
      () => sseMessage([{ type: 'text', text: 'Reached the limit: 40 of 42 books staged, Book 41 and Book 42 are left.' }]),
      // Continue: the rest
      () => sseMessage([one('Book 41', 41, 'c'), one('Book 42', 42, 'c')]),
      () => sseMessage([{ type: 'text', text: 'Staged the last two books.' }]),
    ])
    await runTask(page, 'Make a page for every book on this list')
    const term = terminal(page)
    await expect(term.locator('.term-head__status')).toHaveText('Limit reached', { timeout: 30_000 })
    await expect(term.locator('.term-step--note', { hasText: 'Tool-call limit reached' })).toBeVisible()
    await expect(term.locator('.term-note')).toContainText('The task stopped at the limit of 40 tool calls')
    await expect(term.locator('#term-review-title')).toHaveText('40 proposed changes')
    // the refused calls told Claude it can go on later
    expect(toolResult(bodies[1], 'toolu_b40')).toContain('the person can let you continue with a fresh budget')
    const go = term.getByTestId('term-continue')
    await expect(go).toBeVisible()
    await expect(term.locator('.term-limit__hint')).toContainText('the 40 staged changes stay')
    await expect(prompt(page)).toHaveAttribute('placeholder', /continues with a fresh budget/)

    // Continue: the same task, a fresh budget — Claude hears what is staged already
    await go.click()
    await expect(term.locator('.term-head__status')).toHaveText('Done', { timeout: 30_000 })
    expect(bodies).toHaveLength(4)
    const cont = lastUserText(bodies[2])
    expect(cont).toContain('Continue the task where you stopped at the tool-call limit')
    expect(cont).toContain('fresh budget of 40 tool calls')
    expect(cont).toContain('40 changes are staged so far')
    expect(cont).toContain('Make a page for every book on this list')
    // the conversation goes on (the first task's turns are still in it)
    expect((bodies[2].messages as AnyState[]).length).toBeGreaterThan(3)
    await expect(term.locator('.term-turn').last().locator('.term-turn__cont')).toHaveText('Continues 01 ·')
    await expect(term.locator('#term-review-title')).toHaveText('42 proposed changes')
    await expect(term.getByTestId('term-continue')).toHaveCount(0)
    await term.getByRole('button', { name: 'Apply all' }).click()
    await expect(toast(page, /42 changes applied/)).toBeVisible()
    expect((await childrenOf(page, main)).map((k) => k.title)).toEqual(books)

    // /continue with nothing to continue says so (no request)
    await prompt(page).fill('/continue')
    await prompt(page).press('Enter')
    await expect(term.locator('.term-echo').last()).toContainText('Nothing to continue')
    expect(bodies).toHaveLength(4)
  })

  test('DE: Limit erreicht → /weiter (and ↵ on the empty prompt) setzt fort', async ({ page, context }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', language: 'de' }))
    const main = await createPage(page, { title: 'Leseliste', content: doc(para('Bücher.')) })
    await gotoPage(page, main)
    const many = (from: number, n: number): Block[] => Array.from({ length: n }, (_, i) => ({ type: 'tool_use', id: `toolu_d${from + i}`, name: 'create_page', input: { title: `Buch ${from + i}`, markdown: 'Notiz.', parent_id: main } }))
    const bodies = await mockClaude(context, [
      () => sseMessage(many(1, 41)),
      () => sseMessage([{ type: 'text', text: 'Limit erreicht, ein Buch fehlt.' }]),
      () => sseMessage(many(42, 41)),
      () => sseMessage([{ type: 'text', text: 'Wieder am Limit.' }]),
      () => sseMessage([{ type: 'text', text: 'Fertig: nichts mehr offen.' }]),
    ])
    await runTask(page, 'Lege für jedes Buch eine Unterseite an', { region: 'KI-Terminal', label: 'Aufgabe für den Agenten' })
    const term = terminal(page, 'KI-Terminal')
    await expect(term.locator('.term-head__status')).toHaveText('Limit erreicht', { timeout: 30_000 })
    await expect(term.getByTestId('term-continue')).toHaveText('Weitermachen')
    await expect(term.locator('.term-note')).toContainText('Limit von 40 Tool-Aufrufen')
    // /weiter
    const field = prompt(page, 'Aufgabe für den Agenten')
    await field.fill('/weiter')
    await field.press('Enter')
    await expect(term.locator('.term-head__status')).toHaveText('Limit erreicht', { timeout: 30_000 })
    expect(lastUserText(bodies[2])).toContain('Continue the task where you stopped')
    await expect(term.locator('.term-turn__cont').first()).toHaveText('Weiter mit 01 ·')
    // ↵ on the empty prompt continues too
    await field.fill('')
    await field.press('Enter')
    await expect(term.locator('.term-head__status')).toHaveText('Fertig', { timeout: 30_000 })
    expect(bodies).toHaveLength(5)
    expect(lastUserText(bodies[4])).toContain('80 changes are staged so far')
  })

  test('AI menu: own requests are routed — make a sub-page / one page per item run at once, "as a board" offers Turn into database, Atlas work goes to the terminal, writing stays a request', async ({ page, context }) => {
    await openApp(page)
    await wsEval(page, (s, atlas) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', mcpServers: [atlas] }), ATLAS)
    const bodies = await mockClaude(context, [() => sseMessage([{ type: 'text', text: 'Looked it up — nothing to change.' }])])
    const id = await createPage(page, { title: 'Sprint notes', content: doc(para('Kickoff on Monday.'), para('Retro on Friday.'), TICKET_LIST, para('Closing words.')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)

    // a writing request stays a request (first key: Ask Claude)
    let ai = await askAI(page, ed, 'Kickoff', 'Retro on Friday.')
    await ai.locator('.ai-cmd__input').fill('make this shorter')
    await expect(ai.getByRole('option').first()).toContainText('Ask Claude')
    // "as a board": Turn into database comes first (offered, not run)
    await ai.locator('.ai-cmd__input').fill('as a board')
    await expect(ai.getByRole('option').first()).toContainText('Turn into database')
    await expect(ai.getByRole('option').first()).toContainText('“as a board”')
    // "make a sub-page out of this" + Enter: Turn into page, no request
    await ai.locator('.ai-cmd__input').fill('make a sub-page out of this')
    await expect(ai.getByRole('option').first()).toContainText('Turn into page')
    await page.keyboard.press('Enter')
    await expect(ai).toHaveCount(0)
    await expect.poll(() => topTypes(page, id)).toEqual(['pageLink', 'bulletList', 'paragraph'])
    await expect(toast(page, /Moved to a new page · Kickoff on Monday\./)).toBeVisible()
    expect(bodies).toHaveLength(0)

    // on the list: Structure offers Sub-page per item, Transform into lists "Pages + table"
    // (Sub-page per item sits under "More …" of the short top level)
    ai = await askAI(page, ed, 'ATL-1 Login', 'Coupon field missing')
    await ai.locator('#ai-row-more').click()
    await expect(ai.getByRole('option', { name: /Sub-page per item/ })).toBeVisible()
    await expect(async () => {
      await page.keyboard.press('Escape')
      await expect(ai).toHaveCount(0, { timeout: 1000 })
    }).toPass()
    ai = await askAI(page, ed, 'ATL-1 Login', 'Coupon field missing')
    await ai.getByRole('option', { name: /Transform into/ }).first().click()
    await expect(ai.getByRole('option', { name: /Pages \+ table/ })).toBeVisible()
    // Esc: back to the list, then closed
    await expect(async () => {
      await page.keyboard.press('Escape')
      await expect(ai).toHaveCount(0, { timeout: 1000 })
    }).toPass({ timeout: 10_000 })
    // "one page per item" on the list + Enter: Sub-page per item
    ai = await askAI(page, ed, 'ATL-1 Login', 'Coupon field missing')
    await ai.locator('.ai-cmd__input').fill('one page per item please')
    await expect(ai.getByRole('option').first()).toContainText('Sub-page per item')
    await page.keyboard.press('Enter')
    await expect.poll(() => topTypes(page, id)).toEqual(['pageLink', 'table', 'paragraph'])
    await expect(toast(page, /Made 3 sub-pages, linked in a table/)).toBeVisible()
    expect(bodies).toHaveLength(0)

    // work in Atlas: the terminal, with the request and the selection as a reference
    ai = await askAI(page, ed, 'Closing', 'Closing words.')
    await ai.locator('.ai-cmd__input').fill('for every ticket in Atlas create a sub-page')
    await expect(ai.getByRole('option').first()).toContainText('This needs the AI terminal — run it there')
    await page.keyboard.press('Enter')
    const term = terminal(page)
    await expect(term).toBeVisible()
    await expect(term.locator('.term-turn__task')).toHaveText('for every ticket in Atlas create a sub-page')
    await expect(term.getByText('Looked it up — nothing to change.')).toBeVisible({ timeout: 20_000 })
    expect(bodies).toHaveLength(1)
    const user = lastUserText(bodies[0])
    expect(user).toContain('<reference page=')
    expect(user).toContain('Closing words.')
    expect(bodies[0].mcp_servers.map((x: AnyState) => x.name)).toEqual(['atlas'])
  })

  test('AI menu DE: "mach daraus eine Unterseite" runs Turn into page, "pro Ticket eine Seite" Sub-page per item, "als Tabelle" offers the database', async ({ page, context }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', language: 'de' }))
    const bodies = await mockClaude(context, [])
    const id = await createPage(page, {
      title: 'Notizen',
      content: doc(para('Erster Gedanke.'), para('Zweiter Gedanke.'), ul(li(para('T-1 Anmeldung'), para('Status: offen')), li(para('T-2 Warenkorb'), para('Status: erledigt'))), para('Schluss.')),
    })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    let ai = await askAI(page, ed, 'Erster', 'Zweiter Gedanke.', true)
    await ai.locator('.ai-cmd__input').fill('als Tabelle')
    await expect(ai.getByRole('option').first()).toContainText('In Datenbank umwandeln')
    await ai.locator('.ai-cmd__input').fill('mach daraus eine Unterseite')
    await expect(ai.getByRole('option').first()).toContainText('In Seite umwandeln')
    await page.keyboard.press('Enter')
    await expect.poll(() => topTypes(page, id)).toEqual(['pageLink', 'bulletList', 'paragraph'])
    await expect(toast(page, /In eine neue Seite verschoben · Erster Gedanke\./)).toBeVisible()

    ai = await askAI(page, ed, 'T-1 Anmeldung', 'T-2 Warenkorb', true)
    await ai.locator('.ai-cmd__input').fill('pro Ticket eine Seite')
    await expect(ai.getByRole('option').first()).toContainText('Unterseite pro Eintrag')
    await page.keyboard.press('Enter')
    await expect.poll(() => topTypes(page, id)).toEqual(['pageLink', 'table', 'paragraph'])
    await expect(toast(page, /2 Unterseiten angelegt, verlinkt in einer Tabelle/)).toBeVisible()
    const table = await tableOf(page, id)
    expect(table.cells[0]).toEqual(['Seite', 'Status'])
    expect(table.cells.slice(1).map((r) => r[1])).toEqual(['offen', 'erledigt'])
    expect((await childrenOf(page, id)).map((k) => k.title)).toEqual(['Erster Gedanke.', 'T-1 Anmeldung', 'T-2 Warenkorb'])
    expect(bodies).toHaveLength(0)
  })

  test('Sub-page per item: a bullet list with nested details → grip → Turn into → Sub-page per item; the table links 3 pages; toast Undo puts the list back', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Bug triage', content: doc(para('Found this week:'), TICKET_LIST, para('Next review on Friday.')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    const editorJSON = () => ed.evaluate((el) => JSON.parse(JSON.stringify((el as HTMLElement & { editor: AnyState }).editor.getJSON())))
    const before = await editorJSON()

    await ed.locator('li p', { hasText: 'ATL-1 Login' }).click()
    await selectRange(page, ed, 'ATL-1 Login', 'Owner: Cleo')
    await ed.locator('li p', { hasText: 'ATL-2 Cart' }).hover()
    const grip = page.getByRole('button', { name: /^Block menu$/ })
    await expect(grip).toBeVisible()
    await grip.click()
    const menu = page.locator('[data-popover][role="menu"]').first()
    await menu.getByRole('menuitem', { name: 'Turn into', exact: true }).click()
    const item = page.getByRole('menuitem', { name: /^Sub-page per item · 3 items/ })
    await expect(item).toBeVisible()
    await item.click()

    // here: the intro, ONE table, the outro
    await expect.poll(() => topTypes(page, id)).toEqual(['paragraph', 'table', 'paragraph'])
    await expect(toast(page, /Made 3 sub-pages, linked in a table/)).toBeVisible()
    const kids = await childrenOf(page, id)
    expect(kids.map((k) => [k.title, k.origin])).toEqual([
      ['ATL-1 Login fails on Safari', 'split'],
      ['ATL-2 Cart total is off', 'split'],
      ['ATL-3 Coupon field missing', 'split'],
    ])
    const table = await tableOf(page, id)
    expect(table.cells).toEqual([
      ['Page', 'Status', 'Owner'],
      ['@ATL-1 Login fails on Safari', 'Open', 'Ana'],
      ['@ATL-2 Cart total is off', 'Done', 'Ben'],
      ['@ATL-3 Coupon field missing', 'Open', 'Cleo'],
    ])
    expect(table.links).toEqual(kids.map((k) => k.id))
    // the first page holds the nested details (the list + the note), not its title line
    const first = await pageById(page, kids[0].id)
    expect(first.content.content.map((n: AnyState) => n.type)).toEqual(['bulletList', 'paragraph'])
    expect(texts(first.content)).toBe('Status: OpenOwner: AnaUsers see a blank page after the redirect.')
    await expect(ed.locator('table .mention__page')).toHaveCount(3)

    // the toast's Undo: the list back as it was, the pages in the trash
    await toast(page, /Made 3 sub-pages/).getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => topTypes(page, id)).toEqual(['paragraph', 'bulletList', 'paragraph'])
    expect(JSON.stringify((await editorJSON()).content)).toBe(JSON.stringify(before.content))
    for (const k of kids) await expect.poll(async () => (await pageById(page, k.id)).trashed).toBe(true)
  })

  test('Sub-page per item: heading sections (the intro stays) and a table (rows → pages, "Column: value" bodies); ⌘Z undoes in one step', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, {
      title: 'Team',
      content: doc(
        para('Who does what.'),
        heading(2, 'Alpha'),
        para('Status: Active'),
        para('Owns the checkout.'),
        heading(3, 'Notes'),
        para('Hiring one more.'),
        heading(2, 'Beta'),
        para('Status: Paused'),
        para('Owns search.'),
      ),
    })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    // block selection over the sections (from the first heading on): the grip menu of selected blocks
    await ed.locator('h2, h3', { hasText: 'Alpha' }).first().click()
    await selectRange(page, ed, 'Alpha', 'Owns search.')
    await page.keyboard.press('Alt+Enter')
    const menu = page.locator('[data-popover][role="menu"]').first()
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Turn into', exact: true }).click()
    await page.getByRole('menuitem', { name: /^Sub-page per item · 2 items/ }).click()
    await expect.poll(() => topTypes(page, id)).toEqual(['paragraph', 'table'])
    const kids = await childrenOf(page, id)
    expect(kids.map((k) => k.title)).toEqual(['Alpha', 'Beta'])
    const alpha = await pageById(page, kids[0].id)
    expect(alpha.content.content.map((n: AnyState) => n.type)).toEqual(['paragraph', 'paragraph', 'heading', 'paragraph'])
    expect((await tableOf(page, id)).cells).toEqual([
      ['Page', 'Status'],
      ['@Alpha', 'Active'],
      ['@Beta', 'Paused'],
    ])
    // ⌘Z: one step back, the pages in the trash
    await ed.focus()
    await page.keyboard.press(`${MOD}+z`)
    await expect.poll(() => topTypes(page, id)).toEqual(['paragraph', 'heading', 'paragraph', 'paragraph', 'heading', 'paragraph', 'heading', 'paragraph', 'paragraph'])
    for (const k of kids) await expect.poll(async () => (await pageById(page, k.id)).trashed).toBe(true)

    // a table: header names the columns, every row a page
    const t2 = await createPage(page, {
      title: 'Vendors',
      content: doc({ type: 'table', content: [row('tableHeader', 'Name', 'Status', 'Contact'), row('tableCell', 'Acme', 'Signed', 'jo@acme.test'), row('tableCell', 'Globex', 'Talking', '')] }, para('After.')),
    })
    await gotoPage(page, t2)
    const ed2 = editorOf(page, t2)
    await ed2.getByText('Acme', { exact: true }).hover()
    const grip = page.getByRole('button', { name: /^Block menu$/ })
    await expect(grip).toBeVisible()
    await grip.click()
    // a cell's text: the entry sits in its Turn into list (the table itself has it on its own)
    const tableMenu = page.locator('[data-popover][role="menu"]').first()
    await expect(tableMenu).toBeVisible()
    const direct = page.getByRole('menuitem', { name: /^Sub-page per item · 2 items/ })
    if (!(await direct.isVisible())) await tableMenu.getByRole('menuitem', { name: 'Turn into', exact: true }).click()
    await direct.click()
    // the new table replaces the old one (the same block types: wait for its content)
    await expect.poll(async () => (await tableOf(page, t2)).cells).toEqual([
      ['Page', 'Status', 'Contact'],
      ['@Acme', 'Signed', 'jo@acme.test'],
      ['@Globex', 'Talking', ''],
    ])
    expect(await topTypes(page, t2)).toEqual(['table', 'paragraph'])
    const vendors = await childrenOf(page, t2)
    expect(vendors.map((k) => k.title)).toEqual(['Acme', 'Globex'])
    expect(texts((await pageById(page, vendors[0].id)).content)).toBe('Status: SignedContact: jo@acme.test')
    expect((await tableOf(page, t2)).links).toEqual(vendors.map((k) => k.id))
  })

  test('Sub-page per item: a private parent goes through createPrivatePage (no team cloud here: refused, nothing written); Transform into → Pages + table; 390 px', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'Mine', content: doc(TICKET_LIST) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    // marked private (the team binding's marker): new pages would have to be private too — outside a team workspace that is refused
    await wsEval(page, (s, id) => s.updatePage(id, { private: true }), id)
    await ed.locator('li p', { hasText: 'ATL-1 Login' }).click()
    await selectRange(page, ed, 'ATL-1 Login', 'Owner: Cleo')
    await page.keyboard.press('Alt+Enter')
    let menu = page.locator('[data-popover][role="menu"]').first()
    await menu.getByRole('menuitem', { name: 'Turn into', exact: true }).click()
    await page.getByRole('menuitem', { name: /^Sub-page per item · 3 items/ }).click()
    await expect(toast(page, /The new page could not be created/)).toBeVisible()
    await expect.poll(() => topTypes(page, id)).toEqual(['bulletList'])
    expect(await childrenOf(page, id)).toEqual([])
    await wsEval(page, (s, id) => s.updatePage(id, { private: false }), id)

    // 390 px: every block selected (⌘A twice), the block menu fits, Transform into → Pages + table works there
    await page.setViewportSize({ width: 390, height: 844 })
    await ed.locator('li p', { hasText: 'ATL-1 Login' }).click()
    await page.keyboard.press(`${MOD}+a`)
    await page.keyboard.press(`${MOD}+a`)
    await expect(ed.locator('.is-block-selected').first()).toBeVisible()
    await page.keyboard.press('Alt+Enter')
    menu = page.locator('[data-popover][role="menu"]').first()
    await expect(menu).toBeVisible()
    const box = await menu.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    await menu.getByRole('menuitem', { name: /^Transform into/ }).click()
    const item = page.getByRole('menuitem', { name: /^Pages \+ table/ })
    await expect(item).toBeVisible()
    const itemBox = await item.boundingBox()
    expect(itemBox!.x + itemBox!.width).toBeLessThanOrEqual(390)
    await item.click()
    await expect.poll(() => topTypes(page, id)).toEqual(['table'])
    expect((await childrenOf(page, id)).map((k) => k.title)).toEqual(['ATL-1 Login fails on Safari', 'ATL-2 Cart total is off', 'ATL-3 Coupon field missing'])
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  })
})
