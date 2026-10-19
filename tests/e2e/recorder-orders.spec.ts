/**
 * Flight recorder × work orders (Prüfaufträge, Orders B13 — spec §3.9, §3.11): the chain's writes are eject units of the
 * order writer — `order:<row>:<run>#c<n>` (a step created) · `#a<n>` (a step advanced: Grundlage, branch, Stage in ONE
 * write) · `#s` (a Status the chain wrote); its setup writes carry no part and are no unit.
 *  - the eject takes back what the chain made and nobody touched since: steps the worker never took go to the trash, a
 *    step the worker runs is held (its writes came after); it never writes a field that moves a task; the request's
 *    Status goes back. The chain halts at once — 'ejected' about its first such step ("Schritt 02 ausgeworfen"), Status
 *    Angehalten; S skips a step (the next ejected one halts again); the eject's Undo brings the steps back and drops
 *    the marks — the halt stays (an eject and its Undo never advance a chain), ↵ Fortsetzen goes on;
 *  - an eject never runs a chain on: the agent's text taken back from parked step 02 ends its wait for Confirm, yet no
 *    pass runs — the next one (anything else) goes on;
 *  - only the Status the chain wrote, ejected during step 01's count: the chain halts ('the request's Status was
 *    ejected'), step 01 never starts; while a chain is being created the eject waits ('orderBusy');
 *  - the full backup carries the work orders' config, never this device's records or consent; a restore keeps this
 *    device's records; the local reset erases them (and the consent).
 * Node cases: the units in the eject's change map and their fates, the units parsed per run, the record's marks
 * (withEjected / withoutEjected, a 'member' halt named by the eject), the reader, the engine's halt and S.
 * A fake worker on CODING_E2E_PORT plays the steps; api.anthropic.com is scripted (the planner's answer). Fictional data
 * only (Nordlicht, Tessera, Mara Lind, Wissensbasis).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval, gotoPage, waitForApp } from './fixtures'
import { test as node, expect as nodeExpect } from '@playwright/test'
import { mockClaudeScript, type ClaudeTurn } from './helpers/providers'
import { startFakeWorker, type FakeWorker } from './helpers/fakeWorker'
import { rec, startRecorder } from './helpers/recorder'
import { exportBackup, importBackup } from './helpers/backup'
import { WORKER_CAN, type WorkerInfo } from '../../src/app/features/coding/protocol'
import { changeMap, unitFates } from '../../src/app/features/recorder/eject/sources'
import { orderUnitsByRun, orderUnitsOf } from '../../src/app/features/coding/orders/ejectUnits'
import { canSkip, nextMove, withEjected, withHalt, withoutEjected, withSkip, type ChainTaskFacts, type ChainWorld } from '../../src/app/features/coding/chain'
import { readOrderChain } from '../../src/app/features/coding/orders/record'
import type { OrderChain, OrderChainStep } from '../../src/app/features/coding/orders/types'
import type { EjectRecord, JEvent, PlaceKey } from '../../src/app/features/recorder/model/types'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/* ------------------------------------------------------------------ Node: units, fates, marks */

