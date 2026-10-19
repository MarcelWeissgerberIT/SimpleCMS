/**
 * Work orders (Prüfaufträge) B6 — confirming a plan (spec §2.9): a fake worker on CODING_E2E_PORT, api.anthropic.com
 * scripted (the planner's answer; the server "Wissensbasis" is fictional and never contacted — Anthropic would call it,
 * the script plays its blocks). Fictional data only (Nordlicht, Tessera, Mara Lind, Wissensbasis).
 *  - startChain: every step created PARKED in its project's first stage under `order:<row>:<run>#c<n>`, its page = the
 *    slot (steps ≥ 2), the request quote (plain text — no mention node), the server's context (step 01 only), goal,
 *    criteria, the pages that go along; every block with its id (opening the page writes nothing); the Prüfauftrag /
 *    Schritt roles; trusted here; the record 'running', Status Läuft; step 01 starts after the 10 s count (↵ jetzt: now)
 *    and only then reaches the worker;
 *  - a throw at step 3 of 5 leaves nothing (every step made in the trash, the plan stands); a double ↵ makes one chain;
 *  - a reload mid-create completes it; a step touched meanwhile → interrupted ("Angelegte verwerfen" / "Rest anlegen");
 *  - Undo (Z) before step 01 was taken trashes all and puts the plan back; after it was taken it is refused;
 *  - a follow-up chain counts on (4, 5, 6) and trashes the older chain's parked steps — its Undo brings them back;
 *  - parked steps never reach the worker (moved into an automatic stage by hand: held; the chain then halts "out of
 *    order"); a project that starts new tasks at once is refused before anything is created;
 *  - the plate: the plan's steps in Kette bereit, ↵ Kette starten (VON HAND — ready a moment after the plan was seen in full), the count
 *    with ↵ jetzt and Z (focus in the plate), the Laufleiste's state words, an interrupted creation's keys.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval, flush, gotoPage, waitForApp } from './fixtures'
import { mockClaudeScript, type ClaudeTurn } from './helpers/providers'
import { startFakeWorker, type FakeWorker } from './helpers/fakeWorker'
import { readPlan } from './helpers/orders'
import { test as node, expect as nodeExpect } from '@playwright/test'
import { WORKER_CAN, type WorkerInfo } from '../../src/app/features/coding/protocol'
import { stepPage, requestPlain } from '../../src/app/features/coding/orders/stepPage'
import { stepWords } from '../../src/app/features/coding/orders/words'
import { readOrderChain } from '../../src/app/features/coding/orders/record'
import { messages as codingMessages } from '../../src/app/features/coding/messages'
import type { Translate } from '../../src/shared/i18n'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** CODING_E2E_PORT: one port for the coding suites when they run side by side (one worker at a time) */
const PORT = Number(process.env.CODING_E2E_PORT) || 47484 + 10 * Number(process.env.TEST_PARALLEL_INDEX ?? 0)
test.describe.configure({ mode: 'serial' })

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
const KB = { id: 'srvkb000001', name: 'wissensbasis', url: 'https://kb.example.test/mcp', token: 'kb-e2e-PLAINTEXT-token-0001', enabled: true, prompt: '**Wissensbasis** holds the support records.', promptSource: 'auto', tools: ['kb_search', 'kb_get'], checkedAt: 1 }
const WELCOME: WorkerInfo = { worker: '1.11.0', name: 'website-box', repos: [{ name: 'website', baseBranch: 'main', branches: ['main', 'one/nordlicht-footer', 'feature/login'], mcp: [] }], parallel: 1, busy: [], spentToday: 0, dayLimit: null, claude: { found: true, version: '2.0.0' }, setup: true, mcp: [] }
const REQUEST = 'Prüfe, warum der Login von Nordlicht nach 30 Sekunden abbricht. Siehe '

type Seam = { __oneOrders: Record<string, (...a: any[]) => Promise<any>>; __onePreflight: { stores: { coding: { getState: () => AnyState } } }; __oneCodingWrites: Record<string, (...a: any[]) => any> } // eslint-disable-line @typescript-eslint/no-explicit-any
const call = (page: Page, name: string, ...args: unknown[]) => page.evaluate(([n, a]) => (window as unknown as Seam).__oneOrders[n as string]!(...(a as unknown[])), [name, args] as const)
const orders = (page: Page) => ({
  plan: (row: string) => call(page, 'plan', row, { mode: 'manual', replace: true }) as Promise<AnyState>,
  record: (row: string) => call(page, 'record', row) as Promise<AnyState>,
  start: (row: string, hash?: string) => call(page, 'start', row, ...(hash ? [hash] : [])) as Promise<AnyState>,
  undo: (row: string) => call(page, 'undo', row) as Promise<AnyState>,
  startNow: (row: string) => call(page, 'startNow', row) as Promise<AnyState>,
  world: (row: string) => call(page, 'world', row) as Promise<AnyState>,
  fault: (f: AnyState | null) => call(page, 'fault', f),
  finishRest: (row: string) => call(page, 'finishRest', row) as Promise<AnyState>,
  discardMade: (row: string) => call(page, 'discardMade', row) as Promise<AnyState>,
  parked: (id: string) => call(page, 'parked', id) as Promise<boolean>,
  runChain: (row: string) => call(page, 'runChain', row) as Promise<AnyState>,
})
type Entries = { __oneOrderEntries: { setStatusAs: (row: string, key: string, w: AnyState) => boolean } }
/** The Status written by nobody's hand (upkeep): never a press — the planner is called on its own after it. */
const statusBy = (page: Page, row: string, key: string) => page.evaluate(([r, k]) => (window as unknown as Entries).__oneOrderEntries.setStatusAs(r, k, { kind: 'system', why: 'maintenance' }), [row, key] as const)
const connected = (page: Page) => expect.poll(() => page.evaluate(() => (window as unknown as Seam).__onePreflight.stores.coding.getState().conn), { timeout: 15_000 }).toBe('connected')

