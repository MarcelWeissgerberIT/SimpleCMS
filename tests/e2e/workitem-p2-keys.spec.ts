/**
 * Task block P2 — keyboard only and touch only, each with its Undo: Make tasks on a selection (the block menu →
 * Transform into → Tasks) and at the cursor (make_tasks), Make tasks in meeting notes, a terminal change holding tasks,
 * a held agent change (apply / discard), an MCP task change (approve). The caret is placed once per test (setup);
 * everything after it is keys or taps only. Claude is mocked; the MCP part runs its own bridge port. Fictional data.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { BrowserContext, CDPSession, Locator, Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { Client } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StdioClientTransport } from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js'
import { test, expect, openApp, wsEval, createPage, gotoPage, editorOf, flush, sse, MOD } from './fixtures'
import { call, mockAgent, openTerminal, prompt, say, setKey, terminal, type AnyState } from './helpers/terminal'

const p = (text: string): JSONContent => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' })
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })
const day = (offset: number) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function tasksIn(d: JSONContent | null | undefined): Array<AnyState & { title: string }> {
  const out: Array<AnyState & { title: string }> = []
  const text = (n: JSONContent): string => n.text ?? (n.content ?? []).map(text).join('')
  const walk = (n: JSONContent) => {
    if (n.type === 'workItem') out.push({ ...(n.attrs ?? {}), title: text(n.content?.[0] ?? {}) })
    for (const c of n.content ?? []) walk(c)
  }
  if (d) walk(d)
  return out
}
const contentOf = (page: Page, id: string) => wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.pages[id]?.content ?? null)), id)
const taskTitles = async (page: Page, id: string) => tasksIn(await contentOf(page, id)).map((t) => t.title.trim())
const panel = (page: Page) => page.locator('.ai-panel')
const row = (page: Page, id: string) => panel(page).locator(`#ai-row-${id}`)
const toastKey = (page: Page, text: RegExp | string) => page.locator('.toast').filter({ hasText: text }).getByRole('button', { name: 'Undo' })

/** api.anthropic.com → a streamed answer (the AI menu) or a structured one (Transform → Tasks). */
async function mockMenu(ctx: BrowserContext, answers: { stream?: string; json?: object }) {
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (req.method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [], has_more: false }) })
    const body = JSON.parse(req.postData() ?? '{}')
    try {
      if (body.stream === true) return await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse(answers.stream ?? 'ok') })
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'msg_e2e', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(answers.json ?? {}) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }),
      })
    } catch {
      /* the page went away */
    }
  })
}

const PLAN = {
  items: [
    { title: 'Draft the launch copy', notes: [], status: 'todo', owners: ['Alex'], due: null, blockedBy: [], from: [1] },
    { title: 'Book the venue', notes: [], status: 'todo', owners: [], due: null, blockedBy: [1], from: [2] },
  ],
  keep: [],
  left: [],
}
const MAKE = `> [!TODO] Draft the launch copy\n> Owner: Alex\n\n> [!TODO] Book the venue\n> Blocked by: Draft the launch copy`

/** The caret at the start of the text `needle` (setup only — placed once, like a click would). */
async function caretAt(page: Page, id: string, needle: string | null) {
  await editorOf(page, id).evaluate((root, needle) => {
    const e = (root as unknown as { editor: AnyState }).editor
    let at = e.state.doc.content.size - 1
    if (needle)
      e.state.doc.descendants((n: AnyState, pos: number) => {
        if (n.isText && n.text.includes(needle) && at === e.state.doc.content.size - 1) at = pos + n.text.indexOf(needle)
      })
    e.chain().focus().setTextSelection(at).run()
  }, needle)
  await page.waitForTimeout(150)
}