node.describe('work orders × the eject (Node)', () => {
  const A = 1_000_000
  const B = A + 600_000
  const RUN = 'order:woRow0001:runChain01'
  const ev = (at: number, r: string | undefined, c?: string) => ({ at, r, ...(c ? { c } : {}) }) as unknown as JEvent
  const place = (p: PlaceKey, events: JEvent[]) => [p, { p, ownEvents: events }] as const

  node('units: #c<n> / #a<n> / #s per change of the order run; its setup writes (no part) are no unit; the planner run is its own', () => {
    const data = {
      sel: { lane: 'order:woRow0001', run: RUN, a: A, b: B },
      places: new Map([
        place('p:step1', [ev(A + 10, RUN, 'c1'), ev(A + 200, RUN, 'a1')]),
        place('p:step2', [ev(A + 20, RUN, 'c2')]),
        place('p:step3', [ev(A + 30, RUN, 'c3')]),
        place('p:woRow0001', [ev(A + 40, RUN, 's'), ev(A + 5, 'order:woRow0001:runPlan01', 's')]),
        // the setup writer (projects, the chain's properties, an older chain's parked steps to the trash)
        place('s:projCoding', [ev(A + 2, RUN)]),
        place('p:oldStep', [ev(A + 3, RUN)]),
      ]),
    } as unknown as Parameters<typeof changeMap>[0]
    const plan = { places: [...data.places.keys()].map((p) => ({ p })) } as unknown as Parameters<typeof changeMap>[1]
    const map = changeMap(data, plan)
    nodeExpect(map).toEqual({
      'p:step1': [`${RUN}#a1`, `${RUN}#c1`],
      'p:step2': [`${RUN}#c2`],
      'p:step3': [`${RUN}#c3`],
      'p:woRow0001': [`${RUN}#s`, `order:woRow0001:runPlan01#s`],
    })
    // step 01 held (the worker wrote it since), 02 / 03 to the trash, the Status back
    const outcomes = { 'p:step1': 'held', 'p:step2': 'trash', 'p:step3': 'trash', 'p:woRow0001': 'back' } as Record<PlaceKey, EjectRecord['outcomes'][PlaceKey]>
    const f = unitFates({ ...map }, outcomes, (p) => (p === 'p:step1' ? { lane: 'coding', at: A + 300 } : undefined))
    nodeExpect(f.ejected).toEqual([`${RUN}#c2`, `${RUN}#c3`, `${RUN}#s`, `order:woRow0001:runPlan01#s`])
    nodeExpect(f.held).toEqual([
      { unit: `${RUN}#a1`, by: 'coding', at: A + 300 },
      { unit: `${RUN}#c1`, by: 'coding', at: A + 300 },
    ])
    // per run: the steps whose creation or advance went back, whether a Status did
    nodeExpect(orderUnitsByRun(f.ejected)).toEqual([
      { row: 'woRow0001', run: 'runChain01', steps: [2, 3], status: true },
      { row: 'woRow0001', run: 'runPlan01', steps: [], status: true },
    ])
    // held units are no business of the chain's (it learns only what went back)
    nodeExpect(orderUnitsByRun(f.held.map((h) => h.unit))).toEqual([{ row: 'woRow0001', run: 'runChain01', steps: [1], status: false }])
    nodeExpect(orderUnitsOf(RUN, ['c2', 'a2', 'c10', 's', 'x1', 'c0', 'c1000'])).toEqual({ row: 'woRow0001', run: 'runChain01', steps: [2, 10], status: true })
    nodeExpect(orderUnitsOf('agent:a1:r1', ['c1'])).toBeNull()
    nodeExpect(orderUnitsOf('order:woRow0001:run:extra', ['c1'])).toBeNull()
    nodeExpect(orderUnitsOf('order:../x:run', ['c1'])).toBeNull()
  })

  const step = (n: number, kind: OrderChainStep['kind'] = 'coding'): OrderChainStep => ({ n, id: `task${n}`, kind, project: `proj${n}`, line: 'L', approvals: 'none', refs: {}, basisBlock: n > 1 ? `task${n}-wait` : null })
  const chain3 = (over: Partial<OrderChain> = {}): OrderChain => ({ run: 'runChain01', confirmedAt: 1000, startAt: 1000, steps: [step(1, 'spec'), step(2), step(3, 'qa')], doneBy: {}, halted: null, checkpoint: false, advanced: { 1: 2000 }, moved: { 1: 2001 }, ...over })
  const facts = (o: Partial<ChainTaskFacts> = {}): ChainTaskFacts => ({ exists: true, trashed: false, stage: 'parkS', stageKind: 'queue', parkStage: 'parkS', startStage: 'startS', startsAtOnce: false, state: 'idle', line: 'L', approvals: 'none', endsConfirm: false, trusted: true, repo: 'website', branch: null, spentUsd: 0, ...o })
  const world = (chain: OrderChain, tasks: Record<string, ChainTaskFacts>): ChainWorld => ({ now: 10 * 60_000, record: { v: 1, state: chain.halted ? 'halted' : 'running', chain }, request: { live: true, status: 'running', usable: true }, tasks, refs: {} })

  node('the record: withEjected marks each step of the chain once (a "member" halt about one of them names the eject); withoutEjected drops only that eject’s marks — the halt stays; the reader keeps them', () => {
    const c = chain3()
    const marked = withEjected(c, [2, 3, 9], 'ejA')
    nodeExpect(marked.ejected).toEqual({ 2: 'ejA', 3: 'ejA' })
    nodeExpect(withEjected(marked, [2, 3], 'ejA')).toBe(marked)
    // a pass that came first recorded the trashed step as 'member': the eject's settle names it
    const memberHalt = withHalt(c, { why: 'member', by: 'order', step: 2 }, 5000)
    nodeExpect(withEjected(memberHalt, [2], 'ejA').halted).toEqual({ at: 5000, why: 'ejected', by: 'order', step: 2 })
    // any other halt stays as it was (sticky)
    const budget = withHalt(c, { why: 'budget', by: 'order', step: 2 }, 5000)
    nodeExpect(withEjected(budget, [2], 'ejA').halted).toEqual(budget.halted)
    // two ejects: the Undo of one drops its own marks only; the halt stays
    const two = withEjected(withHalt(marked, { why: 'ejected', by: 'eject:ejA', step: 2 }, 6000), [3], 'ejB')
    nodeExpect(two.ejected).toEqual({ 2: 'ejA', 3: 'ejB' })
    const undone = withoutEjected(two, [2, 3], 'ejA')
    nodeExpect(undone.ejected).toEqual({ 3: 'ejB' })
    nodeExpect(undone.halted).toMatchObject({ why: 'ejected', step: 2 })
    nodeExpect(withoutEjected(withoutEjected(undone, [3], 'ejB'), [3], 'ejB').ejected).toBeUndefined()
    nodeExpect(withoutEjected(c, [2], 'ejA')).toBe(c)
    // the reader: steps of the chain only, ids only
    const read = readOrderChain({ ...JSON.parse(JSON.stringify(two)), ejected: { 2: 'ejA', 3: 'ejB', 7: 'ejC', x: 'ejD', 1: 'bad id!' } })
    nodeExpect(read?.ejected).toEqual({ 2: 'ejA', 3: 'ejB' })
    nodeExpect(readOrderChain({ ...JSON.parse(JSON.stringify(c)), ejected: 'junk' })?.ejected).toBeUndefined()
  })

  node('the engine: an ejected step halts the chain ("ejected", that step) before anything else of the steps; S skips it — the next ejected one halts again; a skipped one never', () => {
    const c = chain3()
    const tasks = { task1: facts({ stage: 'gateS', stageKind: 'gate' }), task2: facts({ trashed: true, ejected: true }), task3: facts({ trashed: true, ejected: true }) }
    nodeExpect(nextMove(world(c, tasks))).toEqual({ kind: 'halt', why: 'ejected', step: 2 })
    const halted = withHalt(c, { why: 'ejected', by: 'eject:ejA', step: 2 }, 7000)
    nodeExpect(canSkip(world(halted, tasks), 2)).toBe(true)
    const skipped = withSkip(halted, 2)
    nodeExpect(skipped.halted).toBeNull()
    nodeExpect(nextMove(world(skipped, tasks))).toEqual({ kind: 'halt', why: 'ejected', step: 3 })
    const both = withSkip(withSkip(c, 2), 3)
    nodeExpect(nextMove(world(both, tasks))).toEqual({ kind: 'wait', why: 'gate', step: 1 })
  })
})

