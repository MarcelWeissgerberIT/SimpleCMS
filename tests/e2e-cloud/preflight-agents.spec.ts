/**
 * Preflight in a team workspace (T-P2-13): a server agent's staged proposals and its failure count only for its creator
 * (agent-runs/open is asked only for the member's OWN server agents — a teammate's tab never asks for them, M11); a
 * hidden tab asks nothing (PB11); the gate lamp counts only the member's own (private) pipeline; two accounts in one
 * browser share no acknowledgement, no day record and no Bordbuch (M14). The server's run store is answered by a route
 * (its runner would need Claude); every name is fictional.
 */
import type { Page, Route } from '@playwright/test'
import { test, expect, email, signIn, newPerson, openApp, wsEval, cloudEval, waitOnline, createWorkspace, join } from './fixtures'
import { seedPipeline } from '../e2e/helpers/preflightStory.mjs'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const pf = <R, A = null>(page: Page, fn: (s: AnyState, arg: A) => R | Promise<R>, arg?: A): Promise<R> =>
  page.evaluate(({ src, arg }) => new Function('s', 'arg', `return (${src})(s, arg)`)((window as unknown as Record<string, AnyState>).__onePreflight, arg), { src: fn.toString(), arg: (arg ?? null) as A }) as Promise<R>
const reading = async (page: Page, id: string) => {
  await pf(page, (p) => p.flush())
  return pf(page, (p, id) => p.readings()[id] ?? null, id) as Promise<{ count: number; ids: string[] } | null>
}
const count = async (page: Page, id: string) => (await reading(page, id))?.count ?? 0

const agent = (over: AnyState) => ({
  icon: null,
  instructions: 'Keep the deals list current.',
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
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...over,
})

/** agent-runs/open answered for the given staged run and failing heads; every request's agent ids noted. */
async function serveOpenRuns(page: Page, asked: string[][], staged: AnyState | null, failing: string[] = []): Promise<void> {
  await page.route('**/api/workspaces/*/agent-runs/open?*', (route: Route) => {
    const ids = (new URL(route.request().url()).searchParams.get('agentIds') ?? '').split(',').filter(Boolean)
    asked.push(ids)
    const runs = staged && ids.includes(staged.agentId) ? [staged] : []
    const now = Date.now()
    const latest = [...(staged && ids.includes(staged.agentId) ? [{ id: staged.id, agentId: staged.agentId, status: 'staged', startedAt: staged.startedAt, endedAt: staged.endedAt }] : []), ...failing.filter((id) => ids.includes(id)).map((id) => ({ id: `run-fail-${id}`, agentId: id, status: 'error', startedAt: now - 120_000, endedAt: now - 100_000 }))]
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ runs, latest }) })
  })
}

/** Pretend the tab is hidden / visible again (the browser's own signal). */
const setHidden = (page: Page, hidden: boolean) =>
  page.evaluate((hidden) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    document.dispatchEvent(new Event('visibilitychange'))
  }, hidden)

