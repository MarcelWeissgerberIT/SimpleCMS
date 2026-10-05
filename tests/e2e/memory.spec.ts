/**
 * The One memory (features/ai/memory): proposals after AI-terminal tasks (saved only on the OK),
 * /remember, "remember …" and "Remember this" in the AI menu, the `<one_memory>` block in every free-form
 * request (terminal, AI menu, ⌘K "?", custom agents), the "MEMORY · n" lists, the usage log (two-way
 * relations, Uses / Last used rollups, pruning) and the settings. Claude is mocked — never api.anthropic.com:
 * streamed requests get scripted SSE answers, structured ones (proposals, condensing) a scripted JSON answer.
 */
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect, openApp, gotoPage, createPage, wsEval, uiEval, editorOf, doc, para, reloadApp, flush, selectText, MOD } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

let msgSeq = 0

/** One streamed assistant message (text only) in the Messages API SSE shape. */
function sse(text: string): string {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  let body = ev('message_start', {
    message: { id: `msg_mem_${++msgSeq}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  })
  body += ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
  for (const chunk of text.match(/.{1,18}/gs) ?? []) body += ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: chunk } })
  body += ev('content_block_stop', { index: 0 })
  body += ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 40 } })
  body += ev('message_stop', {})
  return body
}

interface Claude {
  /** streamed requests (terminal tasks, AI-menu requests, ⌘K, agents) */
  stream: AnyState[]
  /** structured requests (proposals, condensing) */
  structured: AnyState[]
}

/**
 * api.anthropic.com → streamed request n gets answers[n] (later ones "Done."), a structured request the
 * JSON `structured(body, n)` returns (default: no memories). Never a real request.
 */
async function mockClaude(ctx: BrowserContext, answers: Array<string | ((b: AnyState) => string)> = [], structured: (b: AnyState, n: number) => object = () => ({ memories: [] })): Promise<Claude> {
  const out: Claude = { stream: [], structured: [] }
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (req.method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [], has_more: false }) })
    const body = JSON.parse(req.postData() ?? '{}')
    if (body.output_config?.format) {
      out.structured.push(body)
      const json = structured(body, out.structured.length - 1)
      return route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({ id: `msg_mem_${++msgSeq}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify(json) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 300, output_tokens: 60 } }),
      })
    }
    out.stream.push(body)
    const a = answers[out.stream.length - 1] ?? 'Done.'
    try {
      await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse(typeof a === 'string' ? a : a(body)) })
    } catch {
      /* aborted */
    }
  })
  return out
}

const setKey = (page: Page, lang?: 'de') => wsEval(page, (s, lang) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', ...(lang ? { language: lang } : {}) }), lang)
const terminal = (page: Page, name = 'AI terminal') => page.getByRole('region', { name })
const panel = (page: Page) => page.locator('.ai-panel')
const userText = (body: AnyState) => JSON.stringify(body.messages ?? '')
/** The newest user turn of a request (the terminal's history carries the earlier ones). */
const lastUser = (body: AnyState) => JSON.stringify((body.messages as AnyState[]).filter((m) => m.role === 'user').pop()?.content ?? '')

async function openTerminal(page: Page) {
  if (!(await page.locator('.term').isVisible())) await page.keyboard.press(`${MOD}+j`)
  await expect(page.locator('.term')).toBeVisible()
}

async function run(page: Page, task: string) {
  const input = page.locator('.term-prompt__input')
  await input.fill(task)
  await input.press('Enter')
}

const PREF = { type: 'preference', text: 'CNSX reports are written in German.', topics: ['CNSX'], body: '' }
const FACT = { type: 'fact', text: 'Atlas ships every Friday.', topics: ['Atlas'], body: '' }

/** The memory database's rows, read back by property names (EN). */
function memoryRows(page: Page) {
  return wsEval(page, (s) => {
    const db = (Object.values(s.databases) as AnyState[]).find((d) => d.system === 'memory')
    if (!db) return null
    const prop = (name: string) => db.properties.find((p: AnyState) => p.name === name)
    const opt = (p: AnyState, id: string) => p?.options?.find((o: AnyState) => o.id === id)?.name
    return (Object.values(s.pages) as AnyState[])
      .filter((r) => r.databaseId === db.id && !r.trashed)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((r) => ({
        id: r.id,
        title: r.title,
        type: opt(prop('Type'), r.properties[prop('Type')?.id]),
        topics: (r.properties[prop('Topics')?.id] ?? []).map((id: string) => opt(prop('Topics'), id)),
        source: r.properties[prop('Source')?.id] ?? '',
        active: r.properties[prop('Active')?.id],
        tag: r.properties[prop('Tag')?.id] ?? '',
        content: JSON.stringify(r.content ?? null),
        usedIn: r.properties[prop('Used in')?.id] ?? [],
        citedIn: r.properties[prop('Cited in')?.id] ?? [],
      }))
  })
}

/** The memory log's live rows (newest first). */
function logRows(page: Page) {
  return wsEval(page, (s) => {
    const db = (Object.values(s.databases) as AnyState[]).find((d) => d.system === 'memory-log')
    if (!db) return null
    const prop = (name: string) => db.properties.find((p: AnyState) => p.name === name)
    return (Object.values(s.pages) as AnyState[])
      .filter((r) => r.databaseId === db.id && !r.trashed)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({
        id: r.id,
        title: r.title,
        where: prop('Where')?.options?.find((o: AnyState) => o.id === r.properties[prop('Where')?.id])?.name,
        memories: r.properties[prop('Memories')?.id] ?? [],
        cited: r.properties[prop('Cited')?.id] ?? [],
        page: r.properties[prop('Page')?.id] ?? '',
        result: r.properties[prop('Result')?.id] ?? '',
        content: JSON.stringify(r.content ?? null),
      }))
  })
}