/* ------------------------------------------------------------------ the app */

/** CODING_E2E_PORT: one port for the coding suites when they run side by side (one worker at a time) */
const PORT = Number(process.env.CODING_E2E_PORT) || 47484 + 10 * Number(process.env.TEST_PARALLEL_INDEX ?? 0)

const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/ai/anthropic/orders-plan-kb.json', import.meta.url)), 'utf8')) as AnyState
const CASE = 'pgcase000001'
const OTHER = 'pgother00001'
const ST = { draft: 'woDraft01', plan: 'woPlan001', ready: 'woReady01', running: 'woRun0001', halted: 'woHalt001', done: 'woDone001' }
const statusOptions = [
  { id: ST.draft, name: 'Draft', color: 'gray' },
  { id: ST.plan, name: 'Plan', color: 'blue' },
  { id: ST.ready, name: 'Chain ready', color: 'yellow' },
  { id: ST.running, name: 'Running', color: 'orange' },
  { id: ST.halted, name: 'Halted', color: 'red' },
  { id: ST.done, name: 'Done', color: 'green' },
]
const WELCOME: WorkerInfo = { worker: '1.11.0', name: 'website-box', repos: [{ name: 'website', baseBranch: 'main', branches: ['main'], mcp: [] }], parallel: 1, busy: [], spentToday: 0, dayLimit: null, claude: { found: true, version: '2.0.0' }, setup: true, mcp: [] }
const REQUEST = 'Prüfe, warum der Login von Nordlicht nach 30 Sekunden abbricht. Siehe '