const fill = (plan: AnyState) => JSON.parse(JSON.stringify(plan).split('{{case}}').join(CASE).split('{{other}}').join(OTHER)) as AnyState
/** The planner's answer: the fixture's plan (or `plan`), with the server's blocks before it when `calls`. */
function answer(o: { calls?: boolean; plan?: AnyState } = {}): ClaudeTurn {
  const plan = o.plan ?? fill(FIXTURE.plan)
  const blocks: ClaudeTurn['blocks'] = []
  if (o.calls) for (const c of FIXTURE.calls) blocks.push({ type: 'mcp_tool_use', id: c.id, server: c.server, name: c.name, input: c.input }, { type: 'mcp_tool_result', id: c.id, text: c.result })
  blocks.push({ type: 'text', text: JSON.stringify(plan) })
  return { blocks, usage: { input: 3200, output: 900 } }
}
const noContext = (): AnyState => ({ ...fill(FIXTURE.plan), context: null })
/** Five steps (BA · Coding · Coding · QA · QA) — for the throw at step 3. */
const fiveSteps = () => {
  const p = noContext()
  const [ba, coding, qa] = p.steps
  return { ...p, steps: [ba, coding, { ...coding, title: 'Session-Verlängerung einbauen' }, qa, { ...qa, title: 'Abmelden testen' }] }
}

/**
 * Coding on (this device), the fake worker, the AI key, a work-orders database with one request — and, with `projects`,
 * the three pipeline projects made up front (their seed task removed), so a plan resolves to them.
 */