function meetingDoc(alex: string): JSONContent {
  const todo = (content: JSONContent[]): JSONContent => ({ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content }] })
  return doc(
    {
      type: 'meetingNotes',
      attrs: { id: 'mtg-keys', title: 'Nordlicht sync', status: 'done', language: 'en-US', startedAt: Date.now() - 3_600_000, endedAt: Date.now() - 600_000, duration: 2_940_000, transcript: [] },
      content: [
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Action items' }] },
        { type: 'taskList', content: [todo([{ type: 'text', text: 'Send the deck ' }, { type: 'mention', attrs: { id: alex, label: 'Alex', kind: 'person' } }]), todo([{ type: 'text', text: 'Call the printer' }])] },
      ],
    },
    p(''),
  )
}

/** Long-press the touch grip of the block holding `text` (selects it), CDP touch events. */
async function longPressGrip(page: Page, cdp: CDPSession) {
  const grip = page.locator('.touch-grip')
  await expect(grip).toBeVisible()
  const box = (await grip.boundingBox())!
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
  await page.waitForTimeout(650)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

/** An agent in apply mode whose run stages a held owner task (page 1) and a held reminder task (page 2). */
async function heldRun(page: Page, context: BrowserContext, pageId: string, otherId: string): Promise<Locator> {
  await mockAgent(context, [
    call('c1', 'append_to_page', { id: pageId, markdown: '> [!TODO] Order shirts\n> Owner: Alex' }),
    call('c2', 'append_to_page', { id: otherId, markdown: `> [!TODO] Call the caterer\n> Due: ${day(3)} · Reminder: -1d` }),
    say('Planned.'),
  ])
  const agent = 'ag-keys-held'
  await wsEval(
    page,
    (s, { a, pageId, otherId }) => {
      const now = Date.now()
      s.upsertAgent({ id: a, name: 'Trip planner', instructions: 'Plan the trip.', trigger: { type: 'manual' }, scope: { everything: false, pages: [pageId, otherId], databases: [] }, write: 'apply', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdAt: now, updatedAt: now })
    },
    { a: agent, pageId, otherId },
  )
  await flush(page)
  await page.evaluate((a) => (window.location.hash = `#/agents/${a}`), agent)
  await expect(page.locator('.agx-dhead')).toBeVisible()
  return page.getByRole('button', { name: 'Run now' })
}

/* ------------------------------------------------------------------ keyboard only */

test.describe('keyboard only', () => {
  test('Make tasks on a selection: Esc, Shift+↓, Alt+Enter → Transform into → Tasks, Enter applies; ⌘Z undoes', async ({ page, context }) => {
    await mockMenu(context, { json: PLAN })
    await openApp(page)
    await setKey(page)
    const id = await createPage(page, { title: 'Keys selection', content: doc(p('Next steps:'), p('Alex drafts the launch copy.'), p('Then the venue gets booked.'), p('')) })
    await gotoPage(page, id)
    await caretAt(page, id, 'Alex drafts')
    // Esc selects the block, Shift+↓ grows the selection, Alt+Enter opens its menu
    await page.keyboard.press('Escape')
    await page.keyboard.press('Shift+ArrowDown')
    await expect(editorOf(page, id).locator('.is-block-selected')).toHaveCount(2)
    await page.keyboard.press('Alt+Enter')
    const menu = page.locator('[data-popover][role="menu"]').first()
    await expect(menu).toBeVisible()
    await page.keyboard.type('transform')
    await page.keyboard.press('Enter')
    const tasksItem = page.getByRole('menuitem', { name: 'Tasks', exact: true })
    await expect(tasksItem).toBeVisible()
    const sub = page.getByRole('menu').filter({ has: tasksItem })
    for (let i = 0; i < 12 && (await sub.locator('[data-active="true"]').innerText()).trim() !== 'Tasks'; i++) await page.keyboard.press('ArrowDown')
    await expect(tasksItem).toHaveAttribute('data-active', 'true')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('transform-preview').locator('.item-facts__row')).toHaveCount(2)
    await page.keyboard.press('Enter')
    await expect(panel(page)).toHaveCount(0)
    await flush(page)
    expect(await taskTitles(page, id)).toEqual(['Draft the launch copy', 'Book the venue'])
    await page.keyboard.press(`${MOD}+z`)
    await expect.poll(() => taskTitles(page, id)).toEqual([])
  })

  test('Make tasks at the cursor: Space, "make tasks", Enter, Enter inserts; ⌘Z undoes', async ({ page, context }) => {
    await mockMenu(context, { stream: MAKE })
    await openApp(page)
    await setKey(page)
    const id = await createPage(page, { title: 'Keys cursor', content: doc(p('Alex drafts the copy, then the venue gets booked.'), p('')) })
    await gotoPage(page, id)
    await caretAt(page, id, null)
    await page.keyboard.press('Space')
    await expect(panel(page)).toBeVisible()
    await page.keyboard.type('make tasks')
    await page.keyboard.press('Enter')
    await expect(panel(page).locator('.ai-out')).toHaveAttribute('data-phase', 'done')
    await expect(panel(page).getByTestId('ai-items').locator('.item-facts__row')).toHaveCount(2)
    await page.keyboard.press('Enter')
    await expect(panel(page)).toHaveCount(0)
    await flush(page)
    expect(await taskTitles(page, id)).toEqual(['Draft the launch copy', 'Book the venue'])
    await expect(page.locator('.toast').filter({ hasText: '2 tasks made' })).toBeVisible()
    await page.keyboard.press(`${MOD}+z`)
    await expect.poll(() => taskTitles(page, id)).toEqual([])
  })

  test('meeting notes: Esc selects the heading, Tab reaches "Make tasks", Enter makes them, focus back in the text; ⌘Z undoes; Esc leaves the keys', async ({ page }) => {
    await openApp(page)
    const alex = await wsEval(page, (s) => s.people.find((x: { name: string }) => x.name === 'Alex').id as string)
    const id = await createPage(page, { title: 'Keys meeting', content: meetingDoc(alex) })
    await gotoPage(page, id)
    const key = page.locator('[data-meeting-key="items"]')
    await expect(key).toHaveText(/Make tasks \(2\)/)
    await caretAt(page, id, 'Action items')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Tab')
    await expect(key).toBeFocused()
    // Escape goes back to the text, Tab comes back
    await page.keyboard.press('Escape')
    await expect(editorOf(page, id)).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(key).toBeFocused()
    await page.keyboard.press('Enter')
    await flush(page)
    expect(await taskTitles(page, id)).toEqual(['Send the deck', 'Call the printer'])
    await expect(editorOf(page, id)).toBeFocused()
    await page.keyboard.press(`${MOD}+z`)
    await expect.poll(() => taskTitles(page, id)).toEqual([])
  })

  test('terminal: run, Tab into the review, Enter applies the change holding tasks, u undoes', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const id = await createPage(page, { title: 'Keys terminal', content: doc(p('Kick-off notes.')) })
    await gotoPage(page, id)
    await mockAgent(context, [call('t1', 'append_to_page', { id, markdown: '> [!TODO] Draft copy\n> Owner: Alex\n\n> [!TODO] Ship pricing' }), say('Staged.')])
    await openTerminal(page)
    await page.keyboard.type('Plan the copy work')
    await page.keyboard.press('Enter')
    await expect(terminal(page).locator('.term-turn').last()).toHaveAttribute('data-status', /done/, { timeout: 30_000 })
    const card = terminal(page).locator('.term-change').first()
    await expect(card.getByTestId('item-facts')).toBeVisible()
    await expect(prompt(page)).toBeFocused()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await expect(card).toHaveAttribute('data-status', 'applied')
    await flush(page)
    expect(await taskTitles(page, id)).toEqual(['Draft copy', 'Ship pricing'])
    await page.keyboard.press('u')
    await expect(card).toHaveAttribute('data-status', 'pending')
    expect(await taskTitles(page, id)).toEqual([])
  })

  test('agent: a held change applied by Enter, undone by Enter on its Undo (K, Tab); another discarded by Enter', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const id = await createPage(page, { title: 'Keys agent', content: doc(p('Trip notes.')) })
    const other = await createPage(page, { title: 'Keys agent catering', content: doc(p('Catering notes.')) })
    const runNow = await heldRun(page, context, id, other)
    await runNow.focus()
    await page.keyboard.press('Enter')
    const runRow = page.locator('.agx-run').first()
    await expect(runRow).toHaveAttribute('data-status', /staged/, { timeout: 30_000 })
    const head = runRow.locator('.agx-run__head')
    if ((await head.getAttribute('aria-expanded')) !== 'true') {
      await head.focus()
      await page.keyboard.press('Enter')
    }
    expect(await taskTitles(page, id)).toEqual([])
    const apply1 = runRow.getByRole('button', { name: 'Apply #1' })
    await apply1.focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => taskTitles(page, id)).toEqual(['Order shirts'])
    // the review's focus rule: on to the next open proposal; K comes back to #1, Tab reaches its Undo
    await expect(runRow.locator('.agent-change[data-n="2"]')).toBeFocused()
    await page.keyboard.press('k')
    await expect(runRow.locator('.agent-change[data-n="1"]')).toBeFocused()
    await page.keyboard.press('Tab')
    const undo1 = runRow.getByRole('button', { name: 'Undo #1' })
    await expect(undo1).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(() => taskTitles(page, id)).toEqual([])
    const discard2 = runRow.getByRole('button', { name: 'Discard #2' })
    await discard2.focus()
    await page.keyboard.press('Enter')
    await expect(runRow.locator('.agent-change[data-n="2"]')).toHaveAttribute('data-status', 'discarded')
    expect(await taskTitles(page, id)).toEqual([])
    expect(await taskTitles(page, other)).toEqual([])
  })
})