type Entries = { __oneOrderEntries: { setStatusAs: (row: string, key: string, w: AnyState) => boolean } }
type Seam = { __oneOrders: Record<string, (...a: any[]) => Promise<any>>; __onePreflight: { stores: { coding: { getState: () => AnyState } } }; __oneCodingWrites: Record<string, (...a: any[]) => any> } // eslint-disable-line @typescript-eslint/no-explicit-any
const call0 = (page: Page, name: string, ...args: unknown[]) => page.evaluate(([n, a]) => (window as unknown as Seam).__oneOrders[n as string]!(...(a as unknown[])), [name, args] as const)
const orders = (page: Page) => ({
  plan: (row: string) => call0(page, 'plan', row, { mode: 'manual', replace: true }) as Promise<AnyState>,
  record: (row: string) => call0(page, 'record', row) as Promise<AnyState>,
  start: (row: string) => call0(page, 'start', row) as Promise<AnyState>,
  startNow: (row: string) => call0(page, 'startNow', row) as Promise<AnyState>,
  runChain: (row: string) => call0(page, 'runChain', row) as Promise<AnyState>,
  move: (row: string) => call0(page, 'move', row) as Promise<AnyState | null>,
  advance: (row: string, step: number, passes: string[]) => call0(page, 'advance', row, step, passes) as Promise<AnyState>,
  resume: (row: string) => call0(page, 'resume', row) as Promise<AnyState>,
  skip: (row: string, n: number) => call0(page, 'skip', row, n) as Promise<AnyState>,
  agentAppend: (task: string, text: string) => call0(page, 'agentAppend', task, text) as Promise<boolean>,
  fault: (f: { at: number; mode: 'throw' | 'hold' } | null) => call0(page, 'fault', f) as Promise<void>,
  putRecord: (row: string, r: unknown) => call0(page, 'putRecord', row, r) as Promise<AnyState>,
  setAuto: (db: string, v: { sig: string; at: number } | null) => call0(page, 'setAuto', db, v) as Promise<void>,
})
const connected = (page: Page) => expect.poll(() => page.evaluate(() => (window as unknown as Seam).__onePreflight.stores.coding.getState().conn), { timeout: 30_000 }).toBe('connected')
const fill = (plan: AnyState) => JSON.parse(JSON.stringify(plan).split('{{case}}').join(CASE).split('{{other}}').join(OTHER)) as AnyState
const answer = (): ClaudeTurn => ({ blocks: [{ type: 'text', text: JSON.stringify({ ...fill(FIXTURE.plan), context: null }) }], usage: { input: 3200, output: 900 } })

