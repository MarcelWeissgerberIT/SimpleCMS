/**
 * Custom agents — the MCP tool allow-list, the last run + the agent's own state, and notes for the inbox
 * (features/agents: mcpTools.ts, runTools.ts, exec.ts; features/inbox). A mocked Claude API only — never
 * api.anthropic.com; the MCP servers are fictional addresses Anthropic would call (nothing is called here).
 */
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect, openApp, pageIdByTitle, wsEval, flush, gotoPage } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }

let msgSeq = 0

/** One streamed assistant message in the Messages API SSE shape. */
function sseMessage(blocks: Block[], usage = { input: 1200, output: 80 }): string {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  const stop = blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'
  let body = ev('message_start', {
    message: { id: `msg_mem_${++msgSeq}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: usage.input, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  })
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      body += ev('content_block_start', { index, content_block: { type: 'text', text: '' } })
      body += ev('content_block_delta', { index, delta: { type: 'text_delta', text: b.text } })
    } else {
      body += ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } })
      body += ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } })
    }
    body += ev('content_block_stop', { index })
  })
  body += ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: usage.output } })
  body += ev('message_stop', {})
  return body
}

type Step = (body: AnyState) => string

/** api.anthropic.com → request n gets script[n]; later requests a short report. Returns the request bodies. */
async function mockClaude(ctx: BrowserContext, script: Step[] = [], fallback = 'Checked everything.'): Promise<AnyState[]> {
  const bodies: AnyState[] = []
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (req.method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [], has_more: false }) })
    const body = JSON.parse(req.postData() ?? '{}')
    bodies.push(body)
    const step = script[bodies.length - 1] ?? (() => sseMessage([{ type: 'text', text: fallback }]))
    try {
      await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: step(body) })
    } catch {
      /* aborted (budget stop) */
    }
  })
  return bodies
}

const setKey = (page: Page) => wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))

async function addAgent(page: Page, agent: AnyState): Promise<string> {
  const id = await wsEval(
    page,
    (s, a) => {
      const now = Date.now()
      s.upsertAgent({ instructions: 'Mirror the open items.', trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'none', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdAt: now, updatedAt: now, ...a })
      return a.id as string
    },
    agent,
  )
  await flush(page)
  return id
}

/** One key of this device's "one-agents" store (never creates the database). */
async function agentsKv(page: Page, wantedKey: string): Promise<AnyState | null> {
  return page.evaluate(async (wanted) => {
    const dbs = (await indexedDB.databases?.()) ?? []
    if (!dbs.some((d) => d.name === 'one-agents')) return null
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('one-agents')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    try {
      if (!db.objectStoreNames.contains('runs')) return null
      const store = db.transaction('runs').objectStore('runs')
      const keys = await new Promise<IDBValidKey[]>((res, rej) => {
        const q = store.getAllKeys()
        q.onsuccess = () => res(q.result)
        q.onerror = () => rej(q.error)
      })
      const key = keys.find((k) => String(k) === wanted)
      if (key === undefined) return null
      return await new Promise<AnyState>((res, rej) => {
        const q = db.transaction('runs').objectStore('runs').get(key)
        q.onsuccess = () => res({ key: String(key), value: q.result })
        q.onerror = () => rej(q.error)
      })
    } finally {
      db.close()
    }
  }, wantedKey)
}

const runsOf = async (page: Page, agentId: string): Promise<AnyState[]> => ((await agentsKv(page, `runs:${agentId}`))?.value as AnyState[] | undefined) ?? []

async function waitRuns(page: Page, agentId: string, count: number, timeout = 30_000): Promise<AnyState[]> {
  await expect.poll(async () => (await runsOf(page, agentId)).filter((r) => r.status !== 'running').length, { timeout, message: `runs of ${agentId}` }).toBe(count)
  return runsOf(page, agentId)
}

const goAgent = async (page: Page, id: string) => {
  await page.evaluate((id) => (window.location.hash = `#/agents/${id}`), id)
  await expect(page.locator('.agx-dhead')).toBeVisible()
}

const toolResults = (body: AnyState) => (body.messages as AnyState[]).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((c: AnyState) => c.type === 'tool_result')
const userText = (body: AnyState): string => {
  const first = body.messages[0]
  return typeof first.content === 'string' ? first.content : (first.content as AnyState[]).map((c) => c.text ?? '').join('\n')
}
const inboxData = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __oneInbox: { data: () => unknown } }).__oneInbox.data())) as AnyState)

