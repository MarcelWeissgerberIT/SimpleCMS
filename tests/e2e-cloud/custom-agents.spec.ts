/**
 * Custom agents in a team workspace: definitions sync through the meta map `agents` (sanitized on
 * read), a browser agent runs only in its creator's browser, and the server-runner UI against the
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
    await srv.getByRole('textbox', { name: 'Name' }).fill('atlas')
    await srv.getByRole('textbox', { name: 'Address (https)' }).fill('https://atlas.example.com/mcp')
    await srv.getByLabel('Token').fill('atlas-token-0000000000001234')
    await srv.getByRole('button', { name: 'Save servers' }).click()
    await expect(a.getByText('MCP servers saved on the server')).toBeVisible()
    await srv.getByRole('switch', { name: 'Server runner' }).click()
    await expect(srv).toContainText('On')
    const rt = await a.evaluate(async (ws) => (await fetch(`/api/workspaces/${ws}/agent-runtime`)).json(), wsId)
    expect(rt).toMatchObject({ enabled: true, available: true, claudeKey: { set: true, last4: 'wxyz' }, mcpServers: [{ name: 'atlas', url: 'https://atlas.example.com/mcp', token: { set: true, last4: '1234' } }] })
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
    const staged = { id: 'run-1', agentId: 'ag-srv', runner: 'server', trigger: { type: 'schedule', detail: 'schedule 09:00' }, startedAt: now - 60_000, endedAt: now - 30_000, status: 'staged', summary: 'Moved **Big deal** forward.', steps: [{ kind: 'tool', label: 'Query · Deals', state: 'ok' }, { kind: 'mcp', label: 'ATLAS · search', state: 'ok' }], staged: [{ id: 'c1', n: 1, kind: 'update_row', status: 'pending', pageId: ids.row, databaseId: ids.db, title: 'Big deal', props: [{ propId: 'dStage', name: 'Stage', type: 'text', before: 'lead', after: 'won', intent: { kind: 'value', value: 'won' } }] }], usage: { input: 9000, output: 400, cacheRead: 0, usd: 0.044 } }
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
    await expect(run.locator('.agx-step[data-kind="mcp"]')).toContainText('ATLAS · search')
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