/* ------------------------------------------------------------------ touch only */

test.describe('touch only', () => {
  test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', hasTouch: true, isMobile: true })

  test('Make tasks on a selection: long-press the grip, tap to extend, the grip menu → Transform into → Tasks, tap Transform; the toast undoes', async ({ page, context }) => {
    await mockMenu(context, { json: PLAN })
    await openApp(page)
    await setKey(page)
    const id = await createPage(page, { title: 'Touch selection', content: doc(p('Alex drafts the launch copy.'), p('Then the venue gets booked.'), p('')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p', { hasText: 'Alex drafts' }).tap()
    await longPressGrip(page, await context.newCDPSession(page))
    await ed.locator('p', { hasText: 'venue gets booked' }).tap()
    await expect(ed.locator('.is-block-selected')).toHaveCount(2)
    await page.getByRole('button', { name: 'Block menu · 2 blocks' }).tap()
    const menu = page.locator('[data-popover][role="menu"]').first()
    await menu.getByRole('menuitem', { name: /^Transform into/ }).tap()
    await page.getByRole('menuitem', { name: /^Tasks/ }).tap()
    await expect(page.getByTestId('transform-preview').locator('.item-facts__row')).toHaveCount(2)
    await page.waitForTimeout(500)
    await row(page, 'transform-apply').tap()
    await expect(panel(page)).toHaveCount(0)
    await flush(page)
    expect(await taskTitles(page, id)).toEqual(['Draft the launch copy', 'Book the venue'])
    await toastKey(page, /Transformed/).tap()
    await expect.poll(() => taskTitles(page, id)).toEqual([])
  })

  test('Make tasks at the cursor: tap the empty line, its grip → Ask AI → Make tasks, tap Insert; the toast undoes', async ({ page, context }) => {
    await mockMenu(context, { stream: MAKE })
    await openApp(page)
    await setKey(page)
    const id = await createPage(page, { title: 'Touch cursor', content: doc(p('Alex drafts the copy, then the venue gets booked.'), p('')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p').last().tap()
    await page.locator('.touch-grip').tap()
    await page.locator('[data-popover][role="menu"]').first().getByRole('menuitem', { name: /^Ask AI/ }).tap()
    await expect(panel(page)).toBeVisible()
    await page.waitForTimeout(500)
    await row(page, 'workItems').tap()
    await expect(panel(page).locator('.ai-out')).toHaveAttribute('data-phase', 'done')
    await row(page, 'insert').tap()
    await expect(panel(page)).toHaveCount(0)
    await flush(page)
    expect(await taskTitles(page, id)).toEqual(['Draft the launch copy', 'Book the venue'])
    await toastKey(page, '2 tasks made').tap()
    await expect.poll(() => taskTitles(page, id)).toEqual([])
  })

  test('meeting notes: tap "Make tasks"; the toast undoes', async ({ page }) => {
    await openApp(page)
    const alex = await wsEval(page, (s) => s.people.find((x: { name: string }) => x.name === 'Alex').id as string)
    const id = await createPage(page, { title: 'Touch meeting', content: meetingDoc(alex) })
    await gotoPage(page, id)
    await page.locator('[data-meeting-key="items"]').tap()
    await flush(page)
    expect(await taskTitles(page, id)).toEqual(['Send the deck', 'Call the printer'])
    await toastKey(page, '2 tasks made').tap()
    await expect.poll(() => taskTitles(page, id)).toEqual([])
  })

  test('terminal: tap Apply on the change holding tasks; the toast undoes', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const id = await createPage(page, { title: 'Touch terminal', content: doc(p('Kick-off notes.')) })
    await gotoPage(page, id)
    await mockAgent(context, [call('t1', 'append_to_page', { id, markdown: '> [!TODO] Draft copy\n> Owner: Alex' }), say('Staged.')])
    // opening the terminal and sending the task are not the point here
    await openTerminal(page)
    await prompt(page).fill('Plan the copy work')
    await prompt(page).press('Enter')
    await expect(terminal(page).locator('.term-turn').last()).toHaveAttribute('data-status', /done/, { timeout: 30_000 })
    const card = terminal(page).locator('.term-change').first()
    await card.getByRole('button', { name: /^Apply #1/ }).tap()
    await expect(card).toHaveAttribute('data-status', 'applied')
    await flush(page)
    expect(await taskTitles(page, id)).toEqual(['Draft copy'])
    await toastKey(page, /applied/).tap()
    await expect.poll(() => taskTitles(page, id)).toEqual([])
  })

  test('agent: tap Apply on a held change, tap its Undo; tap Discard ▾ → No reason on another', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const id = await createPage(page, { title: 'Touch agent', content: doc(p('Trip notes.')) })
    const other = await createPage(page, { title: 'Touch agent catering', content: doc(p('Catering notes.')) })
    await (await heldRun(page, context, id, other)).tap()
    const runRow = page.locator('.agx-run').first()
    await expect(runRow).toHaveAttribute('data-status', /staged/, { timeout: 30_000 })
    const head = runRow.locator('.agx-run__head')
    if ((await head.getAttribute('aria-expanded')) !== 'true') await head.tap()
    await runRow.getByRole('button', { name: 'Apply #1' }).tap()
    await expect.poll(() => taskTitles(page, id)).toEqual(['Order shirts'])
    await runRow.getByRole('button', { name: 'Undo #1' }).tap()
    await expect.poll(() => taskTitles(page, id)).toEqual([])
    // touch screens: "Discard ▾" opens the reasons; "No reason" discards without one
    await runRow.getByRole('button', { name: 'Discard #2' }).tap()
    await runRow.getByRole('group', { name: 'Discard #2 with a reason' }).getByRole('button', { name: 'No reason' }).tap()
    await expect(runRow.locator('.agent-change[data-n="2"]')).toHaveAttribute('data-status', 'discarded')
    expect(await taskTitles(page, id)).toEqual([])
    expect(await taskTitles(page, other)).toEqual([])
  })
})

/* ------------------------------------------------------------------ MCP: keyboard and touch */

const BRIDGE = fileURLToPath(new URL('../../public/mcp/one-mcp.mjs', import.meta.url))
const PORT = 47395

test.describe('MCP task change', () => {
  test.describe.configure({ mode: 'serial' })
  let client: Client
  let stderr = ''

  test.beforeAll(async () => {
    expect(existsSync(BRIDGE), 'public/mcp/one-mcp.mjs (npm run build:mcp)').toBe(true)
    const transport = new StdioClientTransport({ command: process.execPath, args: [BRIDGE], env: { PATH: process.env.PATH ?? '', ONE_MCP_PORT: String(PORT), ONE_MCP_WAIT_MS: '8000' }, stderr: 'pipe' })
    transport.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    client = new Client({ name: 'claude-code', version: '2.0.0' })
    await client.connect(transport)
    await expect.poll(() => stderr).toContain(`ws://127.0.0.1:${PORT}`)
  })

  test.afterAll(async () => {
    await client?.close()
  })

  type ToolResult = { content?: Array<{ type: string; text?: string }>; isError?: boolean }
  const callTool = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args }) as Promise<ToolResult>
  const json = (r: ToolResult) => JSON.parse((r.content ?? []).map((c) => c.text ?? '').join(''))

  async function connect(page: Page) {
    await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
    await page.getByRole('tab', { name: /Agents · MCP|Agenten · MCP/ }).click()
    const port = page.getByLabel('Port', { exact: true })
    await port.fill(String(PORT))
    await port.press('Enter')
    await page.getByRole('switch', { name: 'Allow AI agents on this computer' }).click()
    await expect(page.getByTestId('mcp-state')).toContainText('Connected')
    let list: AnyState = { workspaces: [] }
    await expect
      .poll(async () => {
        list = json(await callTool('one_list_workspaces'))
        return list.workspaces.length
      })
      .toBe(1)
    // a fresh browser is a new workspace: address it once, so calls without a workspace go to it
    if (list.lastUsed && list.lastUsed.id !== list.workspaces[0].id) json(await callTool('one_list_databases', { workspace: list.workspaces[0].id }))
    await page.getByRole('radio', { name: 'Apply directly' }).click()
    await page.keyboard.press('Escape')
  }

  test('keyboard: the card takes focus, Enter approves the task with an owner; the toast\'s Undo by Enter', async ({ page }) => {
    await openApp(page)
    const id = await createPage(page, { title: 'MCP keys', content: doc(p('Errands.')) })
    await connect(page)
    const asked = callTool('one_update_page', { id, mode: 'append', markdown: '> [!TODO] Order shirts\n> Owner: Alex' })
    const card = page.locator('.mcp-card')
    await expect(card).toBeVisible()
    await expect(card.getByRole('button', { name: /Approve/ })).toBeFocused()
    await page.keyboard.press('Enter')
    expect((await asked).isError).toBeFalsy()
    await expect.poll(() => taskTitles(page, id)).toEqual(['Order shirts'])
    const undo = page.locator('.toast').getByRole('button', { name: 'Undo' }).first()
    await undo.focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => taskTitles(page, id)).toEqual([])
  })

  test.describe('touch', () => {
    test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', hasTouch: true, isMobile: true })

    test('tap Approve on the task with an owner; tap the toast\'s Undo', async ({ page }) => {
      await openApp(page)
      const id = await createPage(page, { title: 'MCP touch', content: doc(p('Errands.')) })
      await connect(page)
      const asked = callTool('one_update_page', { id, mode: 'append', markdown: '> [!TODO] Order shirts\n> Owner: Alex' })
      const card = page.locator('.mcp-card')
      await expect(card).toBeVisible()
      await page.waitForTimeout(500)
      await card.getByRole('button', { name: /Approve/ }).tap()
      expect((await asked).isError).toBeFalsy()
      await expect.poll(() => taskTitles(page, id)).toEqual(['Order shirts'])
      await page.locator('.toast').getByRole('button', { name: 'Undo' }).first().tap()
      await expect.poll(() => taskTitles(page, id)).toEqual([])
    })
  })
})
