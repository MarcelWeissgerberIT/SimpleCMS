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
