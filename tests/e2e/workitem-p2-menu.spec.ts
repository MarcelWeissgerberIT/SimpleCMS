/**
 * Task block P2 — the AI menu writes tasks: "Make tasks" on selected blocks (Transform → Tasks: JSON answer, preview with
 * the facts, owners only from the workspace's people), "Make tasks" at the cursor (the page-level action `make_tasks`:
 * Markdown through the settle gate, an echo of an existing task left out), the intent routing, free-form answers holding
 * `[!TODO]` quotes, Replace over whole tasks (settled again at Replace), the safe insert point, and meeting notes
 * "Make tasks". Claude is mocked (streamed answers + structured answers) — nothing reaches api.anthropic.com.
 * Test data is fictional.
 */
import type { BrowserContext, Locator, Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { requestIntent } from '../../src/app/features/ai/intent'
import { test, expect, openApp, wsEval, createPage, gotoPage, editorOf, flush, sse, MOD } from './fixtures'
import { mockAgent, openTerminal, run as runTerminal, say, setKey as setTermKey, terminal } from './helpers/terminal'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const p = (text: string): JSONContent => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' })
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })
const li = (text: string): JSONContent => ({ type: 'listItem', content: [p(text)] })
const bullets = (...items: string[]): JSONContent => ({ type: 'bulletList', content: items.map(li) })
const item = (attrs: Record<string, unknown>, title: string, ...notes: JSONContent[]): JSONContent => ({ type: 'workItem', attrs: { status: 'todo', ...attrs }, content: [p(title), ...notes] })

const A = 'wi_aaaaaaaaaa'
const B = 'wi_bbbbbbbbbb'

/** Every task of a doc (document order, any depth): its attrs + title. */
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
const topTypes = async (page: Page, id: string) => {
  const c = await contentOf(page, id)
  const list = (c?.content ?? []) as JSONContent[]
  const last = list[list.length - 1]
  return (last?.type === 'paragraph' && !last.content?.length ? list.slice(0, -1) : list).map((n) => n.type)
}
const peopleIds = (page: Page) => wsEval(page, (s) => Object.fromEntries((s.people as Array<{ id: string; name: string }>).map((x) => [x.name, x.id])) as Record<string, string>)
const peopleCount = (page: Page) => wsEval(page, (s) => s.people.length as number)
const setKey = (page: Page) => wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
const panel = (page: Page) => page.locator('.ai-panel')
const row = (page: Page, id: string) => panel(page).locator(`#ai-row-${id}`)
const rowIds = (ai: Locator) => ai.locator('.ai-row').evaluateAll((els) => els.map((e) => e.id.replace(/^ai-row-/, '')))
const day = (offset: number) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const gate = (page: Page, v: boolean | null) => page.evaluate((v) => (window as unknown as { __oneItems: { forceCanCreate(v: boolean | null): void } }).__oneItems.forceCanCreate(v), v)

/* ------------------------------------------------------------------ the Claude mock */

interface Captured {
  stream: boolean
  system: string
  prompt: string
}

/**
 * api.anthropic.com → a streamed answer (the AI menu's own requests) or a structured one (Transform → Tasks).
 * `stream` / `json` are called per request (n: 1-based count of that kind).
 */
async function mockMenu(ctx: BrowserContext, answers: { stream?: (n: number) => string; json?: (n: number) => object }): Promise<Captured[]> {
  const captured: Captured[] = []
  let streams = 0
  let jsons = 0
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (req.method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [], has_more: false, first_id: null, last_id: null }) })
    const body = JSON.parse(req.postData() ?? '{}')
    const system = typeof body.system === 'string' ? body.system : JSON.stringify(body.system ?? '')
    const stream = body.stream === true
    captured.push({ stream, system, prompt: String(body.messages?.[0]?.content ?? '') })
    try {
      if (stream) {
        const text = answers.stream?.(++streams) ?? 'ok'
        return await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse(text) })
      }
      const value = answers.json?.(++jsons) ?? {}
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'msg_e2e', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(value) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 600, output_tokens: 300 } }),
      })
    } catch {
      /* the page went away */
    }
  })
  return captured
}

/* ------------------------------------------------------------------ opening the menu */