test('server proposals and a failing server agent count only for their creator; a hidden tab asks nothing; the gate counts only the member’s own pipeline', async ({ page: a, context }) => {
  test.setTimeout(150_000)
  await signIn(a, email('ada'))
  const wsId = await createWorkspace(a, 'Nordlicht Werk')
  const askedA: string[][] = []
  const now = Date.now()
  await openApp(a, wsId)
  await waitOnline(a)
  const adaId = (await cloudEval(a, (c) => c.user.id)) as string
  const ids = await wsEval(a, (s) => {
    const db = s.createDatabase({ title: 'Nordlicht Übergabe', properties: [{ id: 'nName', name: 'Name', type: 'title' }, { id: 'nStatus', name: 'Status', type: 'text' }] })
    return { db, row: s.createRow(db, { title: 'Exportfilter verliert Sonderzeichen', properties: { nStatus: 'offen' } }) as string }
  })
  const staged = { id: 'run-1', agentId: 'ag-srv', runner: 'server', trigger: { type: 'schedule', detail: 'schedule 07:30' }, startedAt: now - 60_000, endedAt: now - 30_000, status: 'staged', summary: '', steps: [], staged: [{ id: 'c1', n: 1, kind: 'update_row', status: 'pending', pageId: ids.row, databaseId: ids.db, title: 'Exportfilter verliert Sonderzeichen', props: [{ propId: 'nStatus', name: 'Status', type: 'text', before: 'offen', after: 'erledigt', intent: { kind: 'value', value: 'erledigt' } }] }] }
  await serveOpenRuns(a, askedA, staged, ['ag-fail'])

  // the creator: the staged proposal counts, the failing agent lights "Agent missed"
  await wsEval(a, (s, x) => s.upsertAgent(x), agent({ id: 'ag-srv', name: 'Übergabe-Spiegel', createdBy: adaId }))
  await wsEval(a, (s, x) => s.upsertAgent(x), agent({ id: 'ag-fail', name: 'Wochenbericht Nordlicht', createdBy: adaId }))
  await expect.poll(() => count(a, 'proposals'), { timeout: 20_000 }).toBe(1)
  await expect.poll(() => count(a, 'missed'), { timeout: 20_000 }).toBe(1)
  expect(askedA.at(-1)!.sort()).toEqual(['ag-fail', 'ag-srv'])

  // PB11: hidden, a new own server agent asks nothing; visible again, the next change asks at once
  await setHidden(a, true)
  const before = askedA.length
  await wsEval(a, (s, x) => s.upsertAgent(x), agent({ id: 'ag-srv2', name: 'Lieferliste', createdBy: adaId }))
  await a.waitForTimeout(2500)
  expect(askedA.length, 'requests from a hidden tab').toBe(before)
  await setHidden(a, false)
  await wsEval(a, (s, x) => s.upsertAgent(x), agent({ id: 'ag-srv3', name: 'Taktzeit', createdBy: adaId }))
  await expect.poll(() => askedA.length).toBeGreaterThan(before)
  expect(askedA.at(-1)).toEqual(expect.arrayContaining(['ag-srv2', 'ag-srv3']))

  // the creator's own pipeline (private): one task at the gate
  const pipe = (await seedPipeline(a)) as { tasks: string[]; dbId: string }
  await a.evaluate(() => (window.location.hash = '#/'))
  await expect.poll(() => count(a, 'gate'), { timeout: 20_000 }).toBe(2)
  expect(await wsEval(a, (s, id) => !!s.databases[id] && !!s.pages[id]?.private, pipe.dbId)).toBe(true)

  // a teammate: never asks for ada's agents, nothing of them lit, no gate of ada's pipeline
  const b = await newPerson(context)
  await signIn(b, email('bo'))
  await join(a, b, wsId, 'member')
  const askedB: string[][] = []
  await serveOpenRuns(b, askedB, staged, ['ag-fail'])
  await openApp(b, wsId)
  await waitOnline(b)
  await expect.poll(() => wsEval(b, (s) => Object.keys(s.agents).sort())).toEqual(['ag-fail', 'ag-srv', 'ag-srv2', 'ag-srv3'])
  await b.waitForTimeout(2000)
  expect(askedB.flat(), 'agent ids a teammate asked for').toEqual([])
  expect(await count(b, 'proposals')).toBe(0)
  expect(await count(b, 'missed')).toBe(0)
  expect(await count(b, 'mirror')).toBe(0)
  expect(await count(b, 'gate')).toBe(0)
  await b.context().close()
})

