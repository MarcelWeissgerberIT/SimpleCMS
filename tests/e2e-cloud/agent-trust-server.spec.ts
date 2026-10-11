/**
 * Per-field trust S1, a server agent's proposals: the review writes a verdict only once the server took the decision.
 * A discard the server refuses (409 run_busy here; a viewer's 403 the same way) discards nothing, leaves this tab's copy
 * open and records no verdict — the same proposal shown again cannot be judged twice; the discard the server takes
 * records exactly one. The server's run store is answered by routes (its runner would need Claude). Fictional names.
 */
import type { Page, Route } from '@playwright/test'
import { test, expect, email, signIn, openApp, wsEval, cloudEval, waitOnline, createWorkspace } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const verdicts = async (page: Page, agent: string): Promise<AnyState[]> =>
  Object.values(((await page.evaluate((id) => (window as unknown as { __oneAgentTrust: AnyState }).__oneAgentTrust.book(id), agent)) as AnyState).entries as Record<string, AnyState[]>).flat()

/** Discard ONE proposal of the run as the run review's row does (judged, with a reason); what discardRun answered. */
const discardOne = (page: Page, run: AnyState, change: string) =>
  page.evaluate(
    async ({ run, change }) => {
      const out = await (window as unknown as { __oneAgents: AnyState }).__oneAgents.discardRun(run, change, { undo: true, row: true, judged: true, reason: 'wrong' })
      return { dropped: out.dropped as string[], refused: (out.refused ?? null) as string | null }
    },
    { run, change },
  )

test('a server run: a discard the server refuses records no verdict and stays open; the one it takes records one', async ({ page: a }) => {
  test.setTimeout(120_000)
  await signIn(a, email('mara'))
  const wsId = await createWorkspace(a, 'Nordlicht Werk')
  await openApp(a, wsId)
  await waitOnline(a)
  const me = (await cloudEval(a, (c) => c.user.id)) as string
  const ids = await wsEval(a, (s) => {
    const db = s.createDatabase({ title: 'Nordlicht Übergabe', properties: [{ id: 'nName', name: 'Name', type: 'title' }, { id: 'nStatus', name: 'Status', type: 'text' }] })
    return { db, row: s.createRow(db, { title: 'Wartungsfenster Oktober', properties: { nStatus: 'offen' } }) as string }
  })
  const now = Date.now()
  const change = { id: 'c1', n: 1, kind: 'update_row', status: 'pending', pageId: ids.row, databaseId: ids.db, title: 'Wartungsfenster Oktober', props: [{ propId: 'nStatus', name: 'Status', type: 'text', before: 'offen', after: 'erledigt', intent: { kind: 'value', value: 'erledigt' } }] }
  const run = { id: 'run-1', agentId: 'ag-srv', runner: 'server', trigger: { type: 'schedule', detail: 'schedule 07:30' }, startedAt: now - 60_000, endedAt: now - 30_000, status: 'staged', summary: '', steps: [], staged: [change] }
  // the server still holds the proposal as open until it takes a decision
  let decided = false
  await a.route('**/api/workspaces/*/agent-runs/open?*', (route: Route) => {
    const runs = decided ? [] : [run]
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ runs, latest: runs.map((r) => ({ id: r.id, agentId: r.agentId, status: 'staged', startedAt: r.startedAt, endedAt: r.endedAt })) }) })
  })
  let busy = true
  const asked: string[] = []
  await a.route('**/api/workspaces/*/agent-runs/run-1/resolve', (route: Route) => {
    asked.push(route.request().postData() ?? '')
    if (busy) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'run_busy', message: 'These changes are being applied right now' } }) })
    decided = true
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...run, status: 'ok', staged: [{ ...change, status: 'discarded' }] }) })
  })
  await wsEval(a, (s, x) => s.upsertAgent(x), {
    id: 'ag-srv',
    name: 'Übergabe-Spiegel',
    icon: null,
    instructions: 'Halte die Übergabe aktuell.',
    trigger: { type: 'manual' },
    scope: { everything: true, pages: [], databases: [] },
    write: 'stage',
    output: null,
    mcpServers: [],
    runner: 'server',
    model: null,
    effort: null,
    maxRunUsd: 0.5,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    createdBy: me,
  })
  await a.waitForFunction(() => !!(window as unknown as { __oneAgents?: unknown; __oneAgentTrust?: unknown }).__oneAgents && !!(window as unknown as { __oneAgentTrust?: unknown }).__oneAgentTrust)

  // refused twice (the proposal comes back each time): nothing discarded, no verdict
  for (let i = 0; i < 2; i++) {
    const out = await discardOne(a, run, 'c1')
    expect(out.dropped).toEqual([])
    expect(out.refused).toContain('Not discarded')
    expect(await verdicts(a, 'ag-srv')).toEqual([])
  }
  expect(asked).toHaveLength(2)

  // the server takes it: discarded, exactly one verdict
  busy = false
  const out = await discardOne(a, run, 'c1')
  expect(out.dropped).toEqual(['c1'])
  expect(out.refused).toBeNull()
  await expect.poll(async () => (await verdicts(a, 'ag-srv')).map((v) => `${v.change}:${v.v}:${v.reason}`)).toEqual(['c1:discard:wrong'])
})