/** Seed memories through the store (the memory database must exist): [{ text, type, active?, body? }]. */
function seedMemories(page: Page, list: Array<{ text: string; type: string; active?: boolean; body?: string; topics?: string[] }>) {
  return wsEval(
    page,
    (s, list) => {
      const db = (Object.values(s.databases) as AnyState[]).find((d) => d.system === 'memory')!
      const prop = (name: string) => db.properties.find((p: AnyState) => p.name === name)
      const typeOpt = (name: string) => prop('Type').options.find((o: AnyState) => o.name.toLowerCase() === name).id
      const ids: string[] = []
      for (const m of list) {
        const id = s.createRow(db.id, { title: m.text, properties: { [prop('Type').id]: typeOpt(m.type), [prop('Active').id]: m.active ?? true } })
        if (m.body) s.setContent(id, { type: 'doc', content: m.body.split('\n').map((line: string) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] })) }, 'e2e')
        ids.push(id)
      }
      return ids
    },
    list,
  )
}

/** Set up the memory (Settings → "Set up memory") through the settings modal. */
async function setUpMemory(page: Page) {
  await uiEval(page, (u) => u.openModal({ type: 'settings', tab: 'ai' }))
  const section = page.getByTestId('memory-settings')
  await section.scrollIntoViewIfNeeded()
  await expect(section).toContainText('Not set up yet')
  await section.getByRole('button', { name: 'Set up memory' }).click()
  await expect(section).toContainText('0 memories · 0 log entries')
  await page.keyboard.press('Escape')
}