async function setup(page: Page, o: { server?: boolean; projects?: boolean } = {}) {
  await page.addInitScript((port) => localStorage.setItem('one.coding', JSON.stringify({ enabled: true, port })), PORT)
  await openApp(page)
  await wsEval(page, (s, a) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', mcpServers: a.server ? [a.kb] : [] }), { server: !!o.server, kb: KB })
  const ids = await wsEval(
    page,
    (s, a) => {
      const p = (id: string, name: string, type: string, extra: AnyState = {}) => ({ id, name, type, ...extra })
      s.createPage({ id: a.CASE, title: 'Supportfall 4711', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Kunde Tessera meldet: der Login bricht nach 30 Sekunden ab, die Eingaben sind weg.' }] }] } })
      s.createPage({ id: a.OTHER, title: 'Tessera intern', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Interne Notizen.' }] }] } })
      const db = s.createDatabase({
        title: 'Work orders',
        properties: [p('woName', 'Name', 'title'), p('woStatus', 'Status', 'select', { options: a.statusOptions }), p('woRepo', 'Repo', 'select', { options: [{ id: 'rWeb', name: 'website', color: 'gray' }] }), p('woId', 'ID', 'unique_id', { idPrefix: 'PA' })],
      })
      s.updateDatabase(db, { system: 'workorders', orders: { v: 1, status: a.ST, server: a.server ? { name: 'wissensbasis' } : null, kinds: ['spec', 'coding', 'qa'], checkpoint: true } })
      const body = [{ type: 'paragraph', content: [{ type: 'text', text: a.REQUEST }, { type: 'mention', attrs: { id: a.CASE, label: 'Supportfall 4711', kind: 'page' } }, { type: 'text', text: '. Repo website.' }] }]
      const row = s.createRow(db, { title: 'Login-Timeout prüfen', properties: { woStatus: a.ST.plan, woRepo: 'rWeb' }, content: { type: 'doc', content: body } })
      return { db, row }
    },
    { CASE, OTHER, ST, statusOptions, server: !!o.server, REQUEST },
  )
  if (o.projects) {
    for (const kind of ['spec', 'coding', 'qa']) {
      const seed = await page.evaluate((k) => (window as unknown as Seam).__oneCodingWrites.create('seed', k), kind)
      await wsEval(page, (s, id) => s.deletePagePermanently(id), seed as string)
    }
  }
  await expect.poll(() => page.evaluate(() => (window as unknown as Seam).__onePreflight.stores.coding.getState().conn), { timeout: 15_000 }).toBe('connected')
  return ids
}

const statusOf = (page: Page, row: string) => wsEval(page, (s, id) => s.pages[id].properties.woStatus as string, row)
/** Live pipeline rows carrying this request's relation (any project). */
const chainRows = (page: Page, row: string) =>
  wsEval(
    page,
    (s, r) =>
      Object.values(s.pages as Record<string, AnyState>)
        .filter((p) => !p.trashed && p.databaseId && ['spec', 'coding', 'qa'].includes(s.databases[p.databaseId]?.system) && Object.values(p.properties as AnyState).some((v) => Array.isArray(v) && v.includes(r)))
        .map((p) => p.id as string),
    row,
  )
const pageOf = (page: Page, id: string) => wsEval(page, (s, x) => s.pages[x] as AnyState, id)
/** Every block of a doc carries an id (paragraphs, headings, lists, quotes, callouts …). */
const blocksWithoutId = (doc: AnyState): number => {
  let n = 0
  const walk = (node: AnyState) => {
    if (node.type !== 'doc' && node.type !== 'text' && node.type !== 'mention' && node.type !== 'hardBreak' && !node.attrs?.id) n++
    for (const c of node.content ?? []) walk(c)
  }
  walk(doc)
  return n
}
const textOf = (node: AnyState): string => (node.type === 'text' ? node.text : (node.content ?? []).map(textOf).join(node.type === 'doc' || node.type === 'blockquote' || node.type === 'callout' ? '\n' : ''))

test.describe('confirming a work order: startChain', () => {
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

  test('every step parked with its page (slot · request quote · context in step 01 · goal · criteria · pages), roles, trust; step 01 starts after the count', async ({ page }) => {
    await mockClaudeScript(page.context(), [answer({ calls: true })])
    const { row } = await setup(page, { server: true })
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'ready', steps: 3 })
    const before = Date.now()
    const out = await orders(page).start(row)
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true })
    const ids = out.steps as string[]
    expect(ids).toHaveLength(3)
    expect((await chainRows(page, row)).sort()).toEqual([...ids].sort())

    // the record: running, the steps as confirmed, the 10 s count from now; Status Läuft
    const rec = await orders(page).record(row)
    expect(rec.state).toBe('running')
    expect(rec.chain.steps.map((s: AnyState) => [s.n, s.id, s.kind])).toEqual([
      [1, ids[0], 'spec'],
      [2, ids[1], 'coding'],
      [3, ids[2], 'qa'],
    ])
    expect(rec.chain.steps[0].basisBlock).toBeNull()
    expect(rec.chain.steps[1].basisBlock).toBe(`${ids[1]}-wait`)
    expect(rec.chain.steps[0].own).toEqual([`${ids[0]}-req`, `${ids[0]}-ctx`])
    expect(rec.chain.steps[2].own).toEqual([`${ids[2]}-wait`, `${ids[2]}-req`])
    // the page step 01 takes along, pinned at the planner's read (its fingerprint — never a tab's contentRev)
    expect(rec.chain.steps[0].refs).toEqual({ [CASE]: expect.stringMatching(/^[0-9a-f]{64}$/) })
    for (const s of rec.chain.steps) {
      expect(s.sig).toMatch(/^[0-9a-f]{64}$/)
      expect(s.rev).toBe(0)
    }
    expect(rec.chain.startAt).toBeGreaterThanOrEqual(before + 9_000)
    expect(rec.chain.advanced).toBeUndefined()
    expect(rec.chain.checkpoint).toBe(true)
    expect(await statusOf(page, row)).toBe(ST.running)

    // step 01: the request quote (plain — no mention node), the server's context, goal, criteria, the page that goes along
    const p1 = await pageOf(page, ids[0]!)
    const top1 = p1.content.content as AnyState[]
    expect(top1[0]).toMatchObject({ type: 'blockquote', attrs: { id: `${ids[0]}-req` } })
    expect(textOf(top1[0]!)).toContain('Request (PA-1)')
    expect(textOf(top1[0]!)).toContain(`${REQUEST}@Supportfall 4711. Repo website.`)
    expect(JSON.stringify(top1[0])).not.toContain('"mention"')
    expect(top1[1]).toMatchObject({ type: 'callout', attrs: { id: `${ids[0]}-ctx` } })
    expect(textOf(top1[1]!)).toContain('Context from the MCP server ‹wissensbasis› (outside)')
    expect(textOf(top1[1]!)).toContain(FIXTURE.plan.context.note)
    expect(JSON.stringify(top1[1])).toContain('https://kb.example.test/r/4711')
    expect(JSON.stringify(p1.content)).toContain('Ursache des Abbruchs benannt')
    const last1 = top1[top1.length - 1]!
    expect(last1).toMatchObject({ type: 'paragraph', attrs: { id: `${ids[0]}-refs` } })
    expect(last1.content.find((n: AnyState) => n.type === 'mention')).toMatchObject({ attrs: { id: CASE, kind: 'page' } })
    expect(blocksWithoutId(p1.content)).toBe(0)
    // steps 02 / 03: the slot first, the quote, no context
    for (const [i, waits] of [
      [1, 'Waits for step 01'],
      [2, 'Waits for step 02'],
    ] as const) {
      const p = await pageOf(page, ids[i]!)
      const top = p.content.content as AnyState[]
      expect(top[0]).toEqual({ type: 'paragraph', attrs: { id: `${ids[i]}-wait` }, content: [{ type: 'text', text: waits }] })
      expect(top[1]).toMatchObject({ type: 'blockquote', attrs: { id: `${ids[i]}-req` } })
      expect(JSON.stringify(p.content)).not.toContain('-ctx')
      expect(blocksWithoutId(p.content)).toBe(0)
      expect(p.contentRev).toBe(0)
    }

    // the roles (display only), the park stage, the worker's repo, trusted here
    const facts = await wsEval(
      page,
      (s, list) =>
        list.map((id: string) => {
          const p = s.pages[id]
          const db = s.databases[p.databaseId]
          const named = (n: string) => db.properties.find((x: AnyState) => x.name === n)?.id
          const stage = db.properties.find((x: AnyState) => x.name === 'Stage')
          return { order: p.properties[named('Work order')], step: p.properties[named('Step')], stage: stage.options.find((o: AnyState) => o.id === p.properties[stage.id])?.name }
        }),
      ids,
    )
    expect(facts).toEqual([
      { order: [row], step: 1, stage: 'Backlog' },
      { order: [row], step: 2, stage: 'Backlog' },
      { order: [row], step: 3, stage: 'Backlog' },
    ])
    const w = await orders(page).world(row)
    expect(w.move).toMatchObject({ kind: 'wait', why: 'startAt', step: 1 })
    for (const id of ids) expect(w.world.tasks[id]).toMatchObject({ exists: true, trusted: true, endsConfirm: false, startsAtOnce: false })
    for (const id of ids) expect(await orders(page).parked(id)).toBe(true)

    // opening a step page writes nothing (every block has its id): it stays untouched
    await gotoPage(page, ids[1]!)
    await page.waitForTimeout(2500)
    expect((await pageOf(page, ids[1]!)).contentRev).toBe(0)

    // the count ends: step 01 moves into its first automatic stage and reaches the worker — the others stay parked
    await expect.poll(async () => (await orders(page).record(row)).chain.advanced?.['1'] ?? null, { timeout: 20_000 }).not.toBeNull()
    await expect.poll(() => fake!.handed().map((t) => t.id), { timeout: 15_000 }).toContain(ids[0])
    expect(fake!.handed().map((t) => t.id)).not.toContain(ids[1])
    expect(fake!.handed().map((t) => t.id)).not.toContain(ids[2])
    expect(await orders(page).parked(ids[0]!)).toBe(false)
    expect(await orders(page).parked(ids[1]!)).toBe(true)
  })

  test('a throw at step 3 of 5 leaves nothing; the plan stands and starts whole after', async ({ page }) => {
    await mockClaudeScript(page.context(), [], { fallback: answer({ plan: fiveSteps() }) })
    const { row } = await setup(page, { projects: true })
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'ready', steps: 5 })
    const draft = (await orders(page).record(row)).draft
    await orders(page).fault({ at: 3, mode: 'throw' })
    const out = await orders(page).start(row)
    expect(out).toMatchObject({ ok: false, why: 'failed', step: 3 })
    // nothing left: the two steps made are in the trash, the record is the plan again, Status Kette bereit
    expect(await chainRows(page, row)).toEqual([])
    const trashed = await wsEval(page, (s, r) => Object.values(s.pages as Record<string, AnyState>).filter((p) => p.trashed && Object.values(p.properties as AnyState).some((v) => Array.isArray(v) && v.includes(r))).length, row)
    expect(trashed).toBe(2)
    const rec = await orders(page).record(row)
    expect(rec.state).toBe('draft')
    expect(rec.chain).toBeUndefined()
    expect(rec.draft.hash).toBe(draft.hash)
    expect(await statusOf(page, row)).toBe(ST.ready)
    // without the fault: all five, numbered 01–05
    await orders(page).fault(null)
    const again = await orders(page).start(row)
    expect(again, JSON.stringify(again)).toMatchObject({ ok: true })
    expect(again.steps).toHaveLength(5)
    expect((await orders(page).record(row)).chain.steps.map((s: AnyState) => s.n)).toEqual([1, 2, 3, 4, 5])
    expect((await chainRows(page, row)).length).toBe(5)
  })

  test('a double ↵ makes one chain; a changed plan is shown again', async ({ page }) => {
    await mockClaudeScript(page.context(), [], { fallback: answer({ plan: noContext() }) })
    const { row } = await setup(page, { projects: true })
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'ready' })
    // a hash the plate did not render: refused, nothing made
    expect(await orders(page).start(row, 'f'.repeat(64))).toMatchObject({ ok: false, why: 'changed' })
    expect(await chainRows(page, row)).toEqual([])
    const both = await page.evaluate((r) => Promise.all([(window as unknown as Seam).__oneOrders.start(r), (window as unknown as Seam).__oneOrders.start(r)]), row)
    expect(both.filter((o: AnyState) => o.ok)).toHaveLength(1)
    expect(both.find((o: AnyState) => !o.ok)).toMatchObject({ ok: false })
    expect(['busy', 'state']).toContain(both.find((o: AnyState) => !o.ok).why)
    expect((await chainRows(page, row)).length).toBe(3)
    // and once more later: no second chain while this one runs
    expect(await orders(page).start(row)).toMatchObject({ ok: false, why: 'state' })
    expect((await chainRows(page, row)).length).toBe(3)
  })

  test('a reload mid-create completes the chain; a step touched meanwhile → interrupted (discard · create the rest)', async ({ page }) => {
    await mockClaudeScript(page.context(), [], { fallback: answer({ plan: noContext() }) })
    const { row } = await setup(page, { projects: true })
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'ready' })
    // the tab stops for good before step 2 (as a tab closed mid-create)
    await orders(page).fault({ at: 2, mode: 'hold' })
    await page.evaluate((r) => void (window as unknown as Seam).__oneOrders.start(r), row)
    await expect.poll(async () => Object.keys((await orders(page).record(row))?.chain?.made ?? {}), { timeout: 10_000 }).toEqual(['1'])
    expect((await orders(page).record(row)).state).toBe('creating')
    await flush(page)
    await page.reload()
    await waitForApp(page)
    // the next start of a tab finishes it: all three, running, Status Läuft
    await expect.poll(async () => (await orders(page).record(row)).state, { timeout: 15_000 }).toBe('running')
    expect((await chainRows(page, row)).length).toBe(3)
    expect(await statusOf(page, row)).toBe(ST.running)

    // again — this time step 01 is edited before the reload: interrupted
    expect(await orders(page).undo(row)).toEqual({ ok: true })
    expect(await chainRows(page, row)).toEqual([])
    await orders(page).fault({ at: 2, mode: 'hold' })
    await page.evaluate((r) => void (window as unknown as Seam).__oneOrders.start(r), row)
    await expect.poll(async () => Object.keys((await orders(page).record(row))?.chain?.made ?? {}), { timeout: 10_000 }).toEqual(['1'])
    const first = (await orders(page).record(row)).chain.steps[0].id as string
    await wsEval(page, (s, id) => s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Mara Lind hat das umgeschrieben.' }] }] }, 'e2e'), first)
    await flush(page)
    await page.reload()
    await waitForApp(page)
    await expect.poll(async () => (await orders(page).record(row)).state, { timeout: 15_000 }).toBe('interrupted')
    expect(await chainRows(page, row)).toEqual([first])
    expect(await statusOf(page, row)).toBe(ST.ready)
    // "Rest anlegen" (VON HAND, §2.2 again — the worker back): the missing two made, the chain runs
    await connected(page)
    const rest = await orders(page).finishRest(row)
    expect(rest, JSON.stringify(rest)).toMatchObject({ ok: true, created: 2 })
    expect((await chainRows(page, row)).length).toBe(3)
    expect((await orders(page).record(row)).state).toBe('running')
    expect(await statusOf(page, row)).toBe(ST.running)
  })

  test('Fix 3: a creation left by a tab that closed mid-create is completed by a tab already open (no reload), once', async ({ page, context, errors }) => {
    await mockClaudeScript(context, [], { fallback: answer({ plan: noContext() }) })
    const { row } = await setup(page, { projects: true })
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'ready' })
    await flush(page)
    // tab A, opened beside this one: its ↵ stops for good before step 2 (as a tab closed mid-create)
    const a = await context.newPage()
    errors.watch(a)
    await openApp(a)
    await orders(a).fault({ at: 2, mode: 'hold' })
    await a.evaluate((r) => void (window as unknown as Seam).__oneOrders.start(r), row)
    await expect.poll(async () => Object.keys((await orders(page).record(row))?.chain?.made ?? {}), { timeout: 15_000 }).toEqual(['1'])
    expect((await orders(page).record(row)).state).toBe('creating')
    const first = (await orders(page).record(row)).chain.steps[0].id as string
    await flush(a)
    // this tab has A's step 01 (the cross-tab save) — and the record stays 'creating' while A holds it
    await expect.poll(() => wsEval(page, (s, id) => !!s.pages[id], first), { timeout: 15_000 }).toBe(true)
    await page.waitForTimeout(1000)
    expect((await orders(page).record(row)).state).toBe('creating')
    // A closes: this tab, open all along, completes the chain — all three steps once, running, Status Läuft
    await a.close()
    await expect.poll(async () => (await orders(page).record(row)).state, { timeout: 20_000 }).toBe('running')
    await expect.poll(() => chainRows(page, row), { timeout: 10_000 }).toHaveLength(3)
    expect(await statusOf(page, row)).toBe(ST.running)
    await page.waitForTimeout(1500)
    expect((await chainRows(page, row)).length).toBe(3)
  })

  test('"Angelegte verwerfen": the steps an interrupted chain made go to the trash, the plan stands again', async ({ page }) => {
    await mockClaudeScript(page.context(), [], { fallback: answer({ plan: noContext() }) })
    const { row } = await setup(page, { projects: true })
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'ready' })
    await orders(page).fault({ at: 3, mode: 'hold' })
    await page.evaluate((r) => void (window as unknown as Seam).__oneOrders.start(r), row)
    await expect.poll(async () => Object.keys((await orders(page).record(row))?.chain?.made ?? {}).length, { timeout: 10_000 }).toBe(2)
    const made = ((await orders(page).record(row)).chain.steps as AnyState[]).slice(0, 2).map((s) => s.id as string)
    await wsEval(page, (s, id) => s.updatePage(id, { title: 'Login-Timeout klären (Mara)' }), made[1]!)
    await flush(page)
    await page.reload()
    await waitForApp(page)
    await expect.poll(async () => (await orders(page).record(row)).state, { timeout: 15_000 }).toBe('interrupted')
    await connected(page)
    // the plate's VON HAND key (ready a moment after it shows)
    await gotoPage(page, row)
    const plate = page.getByTestId('order-plate')
    await expect(plate.getByTestId('order-chain-interrupted')).toContainText('Interrupted — 2 of 3 steps were created.')
    await expect(plate.getByTestId('order-finish-rest')).toBeVisible()
    const discard = plate.getByTestId('order-discard-made')
    await expect(discard).toHaveAttribute('data-ready', '')
    await discard.click()
    await expect(plate.getByTestId('order-plan-step')).toHaveCount(3)
    expect(await chainRows(page, row)).toEqual([])
    const rec = await orders(page).record(row)
    expect(rec.state).toBe('draft')
    expect(rec.chain).toBeUndefined()
    expect(await statusOf(page, row)).toBe(ST.ready)
    // and it starts again from the plan
    expect(await orders(page).start(row)).toMatchObject({ ok: true })
  })

  test('the plate: the plan in Kette bereit, ↵ Kette starten (VON HAND), the count with ↵ jetzt and Z, the Laufleiste', async ({ page }) => {
    await mockClaudeScript(page.context(), [], { fallback: answer({ plan: noContext() }) })
    const { row } = await setup(page, { projects: true })
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'ready' })
    await gotoPage(page, row)
    const plate = page.getByTestId('order-plate')
    await expect(plate.getByTestId('order-plan-step')).toHaveCount(3)
    await expect(plate.getByTestId('order-plan-step').nth(0)).toContainText('Login-Timeout klären')
    await expect(plate.getByTestId('order-plan-step').nth(1)).toContainText('Repo website')
    await expect(plate.getByTestId('order-plan-step').nth(1)).toContainText('Login bleibt 5 Minuten offen')
    // ready to plan says nothing more once the plan stands; planning again is the plain key beside it
    await expect(plate.getByTestId('order-pre')).toHaveCount(0)
    await expect(plate.getByTestId('order-plan')).toHaveText('RPlan again')
    const start = plate.getByTestId('order-start')
    await expect(start).toHaveText('↵Start chain')
    // ↵ acts once every step was seen in full and the page that goes along was opened (B8 — orders-ui.spec)
    await expect(start).toHaveAttribute('aria-disabled', 'true')
    await readPlan(page)
    await expect(start).toHaveAttribute('data-ready', '')
    await expect(start).not.toHaveAttribute('aria-disabled', 'true')
    await start.click()
    await expect(plate.getByTestId('order-countdown')).toContainText(/Step 01 starts in \d+ s/)
    await expect(plate.getByTestId('order-chain-row')).toHaveCount(3)
    await expect(plate.getByTestId('order-chain-row').nth(0)).toHaveAttribute('data-lane', 'parked')
    await expect(plate.getByTestId('order-chain-row').nth(0)).toContainText('parked')
    await expect(plate).toHaveAttribute('data-status', 'running')
    // Z with focus in the plate (its heading has it after the start): all of it back
    await expect(plate.locator('.orp-code')).toBeFocused()
    await page.keyboard.press('z')
    await expect(page.getByText('Chain taken back — the plan is ready again')).toBeVisible()
    await expect(plate.getByTestId('order-plan-step')).toHaveCount(3)
    expect(await chainRows(page, row)).toEqual([])
    expect(await statusOf(page, row)).toBe(ST.ready)
    // again (what was seen stays seen in this tab): ↵ jetzt starts step 01 at once — Z is gone, the line says so
    await expect(start).toHaveAttribute('data-ready', '')
    await start.click()
    await plate.getByTestId('order-start-now').click()
    await expect(plate.getByTestId('order-chain-taken')).toHaveText(/^already running — H halt, (⌘\.|Ctrl\+\.) stop$/)
    await expect(plate.getByTestId('order-undo')).toHaveCount(0)
    await expect(plate.getByTestId('order-chain-row').nth(0)).not.toHaveAttribute('data-lane', 'parked')
    await expect(plate.getByTestId('order-chain-row').nth(1)).toHaveAttribute('data-lane', 'parked')
    expect((await orders(page).record(row)).chain.advanced['1']).toBeGreaterThan(0)
  })

  test('Undo before step 01 was taken trashes all; after it was taken it is refused; a follow-up chain counts on and its Undo brings the old parked steps back', async ({ page }) => {
    await mockClaudeScript(page.context(), [], { fallback: answer({ plan: noContext() }) })
    const { row } = await setup(page, { projects: true })
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'ready' })
    const first = await orders(page).start(row)
    expect(first).toMatchObject({ ok: true })
    expect(await orders(page).undo(row)).toEqual({ ok: true })
    expect(await chainRows(page, row)).toEqual([])
    const back = await orders(page).record(row)
    expect(back.state).toBe('draft')
    expect(back.chain).toBeUndefined()
    expect(await statusOf(page, row)).toBe(ST.ready)

    // started again, step 01 taken at once (↵ jetzt): Undo is refused as a whole, nothing goes
    const second = await orders(page).start(row)
    expect(second).toMatchObject({ ok: true })
    expect(await orders(page).startNow(row)).toMatchObject({ kind: 'advance', step: 1 })
    expect(await orders(page).undo(row)).toEqual({ ok: false, why: 'taken' })
    expect((await chainRows(page, row)).length).toBe(3)

    // a follow-up chain after a halt: numbers go on (4–6), the older chain's parked steps 02–03 go to the trash
    await wsEval(page, (s, a) => s.setRowProperty(a.row, 'woStatus', a.halted), { row, halted: ST.halted })
    // Angehalten (by any writer) halts this device's record where it was written — at once (trigger.ts haltRecord)
    await expect.poll(async () => (await orders(page).record(row)).state, { timeout: 10_000 }).toBe('halted')
    expect((await orders(page).record(row)).chain.halted).toMatchObject({ why: 'status' })
    await statusBy(page, row, 'plan')
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'ready' })
    const old = second.steps as string[]
    const follow = await orders(page).start(row)
    expect(follow, JSON.stringify(follow)).toMatchObject({ ok: true })
    const rec = await orders(page).record(row)
    expect(rec.chain.steps.map((s: AnyState) => s.n)).toEqual([4, 5, 6])
    expect(rec.chain.replaced.trashed.sort()).toEqual([old[1], old[2]].sort())
    expect(await wsEval(page, (s, ids) => ids.map((id: string) => !!s.pages[id].trashed), old)).toEqual([false, true, true])
    // its Undo: the new steps go, the old parked ones come back, the older chain is the record's again
    expect(await orders(page).undo(row)).toEqual({ ok: true })
    expect(await wsEval(page, (s, ids) => ids.map((id: string) => !!s.pages[id].trashed), old)).toEqual([false, false, false])
    const after = await orders(page).record(row)
    expect(after.state).toBe('draft')
    expect(after.chain.steps.map((s: AnyState) => s.id)).toEqual(old)
  })

  test('parked steps never reach the worker; a project that starts new tasks at once is refused before anything is made', async ({ page }) => {
    await mockClaudeScript(page.context(), [], { fallback: answer({ plan: noContext() }) })
    const { row } = await setup(page, { projects: true })
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'ready' })
    const out = await orders(page).start(row)
    expect(out).toMatchObject({ ok: true })
    const ids = out.steps as string[]
    // step 02 moved into its automatic "Ready" stage by hand during the count: the worker asks, gets nothing
    await wsEval(page, (s, id) => {
      const p = s.pages[id]
      const db = s.databases[p.databaseId]
      const stage = db.properties.find((x: AnyState) => x.name === 'Stage')
      s.setRowProperty(id, stage.id, stage.options.find((o: AnyState) => o.name === 'Ready').id)
    }, ids[1]!)
    const asked = fake!.asked.length
    await expect.poll(() => fake!.asked.length, { timeout: 10_000 }).toBeGreaterThan(asked + 1)
    expect(fake!.handed()).toEqual([])
    expect(await orders(page).parked(ids[1]!)).toBe(true)
    // the chain halts "out of order" instead of starting anything — at once (B7: a write to a step runs its chain), so
    // "jetzt" finds nothing left to start
    await expect.poll(async () => (await orders(page).record(row)).state, { timeout: 10_000 }).toBe('halted')
    expect((await orders(page).record(row)).chain.halted).toMatchObject({ why: 'outOfOrder', step: 2 })
    expect(await orders(page).startNow(row)).toBeNull()
    expect(await statusOf(page, row)).toBe(ST.halted)
    await page.waitForTimeout(2500)
    expect(fake!.handed()).toEqual([])

    // a project whose first stage hands new tasks to the worker at once: refused, nothing made
    await statusBy(page, row, 'plan')
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'ready' })
    const coding = await wsEval(page, (s) => Object.values(s.databases as Record<string, AnyState>).find((d) => d.system === 'coding')!.id as string)
    await wsEval(page, (s, db) => s.updateDatabase(db, { pipeline: s.databases[db].pipeline.map((st: AnyState, i: number) => (i === 0 ? { ...st, auto: true } : st)) }), coding)
    const before = (await chainRows(page, row)).length
    expect(await orders(page).start(row)).toMatchObject({ ok: false, why: 'kind', step: 2, kind: 'coding', problem: 'startsAtOnce' })
    expect((await chainRows(page, row)).length).toBe(before)
    expect((await orders(page).record(row)).state).toBe('draft')
    expect(await statusOf(page, row)).toBe(ST.ready)
  })
})