/** The work-orders database with one request (Status Planen), its config; `coding`: Coding on with the fake worker's port. */
async function seedOrders(page: Page, o: { approvals?: 'all' | 'review' | 'none'; coding?: boolean; budget?: number } = {}) {
  if (o.coding !== false)
    await page.addInitScript(
      ([port, approvals]) => {
        localStorage.setItem('one.coding', JSON.stringify({ enabled: true, port }))
        if (approvals) localStorage.setItem('one.coding.approvals', approvals)
      },
      [PORT, o.approvals ?? null] as const,
    )
  await openApp(page)
  await startRecorder(page)
  await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', mcpServers: [] }))
  const ids = await wsEval(
    page,
    (s, a) => {
      const p = (id: string, name: string, type: string, extra: AnyState = {}) => ({ id, name, type, ...extra })
      s.createPage({ id: a.CASE, title: 'Supportfall 4711', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Kunde Tessera meldet: der Login bricht nach 30 Sekunden ab. Gemeldet von Mara Lind.' }] }] } })
      s.createPage({ id: a.OTHER, title: 'Tessera intern', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Interne Notizen.' }] }] } })
      const db = s.createDatabase({
        title: 'Work orders',
        properties: [p('woName', 'Name', 'title'), p('woStatus', 'Status', 'select', { options: a.statusOptions }), p('woRepo', 'Repo', 'select', { options: [{ id: 'rWeb', name: 'website', color: 'gray' }] }), p('woId', 'ID', 'unique_id', { idPrefix: 'PA' })],
      })
      s.updateDatabase(db, { system: 'workorders', orders: { v: 1, status: a.ST, server: null, kinds: ['spec', 'coding', 'qa'], checkpoint: true, ...(a.budget ? { budgetUsd: a.budget } : {}) } })
      const body = [{ type: 'paragraph', content: [{ type: 'text', text: a.REQUEST }, { type: 'mention', attrs: { id: a.CASE, label: 'Supportfall 4711', kind: 'page' } }, { type: 'text', text: '. Repo website.' }] }]
      const row = s.createRow(db, { title: 'Login-Timeout prüfen', properties: { woStatus: a.ST.plan, woRepo: 'rWeb' }, content: { type: 'doc', content: body } })
      return { db, row }
    },
    { CASE, OTHER, ST, statusOptions, REQUEST, budget: o.budget ?? null },
  )
  if (o.coding === false) return ids
  for (const kind of ['spec', 'coding', 'qa']) {
    const seed = await page.evaluate((k) => (window as unknown as Seam).__oneCodingWrites.create('seed', k), kind)
    await wsEval(page, (s, id) => s.deletePagePermanently(id), seed as string)
  }
  await connected(page)
  return ids
}

const statusOf = (page: Page, row: string) => wsEval(page, (s, id) => s.pages[id].properties.woStatus as string, row)
const stageOf = (page: Page, id: string) =>
  wsEval(
    page,
    (s, id) => {
      const row = s.pages[id]
      const db = s.databases[row.databaseId]
      const stage = db.properties.find((p: AnyState) => p.name === 'Stage')
      return (stage.options.find((o: AnyState) => o.id === row.properties[stage.id])?.name ?? null) as string | null
    },
    id,
  )
const trashed = (page: Page, id: string) => wsEval(page, (s, x) => !!s.pages[x]?.trashed, id)
/** What the fake worker answers per stage kind. */
function plays(fake: FakeWorker) {
  fake.auto = (task) => {
    const kind = task.stage.kind as string
    if (kind === 'doc' || kind === 'analyze') return { status: 'ok', plan: `## ${task.stage.name}\n\nErgebnis: der Gateway beendet die Sitzung nach 30 s (Nordlicht).` }
    if (kind === 'plan') return { status: 'ok', plan: 'Plan: Session-Timeout im Gateway auf 5 Minuten setzen.' }
    if (kind === 'implement') return { status: 'ok', summary: 'Timeout geändert.', branch: 'one/login-timeout' }
    if (kind === 'test') return { status: 'ok', test: { ok: true, output: 'ok', ms: 12, code: 0 } }
    return { status: 'ok' }
  }
}
const handed = (fake: FakeWorker) => fake.handed().map((t) => t.id as string)

/** Plan with the scripted answer and start the chain (its count running): the steps' ids and the chain's run key. */
async function confirmed(page: Page, row: string): Promise<{ ids: string[]; runKey: string }> {
  expect(await orders(page).plan(row)).toMatchObject({ kind: 'ready', steps: 3 })
  const out = await orders(page).start(row)
  expect(out, JSON.stringify(out)).toMatchObject({ ok: true })
  const run = (await orders(page).record(row)).chain.run as string
  return { ids: out.steps as string[], runKey: `order:${row}:${run}` }
}

/** The order run's span on the tape (the journal settled first). */
async function runWindow(page: Page, row: string, runKey: string) {
  await rec(page, 'settle')
  const runs = await rec<Array<{ key: string; from: number; to: number }>>(page, 'runs')
  const r = runs.find((x) => x.key === runKey)
  expect(r, `run ${runKey}`).toBeTruthy()
  return { lane: `order:${row}`, run: runKey, a: r!.from - 1000, b: Date.now() + 1000 }
}

test.describe('work orders × the eject (fake worker)', () => {
  test.describe.configure({ mode: 'serial' })
  let fake: FakeWorker | null = null
  test.beforeEach(async ({ errors }) => {
    errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
    fake = await startFakeWorker(PORT, WELCOME)
    fake.can = [...WORKER_CAN]
  })
  test.afterEach(async () => {
    await fake?.close()
    fake = null
  })

  test('the chain’s run ejected: steps the worker never took go to the trash, the one it ran is held; the chain halts at the first (ejected); S skips it, the next halts; the Undo brings them back — the halt stays, nothing starts; ↵ Fortsetzen goes on', async ({ page, aiNet }) => {
    test.setTimeout(240_000)
    await mockClaudeScript(page.context(), [], { fallback: answer() })
    const { row } = await seedOrders(page, { approvals: 'all' })
    plays(fake!)
    const { ids, runKey } = await confirmed(page, row)
    await orders(page).startNow(row)
    // step 01 (analysis) runs on the worker and waits at its gate; 02 / 03 stay parked
    await expect.poll(() => stageOf(page, ids[0]!), { timeout: 60_000 }).toBe('Approve spec')
    expect(await stageOf(page, ids[1]!)).toBe('Backlog')
    expect(await statusOf(page, row)).toBe(ST.running)

    // the plan: step 01 held (the worker's writes came after the chain's), 02 / 03 to the trash, the Status back
    const sel = await runWindow(page, row, runKey)
    const plan = await rec<{ places: Array<{ p: string; outcome: string; reason: string | null; changes: string[] }> }>(page, 'planEject', sel)
    const at = (id: string) => plan.places.find((x) => x.p === `p:${id}`)
    expect(at(ids[0]!)).toMatchObject({ outcome: 'held' })
    expect(at(ids[1]!)).toMatchObject({ outcome: 'trash', changes: ['c2'] })
    expect(at(ids[2]!)).toMatchObject({ outcome: 'trash', changes: ['c3'] })
    expect(at(row)).toMatchObject({ outcome: 'back', changes: ['s'] })
    // the dialog's line: two steps go, one chain halts
    expect(await rec(page, 'ejectFacts', sel)).toMatchObject({ orders: { steps: 2, chains: 1 } })

    // an eject sends nothing (the planner's one request is all that went out)
    const sent = aiNet.count('anthropic')
    const out = await rec<{ id: string; state: string; changes: Record<string, string[]>; outcomes: Record<string, string> }>(page, 'eject', sel)
    expect(out.state).toBe('done')
    expect(out.changes[`p:${ids[1]}`]).toEqual([`${runKey}#c2`])
    expect(await trashed(page, ids[1]!)).toBe(true)
    expect(await trashed(page, ids[2]!)).toBe(true)
    expect(await trashed(page, ids[0]!)).toBe(false)
    // never a field that moves a task: step 01 stays at its gate
    expect(await stageOf(page, ids[0]!)).toBe('Approve spec')
    // the chain: the marks, the halt about step 02 (by the eject), the Status Angehalten (the chain's own #s)
    await expect.poll(async () => (await orders(page).record(row)).state, { timeout: 10_000 }).toBe('halted')
    const r1 = await orders(page).record(row)
    expect(r1.chain.ejected).toEqual({ 2: out.id, 3: out.id })
    expect(r1.chain.halted).toMatchObject({ why: 'ejected', step: 2, by: `eject:${out.id}` })
    await expect.poll(() => statusOf(page, row)).toBe(ST.halted)
    await expect.poll(async () => (await orders(page).move(row))?.why).toBe('halted')

    // the plate (German): the halt line and the lane words
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await gotoPage(page, row)
    const plate = page.getByTestId('order-plate')
    await expect(plate).toContainText('Kette angehalten: Schritt 02 ausgeworfen')
    await expect(plate.locator(`[data-testid="order-chain-row"][data-step="${ids[1]}"]`)).toHaveAttribute('data-lane', 'ejected')
    await expect(plate.locator(`[data-testid="order-chain-row"][data-step="${ids[1]}"]`)).toContainText('ausgeworfen')

    // S on step 02: it leaves the chain — step 03, ejected too, halts it again
    expect(await orders(page).skip(row, 2)).toMatchObject({ ok: true })
    await expect.poll(async () => (await orders(page).record(row)).chain.halted?.step, { timeout: 10_000 }).toBe(3)
    expect((await orders(page).record(row)).chain.halted.why).toBe('ejected')

    // the eject's Undo: both steps back, the marks gone — the halt stays, nothing starts
    expect(await rec(page, 'undoEject', out.id)).toMatchObject({ ok: true })
    expect(await trashed(page, ids[1]!)).toBe(false)
    expect(await trashed(page, ids[2]!)).toBe(false)
    await expect.poll(async () => (await orders(page).record(row)).chain.ejected ?? null).toBeNull()
    const r2 = await orders(page).record(row)
    expect(r2.state).toBe('halted')
    expect(r2.chain.halted).toMatchObject({ why: 'ejected', step: 3 })
    await page.waitForTimeout(2500)
    expect(await stageOf(page, ids[2]!)).toBe('Backlog')
    expect(handed(fake!).filter((id) => id !== ids[0])).toEqual([])
    // ↵ Fortsetzen: the chain goes on (step 01 still waits at its gate; step 02 stays skipped)
    expect(await orders(page).resume(row)).toMatchObject({ ok: true })
    expect((await orders(page).record(row)).state).toBe('running')
    await expect.poll(async () => (await orders(page).move(row))?.why).toBe('gate')
    expect((await orders(page).record(row)).chain.skipped).toEqual([2])
    expect(aiNet.count('anthropic')).toBe(sent)
    expect(await rec(page, 'unknowns')).toEqual([])
  })

  test('an eject never runs a chain on: the agent’s text taken back from parked step 02 ends its wait for Confirm, yet no pass moves it — the next pass does', async ({ page }) => {
    test.setTimeout(240_000)
    await mockClaudeScript(page.context(), [], { fallback: answer() })
    const { row } = await seedOrders(page, { approvals: 'none' })
    plays(fake!)
    const { ids } = await confirmed(page, row)
    await orders(page).startNow(row)
    expect(await orders(page).agentAppend(ids[1]!, 'Bitte zusätzlich den Server neu starten.')).toBe(true)
    await expect.poll(() => stageOf(page, ids[0]!), { timeout: 60_000 }).toBe('Done')
    await expect.poll(async () => (await orders(page).move(row))?.kind, { timeout: 15_000 }).toBe('card')
    // ↵ Weiter passes the analysis card — the Confirm wait stays
    expect(await orders(page).advance(row, 2, ['checkpoint'])).toMatchObject({ ok: true, move: { kind: 'card', why: 'confirm' } })
    // the passes that press set off (its record write) are over before the eject
    await page.waitForTimeout(1500)

    // the agent's write taken back: step 02 is the version confirmed at ↵ again
    await rec(page, 'settle')
    const runs = await rec<Array<{ key: string; from: number; to: number }>>(page, 'runs')
    const agentRun = runs.find((r) => r.key === 'agent:agentE2e01:e2e')!
    expect(agentRun).toBeTruthy()
    await rec(page, 'spy', true)
    const out = await rec<{ id: string; state: string; outcomes: Record<string, string> }>(page, 'eject', { lane: 'agent:agentE2e01', run: agentRun.key, a: agentRun.from - 1000, b: agentRun.to + 1000 })
    expect(out.state).toBe('done')
    expect(out.outcomes[`p:${ids[1]}`]).toBe('back')
    const p2 = await wsEval(page, (s, id) => s.pages[id] as AnyState, ids[1]!)
    expect(JSON.stringify(p2.content)).not.toContain('Server neu starten')
    // no pass ran: no store write after the eject's own, step 02 stays parked, the worker never gets it, the card stands
    await page.waitForTimeout(3000)
    expect((await rec<Array<{ kind: string | null }>>(page, 'spy', false)).map((u) => u.kind)).toEqual(['eject'])
    expect(await stageOf(page, ids[1]!)).toBe('Backlog')
    expect((await orders(page).record(row)).chain.advanced['2']).toBeUndefined()
    expect(handed(fake!).includes(ids[1]!)).toBe(false)
    expect(await orders(page).move(row)).toMatchObject({ kind: 'card', why: 'confirm' })
    // the next pass (any later write, a key) finds nothing left to ask and goes on
    expect(await orders(page).runChain(row)).toMatchObject({ kind: 'advance', step: 2 })
    await expect.poll(() => handed(fake!).includes(ids[1]!), { timeout: 20_000 }).toBe(true)
    expect(await rec(page, 'unknowns')).toEqual([])
  })

  test('only the Status the chain wrote, ejected during the count: the chain halts (its Status was ejected), step 01 never starts; while a chain is being created the eject waits', async ({ page }) => {
    test.setTimeout(240_000)
    await mockClaudeScript(page.context(), [], { fallback: answer() })
    const { row } = await seedOrders(page, { approvals: 'none' })
    plays(fake!)
    const { ids, runKey } = await confirmed(page, row)
    expect(await statusOf(page, row)).toBe(ST.running)
    // the window: the moment the chain wrote Läuft (its creations came before)
    await rec(page, 'settle')
    const events = await rec<Array<{ at: number; r?: string; c?: string; p: string }>>(page, 'events')
    const sAt = events.find((e) => e.p === `p:${row}` && e.r === runKey && e.c === 's')!.at
    expect(events.filter((e) => e.r === runKey && e.c?.startsWith('c')).every((e) => e.at < sAt)).toBe(true)
    const out = await rec<{ id: string; state: string; outcomes: Record<string, string> }>(page, 'eject', { lane: `order:${row}`, run: runKey, a: sAt, b: sAt + 1 })
    expect(out.state).toBe('done')
    expect(Object.keys(out.outcomes)).toEqual([`p:${row}`])
    await expect.poll(async () => (await orders(page).record(row)).chain.halted?.why ?? null, { timeout: 10_000 }).toBe('ejectedStatus')
    await expect.poll(() => statusOf(page, row)).toBe(ST.halted)
    // the count runs out: step 01 never starts
    const startAt = (await orders(page).record(row)).chain.startAt as number
    await page.waitForTimeout(Math.max(0, startAt - Date.now()) + 2500)
    expect(await stageOf(page, ids[0]!)).toBe('Backlog')
    expect(handed(fake!)).toEqual([])
    expect((await orders(page).record(row)).chain.advanced).toBeUndefined()

    // a follow-up chain being created (held mid-way): the eject of its run waits
    await page.evaluate((r) => (window as unknown as Entries).__oneOrderEntries.setStatusAs(r, 'plan', { kind: 'system', why: 'maintenance' }), row)
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'ready' })
    await orders(page).fault({ at: 2, mode: 'hold' })
    const pending = orders(page).start(row).catch(() => null)
    await expect.poll(async () => (await orders(page).record(row)).state, { timeout: 15_000 }).toBe('creating')
    const creating = `order:${row}:${(await orders(page).record(row)).chain.run}`
    expect(creating).not.toBe(runKey)
    await rec(page, 'settle')
    const runs = await rec<Array<{ key: string; from: number }>>(page, 'runs')
    const from = runs.find((r) => r.key === creating)?.from ?? Date.now() - 5000
    expect(await rec(page, 'planEject', { lane: `order:${row}`, run: creating, a: from - 1000, b: Date.now() + 1000 })).toEqual({ refused: { key: 'orderBusy' } })
    void pending
  })
})

/* ------------------------------------------------------------------ backup, reset */

/** The keys of IndexedDB "one-coding" (the coding pipeline's device state, the work orders' records). */
const codingKeys = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const open = indexedDB.open('one-coding')
        open.onerror = () => resolve([])
        open.onsuccess = () => {
          const db = open.result
          if (!db.objectStoreNames.contains('kv')) {
            db.close()
            return resolve([])
          }
          const q = db.transaction('kv').objectStore('kv').getAllKeys()
          q.onsuccess = () => {
            db.close()
            resolve(q.result.map(String))
          }
          q.onerror = () => resolve([])
        }
      }),
  )