/** Select from the start of `from` to the end of `to` (DOM range — ProseMirror picks it up). */
async function selectRange(page: Page, editor: Locator, from: string, to: string, at = 0): Promise<void> {
  const select = () =>
    editor.evaluate(
      (root, [a, b, at]) => {
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
        r.setStart(s.node, s.i + (at as number))
        r.setEnd(e.node, e.i + b.length)
        const sel = window.getSelection()!
        sel.removeAllRanges()
        sel.addRange(r)
      },
      [from, to, at] as const,
    )
  for (let attempt = 0; attempt < 5; attempt++) {
    await select()
    await page.waitForTimeout(150)
    const got = await page.evaluate(() => window.getSelection()?.toString() ?? '')
    if (got.trim().length && got.trimEnd().endsWith(to)) return
  }
  throw new Error('selection did not hold')
}

/** A selection from `from` to `to` and the AI menu opened on it (the bubble's Ask AI). */
async function askOnSelection(page: Page, id: string, from: string, to: string, at = 0): Promise<Locator> {
  const ed = editorOf(page, id)
  await ed.getByText(from, { exact: false }).first().click()
  await selectRange(page, ed, from, to, at)
  const bubble = page.locator('[aria-label="Formatting"], [aria-label="Formatierung"]').first()
  await expect(bubble).toBeVisible()
  await bubble.getByRole('button', { name: /^(Ask AI|KI fragen)$/ }).click()
  await expect(panel(page)).toBeVisible()
  return panel(page)
}

/** The caret on the last (empty) line — a new one typed when the last line holds text — Space → the AI menu at the cursor. */
async function askAtCursor(page: Page, id: string): Promise<Locator> {
  const ed = editorOf(page, id)
  const empty = await ed.evaluate((root) => {
    const e = (root as unknown as { editor: AnyState }).editor
    const last = e.state.doc.lastChild
    e.chain().focus().setTextSelection(e.state.doc.content.size - 1).run()
    return last?.type.name === 'paragraph' && last.content.size === 0
  })
  if (!empty) {
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
  }
  await page.waitForTimeout(150)
  await page.keyboard.press('Space')
  await expect(panel(page)).toBeVisible()
  return panel(page)
}

async function setup(page: Page, title: string, content: JSONContent): Promise<string> {
  await openApp(page)
  await setKey(page)
  const id = await createPage(page, { title, content })
  await gotoPage(page, id)
  await expect(editorOf(page, id)).toContainText(/./)
  return id
}

/* ------------------------------------------------------------------ intent (pure) */

test.describe('intent: "make tasks"', () => {
  test('the phrase table (EN + DE): tasks route to Make tasks; databases, the coding pipeline and the workspace never', () => {
    const items = [
      'make tasks from this',
      'turn these into tasks',
      'convert this into tasks',
      'extract the action items',
      'pull out the action items as tasks',
      'create tasks out of the notes',
      'as tracked tasks please',
      'tasks from this',
      'mach Aufgaben daraus',
      'als Aufgaben',
      'erstelle Aufgaben aus den Notizen',
      'wandle das in Aufgaben um',
      'Aufgaben daraus bitte',
    ]
    for (const s of items) {
      expect(requestIntent(s, { selection: true }), s).toBe('items')
      expect(requestIntent(s, { selection: false }), s).toBe('items')
    }
    const not: Array<[string, boolean, string | null]> = [
      ['turn this into a board', true, 'todb'],
      ['make tasks on the board', true, null],
      ['create a coding task for this', true, null],
      ['make tasks for the coding pipeline', false, null],
      ['summarize the tasks', true, null],
      ['what tasks are on this page', false, null],
      ['make tasks from all pages in the workspace', false, 'terminal'],
      ['make tasks from the workspace', false, null],
      ['mach eine Tabelle daraus', true, 'todb'],
      ['fasse die Aufgaben zusammen', true, null],
      ['create pages for these tasks', false, 'terminal'],
      ['a page for each task', true, 'pagesPerItem'],
      ['improve this', true, null],
    ]
    for (const [s, selection, want] of not) expect(requestIntent(s, { selection }), s).toBe(want)
  })
})

/* ------------------------------------------------------------------ 1440 light */