test('two accounts in one browser share no acknowledgement, no day record and no Bordbuch', async ({ page: a, context }) => {
  test.setTimeout(120_000)
  const ada = email('ada')
  const bo = email('bo')
  await signIn(a, ada)
  const wsId = await createWorkspace(a, 'Nordlicht Werk')
  const b = await newPerson(context)
  await signIn(b, bo)
  await join(a, b, wsId, 'member')
  await b.context().close()

  const probe = (page: Page) => pf(page, (p) => p.fakeLamps([{ id: 'probe', legend: 'Probe\nlamp', count: 1 }]))
  await openApp(a, wsId, '#/')
  await waitOnline(a)
  await probe(a)
  await expect.poll(() => count(a, 'probe')).toBe(1)
  await pf(a, (p) => p.ack('probe'))
  const adaScope = (await pf(a, (p) => p.state().scope)) as string
  expect(adaScope).toMatch(new RegExp(`^cloud:${wsId}:u:`))
  expect(Object.keys(await pf(a, (p) => p.acks().lamps ?? p.acks()))).toContain('probe')
  await expect.poll(async () => ((await pf(a, (p) => p.log())) as AnyState[]).some((e) => e.k === 'ack' && e.lamp === 'probe')).toBe(true)

  // the same browser, now bo
  await signIn(a, bo)
  await openApp(a, wsId, '#/')
  await waitOnline(a)
  await probe(a)
  await expect.poll(() => count(a, 'probe')).toBe(1)
  const boScope = (await pf(a, (p) => p.state().scope)) as string
  expect(boScope).toMatch(new RegExp(`^cloud:${wsId}:u:`))
  expect(boScope).not.toBe(adaScope)
  // ada's acknowledgement is not bo's: the lamp is new for bo
  expect(Object.keys(await pf(a, (p) => p.acks().lamps ?? p.acks()))).not.toContain('probe')
  await expect.poll(() => pf(a, (p) => p.state().views.find((v: AnyState) => v.id === 'probe')?.isNew ?? null)).toBe(true)
  // nor her Bordbuch or her day record
  expect(((await pf(a, (p) => p.log())) as AnyState[]).some((e) => e.k === 'ack' && e.lamp === 'probe')).toBe(false)
  const keys = await a.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('one.preflight.today:')))
  expect(keys).toEqual(expect.arrayContaining([`one.preflight.today:${adaScope}`, `one.preflight.today:${boScope}`]))
})

/** A Preflight card of the proposals lamp, opened by ↵ on its cap (the card takes the keyboard). */
async function openProposals(page: Page): Promise<void> {
  await page.evaluate(() => (window.location.hash = '#/'))
  const cap = page.locator('.pf-cap[data-lamp="proposals"]')
  await cap.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.pf-q article.pf-card[data-current]')).toBeFocused()
}

test('a server proposal applied in another tab is never applied again here: A reads the run from the server first (review S5)', async ({ page: a }) => {
  test.setTimeout(150_000)
  await signIn(a, email('ada'))
  const wsId = await createWorkspace(a, 'Nordlicht Werk')
  await openApp(a, wsId)
  await waitOnline(a)
  const adaId = (await cloudEval(a, (c) => c.user.id)) as string
  const ids = await wsEval(a, (s) => {
    const db = s.createDatabase({ title: 'Nordlicht Übergabe', properties: [{ id: 'nName', name: 'Name', type: 'title' }, { id: 'nStatus', name: 'Status', type: 'text' }] })
    return { db, row: s.createRow(db, { title: 'Exportfilter verliert Sonderzeichen', properties: { nStatus: 'offen' } }) as string }
  })
  const now = Date.now()
  const change = (status: string, after: string) => ({ id: 'c1', n: 1, kind: 'update_row', status, pageId: ids.row, databaseId: ids.db, title: 'Exportfilter verliert Sonderzeichen', props: [{ propId: 'nStatus', name: 'Status', type: 'text', before: 'offen', after, intent: { kind: 'value', value: after } }] })
  const run = (id: string, at: number, status: string, staged: AnyState[]) => ({ id, agentId: 'ag-srv', runner: 'server', trigger: { type: 'schedule', detail: 'schedule 07:30' }, startedAt: at, endedAt: at + 30_000, status, summary: '', steps: [], staged })
  // what the server holds: run-1 open
  let server: AnyState[] = [run('run-1', now - 120_000, 'staged', [change('pending', 'erledigt')])]
  const resolves: AnyState[] = []
  await a.route('**/api/workspaces/*/agent-runs/open?*', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ runs: server.filter((r) => r.status === 'staged'), latest: [] }) }),
  )
  await a.route('**/api/workspaces/*/agent-runs/*/resolve', async (route: Route) => {
    resolves.push({ url: route.request().url(), body: route.request().postDataJSON() })
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await wsEval(a, (s, x) => s.upsertAgent(x), agent({ id: 'ag-srv', name: 'Übergabe-Spiegel', createdBy: adaId }))
  await expect.poll(() => count(a, 'proposals'), { timeout: 20_000 }).toBe(1)

  // another tab of this browser applies it and tells the server — this tab's copy still says "open"
  server = [run('run-1', now - 120_000, 'ok', [change('applied', 'erledigt')])]
  await openProposals(a)
  const card = a.locator('.pf-q article.pf-card[data-current]')
  await expect(card).toHaveAttribute('data-id', 'run:run-1#c1')
  await expect(card).not.toHaveAttribute('aria-busy', 'true')
  await a.keyboard.press('a')
  await expect(card.locator('.pf-card__tomb')).toBeVisible()
  await a.waitForTimeout(500)
  expect(await wsEval(a, (s, id) => s.pages[id].properties.nStatus, ids.row)).toBe('offen')
  expect(resolves).toEqual([])

  // positive control: a run the server still holds open is applied (and marked there)
  server = [run('run-2', now - 60_000, 'staged', [change('pending', 'in Arbeit')])]
  await wsEval(a, (s, x) => s.upsertAgent(x), agent({ id: 'ag-srv-b', name: 'Lieferliste', createdBy: adaId }))
  await expect.poll(async () => (await reading(a, 'proposals'))?.ids ?? []).toEqual(['run:run-2#c1'])
  await openProposals(a)
  // the tombstone of run-1 stays the current card until the person moves on
  if ((await card.getAttribute('data-id')) !== 'run:run-2#c1') await a.locator('.pf-qr[data-id="run:run-2#c1"]').click()
  await expect(card).toHaveAttribute('data-id', 'run:run-2#c1')
  await expect(card).not.toHaveAttribute('aria-busy', 'true')
  await a.keyboard.press('a')
  await expect.poll(() => wsEval(a, (s, id) => s.pages[id].properties.nStatus, ids.row)).toBe('in Arbeit')
  await expect.poll(() => resolves.length).toBe(1)
  expect(resolves[0].url).toContain('/agent-runs/run-2/resolve')
  expect(resolves[0].body).toMatchObject({ applied: ['c1'] })
})