test('the full backup carries the work orders’ config, never this device’s records or consent; a restore keeps this device’s records; the local reset erases them', async ({ page, errors }, testInfo) => {
  test.setTimeout(180_000)
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  const { db, row } = await seedOrders(page, { coding: false, budget: 5 })
  const now = Date.now()
  // this device's record of the request: a plan (its words) and a chain's run — the canaries
  const canary = 'Kanarie Nordlicht 4711'
  await orders(page).putRecord(row, {
    v: 1,
    state: 'draft',
    pressed: now,
    draft: { plan: { v: 1, summary: canary, context: null, steps: [], questions: ['Welche Sitzungsdauer?'], refused: null }, hash: 'hKanarie0001', run: 'runKanarie01', at: now },
  })
  await orders(page).setAuto(db, { sig: 'f'.repeat(64), at: now })
  expect((await orders(page).record(row)).draft.run).toBe('runKanarie01')
  expect((await codingKeys(page)).filter((k) => k.includes('|order|'))).toEqual([`local:local|order|${row}`])

  const { json, file } = await exportBackup(page, testInfo, 'full.json')
  const text = JSON.stringify(json)
  // the config: the Status options by id, the budget — the work orders' settings come back with a restore
  expect((json.workspace.databases as AnyState)[db].orders).toMatchObject({ v: 1, status: ST, kinds: ['spec', 'coding', 'qa'], checkpoint: true, budgetUsd: 5 })
  // never the record (its plan, its run, its key) nor the consent
  for (const mark of [canary, 'runKanarie01', 'hKanarie0001', '|order|', 'one-coding', 'one.orders.auto', 'f'.repeat(64)]) expect(text, mark).not.toContain(mark)

  // a restore (replace): the config as the file had it; this device's record stays this device's
  await wsEval(page, (s, a) => s.updateDatabase(a.db, { orders: { ...s.databases[a.db].orders, budgetUsd: 9 } }), { db })
  await importBackup(page, file, 'replace')
  expect(await wsEval(page, (s, id) => s.databases[id].orders.budgetUsd as number, db)).toBe(5)
  expect((await orders(page).record(row)).draft.run).toBe('runKanarie01')
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('one.orders.auto:')))).toEqual([])

  // the local reset (Workspace settings → Danger zone): the records go with it, the consent too
  await orders(page).setAuto(db, { sig: 'e'.repeat(64), at: now })
  await page.evaluate(() => (window.location.hash = '#/workspace/danger'))
  const section = page.getByTestId('workspace-page')
  await expect(section).toHaveAttribute('data-section', 'danger')
  await section.getByRole('button', { name: 'Reset workspace' }).click()
  const confirm = page.getByRole('dialog').filter({ hasText: 'Reset the entire workspace?' })
  await expect(confirm).toBeVisible()
  await Promise.all([page.waitForEvent('load'), confirm.getByRole('button', { name: 'Erase & restart' }).click()])
  await waitForApp(page)
  expect(await page.evaluate(() => localStorage.getItem('one.resetPending'))).toBeNull()
  expect((await codingKeys(page)).filter((k) => k.includes('|order|'))).toEqual([])
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('one.orders.auto:')))).toEqual([])
})