test.describe('One memory', () => {
  test('terminal: proposals after a task (y saves, n dismisses) → the database; the next task carries it; MEMORY · 1; a cited memory is logged', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    // before any memory exists, proposals run only when switched on
    await wsEval(page, (s) => s.updateSettings({ memory: { proposals: true } }))
    const claude = await mockClaude(context, ['Outline drafted: intro, the numbers, next steps.', 'Here is the report outline, in German as you prefer [M1].'], (_b, n) => ({ memories: n === 0 ? [PREF, FACT] : [] }))
    await openTerminal(page)
    await run(page, 'Draft the weekly CNSX report outline')

    const card = terminal(page).getByTestId('term-memory')
    await expect(card).toContainText('REMEMBER? · 2', { timeout: 20_000 })
    await expect(card).toContainText('CNSX reports are written in German.')
    await expect(card).toContainText('Atlas ships every Friday.')
    // one small structured request: the task and Claude's answer — nothing saved yet
    expect(claude.structured).toHaveLength(1)
    expect(userText(claude.structured[0])).toContain('Draft the weekly CNSX report outline')
    expect(userText(claude.structured[0])).toContain('Outline drafted')
    expect(claude.structured[0].mcp_servers).toBeUndefined()
    expect(await memoryRows(page)).toBeNull()

    // Tab from the empty prompt → the first proposal; y saves, n dismisses
    await page.locator('.term-prompt__input').press('Tab')
    const items = card.locator('.term-change')
    await expect(items.nth(0)).toBeFocused()
    await page.keyboard.press('y')
    await expect(items.nth(0)).toHaveAttribute('data-status', 'saved')
    await expect(items.nth(1)).toBeFocused()
    await page.keyboard.press('n')
    await expect(items.nth(1)).toHaveAttribute('data-status', 'dismissed')

    const rows = await memoryRows(page)
    expect(rows).toHaveLength(1)
    expect(rows![0]).toMatchObject({ title: 'CNSX reports are written in German.', type: 'Preference', topics: ['CNSX'], active: true })
    expect(rows![0].source).toMatch(/^AI terminal · \d{4}-\d\d-\d\d$/)
    // the database: top level, "One memory", its log next to it
    const dbs = await wsEval(page, (s) => (Object.values(s.databases) as AnyState[]).filter((d) => d.system).map((d) => ({ system: d.system, title: s.pages[d.id].title, parent: s.pages[d.id].parentId, views: d.views.map((v: AnyState) => `${v.type}:${v.name}`) })))
    expect(dbs).toEqual(
      expect.arrayContaining([
        { system: 'memory', title: 'One memory', parent: null, views: ['table:All', 'board:By type'] },
        { system: 'memory-log', title: 'Memory log', parent: null, views: ['table:Log', 'feed:Feed'] },
      ]),
    )

    // the next task carries the memory
    await page.locator('.term-prompt__input').focus()
    await run(page, 'Write the CNSX weekly report')
    await expect.poll(() => claude.stream.length).toBe(2)
    const sent = lastUser(claude.stream[1])
    expect(sent).toContain('<one_memory>')
    expect(sent).toContain('[M1] Preference: CNSX reports are written in German.')
    expect(sent).toContain('Follow a matching Procedure as the template for the task')
    expect(sent).not.toContain('Atlas ships every Friday')
    // its tools: recall + remember join the conversation's next start (pinned per conversation)
    expect(claude.stream[1].tools.map((x: AnyState) => x.name)).not.toContain('recall')

    const chip = terminal(page).getByTestId('term-memory-chip')
    await expect(chip).toHaveText('MEMORY · 1')
    await chip.click()
    const menu = page.getByRole('menu').first()
    await expect(menu).toContainText('M1 · CNSX reports are written in German.')
    await page.keyboard.press('Escape')

    // [M1] cited → one log row with both relations; the memory shows it in Used in / Cited in
    await expect.poll(async () => (await logRows(page))?.length).toBe(1)
    const [log] = (await logRows(page))!
    const memId = rows![0].id
    expect(log).toMatchObject({ where: 'AI terminal', memories: [memId], cited: [memId] })
    expect(log.title).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d · Write the CNSX weekly report$/)
    expect(log.result).toContain('answer')
    expect(log.content).not.toContain('report outline')
    const after = (await memoryRows(page))![0]
    expect(after.usedIn).toEqual([log.id])
    expect(after.citedIn).toEqual([log.id])

    // the entry: Uses 1, Last used today (rollups), Used in → the log row
    await uiEval(page, (u, id) => u.openPeek(id), memId)
    const prow = (name: string) => page.locator('.db-prow').filter({ has: page.locator('.db-prow__name', { hasText: new RegExp(`^${name}$`) }) })
    await expect(prow('Uses')).toContainText('1')
    await expect(prow('Last used')).toContainText(/Today|\w{3} \d/)
    await expect(prow('Used in')).toContainText('Write the CNSX weekly report')
    await expect(prow('Cited in')).toContainText('Write the CNSX weekly report')

    // a new conversation: the memory tools are offered now
    await page.keyboard.press('Escape')
    await openTerminal(page)
    await run(page, '/new')
    await run(page, 'Anything else on CNSX?')
    await expect.poll(() => claude.stream.length).toBe(3)
    expect(claude.stream[2].tools.map((x: AnyState) => x.name)).toEqual(expect.arrayContaining(['recall', 'remember']))
    expect(claude.stream[2].system).toContain('One memory')

    // reload keeps the memory, the log and the relations
    await reloadApp(page)
    expect((await memoryRows(page))![0]).toMatchObject({ title: 'CNSX reports are written in German.', usedIn: expect.arrayContaining([log.id]) })
    expect((await logRows(page))!.length).toBeGreaterThanOrEqual(1)
  })

  test('/remember, duplicates → "Update existing", a Procedure’s template and only active memories in the block, /no-memory, Settings off', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const claude = await mockClaude(context)
    await openTerminal(page)

    // /remember: the person's own words as a proposal (no request); y saves it — the memory is created
    await run(page, '/remember Always write customer reports in German')
    const cards = terminal(page).getByTestId('term-memory')
    await expect(cards.last()).toContainText('REMEMBER? · 1')
    await expect(cards.last().locator('.mem-type')).toHaveText('Preference')
    await page.locator('.term-prompt__input').press('Tab')
    await page.keyboard.press('y')
    await expect(cards.last().locator('.term-change')).toHaveAttribute('data-status', 'saved')
    expect(claude.stream.length + claude.structured.length).toBe(0)
    expect((await memoryRows(page))!.map((r) => r.title)).toEqual(['Always write customer reports in German'])

    // nearly the same again: the card offers "Update existing"; y updates instead of adding
    await page.locator('.term-prompt__input').focus()
    await run(page, '/merken always write customer reports in German, please')
    await expect(cards.last().getByTestId('memory-dup')).toContainText('Almost the same as: Always write customer reports in German')
    await expect(cards.last().getByRole('button', { name: /Update existing/ })).toBeVisible()
    await page.locator('.term-prompt__input').press('Tab')
    await page.keyboard.press('y')
    await expect(cards.last().locator('.term-change')).toHaveAttribute('data-status', 'updated')
    expect((await memoryRows(page))!.map((r) => r.title)).toEqual(['Always write customer reports in German, please'])

    // a Procedure with its template, and an inactive one
    await seedMemories(page, [
      { text: 'Weekly status report procedure', type: 'procedure', body: 'Collect the numbers from Projects.\nThree sections: done, next, risks.' },
      { text: 'Status reports go out on Mondays.', type: 'fact', active: false },
    ])
    await run(page, 'Prepare the weekly status report')
    await expect.poll(() => claude.stream.length).toBe(1)
    const sent = lastUser(claude.stream[0])
    expect(sent).toContain('<one_memory>')
    expect(sent).toContain('Procedure: Weekly status report procedure')
    expect(sent).toContain('Collect the numbers from Projects.')
    expect(sent).toContain('Preference: Always write customer reports in German, please')
    expect(sent).not.toContain('go out on Mondays')
    await expect(terminal(page).getByTestId('term-memory-chip')).toHaveText('MEMORY · 2')
    // proposals ran by default (a memory exists) — Claude proposed none: no card
    await expect.poll(() => claude.structured.length).toBe(1)

    // /no-memory: the next task goes without
    await run(page, '/no-memory')
    await expect(terminal(page).locator('.term-echo').last()).toContainText('The next task runs without the One memory.')
    await run(page, 'Prepare it again')
    await expect.poll(() => claude.stream.length).toBe(2)
    expect(lastUser(claude.stream[1])).not.toContain('<one_memory>')
    await expect(terminal(page).getByTestId('term-memory-chip')).toHaveText('MEMORY · OFF')
    // /no-memory <task>: that task without
    await run(page, '/no-memory Prepare it a third time')
    await expect.poll(() => claude.stream.length).toBe(3)
    expect(lastUser(claude.stream[2])).not.toContain('<one_memory>')
    expect(lastUser(claude.stream[2])).toContain('Prepare it a third time')

    // Settings → Claude AI → "Use the memory" off: no block, no proposals
    await expect.poll(() => claude.structured.length).toBe(3)
    await page.keyboard.press('Escape')
    await uiEval(page, (u) => u.openModal({ type: 'settings', tab: 'ai' }))
    const section = page.getByTestId('memory-settings')
    await section.scrollIntoViewIfNeeded()
    await expect(section).toContainText('3 memories · 1 log entry')
    await section.getByRole('switch', { name: 'Use the memory' }).click()
    await expect(section.getByRole('switch', { name: 'Use the memory' })).toHaveAttribute('aria-checked', 'false')
    await page.keyboard.press('Escape')
    const before = claude.structured.length
    await openTerminal(page)
    await run(page, 'Prepare the weekly status report once more')
    await expect.poll(() => claude.stream.length).toBe(4)
    expect(lastUser(claude.stream[3])).not.toContain('<one_memory>')
    await expect(terminal(page).locator('.term-head__status')).toContainText('Done')
    await page.waitForTimeout(400)
    expect(claude.structured.length).toBe(before)
  })

  test('AI menu: "remember …" → a proposal card; selection → Remember this; an own request carries the memory (list, history, toggle off) and is logged', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const claude = await mockClaude(context, ['Launch checklist drafted [M1].', 'Without memory.'], (b) =>
      JSON.stringify(b.messages).includes('Beta testers get access')
        ? { memories: [{ type: 'fact', text: 'Beta testers get access one week before the launch.', topics: ['Launch'], body: '' }] }
        : { memories: [{ type: 'decision', text: 'We use Atlas as the knowledge base.', topics: ['Atlas'], body: '' }] },
    )
    const id = await createPage(page, { title: 'Launch notes', content: doc(para('Beta testers get access one week before the launch.'), para('')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)

    const openPanel = async () => {
      await ed.locator('p').last().click()
      await ed.evaluate((root) => {
        const e = (root as unknown as { editor: AnyState }).editor
        e.chain().focus().setTextSelection(e.state.doc.content.size - 1).run()
      })
      await page.waitForTimeout(150)
      await page.keyboard.press('Space')
      await expect(panel(page)).toBeVisible()
    }

    // "merk dir …" / "remember …": a proposal, not an answer
    await openPanel()
    await panel(page).locator('.ai-cmd__input').fill('remember that we use Atlas as our knowledge base')
    await expect(panel(page).getByRole('option').first()).toContainText('Remember “we use Atlas as our knowledge base”')
    await page.keyboard.press('Enter')
    const card = panel(page).getByTestId('ai-memory-card')
    await expect(card).toContainText('We use Atlas as the knowledge base.')
    await expect(card.locator('.mem-type')).toHaveText('Decision')
    expect(claude.structured).toHaveLength(1)
    expect(claude.stream).toHaveLength(0)
    await expect(panel(page).getByRole('option', { name: 'Save to One memory' })).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(panel(page)).toHaveCount(0)
    await expect(page.locator('.toast', { hasText: 'Saved to One memory' })).toBeVisible()
    let rows = (await memoryRows(page))!
    expect(rows.map((r) => r.title)).toEqual(['We use Atlas as the knowledge base.'])
    expect(rows[0].source).toBe(`Launch notes · #/p/${id}`)

    // the selection → "Remember this": Claude condenses it into one proposal; Edit, then save
    await selectText(page, ed, 'Beta testers get access one week before the launch.')
    await page.locator('[aria-label="Formatting"]').first().getByRole('button', { name: /^Ask AI$/ }).click()
    await expect(panel(page)).toBeVisible()
    await panel(page).getByRole('option', { name: /Remember this/ }).click()
    await expect(panel(page).getByTestId('ai-memory-card')).toContainText('Beta testers get access one week before the launch.')
    expect(userText(claude.structured[1])).toContain('Beta testers get access')
    await panel(page).getByRole('option', { name: /Edit/ }).click()
    const edit = panel(page).getByTestId('memory-edit')
    await edit.getByRole('textbox', { name: 'Topics (comma-separated)' }).fill('Launch, Beta')
    await edit.getByRole('radio', { name: 'Decision' }).click()
    await edit.getByRole('button', { name: 'Save' }).click()
    await expect(panel(page).getByTestId('ai-memory-card').locator('.mem-type')).toHaveText('Decision')
    await panel(page).getByRole('option', { name: 'Save to One memory' }).click()
    await expect(panel(page)).toHaveCount(0)
    rows = (await memoryRows(page))!
    expect(rows[1]).toMatchObject({ title: 'Beta testers get access one week before the launch.', type: 'Decision', topics: ['Launch', 'Beta'] })

    // an own request: the memory line previews what goes along; the request carries it; [M1] is logged
    await openPanel()
    await panel(page).locator('.ai-cmd__input').fill('draft the launch checklist for the beta testers')
    const line = panel(page).getByTestId('ai-memory')
    await expect(line).toContainText('MEMORY · 1')
    await expect(line).toContainText('Beta testers get access')
    await page.keyboard.press('Enter')
    await expect(panel(page)).toContainText('Launch checklist drafted')
    expect(userText(claude.stream[0])).toContain('<one_memory>')
    expect(userText(claude.stream[0])).toContain('[M1] Decision: Beta testers get access one week before the launch.')
    // the run's line lists what went along → the entry; History → the log row
    await expect(line).toContainText('MEMORY · 1')
    await line.click()
    await expect(panel(page).getByRole('option', { name: /Beta testers get access/ })).toBeVisible()
    await expect.poll(async () => (await logRows(page))?.length).toBe(1)
    await panel(page).getByRole('option', { name: /^History/ }).click()
    await expect(panel(page).getByRole('option', { name: /draft the launch checklist/ })).toBeVisible()
    await expect(panel(page)).toContainText('AI menu · cited')
    const [log] = (await logRows(page))!
    expect(log).toMatchObject({ where: 'AI menu', page: 'Launch notes', memories: [rows[1].id], cited: [rows[1].id] })
    expect(log.content).toContain(`"id":"${id}"`)
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)

    // switched off for one request: the list's toggle
    await openPanel()
    await panel(page).locator('.ai-cmd__input').fill('draft the launch checklist again')
    await panel(page).getByTestId('ai-memory').click()
    await panel(page).getByRole('option', { name: /Use the memory for this request/ }).click()
    await expect(panel(page).getByTestId('ai-memory')).toContainText('MEMORY · OFF')
    await panel(page).getByTestId('ai-memory').click()
    await page.keyboard.press('Enter')
    await expect(panel(page)).toContainText('Without memory.')
    expect(userText(claude.stream[1])).not.toContain('<one_memory>')
    expect((await logRows(page))!).toHaveLength(1)
  })

  test('the log: 2 memories went along, 1 cited → one row with both relations; ⌘K "?" and a custom agent carry the memory; pruning keeps 500; log off → no row', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const claude = await mockClaude(context, ['Palette answer citing [M2].', (b) => (b.tools ? 'Report: launch is on track.' : 'x'), 'Another palette answer.'])
    await setUpMemory(page)
    const [m1, m2] = await seedMemories(page, [
      { text: 'Launch dates are confirmed by Ada.', type: 'fact', topics: [] },
      { text: 'Answers about the launch are short.', type: 'preference' },
    ])

    // ⌘K "?" — both go along (the preference always, the fact by relevance); [M2] cited
    const ask = async (q: string, answer: string) => {
      await page.keyboard.press(`${MOD}+k`)
      const pal = page.getByRole('dialog', { name: 'Command palette' })
      const input = pal.getByRole('combobox').or(pal.locator('input')).first()
      await input.fill(`?${q}`)
      await input.press('Enter')
      await expect(pal).toContainText(answer)
      return pal
    }
    const pal = await ask('when are the launch dates confirmed?', 'Palette answer')
    const sent = userText(claude.stream[0])
    expect(sent).toContain('<one_memory>')
    expect(sent).toContain('Preference: Answers about the launch are short.')
    expect(sent).toContain('Fact: Launch dates are confirmed by Ada.')
    await expect(pal.getByTestId('memory-note')).toHaveText('MEMORY · 2')
    await page.keyboard.press('Escape')
    if (await pal.count()) await page.keyboard.press('Escape')

    await expect.poll(async () => (await logRows(page))?.length).toBe(1)
    const [row] = (await logRows(page))!
    expect(row.where).toBe('⌘K ask')
    expect(row.memories.sort()).toEqual([m1, m2].sort())
    // the preference comes first ([M1]), the fact second: [M2] = the fact
    expect(row.cited).toEqual([m1])
    const mem = (await memoryRows(page))!
    const cited = mem.find((r) => r.id === row.cited[0])!
    expect(cited.citedIn).toEqual([row.id])
    expect(mem.every((r) => r.usedIn.includes(row.id))).toBe(true)
    expect(mem.find((r) => r.id !== cited.id)!.citedIn).toEqual([])

    // a custom agent's run: the block + recall; the run is logged as "Agent · <name>"
    const agentId = await wsEval(page, (s) => {
      const now = Date.now()
      s.upsertAgent({ id: 'ag-mem', name: 'Launch watcher', instructions: 'Check the launch dates and report.', trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'none', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdAt: now, updatedAt: now })
      return 'ag-mem'
    })
    await flush(page)
    await page.evaluate((id) => (window.location.hash = `#/agents/${id}`), agentId)
    await page.getByRole('button', { name: 'Run now' }).click()
    await expect(page.locator('.agx-run').first()).toHaveAttribute('data-status', 'ok', { timeout: 20_000 })
    const agentBody = claude.stream[1]
    expect(userText(agentBody)).toContain('<one_memory>')
    expect(userText(agentBody)).toContain('Launch dates are confirmed by Ada.')
    expect(agentBody.tools.map((x: AnyState) => x.name)).toContain('recall')
    await expect.poll(async () => (await logRows(page))?.[0]?.where).toBe('Agent · Launch watcher')

    // pruning: beyond 500 rows the oldest go to the trash (never deleted for good)
    const logId = await wsEval(page, (s) => (Object.values(s.databases) as AnyState[]).find((d) => d.system === 'memory-log')!.id)
    await wsEval(
      page,
      (s, logId) => {
        for (let i = 0; i < 505; i++) s.createRow(logId, { title: `seed ${i}` })
        // the seeds are older than the real rows
        for (const p of Object.values(s.pages) as AnyState[]) if (p.databaseId === logId && p.title.startsWith('seed ')) s.updatePage(p.id, { createdAt: 1000 + Number(p.title.slice(5)) })
      },
      logId,
    )
    await gotoPage(page, (await createPage(page, { title: 'Scratch', content: doc(para('x')) })))
    await ask('anything about the launch?', 'Another palette answer')
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await logRows(page))?.length, { timeout: 15_000 }).toBe(500)
    const trashed = await wsEval(page, (s, logId) => (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === logId && p.trashed).map((p) => p.title).sort(), logId)
    expect(trashed).toHaveLength(8)
    expect(trashed).toContain('seed 0')
    expect(trashed).not.toContain('seed 504')

    // "Keep a usage log" off → no new row (the memory still goes along)
    await uiEval(page, (u) => u.openModal({ type: 'settings', tab: 'ai' }))
    const section = page.getByTestId('memory-settings')
    await section.scrollIntoViewIfNeeded()
    await section.getByRole('switch', { name: 'Keep a usage log' }).click()
    await page.keyboard.press('Escape')
    const live = await wsEval(page, (s, logId) => (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === logId).length, logId)
    await ask('and the launch dates?', 'Done.')
    expect(userText(claude.stream[claude.stream.length - 1])).toContain('<one_memory>')
    await page.waitForTimeout(300)
    expect(await wsEval(page, (s, logId) => (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === logId).length, logId)).toBe(live)
  })

  test('DE · 390 px: /merken in the terminal, German names and readouts', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openApp(page)
    await setKey(page, 'de')
    await mockClaude(context)
    await openTerminal(page)
    await run(page, '/merken Berichte immer auf Deutsch schreiben')
    const card = page.getByTestId('term-memory').last()
    await expect(card).toContainText('MERKEN? · 1')
    await expect(card.locator('.mem-type')).toHaveText('Vorliebe')
    await expect(card.getByRole('button', { name: /Merken #1/ })).toBeVisible()
    const box = await card.boundingBox()
    expect(box!.width).toBeLessThanOrEqual(390)
    await card.getByRole('button', { name: /Merken #1/ }).click()
    await expect(card.locator('.term-change')).toHaveAttribute('data-status', 'saved')
    const dbs = await wsEval(page, (s) => (Object.values(s.databases) as AnyState[]).filter((d) => d.system).map((d) => `${d.system}:${s.pages[d.id].title}`).sort())
    expect(dbs).toEqual(['memory-log:Gedächtnis-Verlauf', 'memory:One-Gedächtnis'])
    const props = await wsEval(page, (s) => (Object.values(s.databases) as AnyState[]).find((d) => d.system === 'memory')!.properties.map((p: AnyState) => p.name))
    expect(props).toEqual(expect.arrayContaining(['Name', 'Art', 'Themen', 'Quelle', 'Aktiv', 'Verwendet in', 'Zitiert in', 'Verwendungen', 'Zuletzt verwendet']))
    // the standby readout after /neu
    await run(page, '/neu')
    await expect(page.getByTestId('term-memory-standby')).toHaveText('1 Erinnerung · /merken')
    await reloadApp(page)
    const titles = await wsEval(page, (s) => {
      const db = (Object.values(s.databases) as AnyState[]).find((d) => d.system === 'memory')!
      return (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === db.id).map((p) => p.title)
    })
    expect(titles).toEqual(['Berichte immer auf Deutsch schreiben'])
  })
})

/** A seeded example in the memory (the memory database must exist): Type Example, its tag, Pattern + Example body. */
function seedExample(page: Page, tag: string, name: string, lines: string[]) {
  return wsEval(
    page,
    (s, a) => {
      const db = (Object.values(s.databases) as AnyState[]).find((d) => d.system === 'memory')!
      const prop = (name: string) => db.properties.find((p: AnyState) => p.name === name)
      const type = prop('Type').options.find((o: AnyState) => o.name === 'Example').id
      const id = s.createRow(db.id, { title: a.name, properties: { [prop('Type').id]: type, [prop('Tag').id]: a.tag, [prop('Active').id]: true } })
      const h = (text: string) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] })
      const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
      s.setContent(id, { type: 'doc', content: [h('Pattern'), p('Sections: Done, Next, Risks.'), h('Example'), ...a.lines.map(p)] }, 'e2e')
      return id
    },
    { tag, name, lines },
  )
}