test('an older server without agent-runs/open: the last runs of each own agent — a skip never hides the error before it (review I2)', async ({ page: a }) => {
  test.setTimeout(120_000)
  await signIn(a, email('ada'))
  const wsId = await createWorkspace(a, 'Nordlicht Werk')
  await openApp(a, wsId)
  await waitOnline(a)
  const adaId = (await cloudEval(a, (c) => c.user.id)) as string
  const now = Date.now()
  const asked: string[] = []
  await a.route('**/api/workspaces/*/agent-runs/open?*', (route: Route) => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'not_found', message: 'Not found' } }) }))
  await a.route(/\/api\/workspaces\/[^/]+\/agent-runs\?agentId=/, (route: Route) => {
    const agentId = new URL(route.request().url()).searchParams.get('agentId') ?? ''
    asked.push(agentId)
    const head = (id: string, status: string, at: number, x: AnyState = {}) => ({ id, agentId, runner: 'server', trigger: { type: 'schedule', detail: 'schedule 07:30' }, startedAt: at, endedAt: at + 20_000, status, summary: '', steps: [], ...x })
    // newest first: the queue was full at 08:05 (a skip), the 08:00 run failed
    const runs = agentId === 'ag-fail' ? [head('run-skip', 'skipped', now - 5 * 60_000), head('run-err', 'error', now - 10 * 60_000)] : []
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(runs) })
  })
  await wsEval(a, (s, x) => s.upsertAgent(x), agent({ id: 'ag-fail', name: 'Wochenbericht Nordlicht', createdBy: adaId }))
  await expect.poll(() => pf(a, (p) => p.stores.serverAgents.getState().openMode), { timeout: 20_000 }).toBe('fallback')
  await expect.poll(() => asked.includes('ag-fail'), { timeout: 20_000 }).toBe(true)
  await expect.poll(() => count(a, 'missed'), { timeout: 20_000 }).toBe(1)
  expect(await pf(a, (p) => p.stores.serverAgents.getState().openLatest.map((h: AnyState) => `${h.id}:${h.status}`))).toEqual(['run-err:error'])
})