test.describe('1440 light', () => {
  test('Make tasks on selected blocks (Transform → Tasks): <people> go along, the preview shows the facts, Transform writes them; Keep the original; one ⌘Z', async ({ page, context }) => {
    const due = day(9)
    const captured = await mockMenu(context, {
      json: () => ({
        items: [
          { title: 'Draft the launch copy', notes: [], status: 'todo', owners: ['Alex'], due, blockedBy: [], from: [1] },
          { title: 'Book the venue', notes: ['- [ ] Ask for two quotes'], status: 'in_progress', owners: ['Mira', 'Bob'], due: null, blockedBy: [], from: [1] },
          { title: 'Ship the pricing page', notes: [], status: 'todo', owners: [], due: null, blockedBy: [1], from: [1] },
        ],
        keep: [],
        left: [],
      }),
    })
    const id = await setup(page, 'Nordlicht launch', doc(p('Next steps:'), bullets('Alex drafts the launch copy', 'Mira books the venue', 'Ship pricing after the copy'), p('')))
    const ppl = await peopleIds(page)
    const before = await peopleCount(page)
    const ai = await askOnSelection(page, id, 'Alex drafts', 'after the copy')
    // several blocks: Make tasks on the top level, after Transform into
    expect(await rowIds(ai)).toEqual(['improve', 'fix', 'translate', 'transform', 'workItems', 'summarize', 'more'])
    await row(page, 'workItems').click()
    const pv = page.getByTestId('transform-preview')
    await expect(pv.getByTestId('transform-plate').locator('.item-facts__row')).toHaveCount(3)
    // the request: the blocks + the people's names (never an email)
    const req = captured.find((c) => !c.stream)!
    expect(req.prompt).toContain('<people>')
    expect(req.prompt).toContain('Alex')
    expect(req.prompt).toContain('Mira')
    expect(req.prompt).not.toContain('@example.test')
    expect(req.system).toContain('tracked tasks')
    // the preview: owners, due, the link to a new task, Bob left out (no such person), the people note
    const rows = pv.locator('.item-facts__row')
    await expect(rows.nth(0).locator('[data-chip="person"]')).toContainText('Alex')
    await expect(rows.nth(0).locator('[data-chip="due"]')).toBeVisible()
    await expect(rows.nth(2).locator('[data-chip="blocked"]')).toContainText('Draft the launch copy')
    await expect(pv.locator('.item-facts__warn')).toContainText('“Bob” is no person in this workspace')
    await expect(pv.getByTestId('transform-people')).toContainText(/Owners only from your people: \d+ names go along/)
    // Keep the original below, then Transform (Enter)
    await pv.getByTestId('transform-keep').locator('[role="switch"], button, input').first().click()
    await row(page, 'transform-apply').click()
    await expect(panel(page)).toHaveCount(0)
    await flush(page)
    const tasks = tasksIn(await contentOf(page, id))
    expect(tasks.map((t) => t.title)).toEqual(['Draft the launch copy', 'Book the venue', 'Ship the pricing page'])
    expect(tasks[0]).toMatchObject({ people: [ppl.Alex], due })
    expect(tasks[1]).toMatchObject({ people: [ppl.Mira], status: 'in_progress' })
    expect(tasks[2].blockedBy).toEqual([tasks[0].itemId])
    expect(new Set(tasks.map((t) => t.itemId)).size).toBe(3)
    expect(await topTypes(page, id)).toEqual(['paragraph', 'workItem', 'workItem', 'workItem', 'details'])
    expect(await peopleCount(page)).toBe(before)
    // one ⌘Z: the list is back
    await editorOf(page, id).getByText('Next steps').click()
    await page.keyboard.press(`${MOD}+z`)
    await expect.poll(() => topTypes(page, id)).toEqual(['paragraph', 'bulletList'])
  })

  test('Make tasks at the cursor (make_tasks): <people> + the page in the file form; two new tasks at the line, the echo of a task left out; context "none" asks first; the gate shut', async ({ page, context }) => {
    const answer = `> [!TODO] Draft the launch copy\n> Owner: Alex · Due: ${day(5)}\n\n> [!TODO] Book the venue\n> Blocked by: Draft the launch copy\n\n> [!TODO] Order the banners {#${A}}`
    const captured = await mockMenu(context, { stream: () => answer })
    const id = await setup(page, 'Nordlicht kick-off', doc(p('Alex drafts the copy, then the venue gets booked.'), item({ itemId: A }, 'Order the banners'), p('')))
    const ppl = await peopleIds(page)
    let ai = await askAtCursor(page, id)
    expect(await rowIds(ai)).toEqual(['continue', 'outline', 'brainstorm', 'summarize', 'action_items', 'workItems', 'workspace', 'more'])
    await expect(row(page, 'workItems')).toContainText('Make tasks from this page')
    await row(page, 'workItems').click()
    await expect(panel(page).locator('.ai-out')).toHaveAttribute('data-phase', 'done')
    const req = captured.find((c) => c.stream)!
    expect(req.prompt).toContain('<people>')
    expect(req.prompt).toMatch(/Task: Turn the text into tracked tasks/)
    // the page in the file form: the task Claude must leave out comes with its id
    expect(req.prompt).toContain(`{#${A}}`)
    expect(req.system).toContain('> [!TODO]')
    // the stream shows TASK rows; the strip shows the two new tasks and that the echo was left out
    await expect(panel(page).locator('[data-md-task]')).toHaveCount(3)
    const strip = panel(page).getByTestId('ai-items')
    await expect(strip.locator('.item-facts__row')).toHaveCount(2)
    await expect(strip.locator('.item-facts__warn')).toContainText('is a task already')
    await expect(strip.getByTestId('ai-items-people')).toContainText(/names go along/)
    await page.keyboard.press('Enter')
    await expect(panel(page)).toHaveCount(0)
    await flush(page)
    const tasks = tasksIn(await contentOf(page, id))
    expect(tasks.map((t) => t.title)).toEqual(['Order the banners', 'Draft the launch copy', 'Book the venue'])
    expect(tasks[1]).toMatchObject({ people: [ppl.Alex] })
    expect(tasks[2].blockedBy).toEqual([tasks[1].itemId])
    const index = await page.evaluate(() => (window as unknown as { __oneItems: { index(): { dups: Record<string, unknown> } } }).__oneItems.index())
    expect(Object.keys(index.dups)).toEqual([])

    // context "none": the existing ask comes first
    ai = await askAtCursor(page, id)
    await panel(page).getByTestId('ai-reads').click()
    await row(page, 'reads-none').click()
    await row(page, 'workItems').click()
    await expect(panel(page).getByTestId('ai-reads-ask')).toBeVisible()
    await page.keyboard.press('Escape')

    // the gate shut: the row is off with its reason; Enter does nothing
    await gate(page, false)
    ai = await askAtCursor(page, id)
    await expect(row(page, 'workItems')).toHaveAttribute('aria-disabled', 'true')
    await expect(row(page, 'workItems')).toContainText('Tasks can’t be made here right now')
    const n = captured.length
    await ai.locator('.ai-cmd__input').fill('make tasks from this')
    await expect(row(page, 'intent-workItems')).toHaveAttribute('aria-disabled', 'true')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    expect(captured.length).toBe(n)
    await gate(page, null)
  })

  test('intent routing: "make tasks from this" → Make tasks (a selection: Transform → Tasks); "turn this into a board" → Turn into database; a coding task is no task block', async ({ page, context }) => {
    await mockMenu(context, { json: () => ({ items: [{ title: 'Call the printer', notes: [], status: 'todo', owners: [], due: null, blockedBy: [], from: [1] }], keep: [], left: [] }) })
    const id = await setup(page, 'Nordlicht print', doc(p('Call the printer about the banners.'), p('Then confirm the delivery date.'), p('')))
    let ai = await askOnSelection(page, id, 'Call the printer', 'delivery date.')
    await ai.locator('.ai-cmd__input').fill('make tasks from this')
    expect((await rowIds(ai))[0]).toBe('intent-workItems')
    await ai.locator('.ai-cmd__input').fill('turn this into a board')
    expect((await rowIds(ai))[0]).toBe('intent-todb')
    await ai.locator('.ai-cmd__input').fill('create a coding task for this')
    expect(await rowIds(ai)).not.toContain('intent-workItems')
    await ai.locator('.ai-cmd__input').fill('mach Aufgaben daraus')
    expect((await rowIds(ai))[0]).toBe('intent-workItems')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('transform-preview').locator('.item-facts__row')).toHaveCount(1)
    await page.keyboard.press('Escape')
    // at the cursor: the page-level action
    ai = await askAtCursor(page, id)
    await ai.locator('.ai-cmd__input').fill('turn these into tasks')
    expect((await rowIds(ai))[0]).toBe('intent-workItems')
    await expect(row(page, 'intent-workItems')).toContainText('Make tasks from this page')
  })

  test('a free-form answer holding tasks: inserted as tasks (a reminder kept); the request of "improve" carries no <people>; a terminal answer shows a plain quote', async ({ page, context }) => {
    const due = day(4)
    const answer = `Here is the plan.\n\n> [!TODO] Send the invitations\n> Due: ${due} · Reminder: -1d\n\n> [!TODO] Print the badges`
    const captured = await mockMenu(context, { stream: (n) => (n === 1 ? 'A better line about the Tessera launch.' : answer) })
    const id = await setup(page, 'Tessera launch', doc(p('A line about the Tessera launch.'), p('')))
    // improve on a selection: no people's names go along
    let ai = await askOnSelection(page, id, 'A line about', 'launch.')
    await row(page, 'improve').click()
    await expect(panel(page).locator('.ai-out')).toHaveAttribute('data-phase', 'done')
    expect(captured[0].prompt).not.toContain('<people>')
    await page.keyboard.press('Escape')
    // an own request at the cursor whose answer holds two tasks
    ai = await askAtCursor(page, id)
    await ai.locator('.ai-cmd__input').fill('plan the invitations')
    await page.keyboard.press('Enter')
    await expect(panel(page).locator('.ai-out')).toHaveAttribute('data-phase', 'done')
    expect(captured[1].prompt).not.toContain('<people>')
    await expect(panel(page).locator('[data-md-task]')).toHaveCount(2)
    await expect(panel(page).getByTestId('ai-items').locator('.item-facts__row')).toHaveCount(2)
    await page.keyboard.press('Enter')
    await flush(page)
    const tasks = tasksIn(await contentOf(page, id))
    expect(tasks.map((t) => t.title)).toEqual(['Send the invitations', 'Print the badges'])
    expect(tasks[0]).toMatchObject({ due, reminder: '-1d' })

    // the AI terminal's answer holding the same text: a plain quote (the TASK rows are opt-in)
    await context.unrouteAll({ behavior: 'ignoreErrors' })
    await mockAgent(context, [say(answer)])
    await setTermKey(page)
    await openTerminal(page)
    await runTerminal(page, 'Show me a plan')
    await expect(terminal(page).locator('.term-turn').last()).toHaveAttribute('data-status', /done/, { timeout: 30_000 })
    await expect(terminal(page).locator('blockquote').first()).toContainText('[!TODO] Send the invitations')
    await expect(terminal(page).locator('[data-md-task]')).toHaveCount(0)
  })

  test('Replace over two whole tasks: ids and fields kept (a status changed meanwhile stays), titles new; an answer that drops one → off with its reason; cutting into a title → the P1 reason; a task deleted meanwhile → below', async ({ page, context }) => {
    let answer = `> [!TODO] Draft the Nordlicht copy {#${A}}\n\n> [!TODO] Ship the Nordlicht pricing {#${B}}`
    const captured = await mockMenu(context, { stream: () => answer })
    const id = await setup(page, 'Nordlicht tasks', doc(p('Two tasks:'), item({ itemId: A, due: day(6), people: [] }, 'Draft copy'), item({ itemId: B, blockedBy: [A] }, 'Ship pricing'), p('After the tasks.'), p('')))
    const ppl = await peopleIds(page)
    await wsEval(page, (s, [id, A, alex]) => {
      const c = JSON.parse(JSON.stringify(s.pages[id].content))
      c.content[1].attrs.people = [alex]
      s.setContent(id, c, 'e2e')
    }, [id, A, ppl.Alex] as const)
    let ai = await askOnSelection(page, id, 'Draft copy', 'Ship pricing')
    await ai.locator('.ai-cmd__input').fill('make the titles more specific')
    await page.keyboard.press('Enter')
    await expect(panel(page).locator('.ai-out')).toHaveAttribute('data-phase', 'done')
    // Claude read both tasks with their ids
    expect(captured[0].prompt).toContain(`{#${A}}`)
    await expect(row(page, 'replace')).not.toHaveAttribute('aria-disabled', 'true')
    // a member sets the first task in progress while the answer waits
    await page.evaluate((A) => (window as unknown as { __oneItems: { write(e: unknown[], o?: unknown): unknown } }).__oneItems.write([{ itemId: A, patch: { status: 'in_progress' } }], { toasts: false }), A)
    await flush(page)
    await row(page, 'replace').click()
    await expect(panel(page)).toHaveCount(0)
    await flush(page)
    let tasks = tasksIn(await contentOf(page, id))
    expect(tasks.map((t) => [t.itemId, t.title])).toEqual([
      [A, 'Draft the Nordlicht copy'],
      [B, 'Ship the Nordlicht pricing'],
    ])
    expect(tasks[0]).toMatchObject({ status: 'in_progress', people: [ppl.Alex], due: day(6) })
    expect(tasks[1].blockedBy).toEqual([A])
    expect(await topTypes(page, id)).toEqual(['paragraph', 'workItem', 'workItem', 'paragraph'])

    // an answer that drops a task (or turns it into another marker): Replace off with its reason, Insert below first
    answer = `> [!TODO] Draft the Nordlicht copy {#${A}}\n\n> [!AUFGABE] Ship the Nordlicht pricing`
    ai = await askOnSelection(page, id, 'Draft the Nordlicht copy', 'Ship the Nordlicht pricing')
    await ai.locator('.ai-cmd__input').fill('tighten')
    await page.keyboard.press('Enter')
    await expect(panel(page).locator('.ai-out')).toHaveAttribute('data-phase', 'done')
    expect((await rowIds(ai))[0]).toBe('insert')
    await expect(row(page, 'replace')).toHaveAttribute('aria-disabled', 'true')
    await expect(row(page, 'replace')).toContainText('Claude’s answer drops a task')
    await page.keyboard.press('Escape')

    // a selection starting inside a title: it cuts into the task — the P1 reason
    answer = `> [!TODO] Draft the Nordlicht copy {#${A}}\n\n> [!TODO] Ship the Nordlicht pricing {#${B}}`
    ai = await askOnSelection(page, id, 'Draft the Nordlicht copy', 'Ship the Nordlicht pricing', 6)
    await ai.locator('.ai-cmd__input').fill('tighten')
    await page.keyboard.press('Enter')
    await expect(panel(page).locator('.ai-out')).toHaveAttribute('data-phase', 'done')
    await expect(row(page, 'replace')).toHaveAttribute('aria-disabled', 'true')
    await expect(row(page, 'replace')).toContainText('Holds a task')
    await page.keyboard.press('Escape')

    // the doc changed between the answer and Replace (a task deleted): the answer goes below instead
    ai = await askOnSelection(page, id, 'Draft the Nordlicht copy', 'Ship the Nordlicht pricing')
    await ai.locator('.ai-cmd__input').fill('tighten')
    await page.keyboard.press('Enter')
    await expect(panel(page).locator('.ai-out')).toHaveAttribute('data-phase', 'done')
    await editorOf(page, id).evaluate((root, B) => {
      const e = (root as unknown as { editor: AnyState }).editor
      e.state.doc.descendants((n: AnyState, pos: number) => {
        if (n.type.name === 'workItem' && n.attrs.itemId === B) {
          e.view.dispatch(e.state.tr.delete(pos, pos + n.nodeSize))
          return false
        }
        return true
      })
    }, B)
    // the answer brings back a task the range no longer holds: Replace is off now — Insert below (Enter) writes it below
    await expect(row(page, 'replace')).toHaveAttribute('aria-disabled', 'true')
    await expect(row(page, 'replace')).toContainText('Claude’s answer drops a task')
    await page.keyboard.press('Enter')
    await expect(panel(page)).toHaveCount(0)
    await flush(page)
    tasks = tasksIn(await contentOf(page, id))
    // the kept task is untouched in place; the answer went below: A's echo left out (it exists), B's quote made anew
    expect(tasks[0]).toMatchObject({ itemId: A, title: 'Draft the Nordlicht copy', status: 'in_progress' })
    expect(tasks.filter((t) => t.itemId === A)).toHaveLength(1)
    expect(tasks.some((t) => t.itemId === B)).toBe(false)
  })

  test('Insert below from a task\'s note / a table cell: a task in the answer lands after the outermost task / after the table', async ({ page, context }) => {
    await mockMenu(context, { stream: () => '> [!TODO] Check the banner proofs' })
    const table: JSONContent = {
      type: 'table',
      content: [
        { type: 'tableRow', content: [{ type: 'tableHeader', content: [p('Item')] }, { type: 'tableHeader', content: [p('Owner')] }] },
        { type: 'tableRow', content: [{ type: 'tableCell', content: [p('Banners')] }, { type: 'tableCell', content: [p('Sam handles it')] }] },
      ],
    }
    const id = await setup(page, 'Nordlicht print run', doc(item({ itemId: A }, 'Order the banners', p('Note about the proofs')), table, p('End.'), p('')))
    // the target is a task's note: "Insert below" would land in the notes — the task goes after the task
    await askOnSelection(page, id, 'Note about', 'the proofs')
    await panel(page).locator('.ai-cmd__input').fill('one more check')
    await page.keyboard.press('Enter')
    await expect(panel(page).locator('.ai-out')).toHaveAttribute('data-phase', 'done')
    await row(page, 'insert').click()
    await expect(panel(page)).toHaveCount(0)
    await flush(page)
    let c = await contentOf(page, id)
    expect((c.content as JSONContent[]).slice(0, 2).map((n) => n.type)).toEqual(['workItem', 'workItem'])
    expect(tasksIn(c).map((t) => t.title)).toEqual(['Order the banners', 'Check the banner proofs'])
    expect(tasksIn((c.content as JSONContent[])[0])).toHaveLength(1)
    // the target is a table cell: after the table, never inside a cell
    await askOnSelection(page, id, 'Sam handles', 'it')
    await panel(page).locator('.ai-cmd__input').fill('one more check')
    await page.keyboard.press('Enter')
    await expect(panel(page).locator('.ai-out')).toHaveAttribute('data-phase', 'done')
    await row(page, 'insert').click()
    await expect(panel(page)).toHaveCount(0)
    await flush(page)
    c = await contentOf(page, id)
    const types = (c.content as JSONContent[]).map((n) => n.type)
    const t = types.indexOf('table')
    expect(types[t + 1]).toBe('workItem')
    expect(tasksIn((c.content as JSONContent[])[t])).toEqual([])
  })

  test('meeting notes "Make tasks (3)": the top-level to-dos become tasks in one step (done, people, due + reminder; an unknown person stays text); the toast\'s Undo and ⌘Z bring them back; the gate shut hides the key', async ({ page }) => {
    await openApp(page)
    const ppl = await peopleIds(page)
    const before = await peopleCount(page)
    const due = day(7)
    const mention = (attrs: Record<string, unknown>): JSONContent => ({ type: 'mention', attrs })
    const todo = (checked: boolean, content: JSONContent[], ...nested: JSONContent[]): JSONContent => ({ type: 'taskItem', attrs: { checked }, content: [{ type: 'paragraph', content }, ...nested] })
    const meeting: JSONContent = {
      type: 'meetingNotes',
      attrs: { id: 'mtg-p2', title: 'Nordlicht sync', status: 'done', language: 'en-US', startedAt: Date.now() - 3_600_000, endedAt: Date.now() - 600_000, duration: 2_940_000, transcript: [] },
      content: [
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Action items' }] },
        {
          type: 'taskList',
          content: [
            todo(true, [{ type: 'text', text: 'Approve the budget' }]),
            todo(false, [{ type: 'text', text: 'Send the deck ' }, mention({ id: ppl.Alex, label: 'Alex', kind: 'person' }), { type: 'text', text: ' ' }, mention({ id: due, label: 'Next week', kind: 'date', reminder: '-1d' })], {
              type: 'taskList',
              content: [todo(false, [{ type: 'text', text: 'Attach the figures' }])],
            }),
            todo(false, [{ type: 'text', text: 'Call the printer ' }, mention({ id: 'person-unknown-1', label: 'Mara Lind', kind: 'person' })]),
          ],
        },
      ],
    }
    const id = await createPage(page, { title: 'Nordlicht sync notes', content: doc(meeting, p('')) })
    await gotoPage(page, id)
    const key = page.locator('[data-meeting-key="items"]')
    await expect(key).toHaveText(/Make tasks \(3\)/)
    await key.click()
    await flush(page)
    const tasks = tasksIn(await contentOf(page, id))
    expect(tasks.map((t) => t.title.trim())).toEqual(['Approve the budget', 'Send the deck', 'Call the printer @Mara Lind'])
    expect(tasks[0]).toMatchObject({ status: 'done' })
    expect(tasks[1]).toMatchObject({ people: [ppl.Alex], due, reminder: '-1d' })
    expect(tasks[2].people ?? []).toEqual([])
    expect(await peopleCount(page)).toBe(before)
    // the toast's Undo (a click)
    await page.locator('.toast').filter({ hasText: '3 tasks made' }).getByRole('button', { name: 'Undo' }).click()
    await flush(page)
    expect(tasksIn(await contentOf(page, id))).toEqual([])
    // again, then ⌘Z
    await key.click()
    await flush(page)
    expect(tasksIn(await contentOf(page, id))).toHaveLength(3)
    await editorOf(page, id).getByText('Action items').click()
    await page.keyboard.press(`${MOD}+z`)
    await flush(page)
    expect(tasksIn(await contentOf(page, id))).toEqual([])
    // the gate shut: no key (the page shown again)
    await gate(page, false)
    await page.evaluate(() => (location.hash = '#/'))
    await expect(editorOf(page, id)).toHaveCount(0)
    await gotoPage(page, id)
    await expect(page.locator('[data-meeting-key="send"]')).toBeVisible()
    await expect(key).toHaveCount(0)
  })
})