/* ------------------------------------------------------------------ Node: the step page, the record */

/** the coding strings as the app's translator reads them ({name} filled in; shared/i18n itself needs Vite's env) */
const tr = (lang: 'en' | 'de'): Translate => ((key: string, vars?: Record<string, string | number>) => {
  const str = (codingMessages[lang] as Record<string, string>)[key] ?? key
  return vars ? str.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : str
}) as Translate

node.describe('the step page and the record (Node)', () => {
  const titles: Record<string, string> = { pgcase000001: 'Supportfall 4711', pgother00001: 'Tessera intern' }
  const titleOf = (id: string) => titles[id] ?? 'Untitled'
  const request = [
    { type: 'paragraph', content: [{ type: 'text', text: 'Prüfe den Login. ' }, { type: 'mention', attrs: { id: 'pgcase000001', label: 'Supportfall 4711', kind: 'page' } }, { type: 'text', text: ' und https://one.example.test/app/#/p/pgother00001 lesen' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Mara Lind', marks: [{ type: 'link', attrs: { href: '#/p/pgother00001' } }] }, { type: 'text', text: ' fragt.' }] },
  ]
  for (const lang of ['en', 'de'] as const) {
    const words = stepWords(tr(lang), lang)
    node(`${lang}: the slot only after a step, the request as plain text, the context only in the first step, the pages at the end`, () => {
      const first = stepPage({ taskId: 'task0000001', after: null, code: 'PA-12', request, context: { server: 'wissensbasis', note: 'Notiz zu #/p/pgother00001.', links: ['https://kb.example.test/r/4711', '#/p/pgother00001'] }, refs: [{ id: 'pgcase000001', label: 'Supportfall 4711' }], titleOf, words })
      nodeExpect(first.basisBlock).toBeNull()
      nodeExpect(first.own).toEqual(['task0000001-req', 'task0000001-ctx'])
      nodeExpect(first.lead.map((b) => b.type)).toEqual(['blockquote', 'callout'])
      const quote = JSON.stringify(first.lead[0])
      // never a node or a link mark that would send a page along — plain text only
      nodeExpect(quote).not.toContain('"mention"')
      nodeExpect(quote).not.toContain('"link"')
      nodeExpect(quote).not.toContain('#/p/')
      nodeExpect(quote).toContain('Prüfe den Login. @Supportfall 4711 und @Tessera intern lesen')
      nodeExpect(quote).toContain(lang === 'de' ? 'Auftrag (PA-12)' : 'Request (PA-12)')
      const ctx = JSON.stringify(first.lead[1])
      nodeExpect(ctx).toContain(lang === 'de' ? 'Kontext vom MCP-Server ‹wissensbasis› (fremd)' : 'Context from the MCP server ‹wissensbasis› (outside)')
      nodeExpect(ctx).toContain('Notiz zu @Tessera intern.')
      nodeExpect(ctx).toContain('https://kb.example.test/r/4711')
      nodeExpect(ctx).not.toContain('#/p/')
      nodeExpect(first.extra).toHaveLength(1)
      nodeExpect(first.extra[0]).toMatchObject({ type: 'paragraph', attrs: { id: 'task0000001-refs' } })
      nodeExpect(first.extra[0]!.content!.filter((n) => n.type === 'mention')).toEqual([{ type: 'mention', attrs: { id: 'pgcase000001', label: 'Supportfall 4711', kind: 'page' } }])

      const later = stepPage({ taskId: 'task0000002', after: 4, code: 'PA-12', request, context: { server: 'wissensbasis', note: 'x', links: [] }, refs: [], titleOf, words })
      nodeExpect(later.basisBlock).toBe('task0000002-wait')
      nodeExpect(later.lead[0]).toEqual({ type: 'paragraph', attrs: { id: 'task0000002-wait' }, content: [{ type: 'text', text: lang === 'de' ? 'Wartet auf Schritt 04' : 'Waits for step 04' }] })
      // the server's context only in the chain's first step; no pages line without refs
      nodeExpect(later.lead.map((b) => b.type)).toEqual(['paragraph', 'blockquote'])
      nodeExpect(later.extra).toEqual([])
    })
  }
  node('the request quote: ≤ 4 000 characters, a cut noted; a person, a date, math as text', () => {
    const words = stepWords(tr('de'), 'de')
    const long = [{ type: 'paragraph', content: [{ type: 'text', text: 'Login '.repeat(1000) }] }]
    const page = stepPage({ taskId: 't1', after: null, code: 'PA-3', request: long, context: null, refs: [], titleOf, words })
    nodeExpect(page.quoted).toBe(4000)
    nodeExpect(page.total).toBe(5999)
    nodeExpect(JSON.stringify(page.lead[0])).toContain('Gekürzt: 4.000 von 5.999 Zeichen des Auftrags')
    nodeExpect(requestPlain({ type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'p1', label: 'Mara Lind', kind: 'person' } }, { type: 'text', text: ' bis ' }, { type: 'mention', attrs: { id: '2026-10-20', label: '20. Okt.', kind: 'date' } }, { type: 'text', text: ': ' }, { type: 'inlineMath', attrs: { latex: 't > 30' } }] }, titleOf)).toBe('@Mara Lind bis 20. Okt.: t > 30')
  })
  node('the record keeps a step\'s title, revision and sig and the replaced chain (one level); drops the rest', () => {
    const step = (n: number, id: string) => ({ n, id, kind: 'coding', project: 'proj000001', line: '[]', approvals: 'review', refs: {}, basisBlock: null })
    const older = { run: 'run0000001', confirmedAt: 1, startAt: 2, steps: [step(1, 'old0000001'), step(2, 'old0000002')], doneBy: {}, halted: { at: 3, why: 'status', by: 'order' }, checkpoint: true }
    const chain = readOrderChain({
      run: 'run0000002',
      confirmedAt: 10,
      startAt: 20,
      steps: [{ ...step(3, 'new0000003'), title: 'Session-Timeout beheben', rev: 0, sig: 'a'.repeat(64) }, { ...step(4, 'new0000004'), title: 'x'.repeat(201), rev: -1, sig: 'nope' }],
      doneBy: {},
      halted: null,
      checkpoint: true,
      replaced: { chain: { ...older, replaced: { chain: older, trashed: [] } }, trashed: ['old0000002', 'bad id!'] },
    })!
    nodeExpect(chain.steps[0]).toMatchObject({ title: 'Session-Timeout beheben', rev: 0, sig: 'a'.repeat(64) })
    nodeExpect(chain.steps[1]!.title).toBeUndefined()
    nodeExpect(chain.steps[1]!.rev).toBeUndefined()
    nodeExpect(chain.steps[1]!.sig).toBeUndefined()
    nodeExpect(chain.replaced!.trashed).toEqual(['old0000002'])
    nodeExpect(chain.replaced!.chain.steps.map((s) => s.id)).toEqual(['old0000001', 'old0000002'])
    // never more than one level
    nodeExpect(chain.replaced!.chain.replaced).toBeUndefined()
  })
})
