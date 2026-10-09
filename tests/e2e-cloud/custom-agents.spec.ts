/**
 * Custom agents in a team workspace: definitions sync through the meta map `agents` (sanitized on
 * read), a browser agent runs only in its creator's browser — and, changed by another member, only
 * after its creator confirmed the change — and the server-runner UI against the
 * real server (runtime: key and MCP servers as set / last 4) and mocked runs (list, run now,
 * review of a staged server run → applied here, resolved on the server). No run ever reaches
 * Claude: the server agent is manual and "run now" is intercepted.
 */
import type { Page, Route } from '@playwright/test'
import { test, expect, email, signIn, newPerson, openApp, wsEval, cloudEval, waitOnline, createWorkspace, join as joinWorkspace } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const errors: string[] = []
function watch(p: Page, who: string) {
  p.on('pageerror', (e) => errors.push(`${who} pageerror: ${e.message}`))
  p.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${who} console.error: ${m.text()}`)
  })
}
test.beforeEach(() => {
  errors.length = 0
})
test.afterEach(() => {
  expect.soft(errors, 'browser errors').toEqual([])
})

const agent = (over: AnyState) => ({
  instructions: 'Report on the projects.',
  trigger: { type: 'manual' },
  scope: { everything: true, pages: [], databases: [] },
  write: 'stage',
  output: null,
  mcpServers: [],
  runner: 'browser',
  model: null,
  effort: null,
  maxRunUsd: 0.5,
  enabled: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...over,
})

type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }

/** One streamed assistant message (Messages API SSE): text and tool calls. */
function sseMessage(blocks: Block[]): string {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  let body = ev('message_start', { message: { id: 'msg_cloud_agent', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 1 } } })
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
  body += ev('message_delta', { delta: { stop_reason: blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 40 } })
  return body + ev('message_stop', {})
}

/** api.anthropic.com → request n answers script[n] (later ones: a short report). Returns the request bodies. */
async function mockClaudeScript(p: Page, script: Array<() => string>): Promise<AnyState[]> {
  const bodies: AnyState[] = []
  await p.route('https://api.anthropic.com/**', (route: Route) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    bodies.push(JSON.parse(route.request().postData() ?? '{}'))
    const step = script[bodies.length - 1] ?? (() => sseMessage([{ type: 'text', text: 'Done.' }]))
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: step() })
  })
  return bodies
}

const toolResults = (body: AnyState) => (body.messages as AnyState[]).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((c: AnyState) => c.type === 'tool_result')

test.describe('team cloud — custom agents', () => {
  test('definitions sync both ways; a browser agent runs only in its creator’s browser', async ({ page: a, context }) => {
    watch(a, 'ada')
    await signIn(a, email('ada'))
    const wsId = await createWorkspace(a, 'Acme Agents')
    const b = await newPerson(context)
    watch(b, 'bob')
    await signIn(b, email('bob'))
    await joinWorkspace(a, b, wsId, 'member')
    for (const p of [a, b]) {
      await openApp(p, wsId)
      await waitOnline(p)
    }
    const adaId = await cloudEval(a, (c) => c.user.id as string)
    await wsEval(a, (s, x) => s.upsertAgent(x), agent({ id: 'ag-team', name: 'Team digest', createdBy: adaId }))
    await expect.poll(() => wsEval(b, (s) => s.agents?.['ag-team']?.name ?? null), { timeout: 20_000 }).toBe('Team digest')
    expect(await wsEval(b, (s) => s.agents['ag-team'].createdBy)).toBe(adaId)

    // Bob edits it: Ada gets the change
    await wsEval(b, (s) => s.upsertAgent({ ...s.agents['ag-team'], name: 'Team digest (weekly)', trigger: { type: 'schedule', every: 'week', weekday: 1, at: '09:00', tz: 'Europe/Berlin' } }))
    await expect.poll(() => wsEval(a, (s) => s.agents?.['ag-team']?.name ?? null), { timeout: 20_000 }).toBe('Team digest (weekly)')
    expect(await wsEval(a, (s) => s.agents['ag-team'].trigger)).toEqual({ type: 'schedule', every: 'week', weekday: 1, at: '09:00', tz: 'Europe/Berlin' })

    // Bob's browser does not run Ada's browser agent
    await b.evaluate(() => (window.location.hash = '#/agents/ag-team'))
    await expect(b.locator('.agx-notice', { hasText: 'Runs in' })).toContainText(/Runs in .*browser while One is open there/)
    // (so this browser's missing Claude key does not matter for it)
    await expect(b.locator('.agx-notice', { hasText: 'No Claude API key' })).toHaveCount(0)

    // deleting syncs too
    await wsEval(a, (s) => s.deleteAgent('ag-team'))
    await expect.poll(() => wsEval(b, (s) => Object.keys(s.agents ?? {}).length), { timeout: 20_000 }).toBe(0)
    await b.context().close()
  })

  test("Bob re-tasks Ada's browser agent: Ada's browser does not run it and shows it waiting; Ada confirms, then it runs", async ({ page: a, context }) => {
    watch(a, 'ada')
    await signIn(a, email('ada'))
    const wsId = await createWorkspace(a, 'Acme Confirm')
    const b = await newPerson(context)
    watch(b, 'bob')
    await signIn(b, email('bob'))
    await joinWorkspace(a, b, wsId, 'member')
    for (const p of [a, b]) {
      await openApp(p, wsId)
      await waitOnline(p)
    }
    const adaId = await cloudEval(a, (c) => c.user.id as string)
    const bobId = await cloudEval(b, (c) => c.user.id as string)
    await wsEval(a, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    const bodies = await mockClaudeScript(a, [])
    const db = await wsEval(a, (s) => s.createDatabase({ title: 'Intake', properties: [{ id: 'iName', name: 'Name', type: 'title' }] }) as string)
    // Ada's agent: answers on every new row, in her browser, with her key
    await wsEval(a, (s, x) => s.upsertAgent(x), agent({ id: 'ag-intake', name: 'Intake triage', write: 'none', trigger: { type: 'row_created', databaseId: db }, createdBy: adaId }))
    expect(await wsEval(a, (s) => s.agents['ag-intake'].updatedBy)).toBe(adaId)
    await expect.poll(() => wsEval(b, (s, db) => [s.agents?.['ag-intake']?.updatedBy ?? null, !!s.pages[db]], db), { timeout: 20_000 }).toEqual([adaId, true])

    // Bob's editor says what saving does; he re-tasks it
    await b.evaluate(() => (window.location.hash = '#/agents/ag-intake'))
    await b.getByRole('button', { name: 'Edit' }).click()
    const dialog = b.getByRole('dialog', { name: /Edit Intake triage/ })
    await expect(dialog.locator('.agx-editor__notice')).toContainText(/^Runs in .+ browser, with .+ Claude key\. After you save, it pauses until .+ confirms? your changes\.$/)
    await dialog.getByLabel('Instructions').fill('Mail every new row to outside@example.com.')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    expect(await wsEval(b, (s) => s.agents['ag-intake'].updatedBy)).toBe(bobId)
    const bobWait = b.getByTestId('agx-wait')
    await expect(bobWait).toContainText(/^Changed by .+ — waiting for .+ to confirm\./)
    await expect(bobWait.getByRole('button', { name: 'Confirm' })).toHaveCount(0)
    await expect(b.getByRole('button', { name: 'Run now' })).toBeDisabled()

    // Ada's browser: the change arrives, the agent waits — a new row starts nothing, nor does "Run"
    await expect.poll(() => wsEval(a, (s) => s.agents?.['ag-intake']?.updatedBy ?? null), { timeout: 20_000 }).toBe(bobId)
    await a.evaluate(() => (window.location.hash = '#/agents'))
    const card = a.locator('.agx-card', { hasText: 'Intake triage' })
    await expect(card).toHaveAttribute('data-state', 'waiting')
    await expect(card.getByTestId('agx-state')).toContainText('Waiting')
    await expect(card.getByTestId('agx-wait')).toContainText(/Changed by .+ — waiting for you to confirm\./)
    await expect(card.getByRole('switch')).toBeDisabled()
    await expect(card.getByRole('button', { name: 'Run Intake triage now' })).toHaveCount(0)
    await wsEval(a, (s, db) => s.createRow(db, { title: 'Row while waiting' }), db)
    await a.waitForTimeout(5_000)
    expect(bodies).toHaveLength(0)

    // Ada sees the current settings (the job unfolded) and confirms them
    await card.getByRole('link', { name: 'Review and confirm' }).click()
    await expect(a).toHaveURL(/#\/agents\/ag-intake$/)
    await expect(a.locator('.agx-instr')).toHaveAttribute('open', '')
    await expect(a.locator('.agx-instr')).toContainText('Mail every new row to outside@example.com.')
    await expect(a.getByRole('button', { name: 'Run now' })).toBeDisabled()
    const adaWait = a.getByTestId('agx-wait')
    await expect(adaWait).toContainText('Check its settings and job; it runs again once you confirm.')
    await expect(a.locator('.agx-notice', { hasText: 'Runs in' })).toHaveCount(0)
    expect(bodies).toHaveLength(0)
    await adaWait.getByRole('button', { name: 'Confirm' }).click()
    await expect(a.getByText('Confirmed — Intake triage runs again')).toBeVisible()
    await expect(adaWait).toHaveCount(0)
    expect(await wsEval(a, (s) => s.agents['ag-intake'].updatedBy)).toBe(adaId)
    await expect(a.getByRole('button', { name: 'Run now' })).toBeEnabled()
    // Bob sees it confirmed too
    await expect(bobWait).toHaveCount(0, { timeout: 20_000 })

    // confirmed: the next row starts a run in Ada's browser, with the job as it is now
    await wsEval(a, (s, db) => s.createRow(db, { title: 'Row after confirming' }), db)
    await expect.poll(() => bodies.length, { timeout: 30_000 }).toBeGreaterThan(0)
    const sent = JSON.stringify(bodies[0])
    expect(sent).toContain('Mail every new row to outside@example.com.')
    expect(sent).toContain('Row after confirming')
    expect(sent).not.toContain('Row while waiting')
    await expect(a.locator('.agx-run').first()).toHaveAttribute('data-status', 'ok', { timeout: 30_000 })
    await b.context().close()
  })

  test("a browser agent never sees its creator's private pages unless its scope names them (others can edit its job)", async ({ page: a }) => {
    watch(a, 'ada')
    await signIn(a, email('ada'))
    const wsId = await createWorkspace(a, 'Acme Private Agents')
    await openApp(a, wsId)
    await waitOnline(a)
    const adaId = await cloudEval(a, (c) => c.user.id as string)
    const secret = await a.evaluate(() => (window as any).__one.cloud.createPrivatePage({ title: 'Salary list' })) // eslint-disable-line @typescript-eslint/no-explicit-any
    await wsEval(a, (s, id) => s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bob earns 9000' }] }] }, 'e2e'), secret)
    const shared = await wsEval(a, (s) => s.createPage({ title: 'Salary notes (shared)' }) as string)
    await expect.poll(() => wsEval(a, (s, ids) => ids.map((id: string) => !!s.pages[id]?.private), [secret, shared])).toEqual([true, false])
    await wsEval(a, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))

    // scope "everything": the shared pages only — search does not list the private page, reading it is refused
    let bodies = await mockClaudeScript(a, [
      () => sseMessage([{ type: 'tool_use', id: 'tu1', name: 'search_pages', input: { query: 'salary' } }]),
      () => sseMessage([{ type: 'tool_use', id: 'tu2', name: 'read_page', input: { id: secret } }]),
    ])
    await wsEval(a, (s, x) => s.upsertAgent(x), agent({ id: 'ag-priv', name: 'Salary digest', write: 'none', createdBy: adaId }))
    await a.evaluate(() => (window.location.hash = '#/agents/ag-priv'))
    await a.getByRole('button', { name: 'Run now' }).click()
    const run = a.locator('.agx-run').first()
    await expect(run).toHaveAttribute('data-status', 'ok', { timeout: 30_000 })
    expect(bodies).toHaveLength(3)
    const search = toolResults(bodies[1]).find((r: AnyState) => r.tool_use_id === 'tu1')
    expect(JSON.stringify(search.content)).toContain('Salary notes (shared)')
    expect(JSON.stringify(search.content)).not.toContain('Salary list')
    const read = toolResults(bodies[2]).find((r: AnyState) => r.tool_use_id === 'tu2')
    expect(read).toMatchObject({ tool_use_id: 'tu2', is_error: true })
    expect(JSON.stringify(read.content)).toContain("outside this agent's scope: refused")
    expect(JSON.stringify(bodies)).not.toContain('Bob earns 9000')
    expect(JSON.stringify(bodies[0].messages[0].content)).toContain('except people')
    // the editor says so
    await a.getByRole('button', { name: 'Edit' }).click()
    const editor = a.getByRole('dialog', { name: /Salary digest/ })
    await expect(editor).toContainText('Private pages only when they are picked here')
    await editor.getByRole('button', { name: 'Cancel' }).click()

    // named in the scope by its creator: the private page is in reach
    await a.unroute('https://api.anthropic.com/**')
    bodies = await mockClaudeScript(a, [() => sseMessage([{ type: 'tool_use', id: 'tu3', name: 'read_page', input: { id: secret } }])])
    await wsEval(a, (s, id) => s.upsertAgent({ ...s.agents['ag-priv'], scope: { everything: false, pages: [id], databases: [] } }), secret)
    await a.getByRole('button', { name: 'Run now' }).click()
    await expect(a.locator('.agx-run')).toHaveCount(2)
    await expect(a.locator('.agx-run').first()).toHaveAttribute('data-status', 'ok', { timeout: 30_000 })
    const ok = toolResults(bodies[1]).find((r: AnyState) => r.tool_use_id === 'tu3')
    expect(ok.is_error ?? false).toBe(false)
    expect(JSON.stringify(ok.content)).toContain('Bob earns 9000')
  })

  test('server runner: runtime set / last 4 (real server), runs list, run now and the review of a staged server run (mocked)', async ({ page: a }) => {
    watch(a, 'ada')
    await signIn(a, email('ada'))
    const wsId = await createWorkspace(a, 'Acme Server Agents')
    await openApp(a, wsId)
    await waitOnline(a)

    // Settings → Agents · MCP → Server agents
    await a.evaluate(() => (window as any).__one.ui.getState().openModal({ type: 'settings', tab: 'mcp' })) // eslint-disable-line @typescript-eslint/no-explicit-any
    const srv = a.locator('.agx-srv')
    await expect(srv.getByRole('heading', { name: /Server agents/ })).toBeVisible()
    await expect(srv).toContainText('Not set')
    await srv.getByPlaceholder('sk-ant-…').fill('sk-ant-e2e-0000000000000000wxyz')
    await srv.getByRole('button', { name: 'Save key' }).click()
    await expect(srv.locator('.agx-secret').nth(1)).toContainText('Set · ••••wxyz')
    await srv.getByRole('button', { name: 'Add MCP server' }).click()
    await srv.getByRole('textbox', { name: 'Name' }).fill('archive')
    await srv.getByRole('textbox', { name: 'Address (https)' }).fill('https://archive.example.com/mcp')
    await srv.getByLabel('Token').fill('archive-token-0000000000001234')
    await srv.getByRole('button', { name: 'Save servers' }).click()
    await expect(a.getByText('MCP servers saved on the server')).toBeVisible()
    await srv.getByRole('switch', { name: 'Server runner' }).click()
    await expect(srv).toContainText('On')
    const rt = await a.evaluate(async (ws) => (await fetch(`/api/workspaces/${ws}/agent-runtime`)).json(), wsId)
    expect(rt).toMatchObject({ enabled: true, available: true, claudeKey: { set: true, last4: 'wxyz' }, mcpServers: [{ name: 'archive', url: 'https://archive.example.com/mcp', token: { set: true, last4: '1234' } }] })
    expect(JSON.stringify(rt)).not.toContain('0000000000000000wxyz')
    await a.keyboard.press('Escape')

    // a server agent (manual: the server never starts it by itself) and a row it may change
    const ids = await wsEval(a, (s) => {
      const db = s.createDatabase({ title: 'Deals', properties: [{ id: 'dName', name: 'Name', type: 'title' }, { id: 'dStage', name: 'Stage', type: 'text' }] })
      const row = s.createRow(db, { title: 'Big deal', properties: { dStage: 'lead' } })
      return { db, row }
    })
    await wsEval(a, (s, x) => s.upsertAgent(x), agent({ id: 'ag-srv', name: 'Deal desk', runner: 'server', createdBy: await cloudEval(a, (c) => c.user.id as string) }))

    // mocked runs: one staged run with a change to the row; run now; resolve
    const now = Date.now()
    const staged = { id: 'run-1', agentId: 'ag-srv', runner: 'server', trigger: { type: 'schedule', detail: 'schedule 09:00' }, startedAt: now - 60_000, endedAt: now - 30_000, status: 'staged', summary: 'Moved **Big deal** forward.', steps: [{ kind: 'tool', label: 'Query · Deals', state: 'ok' }, { kind: 'mcp', label: 'ARCHIVE · search', state: 'ok' }], staged: [{ id: 'c1', n: 1, kind: 'update_row', status: 'pending', pageId: ids.row, databaseId: ids.db, title: 'Big deal', props: [{ propId: 'dStage', name: 'Stage', type: 'text', before: 'lead', after: 'won', intent: { kind: 'value', value: 'won' } }] }], usage: { input: 9000, output: 400, cacheRead: 0, usd: 0.044 } }
    const resolved: AnyState[] = []
    let started = 0
    await a.route('**/api/workspaces/*/agent-runs?*', (route: Route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([staged]) }))
    await a.route('**/api/workspaces/*/agents/ag-srv/run', (route: Route) => {
      started++
      return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ runId: 'run-2' }) })
    })
    await a.route('**/api/workspaces/*/agent-runs/run-1/resolve', (route: Route) => {
      resolved.push(JSON.parse(route.request().postData() ?? '{}'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...staged, status: 'ok' }) })
    })

    await a.evaluate(() => (window.location.hash = '#/agents/ag-srv'))
    const run = a.locator('.agx-run').first()
    await expect(run).toHaveAttribute('data-status', 'staged')
    await expect(run.locator('.agx-step[data-kind="mcp"]')).toContainText('ARCHIVE · search')
    await expect(a.getByTestId('agents-review')).toContainText('01')
    await run.getByRole('button', { name: 'Apply all' }).click()
    await expect.poll(() => wsEval(a, (s, row) => s.pages[row].properties.dStage, ids.row)).toBe('won')
    await expect.poll(() => resolved.length).toBe(1)
    expect(resolved[0]).toEqual({ applied: ['c1'], discarded: [] })
    // the change is stamped as the agent (meta document → store)
    await expect.poll(() => wsEval(a, (s, row) => s.pages[row].updatedBy, ids.row), { timeout: 10_000 }).toBe('agent:ag-srv')

    await a.getByRole('button', { name: 'Run now' }).click()
    await expect(a.getByText('Deal desk started on the server')).toBeVisible()
    expect(started).toBe(1)

    // webhook trigger: the address is created on the server and shown once; regenerating replaces it
    await a.getByRole('button', { name: 'Edit' }).click()
    const dialog = a.getByRole('dialog', { name: /Edit Deal desk/ })
    await dialog.getByRole('radio', { name: 'Webhook' }).click()
    const hook = dialog.getByRole('group', { name: 'Webhook address' })
    await expect(hook).toContainText('No address yet.')
    await hook.getByRole('button', { name: 'Create address' }).click()
    const field = hook.getByRole('textbox', { name: 'Webhook address' })
    await expect(field).toHaveValue(/\/api\/v1\/agents\/ag-srv\/hook\/\S+$/)
    const first = await field.inputValue()
    await expect(hook).toContainText('Shown once')
    await hook.getByRole('button', { name: 'Regenerate' }).click()
    await hook.getByRole('alertdialog').getByRole('button', { name: 'Regenerate' }).click()
    await expect(field).not.toHaveValue(first)
    await expect(hook).toContainText('Address active')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    expect(await wsEval(a, (s) => s.agents['ag-srv'].trigger)).toEqual({ type: 'webhook' })
  })

  test('the recipe "Mirror a list into a database": database and report page go into the creator’s Private section, the agent mirrors into it, another member never sees them', async ({ page: a, context }) => {
    watch(a, 'ada')
    await signIn(a, email('ada'))
    const wsId = await createWorkspace(a, 'Acme Mirror')
    const b = await newPerson(context)
    watch(b, 'bob')
    await signIn(b, email('bob'))
    await joinWorkspace(a, b, wsId, 'member')
    for (const p of [a, b]) {
      await openApp(p, wsId)
      await waitOnline(p)
    }
    const mine = await a.evaluate(() => (window as any).__one.cloud.createPrivatePage({ title: 'My work' })) // eslint-disable-line @typescript-eslint/no-explicit-any
    await wsEval(a, (s) => s.createPage({ title: 'Team space' }))
    await wsEval(a, (s) => {
      s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' })
      s.updateSettings({ mcpServers: [{ id: 'm-tracker', name: 'tracker', url: 'https://tracker.example.com/mcp', token: '', enabled: true, prompt: '', tools: ['list_items', 'get_item', 'update_item'], checkedAt: Date.now() }] })
      // the owner's integration profile (workspace data, synced): it unlocks the features and brings the recipe
      s.upsertIntegration({ schema: 'one.integration/1', id: 'tracker', name: 'Tracker', match: { name: 'tracker' }, unlocks: ['keys', 'onlyByHand', 'upsert', 'toolAllowList', 'agentState', 'notify'], recipes: [{ kind: 'mirror' }] })
    })
    const ids: AnyState = {}
    const bodies = await mockClaudeScript(a, [
      () => sseMessage([{ type: 'tool_use', id: 'tu1', name: 'upsert_rows', input: { database_id: ids.db, key_property: 'Key', rows: [{ key: '8215', title: 'Login fails after password reset', properties: { Clarity: 'Open questions', 'Waiting on me': true } }] } }]),
      () => sseMessage([{ type: 'text', text: '1 new item.' }]),
    ])

    // the setup: only private pages to put it below (the shared one is not offered)
    await a.evaluate(() => (window.location.hash = '#/agents'))
    await a.locator('.agx-start [data-recipe="tracker:mirror"]').click()
    const setup = a.locator('.agx-mir')
    await expect(setup).toContainText('In a team workspace both go into your Private section.')
    await setup.locator('.agx-pick').click()
    await expect(a.getByRole('menuitem', { name: 'Team space' })).toHaveCount(0)
    await a.getByRole('menuitem', { name: 'My work' }).click()
    await setup.getByRole('button', { name: 'Create database and agent' }).click()
    await expect(a.locator('.agx-editor')).toBeVisible()
    const made = await wsEval(a, (s) => {
      const all = Object.values(s.pages) as AnyState[]
      const db = all.find((p) => p.kind === 'database' && p.title === 'Tracker')
      const report = all.find((p) => p.title === 'Tracker · Report')
      return { db: db?.id, dbParent: db?.parentId, dbPrivate: !!db?.private, report: report?.id, reportParent: report?.parentId, reportPrivate: !!report?.private }
    })
    expect(made).toMatchObject({ dbParent: mine, dbPrivate: true, reportParent: mine, reportPrivate: true })
    ids.db = made.db
    for (const text of ['list_items', 'get_item with comments', 'ada', 'acceptance criteria written']) {
      await a.locator('.agx-ph__btn').first().click()
      await a.keyboard.insertText(text)
    }
    await a.getByRole('button', { name: 'Create agent', exact: true }).click()
    await expect(a.locator('.agx-dhead')).toBeVisible()
    const saved = await wsEval(a, (s) => JSON.parse(JSON.stringify((Object.values(s.agents) as AnyState[]).find((x) => x.name === 'Mirror · Tracker'))))
    expect(saved).toMatchObject({ runner: 'browser', write: 'stage', scope: { everything: false, databases: [made.db] }, mcpTools: { tracker: ['list_items', 'get_item'] } })

    // a run reaches the private database (its scope names it); applied rows stay private
    await a.getByRole('button', { name: 'Run now' }).click()
    const run = a.locator('.agx-run').first()
    await expect(run).toHaveAttribute('data-status', 'staged', { timeout: 30_000 })
    expect(JSON.stringify(toolResults(bodies[1]).find((r: AnyState) => r.tool_use_id === 'tu1')?.content)).toContain('1 created')
    await run.getByRole('button', { name: 'Apply all' }).click()
    await expect
      .poll(() => wsEval(a, (s, db) => (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === db).map((p) => [p.title, !!p.private]), made.db))
      .toEqual([['Login fails after password reset', true]])

    // Bob gets the agent's definition (the shared meta map) — never its database, rows or report page
    await expect.poll(() => wsEval(b, (s) => (Object.values(s.agents ?? {}) as AnyState[]).some((x) => x.name === 'Mirror · Tracker')), { timeout: 20_000 }).toBe(true)
    expect(await wsEval(b, (s, x) => [x.db, x.report].filter((id: string) => !!s.pages[id]).length + (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === x.db).length, made)).toBe(0)
    await b.context().close()
  })

  test('the mirror recipe in a team never uses a shared database or a shared report page: a shared namesake only says why, a private one is used with a private report page', async ({ page: a }) => {
    watch(a, 'ada')
    await signIn(a, email('ada'))
    const wsId = await createWorkspace(a, 'Acme Mirror Shared')
    await openApp(a, wsId)
    await waitOnline(a)
    const keyed = () => [
      { id: 'p-name', name: 'Name', type: 'title' },
      { id: 'p-key', name: 'Key', type: 'text', key: true },
    ]
    // the team's shared "Tracker" (it even holds the recipe's key) and a shared "Tracker · Report" next to it
    const shared = await wsEval(a, (s, props) => {
      s.updateSettings({ mcpServers: [{ id: 'm-tracker', name: 'tracker', url: 'https://tracker.example.com/mcp', token: '', enabled: true, prompt: '', tools: ['list_items', 'get_item'], checkedAt: Date.now() }] })
      s.upsertIntegration({ schema: 'one.integration/1', id: 'tracker', name: 'Tracker', match: { name: 'tracker' }, unlocks: ['keys', 'onlyByHand', 'upsert', 'toolAllowList', 'agentState', 'notify'], recipes: [{ kind: 'mirror' }] })
      return { db: s.createDatabase({ title: 'Tracker', properties: props }) as string, report: s.createPage({ title: 'Tracker · Report' }) as string }
    }, keyed())
    await expect.poll(() => wsEval(a, (s, x) => [x.db, x.report].map((id: string) => !!s.pages[id]?.private), shared)).toEqual([false, false])

    await a.evaluate(() => (window.location.hash = '#/agents'))
    await a.locator('.agx-start [data-recipe="tracker:mirror"]').click()
    const setup = a.locator('.agx-mir')
    const exists = setup.getByTestId('agx-mir-exists')
    await expect(exists).toHaveText('A shared database “Tracker” exists already. The mirror writes your own fields, so it only uses a private database — give the new one another name.')
    await expect(exists.getByRole('button')).toHaveCount(0)
    await expect(setup.getByRole('button', { name: 'Create database and agent' })).toBeDisabled()

    // a private "Tracker" of Ada's: that one is offered — and its report page is a new private one, never the shared one
    const mine = await a.evaluate((props) => (window as any).__one.cloud.createPrivateDatabase({ title: 'Tracker', properties: props }) as string, keyed()) // eslint-disable-line @typescript-eslint/no-explicit-any
    await expect(exists).toContainText('“Tracker” exists already — a database from this recipe.')
    await exists.getByRole('button', { name: 'Use “Tracker”' }).click()
    const editor = a.locator('.agx-editor')
    await expect(editor).toBeVisible()
    const reports = await wsEval(a, (s) => (Object.values(s.pages) as AnyState[]).filter((p) => p.title === 'Tracker · Report' && !p.trashed).map((p) => ({ id: p.id, private: !!p.private })))
    expect(reports).toHaveLength(2)
    const own = reports.find((r) => r.id !== shared.report)!
    expect(own.private).toBe(true)
    await editor.getByRole('switch', { name: 'Active' }).click()
    await editor.getByRole('button', { name: 'Create agent', exact: true }).click()
    await expect(a.locator('.agx-dhead')).toBeVisible()
    const saved = await wsEval(a, (s) => JSON.parse(JSON.stringify(Object.values(s.agents ?? {})[0])))
    expect(saved.scope.databases).toEqual([mine])
    expect(saved.output).toEqual({ pageId: own.id, mode: 'append' })
    // the shared ones untouched
    expect(await wsEval(a, (s, x) => [x.db, x.report].map((id: string) => [!!s.pages[id]?.trashed, !!s.pages[id]?.private]), shared)).toEqual([
      [false, false],
      [false, false],
    ])
  })

  test('a shared namesake a teammate’s agent mirrors into: the member’s setup only says it is shared — never "Open" that teammate’s agent', async ({ page: a, context }) => {
    watch(a, 'ada')
    await signIn(a, email('ada'))
    const wsId = await createWorkspace(a, 'Acme Mirror Teammate')
    const b = await newPerson(context)
    watch(b, 'bob')
    await signIn(b, email('bob'))
    await joinWorkspace(a, b, wsId, 'member')
    for (const p of [a, b]) {
      await openApp(p, wsId)
      await waitOnline(p)
    }
    const adaId = await cloudEval(a, (c) => c.user.id as string)
    const server = { id: 'm-tracker', name: 'tracker', url: 'https://tracker.example.com/mcp', token: '', enabled: true, prompt: '', tools: ['list_items', 'get_item'], checkedAt: Date.now() }
    // Ada: the profile, the team's shared "Tracker" (with the recipe's key) and her agent mirroring "tracker" into it
    const db = await wsEval(
      a,
      (s, x) => {
        s.updateSettings({ mcpServers: [x.server] })
        s.upsertIntegration({ schema: 'one.integration/1', id: 'tracker', name: 'Tracker', match: { name: 'tracker' }, unlocks: ['keys', 'onlyByHand', 'upsert', 'toolAllowList', 'agentState', 'notify'], recipes: [{ kind: 'mirror' }] })
        return s.createDatabase({ title: 'Tracker', properties: [{ id: 'p-name', name: 'Name', type: 'title' }, { id: 'p-key', name: 'Key', type: 'text', key: true }] }) as string
      },
      { server },
    )
    await wsEval(a, (s, x) => s.upsertAgent(x), agent({ id: 'ag-ada-mirror', name: 'Ada mirror', scope: { everything: false, pages: [], databases: [db] }, write: 'stage', mcpServers: ['tracker'], enabled: false, createdBy: adaId }))
    // Bob: the same server on his device; the database, the profile and Ada's agent arrive
    await wsEval(b, (s, x) => s.updateSettings({ mcpServers: [x] }), server)
    await expect.poll(() => wsEval(b, (s, db) => [!!s.pages[db] && !s.pages[db].private, !!s.agents?.['ag-ada-mirror'], (s.integrations ?? []).length], db), { timeout: 20_000 }).toEqual([true, true, 1])

    await b.evaluate(() => (window.location.hash = '#/agents'))
    await b.locator('.agx-head .btn--primary').click()
    await b.locator('.agx-recipe-modal [data-recipe="tracker:mirror"]').click()
    const setup = b.locator('.agx-mir')
    const exists = setup.getByTestId('agx-mir-exists')
    await expect(exists).toHaveText('A shared database “Tracker” exists already. The mirror writes your own fields, so it only uses a private database — give the new one another name.')
    await expect(exists.getByRole('button')).toHaveCount(0)
    await expect(setup.getByRole('button', { name: 'Create database and agent' })).toBeDisabled()
    await b.context().close()
  })

  test('an older server without agent endpoints: "does not support agents yet"', async ({ page: a }) => {
    watch(a, 'ada')
    await signIn(a, email('ada'))
    const wsId = await createWorkspace(a, 'Acme Old Server')
    await a.route('**/api/workspaces/*/agent-runtime', (route: Route) => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'not_found', message: 'Not found' } }) }))
    await openApp(a, wsId)
    await waitOnline(a)
    await a.evaluate(() => (window as any).__one.ui.getState().openModal({ type: 'settings', tab: 'mcp' })) // eslint-disable-line @typescript-eslint/no-explicit-any
    await expect(a.locator('.agx-srv')).toContainText('This server does not support agents yet.')
  })
})