/* ------------------------------------------------------------------ 390 dark */

test.describe('390 dark', () => {
  test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', hasTouch: true, isMobile: true })

  test('the Make tasks row, the transform preview and the result strip fit the phone; keys ≥ 32 px; no sideways scroll', async ({ page, context }) => {
    await mockMenu(context, {
      json: () => ({ items: [{ title: 'Draft the launch copy for the Nordlicht relaunch page', notes: [], status: 'todo', owners: ['Alex'], due: day(3), blockedBy: [], from: [1] }, { title: 'Book the venue', notes: [], status: 'todo', owners: [], due: null, blockedBy: [1], from: [1] }], keep: [], left: [] }),
      stream: () => '> [!TODO] Send the invitations to every partner of the Nordlicht relaunch\n> Owner: Alex\n\n> [!TODO] Print the badges',
    })
    const id = await setup(page, 'Nordlicht phone', doc(p('Alex drafts the copy.'), p('Then the venue gets booked.'), p('')))
    const ai = await askOnSelection(page, id, 'Alex drafts', 'gets booked.')
    await expect(row(page, 'workItems')).toBeVisible()
    const box = await row(page, 'workItems').boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(31.5)
    await row(page, 'workItems').click()
    const pv = page.getByTestId('transform-preview')
    await expect(pv.locator('.item-facts__row')).toHaveCount(2)
    const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(await sideways()).toBeLessThanOrEqual(0)
    const wide = await pv.evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(wide).toBeLessThanOrEqual(1)
    await page.keyboard.press('Escape')
    void ai
    // the page-level strip
    const at = await askAtCursor(page, id)
    await row(page, 'workItems').click()
    await expect(at.locator('.ai-out')).toHaveAttribute('data-phase', 'done')
    await expect(at.getByTestId('ai-items').locator('.item-facts__row')).toHaveCount(2)
    expect(await sideways()).toBeLessThanOrEqual(0)
    const insert = await row(page, 'insert').boundingBox()
    expect(insert!.height).toBeGreaterThanOrEqual(31.5)
  })
})