const TRACKER = { id: 'm-tracker', name: 'tracker', url: 'https://tracker.example.com/mcp', token: '', enabled: true, prompt: 'Look up items of the item tracker.' }
const TRACKER_TOOLS = ['list_items', 'get_item', 'search_items', 'create_item', 'update_item', 'whoami', 'delete_search_index']

test.describe('Custom agents: tool allow-list, last run + state, inbox notes', () => {
  test('MCP tool allow-list: the toolset switches every other tool off; an empty list leaves the server out; stored lists are sanitised', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    await wsEval(page, (s, servers) => s.updateSettings({ mcpServers: servers }), [
      { ...TRACKER, tools: TRACKER_TOOLS, checkedAt: Date.now() },
      { id: 'm-wiki', name: 'wiki', url: 'https://wiki.example.com/mcp', token: '', enabled: true, prompt: '' },
    ])
    const bodies = await mockClaude(context, [() => sseMessage([{ type: 'text', text: 'Found 2 open items.' }])])
    const id = await addAgent(page, {
      id: 'ag-allow',
      name: 'Item mirror',
      mcpServers: ['tracker', 'wiki'],
      // a bad name and a server the agent does not use are dropped by the sanitizer
      mcpTools: { tracker: ['list_items', 'get_item', 'bad name!', 'list_items'], wiki: [], ghost: ['x'] },
    })
    expect(await wsEval(page, (s, id) => s.agents[id].mcpTools, id)).toEqual({ tracker: ['list_items', 'get_item'], wiki: [] })

    await goAgent(page, id)
    await expect(page.locator('.agx-spec--plate')).toContainText('TRACKER (2 tools) · WIKI (0 tools)')
    await page.getByRole('button', { name: 'Run now' }).click()
    const run = page.locator('.agx-run').first()
    await expect(run).toHaveAttribute('data-status', 'ok', { timeout: 20_000 })
    expect(bodies).toHaveLength(1)
    const b = bodies[0]
    expect(b.mcp_servers).toEqual([{ type: 'url', url: 'https://tracker.example.com/mcp', name: 'tracker' }])
    expect(b.tools.filter((t: AnyState) => t.type === 'mcp_toolset')).toEqual([
      { type: 'mcp_toolset', mcp_server_name: 'tracker', default_config: { enabled: false }, configs: { list_items: { enabled: true }, get_item: { enabled: true } } },
    ])
    expect(b.system).toContain('Only these of its tools are switched on for you: list_items, get_item.')
    expect(b.system).not.toContain('<mcp_server name="wiki">')
    await expect(run.locator('.agx-step[data-kind="note"]')).toContainText('WIKI: no tool ticked for this agent — left out.')

    // no list = all tools: the plain toolset
    await wsEval(page, (s, id) => s.upsertAgent({ ...s.agents[id], mcpTools: undefined }), id)
    await page.getByRole('button', { name: 'Run now' }).click()
    await expect.poll(() => bodies.length).toBe(2)
    expect(bodies[1].tools.filter((t: AnyState) => t.type === 'mcp_toolset')).toEqual([
      { type: 'mcp_toolset', mcp_server_name: 'tracker' },
      { type: 'mcp_toolset', mcp_server_name: 'wiki' },
    ])
  })

  test('editor: the tools of the last test as checkboxes, "Read-only tools" and "All"; an untested server points to Settings', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s, servers) => s.updateSettings({ mcpServers: servers }), [
      { ...TRACKER, tools: TRACKER_TOOLS, checkedAt: Date.now() },
      { id: 'm-notes', name: 'notes', url: 'https://notes.example.com/mcp', token: '', enabled: true, prompt: '' },
    ])
    const id = await addAgent(page, { id: 'ag-edit', name: 'Item mirror', mcpServers: ['tracker'] })
    await goAgent(page, id)
    await page.getByRole('button', { name: 'Edit' }).click()
    const dialog = page.getByRole('dialog', { name: /Item mirror/ })
    const tools = dialog.getByRole('group', { name: 'Tools of TRACKER' })
    await expect(tools).toBeVisible()
    await expect(tools.getByRole('checkbox')).toHaveCount(TRACKER_TOOLS.length)
    for (const name of TRACKER_TOOLS) await expect(tools.getByRole('checkbox', { name })).toBeChecked()
    await expect(tools.getByTestId('agx-tools-count')).toHaveText('ALL')
    await expect(tools.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')

    // the read-only preset: get / list / search / whoami — never a name with a write verb in it
    await tools.getByRole('button', { name: 'Read-only tools' }).click()
    for (const name of ['list_items', 'get_item', 'search_items', 'whoami']) await expect(tools.getByRole('checkbox', { name })).toBeChecked()
    for (const name of ['create_item', 'update_item', 'delete_search_index']) await expect(tools.getByRole('checkbox', { name })).not.toBeChecked()
    await expect(tools.getByTestId('agx-tools-count')).toHaveText('4/7')
    await tools.getByRole('checkbox', { name: 'whoami' }).uncheck()
    await expect(tools.getByTestId('agx-tools-count')).toHaveText('3/7')
    // All → no list again
    await tools.getByRole('button', { name: 'All' }).click()
    await expect(tools.getByTestId('agx-tools-count')).toHaveText('ALL')
    await tools.getByRole('button', { name: 'Read-only tools' }).click()

    // a server that was never tested: no list to choose from — test it first
    await dialog.getByRole('checkbox', { name: 'NOTES' }).check()
    const notes = dialog.getByRole('group', { name: 'Tools of NOTES' })
    await expect(notes).toContainText('Test the connection first to choose its tools')
    await expect(notes.getByRole('checkbox')).toHaveCount(0)

    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    const saved = await wsEval(page, (s, id) => s.agents[id], id)
    expect(saved.mcpServers).toEqual(['tracker', 'notes'])
    expect(saved.mcpTools).toEqual({ tracker: ['list_items', 'get_item', 'search_items', 'whoami'] })

    // German labels
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await page.getByRole('button', { name: 'Bearbeiten' }).click()
    const de = page.getByRole('dialog').getByRole('group', { name: 'Werkzeuge von TRACKER' })
    await expect(de.getByRole('button', { name: 'Nur lesende Werkzeuge' })).toBeVisible()
    await expect(page.getByRole('dialog').getByRole('group', { name: 'Werkzeuge von NOTES' })).toContainText('Teste zuerst die Verbindung')
    // the link opens Settings (Claude AI, where the MCP servers are tested)
    await page.getByRole('dialog').getByRole('button', { name: 'Einstellungen → Claude KI → MCP-Server' }).click()
    await expect(page.getByRole('dialog', { name: /Einstellungen/ })).toBeVisible()
  })

  test('state: saved when a run ends ok, read by the next run with the last successful run in its context; a budget run keeps the old state', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const bodies = await mockClaude(context, [
      // run 1: nothing saved yet → save a cursor
      () => sseMessage([{ type: 'tool_use', id: 'g1', name: 'agent_state_get', input: {} }]),
      () => sseMessage([{ type: 'tool_use', id: 's1', name: 'agent_state_set', input: { json: '{"cursor": "c1", "seen": ["#8215"]}' } }]),
      () => sseMessage([{ type: 'text', text: 'Mirrored 2 items.' }]),
      // run 2: reads c1, sets c2 — then goes over its budget: c1 stays
      () => sseMessage([{ type: 'tool_use', id: 'g2', name: 'agent_state_get', input: {} }, { type: 'tool_use', id: 's2', name: 'agent_state_set', input: { json: '{"cursor":"c2"}' } }]),
      () => sseMessage([{ type: 'tool_use', id: 'l2', name: 'list_databases', input: {} }], { input: 400_000, output: 50 }),
      // run 3: c1 again; its last successful run is still run 1; a state over 4 KB is refused
      () => sseMessage([{ type: 'tool_use', id: 'g3', name: 'agent_state_get', input: {} }, { type: 'tool_use', id: 's3', name: 'agent_state_set', input: { json: JSON.stringify({ seen: 'x'.repeat(5000) }) } }]),
      () => sseMessage([{ type: 'text', text: 'Nothing new.' }]),
    ])
    const id = await addAgent(page, { id: 'ag-state', name: 'Item mirror', maxRunUsd: 0.2 })
    await goAgent(page, id)

    await page.getByRole('button', { name: 'Run now' }).click()
    const [run1] = await waitRuns(page, id, 1)
    expect(run1.status).toBe('ok')
    expect(userText(bodies[0])).toContain('Last successful run: none — this is the first run.')
    expect(bodies[0].tools.map((t: AnyState) => t.name)).toEqual(expect.arrayContaining(['agent_state_get', 'agent_state_set', 'notify_me']))
    expect(toolResults(bodies[1])[0].content).toContain('Nothing saved yet')
    expect(run1.steps.map((s: AnyState) => s.label)).toContain('State saved for the next run (32 bytes)')
    const st1 = await agentsKv(page, `state:local:local:${id}`)
    expect(st1?.key).toBe(`state:local:local:${id}`)
    expect(st1?.value).toMatchObject({ json: '{"cursor":"c1","seen":["#8215"]}', runId: run1.id })
    await expect(page.getByTestId('agx-saved-state')).toContainText('32 bytes')

    await page.getByRole('button', { name: 'Run now' }).click()
    const [run2] = await waitRuns(page, id, 2)
    expect(run2.status).toBe('budget')
    expect(userText(bodies[3])).toContain(`Last successful run: ${new Date(run1.startedAt).toISOString()} (`)
    expect(toolResults(bodies[4])[0].content).toContain('{"cursor":"c1","seen":["#8215"]}')
    expect(run2.steps.map((s: AnyState) => s.label)).toContain('The run did not finish: the previous state stays')
    expect((await agentsKv(page, `state:local:local:${id}`))?.value.json).toBe('{"cursor":"c1","seen":["#8215"]}')

    await page.getByRole('button', { name: 'Run now' }).click()
    const [run3] = await waitRuns(page, id, 3)
    expect(run3.status).toBe('ok')
    expect(userText(bodies[5])).toContain(`Last successful run: ${new Date(run1.startedAt).toISOString()} (`)
    const [get3, set3] = toolResults(bodies[6])
    expect(get3.content).toContain('"cursor":"c1"')
    expect(set3.is_error).toBe(true)
    expect(JSON.stringify(set3.content)).toContain('The state is too large')
    expect((await agentsKv(page, `state:local:local:${id}`))?.value.json).toBe('{"cursor":"c1","seen":["#8215"]}')

    // Clear (asks first): the next run starts like the first
    await page.getByTestId('agx-saved-state').getByRole('button', { name: 'Clear' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Clear' }).click()
    await expect(page.getByTestId('agx-saved-state')).toHaveCount(0)
    expect(await agentsKv(page, `state:local:local:${id}`)).toBeNull()
  })

  test('notify_me: notes become inbox items of kind "agent" after an ok run (page link, agent label), capped at 10; out-of-scope pages are refused', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const wiki = await pageIdByTitle(page, 'Team wiki')
    const projects = await pageIdByTitle(page, 'Projects')
    const notes: Block[] = Array.from({ length: 12 }, (_, i) => ({ type: 'tool_use', id: `n${i}`, name: 'notify_me', input: i === 0 ? { text: 'New comment on #8215', page_id: wiki } : { text: `Item #${8300 + i} became ready` } }))
    const bodies = await mockClaude(context, [
      () => sseMessage([{ type: 'tool_use', id: 'bad', name: 'notify_me', input: { text: 'Outside', page_id: projects } }]),
      () => sseMessage(notes),
      () => sseMessage([{ type: 'text', text: '12 items changed.' }]),
    ])
    const id = await addAgent(page, { id: 'ag-notes', name: 'Item mirror', scope: { everything: false, pages: [wiki], databases: [] } })
    await goAgent(page, id)
    await page.getByRole('button', { name: 'Run now' }).click()
    const [run] = await waitRuns(page, id, 1)
    expect(run.status).toBe('ok')
    // a page outside the scope: refused, Claude is told why
    const refused = toolResults(bodies[1])[0]
    expect(refused.is_error).toBe(true)
    expect(JSON.stringify(refused.content)).toContain('outside this agent')
    expect(run.steps.map((s: AnyState) => s.label)).toContain('12 notes sent to the inbox')

    const items = ((await inboxData(page)).items as AnyState[]).filter((i) => i.kind === 'agent').sort((a, b) => a.at - b.at)
    expect(items).toHaveLength(10)
    expect(items[0]).toMatchObject({ id: `g:${run.id}:1`, kind: 'agent', pageId: wiki, excerpt: 'New comment on #8215', agentId: id, runId: run.id })
    expect(items[1]).toMatchObject({ pageId: '', excerpt: 'Item #8301 became ready' })
    expect(items[9].excerpt).toBe('3 more: Item #8309 became ready · Item #8310 became ready · Item #8311 became ready')

    // the inbox: an "Agents" filter, the agent's label, opens the page and marks it read
    await page.evaluate(() => (window.location.hash = '#/inbox'))
    await page.getByRole('tab', { name: /Agents/ }).click()
    const rows = page.locator('#main .ibx-item[data-kind="agent"]')
    await expect(rows).toHaveCount(10)
    const first = rows.filter({ hasText: 'New comment on #8215' })
    await expect(first).toContainText('Team wiki')
    await expect(first).toContainText('Agent · Item mirror')
    await first.locator('.ibx-item__open').click()
    await expect(page).toHaveURL(new RegExp(`#/p/${wiki}`))
    await expect.poll(async () => ((await inboxData(page)).items as AnyState[]).find((i) => i.id === `g:${run.id}:1`)?.read).toBe(true)
    // a note without a page opens the agent
    await page.evaluate(() => (window.location.hash = '#/inbox'))
    await rows.filter({ hasText: 'Item #8301 became ready' }).locator('.ibx-item__open').click()
    await expect(page).toHaveURL(new RegExp(`#/agents/${id}$`))
  })

  test('a failed run delivers no notes; a scheduled apply run that changed something says so in a toast with Open', async ({ page, context }) => {
    await page.clock.install({ time: new Date('2026-10-05T07:59:00+02:00') })
    await openApp(page)
    await setKey(page)
    const wiki = await pageIdByTitle(page, 'Team wiki')
    await mockClaude(context, [
      // the budget run: a note, then over the budget
      () => sseMessage([{ type: 'tool_use', id: 'n1', name: 'notify_me', input: { text: 'Never delivered' } }]),
      () => sseMessage([{ type: 'tool_use', id: 'l1', name: 'list_databases', input: {} }], { input: 400_000, output: 50 }),
      // the scheduled apply run
      () => sseMessage([{ type: 'tool_use', id: 'a1', name: 'append_to_page', input: { id: wiki, markdown: 'Synced 3 items.' } }]),
      () => sseMessage([{ type: 'text', text: 'Synced 3 items into Team wiki.' }]),
    ])
    const failing = await addAgent(page, { id: 'ag-fail', name: 'Spender', maxRunUsd: 0.2 })
    await goAgent(page, failing)
    await page.getByRole('button', { name: 'Run now' }).click()
    const [bad] = await waitRuns(page, failing, 1)
    expect(bad.status).toBe('budget')
    expect(bad.steps.map((s: AnyState) => s.label)).toContain('1 note(s) not delivered: the run did not finish')
    expect(((await inboxData(page)).items as AnyState[]).filter((i) => i.kind === 'agent')).toHaveLength(0)

    const id = await addAgent(page, { id: 'ag-sched-apply', name: 'Wiki sync', write: 'apply', trigger: { type: 'schedule', every: 'day', at: '08:00', tz: 'Europe/Berlin' } })
    await page.evaluate(() => (window.location.hash = '#/'))
    await page.clock.fastForward('01:40')
    const [run] = await waitRuns(page, id, 1)
    expect(run).toMatchObject({ status: 'ok', applied: 1, trigger: { type: 'schedule' } })
    const toast = page.locator('.toast', { hasText: 'Agent · Wiki sync: 1 change' })
    await expect(toast).toBeVisible()
    await toast.getByRole('button', { name: 'Open' }).click()
    await expect(page).toHaveURL(new RegExp(`#/agents/${id}$`))
    await gotoPage(page, wiki)
  })
})