test.describe('One memory · pages as examples', () => {
  test('save a page as example (⋯ menu): Pattern + Example body, the database as schema + rows, an older memory gets Tag / Example; context marks limit it; a taken tag offers to replace', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const claude = await mockClaude(context, [], (b) =>
      b.system?.includes('EXAMPLE') ? { description: 'Weekly status report for a customer project', pattern: '## Sections\n1. Done — what shipped\n2. Projects table' } : { memories: [] },
    )
    // a memory database from before examples existed: no Tag column, no Example type
    await setUpMemory(page)
    await wsEval(page, (s) => {
      const db = (Object.values(s.databases) as AnyState[]).find((d) => d.system === 'memory')!
      const tag = db.properties.find((p: AnyState) => p.name === 'Tag')
      s.deleteProperty(db.id, tag.id)
      const type = db.properties.find((p: AnyState) => p.name === 'Type')
      s.updateProperty(db.id, type.id, { options: type.options.filter((o: AnyState) => o.name !== 'Example') })
    })
    const projects = await wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).find((p) => p.title === 'Projects' && p.kind === 'database')!.id)
    const view = await wsEval(page, (s, id) => s.databases[id].views[0].id, projects)
    const id = await createPage(page, {
      title: 'Weekly report KW 40',
      content: doc(
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Done' }] },
        { type: 'bulletList', content: ['Shipped the login', 'Fixed the sync'].map((x) => ({ type: 'listItem', content: [para(x)] })) },
        { type: 'databaseBlock', attrs: { databaseId: projects, viewId: view } },
        para('Signed, the team'),
      ),
    })
    await gotoPage(page, id)
    await page.locator('.tb').getByRole('button', { name: 'Page options' }).click()
    await page.getByRole('menuitem', { name: 'Save as example in memory' }).click()
    const dialog = page.getByTestId('memory-example')
    await expect(dialog).toContainText('Weekly report KW 40 · the whole page')
    const tag = dialog.getByRole('textbox').first()
    await expect(tag).toHaveValue('weekly-report-kw-40')
    await tag.fill('Wochenbericht')
    await expect(tag).toHaveValue('wochenbericht')
    await tag.press('Enter')
    await expect(page.locator('.toast', { hasText: 'Saved #wochenbericht to One memory' })).toBeVisible({ timeout: 15_000 })

    // one structured request with the example as Markdown (the database as its schema + rows)
    const req = claude.structured.find((b) => b.system?.includes('EXAMPLE'))!
    expect(userText(req)).toContain('Shipped the login')
    expect(userText(req)).toContain('Database “Projects”')
    const ex = (await memoryRows(page))!.find((r) => r.tag === 'wochenbericht')!
    expect(ex).toMatchObject({ title: 'Weekly status report for a customer project', type: 'Example', active: true })
    expect(ex.source).toBe(`Weekly report KW 40 · #/p/${id}`)
    expect(ex.content).toContain('"text":"Pattern"')
    expect(ex.content).toContain('Projects table')
    expect(ex.content).toContain('"text":"Example"')
    expect(ex.content).toContain('Shipped the login')
    expect(ex.content).toContain('"type":"table"')
    expect(ex.content).toContain('Database “Projects”')
    expect(ex.content).not.toContain('databaseBlock')
    // the older memory got its Tag column and Example type
    expect(await wsEval(page, (s) => (Object.values(s.databases) as AnyState[]).find((d) => d.system === 'memory')!.properties.some((p: AnyState) => p.name === 'Tag'))).toBe(true)

    // a taken tag: the dialog offers to replace that example
    await page.locator('.tb').getByRole('button', { name: 'Page options' }).click()
    await page.getByRole('menuitem', { name: 'Save as example in memory' }).click()
    await tag.fill('wochenbericht')
    await expect(dialog.getByTestId('memory-example-taken')).toContainText('#wochenbericht is taken: “Weekly status report for a customer project”')
    await expect(dialog.getByRole('button', { name: 'Save example' })).toBeDisabled()
    await dialog.getByRole('switch', { name: 'Replace the existing example' }).click()
    await dialog.getByRole('button', { name: 'Replace example' }).click()
    await expect(page.locator('.toast', { hasText: 'Replaced the example #wochenbericht' })).toBeVisible({ timeout: 15_000 })
    expect((await memoryRows(page))!.filter((r) => r.type === 'Example')).toHaveLength(1)

    // context marks: only the marked block is the example; "nothing" refuses
    const ed = editorOf(page, id)
    await ed.locator('p', { hasText: 'Signed, the team' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(150)
    await page.keyboard.press('Space')
    await expect(panel(page)).toBeVisible()
    await page.getByTestId('ai-reads').click()
    await panel(page).getByRole('option', { name: /Mark blocks/ }).click()
    await page.getByTestId('ctx-layer').getByRole('option').first().click()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)
    await page.locator('.tb').getByRole('button', { name: 'Page options' }).click()
    await page.getByRole('menuitem', { name: 'Save as example in memory' }).click()
    await expect(dialog).toContainText('1 marked block')
    await tag.fill('nur-titel')
    await tag.press('Enter')
    await expect(page.locator('.toast', { hasText: 'Saved #nur-titel' })).toBeVisible({ timeout: 15_000 })
    const short = (await memoryRows(page))!.find((r) => r.tag === 'nur-titel')!
    expect(short.content).toContain('"text":"Done"')
    expect(short.content).not.toContain('Shipped the login')
  })

  test('"#wochenbericht" forces the example in full: terminal (# completion, bare tag, unknown tag), AI menu own request, the MEMORY list', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const claude = await mockClaude(context, ['Report for KW 41 staged [M1].', 'Done.', 'Done.', 'Draft in the same shape.'])
    await setUpMemory(page)
    await seedExample(page, 'wochenbericht', 'Weekly status report for a customer project', ['Done: shipped the login.', 'Next: billing.'])

    // terminal: "#wo" + Tab completes the tag
    await openTerminal(page)
    const input = page.locator('.term-prompt__input')
    await input.pressSequentially('nimm #woch')
    await expect(page.getByRole('listbox', { name: 'Examples in memory' }).getByRole('option', { name: /#wochenbericht/ })).toBeVisible()
    await input.press('Tab')
    await expect(input).toHaveValue('nimm #wochenbericht ')
    await input.pressSequentially('als Vorlage für KW 41 auf einer neuen Seite')
    await input.press('Enter')
    await expect.poll(() => claude.stream.length).toBe(1)
    let sent = lastUser(claude.stream[0])
    expect(sent).toContain('[M1] Example #wochenbericht: Weekly status report for a customer project')
    expect(sent).toContain('Create the content based on this example: same structure, sections, columns and format')
    expect(sent).toContain('Done: shipped the login.')
    expect(sent).toContain('Sections: Done, Next, Risks.')
    await expect(terminal(page).getByTestId('term-memory-chip')).toHaveText('MEMORY · 1')
    await terminal(page).getByTestId('term-memory-chip').click()
    await expect(page.getByRole('menu').first()).toContainText('#wochenbericht')
    await page.keyboard.press('Escape')

    // the bare tag as a word works too; an unknown #tag is said (the task runs)
    await run(page, 'Make the next one like wochenbericht')
    await expect.poll(() => claude.stream.length).toBe(2)
    expect(lastUser(claude.stream[1])).toContain('Example #wochenbericht')
    await run(page, 'Use #monatsbericht for the summary')
    await expect.poll(() => claude.stream.length).toBe(3)
    expect(lastUser(claude.stream[2])).not.toContain('Example #')
    await expect(terminal(page).locator('.term-step--note').last()).toContainText('No example #monatsbericht in memory')
    await page.keyboard.press('Escape')

    // AI menu: "#wo" completes; an own request with the tag carries the example in full
    const id = await createPage(page, { title: 'KW 41', content: doc(para('Login shipped, billing next.'), para('')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p').last().click()
    await ed.evaluate((root) => {
      const e = (root as unknown as { editor: AnyState }).editor
      e.chain().focus().setTextSelection(e.state.doc.content.size - 1).run()
    })
    await page.waitForTimeout(150)
    await page.keyboard.press('Space')
    const field = panel(page).locator('.ai-cmd__input')
    await field.fill('write this week like #wo')
    await expect(panel(page).getByRole('option', { name: /#wochenbericht/ })).toBeVisible()
    await field.press('Tab')
    await expect(field).toHaveValue('write this week like #wochenbericht ')
    await expect(panel(page).getByTestId('ai-memory')).toContainText('M1 #wochenbericht')
    await field.press('Enter')
    await expect(panel(page)).toContainText('Draft in the same shape.')
    sent = lastUser(claude.stream[3])
    expect(sent).toContain('Example #wochenbericht')
    expect(sent).toContain('Next: billing.')
    await panel(page).getByTestId('ai-memory').click()
    await expect(panel(page).getByRole('option', { name: /Weekly status report/ })).toContainText('forced by #wochenbericht')
  })
})
