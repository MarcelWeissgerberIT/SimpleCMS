/**
 * Work orders (Prüfaufträge) B11 — "Ohne Bestätigung starten" / "Start without confirming" (spec §3.5, §4): this
 * device's consent per work-orders database, local only, a Budget je Kette required, the Patchbay asked at switch-on and
 * at every auto create; the consent lapses when the settings it covers change; a finished plan starts without ↵ only
 * when nothing is unclear — else it stays at "Kette bereit" and says why. A fake worker on CODING_E2E_PORT,
 * api.anthropic.com scripted (the planner's answer). Fictional data only (Nordlicht, Tessera, Mara Lind, Wissensbasis).
 *  - Node: the fallbacks (autoCore.ts), the provenance rule, the reasons read back, the words EN = DE;
 *  - refused with a fuse (the person's server + Approvals "Plan and review"); allowed after "Allow this path";
 *  - lapses on a config / Approvals / pipeline change;
 *  - a clean plan starts without ↵ (also a press kept for the worker — the deferred line says it starts too);
 *  - falls back on an open point / a missing repo / another repo / a named branch / a page from mails / an agent-written
 *    request;
 *  - a restored backup never carries it.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval } from './fixtures'
import { test as node, expect as nodeExpect } from '@playwright/test'
import { mockClaudeScript, type ClaudeTurn } from './helpers/providers'
import { startFakeWorker, type FakeWorker } from './helpers/fakeWorker'
import { exportBackup, importBackup } from './helpers/backup'
import { WORKER_CAN, type WorkerInfo } from '../../src/app/features/coding/protocol'
import { autoFallbacks, provOutside, readAutoWhy, stagesPart, type AutoFacts } from '../../src/app/features/coding/orders/autoCore'
import { autoFallbackText, autoWhyText } from '../../src/app/features/coding/orders/autoWords'
import { messages as autoMessages } from '../../src/app/features/coding/orders/autoMessages'
import { moduleKey } from '../../src/app/features/patchbay/ref'
import type { OrderAutoWhy, OrderPlanV1 } from '../../src/app/features/coding/orders/types'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** CODING_E2E_PORT: one port for the coding suites when they run side by side (one worker at a time) */
const PORT = Number(process.env.CODING_E2E_PORT) || 47384

const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/ai/anthropic/orders-plan-kb.json', import.meta.url)), 'utf8')) as AnyState
const CASE = 'pgcase000001'
const OTHER = 'pgother00001'
const MAIL = 'pgmail000001'
const ST = { draft: 'woDraft01', plan: 'woPlan001', ready: 'woReady01', running: 'woRun0001', halted: 'woHalt001', done: 'woDone001' }
const statusOptions = [
  { id: ST.draft, name: 'Draft', color: 'gray' },
  { id: ST.plan, name: 'Plan', color: 'blue' },
  { id: ST.ready, name: 'Chain ready', color: 'yellow' },
  { id: ST.running, name: 'Running', color: 'orange' },
  { id: ST.halted, name: 'Halted', color: 'red' },
  { id: ST.done, name: 'Done', color: 'green' },
]
const welcome = (repos: string[]): WorkerInfo => ({
  worker: '1.11.0',
  name: 'nordlicht-box',
  repos: repos.map((name) => ({ name, baseBranch: 'main', branches: ['main', 'one/nordlicht-footer'], mcp: [] })),
  parallel: 1,
  busy: [],
  spentToday: 0,
  dayLimit: null,
  claude: { found: true, version: '2.0.0' },
  setup: true,
  mcp: [],
})
const REQUEST = 'Prüfe, warum der Login von Nordlicht nach 30 Sekunden abbricht. Siehe '
/** the person's own server for the planner: the fixture Wissensbasis (`*.example.test`), tested here, read tools */
const KB = { id: 'srvkb000001', name: 'wissensbasis', url: 'https://kb.example.test/mcp', token: 'kb-e2e-PLAINTEXT-token-0001', enabled: true, prompt: '**Wissensbasis** holds the support records.', promptSource: 'auto', tools: ['kb_search', 'kb_get', 'kb_post_note'], checkedAt: 1 }

type Seam = { __oneOrders: Record<string, (...a: any[]) => Promise<any>>; __onePreflight: AnyState; __oneCodingWrites: Record<string, (...a: any[]) => any>; __onePatchbay: AnyState } // eslint-disable-line @typescript-eslint/no-explicit-any
const call = (page: Page, name: string, ...args: unknown[]) => page.evaluate(([n, a]) => (window as unknown as Seam).__oneOrders[n as string]!(...(a as unknown[])), [name, args] as const)
const orders = (page: Page) => ({
  record: (row: string) => call(page, 'record', row) as Promise<AnyState | null>,
  auto: (db: string) => call(page, 'auto', db) as Promise<AnyState | null>,
  autoOn: (db: string) => call(page, 'autoOn', db) as Promise<AnyState>,
  autoLapse: (db: string) => call(page, 'autoLapse', db) as Promise<number | null>,
  autoSig: (db: string) => call(page, 'autoSig', db) as Promise<string | null>,
  setAuto: (db: string, v: unknown) => call(page, 'setAuto', db, v) as Promise<boolean>,
  undo: (row: string) => call(page, 'undo', row) as Promise<AnyState>,
})

const fill = (plan: AnyState) => JSON.parse(JSON.stringify(plan).split('{{case}}').join(CASE).split('{{other}}').join(OTHER)) as AnyState
/** The planner's plan without a server (the fixture's, its context dropped), changed per case. */
const planWith = (change: (p: AnyState) => void = () => {}): AnyState => {
  const p = { ...fill(FIXTURE.plan), context: null }
  change(p)
  return p
}

interface Setup {
  approvals?: 'all' | 'review' | 'none'
  /** the work orders' Budget je Kette ($); null: none */
  budget?: number | null
  /** the person's server picked for the planner */
  server?: boolean
  /** the fake worker's repos (null: no worker started yet) */
  repos?: string[] | null
}

/** Coding on (this device), the AI key, a work-orders database with one request, the three projects. */
async function setup(page: Page, o: Setup = {}) {
  await page.addInitScript(
    ([port, approvals]) => {
      localStorage.setItem('one.coding', JSON.stringify({ enabled: true, port }))
      localStorage.setItem('one.tour', '{"off":true}')
      if (approvals) localStorage.setItem('one.coding.approvals', approvals)
    },
    [PORT, o.approvals ?? null] as const,
  )
  await openApp(page)
  await wsEval(page, (s, a) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', mcpServers: a.server ? [a.kb] : [] }), { server: !!o.server, kb: KB })
  const ids = await wsEval(
    page,
    (s, a) => {
      const p = (id: string, name: string, type: string, extra: AnyState = {}) => ({ id, name, type, ...extra })
      s.createPage({ id: a.CASE, title: 'Supportfall 4711', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Kunde Tessera meldet: der Login bricht nach 30 Sekunden ab, die Eingaben sind weg. Gemeldet von Mara Lind.' }] }] } })
      s.createPage({ id: a.OTHER, title: 'Tessera intern', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Interne Notizen.' }] }] } })
      const db = s.createDatabase({
        title: 'Work orders',
        properties: [
          p('woName', 'Name', 'title'),
          p('woStatus', 'Status', 'select', { options: a.statusOptions }),
          p('woRepo', 'Repo', 'select', { options: [{ id: 'rWeb', name: 'website', color: 'gray' }, { id: 'rShop', name: 'shop', color: 'gray' }] }),
          p('woId', 'ID', 'unique_id', { idPrefix: 'PA' }),
        ],
      })
      s.updateDatabase(db, { system: 'workorders', orders: { v: 1, status: a.ST, server: a.server ? { name: 'wissensbasis' } : null, kinds: ['spec', 'coding', 'qa'], checkpoint: true, ...(a.budget !== null ? { budgetUsd: a.budget } : {}) } })
      const body = [{ type: 'paragraph', content: [{ type: 'text', text: a.REQUEST }, { type: 'mention', attrs: { id: a.CASE, label: 'Supportfall 4711', kind: 'page' } }, { type: 'text', text: '. Repo website.' }] }]
      const row = s.createRow(db, { title: 'Login-Timeout prüfen', properties: { woStatus: a.ST.draft, woRepo: 'rWeb' }, content: { type: 'doc', content: body } })
      return { db, row }
    },
    { CASE, OTHER, ST, statusOptions, REQUEST, budget: o.budget === undefined ? 5 : o.budget, server: !!o.server },
  )
  for (const kind of ['spec', 'coding', 'qa']) {
    const seed = await page.evaluate((k) => (window as unknown as Seam).__oneCodingWrites.create('seed', k), kind)
    await wsEval(page, (s, id) => s.deletePagePermanently(id), seed as string)
  }
  return ids
}

/** The fake worker with every capability (B9's way: `can` set before the tab connects). */
async function worker(repos: string[]): Promise<FakeWorker> {
  const f = await startFakeWorker(PORT, welcome(repos))
  f.can = [...WORKER_CAN]
  return f
}
const connected = (page: Page) => expect.poll(() => page.evaluate(() => (window as unknown as Seam).__onePreflight.stores.coding.getState().conn), { timeout: 30_000 }).toBe('connected')
const statusOf = (page: Page, row: string) => wsEval(page, (s, id) => s.pages[id].properties.woStatus as string, row)
const openRow = async (page: Page, row: string) => {
  await page.evaluate((id) => (window.location.hash = `#/p/${id}`), row)
  await expect(page.getByTestId('order-plate')).toBeVisible()
}
/** ↵ Planen on the plate — the person's press (the allow-list's 'plate'). */
const pressPlan = async (page: Page) => {
  await page.getByTestId('order-plate').getByTestId('order-plan').click()
}
/**
 * The person drags the card into "Planen" (the board writes as `you~ui` — the allow-list's 'status' press). On a plan in
 * "Kette bereit" the plate's own "Plan again" (R) is a re-plan at the plate, never auto-started: a press is what auto
 * mode follows.
 */
const pressByStatus = (page: Page, row: string) =>
  page.evaluate(([id, plan]) => (window as unknown as { __oneOrderEntries: { setStatusAs(r: string, k: string, w: unknown): void } }).__oneOrderEntries.setStatusAs(id, plan, { kind: 'you', via: 'ui' }), [row, 'plan'] as const)
const openSettings = async (page: Page) => {
  await page.getByTestId('order-plate').getByTestId('order-settings-key').first().click()
  await expect(page.getByTestId('order-settings')).toBeVisible()
  return page.getByTestId('order-settings')
}
const reasonsOf = async (page: Page, row: string): Promise<OrderAutoWhy[]> => ((await orders(page).record(row))?.draft?.auto?.reasons ?? []) as OrderAutoWhy[]

/* ================================================================== Node */

const fact = (o: Partial<AutoFacts> = {}): AutoFacts => ({
  plan: { v: 1, summary: 's', context: null, questions: [], refused: null, steps: [{ kind: 'spec', title: 'BA', goal: 'g', criteria: [], repo: null, branch: null, priority: 'high', refs: ['p1'], why: '' }, { kind: 'coding', title: 'Code', goal: 'g', criteria: [], repo: 'website', branch: null, priority: 'high', refs: [], why: '' }] } as OrderPlanV1,
  notes: [],
  kinds: ['spec', 'coding', 'qa'],
  rowRepo: 'website',
  repos: ['website', 'shop'],
  needsRepo: [false, true],
  inputs: [{ id: 'row', mail: false, outside: false }, { id: 'p1', mail: false, outside: false }],
  pressFps: { row: 'a'.repeat(64), p1: 'b'.repeat(64) },
  readFps: { row: 'a'.repeat(64), p1: 'b'.repeat(64) },
  budget: 5,
  ...o,
})
const step = (plan: OrderPlanV1, i: number, change: Partial<OrderPlanV1['steps'][number]>): OrderPlanV1 => ({ ...plan, steps: plan.steps.map((s, j) => (j === i ? { ...s, ...change } : s)) })

node.describe('orders auto — the fallbacks (Node)', () => {
  node('a clean plan has none; each doubt is named with its step', () => {
    nodeExpect(autoFallbacks(fact())).toEqual([])
    const base = fact().plan
    nodeExpect(autoFallbacks(fact({ plan: { ...base, questions: ['Welche Sitzungsdauer?', 'Welches Gateway?'] } }))).toEqual([{ why: 'open', n: 2 }])
    nodeExpect(autoFallbacks(fact({ plan: step(base, 1, { repo: null }) }))).toEqual([{ why: 'repo', step: 2 }])
    // a BA step without a repo whose pipeline runs document stages only: fine; one that needs a repo: named
    nodeExpect(autoFallbacks(fact({ needsRepo: [true, true] }))).toEqual([{ why: 'repo', step: 1 }])
    nodeExpect(autoFallbacks(fact({ plan: step(base, 1, { repo: 'shop' }) }))).toEqual([{ why: 'otherRepo', step: 2 }])
    // no Repo on the request: only the ONLY announced repo goes
    nodeExpect(autoFallbacks(fact({ rowRepo: null }))).toEqual([{ why: 'otherRepo', step: 2 }])
    nodeExpect(autoFallbacks(fact({ rowRepo: null, repos: ['website'] }))).toEqual([])
    nodeExpect(autoFallbacks(fact({ plan: step(base, 1, { branch: 'one/nordlicht-footer' }) }))).toEqual([{ why: 'branch', step: 2 }])
    // a branch the planner asked for and the reader dropped (its note) counts the same
    nodeExpect(autoFallbacks(fact({ notes: [{ kind: 'branch', step: 2, branch: 'main', why: 'base' }] }))).toEqual([{ why: 'branch', step: 2 }])
    nodeExpect(autoFallbacks(fact({ kinds: ['coding', 'qa'] }))).toEqual([{ why: 'kind', step: 1 }])
    nodeExpect(autoFallbacks(fact({ inputs: [{ id: 'row', mail: false, outside: true }, { id: 'p1', mail: true, outside: false }] }))).toEqual([
      { why: 'outside', page: 'row', cls: 'foreign' },
      { why: 'outside', page: 'p1', cls: 'mail' },
    ])
    nodeExpect(autoFallbacks(fact({ readFps: { row: 'c'.repeat(64), p1: 'b'.repeat(64) } }))).toEqual([{ why: 'moved', page: 'row' }])
    // a page the planner never read is not compared; a plan from no press (the answers) has nothing to compare
    nodeExpect(autoFallbacks(fact({ readFps: { row: 'a'.repeat(64) } }))).toEqual([])
    nodeExpect(autoFallbacks(fact({ pressFps: null, readFps: {} }))).toEqual([])
    nodeExpect(autoFallbacks(fact({ notes: [{ kind: 'keys', step: 2, count: 1 }, { kind: 'keys', step: null, count: 2 }] }))).toEqual([{ why: 'keys', n: 3 }])
    nodeExpect(autoFallbacks(fact({ budget: null }))).toEqual([{ why: 'budget' }])
  })

  node('provenance: only the person’s own writing is no outside', () => {
    for (const p of [{ updatedBy: null, contentOrigin: null }, { updatedBy: null, contentOrigin: 'editor:e1' }, { updatedBy: null, contentOrigin: 'answers' }]) nodeExpect(provOutside(p)).toBe(false)
    for (const p of [
      { updatedBy: 'agent:ag1', contentOrigin: 'editor:e1' },
      { updatedBy: 'api:k1', contentOrigin: null },
      { updatedBy: 'hook:h1', contentOrigin: null },
      ...['ai', 'sync', 'file', 'import', 'share', 'mcp', 'clip', 'mail', 'template'].map((o) => ({ updatedBy: null, contentOrigin: o })),
    ])
      nodeExpect(provOutside(p)).toBe(true)
    nodeExpect(provOutside(null)).toBe(false)
  })

  node('the reasons read back within bounds; junk is dropped', () => {
    const ok: OrderAutoWhy[] = [{ why: 'open', n: 1 }, { why: 'repo', step: 2 }, { why: 'outside', page: 'pg1', cls: 'mail' }, { why: 'moved', page: 'pg1' }, { why: 'lapsed' }, { why: 'budget' }, { why: 'fuse', label: 'F1', path: 'x' }, { why: 'start', text: 'refused' }]
    for (const r of ok) nodeExpect(readAutoWhy(r)).toEqual(r)
    for (const junk of [null, 1, 'open', { why: 'open', n: 0 }, { why: 'repo', step: 1000 }, { why: 'outside', page: 'a b', cls: 'mail' }, { why: 'outside', page: 'p', cls: 'agent' }, { why: 'start', text: '  ' }, { why: 'nope' }]) nodeExpect(readAutoWhy(junk)).toBeNull()
    nodeExpect((readAutoWhy({ why: 'fuse', label: 'F1', path: 'p'.repeat(900) }) as { path: string }).path.length).toBe(600)
  })

  node('the sig’s pipeline part: what a stage does, never its name', () => {
    const a = stagesPart([{ id: 's1', kind: 'implement', auto: true, name: 'Umsetzen' } as never])
    const b = stagesPart([{ id: 's1', kind: 'implement', auto: true, name: 'Implement' } as never])
    nodeExpect(a).toEqual(b)
    nodeExpect(stagesPart([{ id: 's1', kind: 'implement', auto: false }])).not.toEqual(a)
  })

  node('the sig’s pipeline part (B15): by position — a template read twice (new ids each time) and a project made from it read the same; a changed jump does not', () => {
    const tpl = (ids: string[]) => [
      { id: ids[0]!, kind: 'queue', auto: false },
      { id: ids[1]!, kind: 'doc', auto: true, maxTurns: 40, instructions: 'Analyse' },
      { id: ids[2]!, kind: 'gate', auto: false, next: ids[0] },
      { id: ids[3]!, kind: 'done', auto: false },
    ]
    const first = stagesPart(tpl(['a1', 'a2', 'a3', 'a4']))
    nodeExpect(stagesPart(tpl(['b1', 'b2', 'b3', 'b4']))).toEqual(first)
    nodeExpect(stagesPart(tpl(['optBacklog', 'optAnalyse', 'optApprove', 'optDone']))).toEqual(first)
    const other = tpl(['a1', 'a2', 'a3', 'a4'])
    other[2]!.next = 'a2'
    nodeExpect(stagesPart(other)).not.toEqual(first)
    // a jump to a stage that is not there reads as none
    const gone = tpl(['a1', 'a2', 'a3', 'a4'])
    gone[2]!.next = 'zz'
    nodeExpect((stagesPart(gone)[2] as unknown[])[6]).toBeNull()
  })

  node('the words: EN = DE keys, placeholders kept, never the banned names', () => {
    const en = autoMessages.en as Record<string, string>
    const de = autoMessages.de as Record<string, string>
    nodeExpect(Object.keys(de).sort()).toEqual(Object.keys(en).sort())
    for (const k of Object.keys(en)) nodeExpect((de[k]!.match(/\{\w+\}/g) ?? []).sort()).toEqual((en[k]!.match(/\{\w+\}/g) ?? []).sort())
    for (const v of Object.values(de)) nodeExpect(v).not.toMatch(/Prüfung|Plan bereit|\bdanach\b|Freigeben/)
    nodeExpect(de['features.coding.order.mode.allow']).toBe('Weg zulassen')
    nodeExpect(de['features.coding.order.mode.auto']).toBe('Ohne Bestätigung starten')
    const tr = (key: string, vars: Record<string, string | number> = {}) => (de[key] ?? key).replace(/\{(\w+)\}/g, (_m, n: string) => String(vars[n] ?? ''))
    const o = { row: 'row', titleOf: (id: string) => (id === 'p1' ? 'Supportfall 4711' : '?') }
    nodeExpect(autoFallbackText([{ why: 'open', n: 2 }, { why: 'repo', step: 2 }], tr, o)).toBe('Nicht automatisch gestartet: 2 offene Punkte · Repo fehlt bei 02')
    nodeExpect(autoWhyText({ why: 'outside', page: 'p1', cls: 'mail' }, tr, o)).toBe('‹Supportfall 4711› stammt aus Mails')
    nodeExpect(autoWhyText({ why: 'outside', page: 'row', cls: 'foreign' }, tr, o)).toBe('der Auftrag wurde von außen geschrieben')
    nodeExpect(autoWhyText({ why: 'lapsed' }, tr, o)).toBe('Einstellungen geändert seit dem Einschalten — erneut einschalten')
    nodeExpect(autoFallbackText([], tr, o)).toBeNull()
  })
})

/* ================================================================== the app */

test.describe('orders auto — this device’s consent', () => {
  test.describe.configure({ mode: 'default' })
  let fake: FakeWorker | null = null
  test.afterEach(async () => {
    await fake?.close()
    fake = null
  })

  test('refused without a budget; refused with a fuse (the person’s server, Approvals “Plan and review”); allowed after “Allow this path”', async ({ page }) => {
    fake = await worker(['website'])
    await page.route(/\.example\.test\//, (r) => r.fulfill({ status: 200, body: 'ok' }))
    const { db, row } = await setup(page, { approvals: 'review', budget: null, server: true })
    await connected(page)
    await openRow(page, row)
    const settings = await openSettings(page)
    const auto = settings.getByTestId('order-auto')
    // no budget: the switch stays off and says why
    await expect(auto.getByTestId('order-auto-budget')).toHaveText('Set a budget per chain first')
    await expect(auto.getByRole('switch')).toBeDisabled()
    expect(await orders(page).autoOn(db)).toMatchObject({ ok: false, why: 'budget' })
    // a budget (the field in the same settings): the switch can be pressed
    const budget = settings.getByTestId('order-settings-budget')
    await budget.fill('5')
    await budget.press('Enter')
    await expect(auto.getByRole('switch')).toBeEnabled()
    // the Patchbay: with the consent the planner's path from the server's content runs into Claude Code unattended — a fuse
    await auto.getByRole('switch').click()
    const fuse = auto.getByTestId('order-auto-fuse').first()
    await expect(fuse).toBeVisible({ timeout: 20_000 })
    await expect(fuse).toContainText('Would trip a fuse:')
    await expect(fuse).toContainText('wissensbasis')
    await expect(fuse.getByTestId('order-auto-show')).toHaveText('Show in the Patchbay')
    expect(await orders(page).auto(db)).toBeNull()
    await expect(auto.getByRole('switch')).not.toBeChecked()
    // "Allow this path": the Patchbay's own key 3 on that path — then it switches on
    const n = await auto.getByTestId('order-auto-fuse').count()
    for (let i = 0; i < n + 2 && !(await orders(page).auto(db)); i++) {
      const next = auto.getByTestId('order-auto-fuse').first()
      if (!(await next.isVisible().catch(() => false))) break
      await next.getByTestId('order-auto-allow').click()
      await page.waitForTimeout(300)
    }
    await expect.poll(() => orders(page).auto(db), { timeout: 20_000 }).not.toBeNull()
    const consent = (await orders(page).auto(db)) as { sig: string }
    expect(consent.sig).toBe(await orders(page).autoSig(db))
    await expect(auto.getByRole('switch')).toBeChecked()
    await expect(auto.getByTestId('order-auto-on')).toBeVisible()
    // the rack now: the planner writes without a gate and every one of its fuses reads allowed
    const planner = moduleKey({ kind: 'planner', db })
    const fuses = await page.evaluate((key) => {
      const pb = (window as unknown as Seam).__onePatchbay
      pb.refresh()
      return (pb.model().fuses as AnyState[]).filter((f) => f.chain.decider === key).map((f) => f.allowed?.state ?? 'open')
    }, planner)
    expect(fuses.length).toBeGreaterThan(0)
    expect(fuses.every((s) => s === 'allowed')).toBe(true)
    expect(Object.keys(await wsEval(page, (s) => s.fuseSignoffs ?? {})).length).toBeGreaterThan(0)
    // off again: the person's switch; the Patchbay draws the planner by hand again
    await auto.getByRole('switch').click()
    await expect.poll(() => orders(page).auto(db)).toBeNull()
  })

  test('lapses when the settings change: the config, this device’s Approvals, a pipeline', async ({ page }) => {
    fake = await worker(['website'])
    const { db, row } = await setup(page)
    await connected(page)
    expect(await orders(page).autoOn(db)).toMatchObject({ ok: true })
    // 1) the config: "Stop after the analysis" switched off in the settings
    await openRow(page, row)
    const settings = await openSettings(page)
    await expect(settings.getByTestId('order-auto-on')).toBeVisible()
    await settings.locator('.ors__switch').first().getByRole('switch').click()
    await expect.poll(() => orders(page).auto(db)).toBeNull()
    expect(await orders(page).autoLapse(db)).not.toBeNull()
    await expect(settings.getByTestId('order-auto-lapsed')).toHaveText('Settings changed since you switched it on — switch it on again')
    // 2) on again, then this device's Approvals for new tasks
    expect(await orders(page).autoOn(db)).toMatchObject({ ok: true })
    await expect(settings.getByTestId('order-auto-on')).toBeVisible()
    await page.evaluate(() => (window as unknown as Seam).__oneCodingWrites.approvals('none'))
    await expect.poll(() => orders(page).auto(db)).toBeNull()
    // 3) on again, then a stage of the Coding project (its own setting — what the worker does)
    expect(await orders(page).autoOn(db)).toMatchObject({ ok: true })
    await wsEval(page, (s) => {
      const id = Object.values(s.databases as Record<string, AnyState>).find((d) => d.system === 'coding')!.id as string
      const stages = s.databases[id].pipeline as AnyState[]
      s.updateDatabase(id, { pipeline: stages.map((st, i) => (i === 1 ? { ...st, auto: !st.auto } : st)) })
    })
    await expect.poll(() => orders(page).auto(db)).toBeNull()
    // a consent given for other settings (a sig that is not theirs) lapses as soon as it is seen
    await orders(page).setAuto(db, { sig: 'c'.repeat(64), at: Date.now() })
    await expect.poll(() => orders(page).auto(db)).toBeNull()
    expect(await statusOf(page, row)).toBe(ST.draft)
  })

  test('a clean plan starts without ↵ — also one pressed while the worker was away (the line says it starts too)', async ({ page, errors }) => {
    // the worker is away at first: the link's own reconnect attempts
    errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
    const answer = (): ClaudeTurn => ({ blocks: [{ type: 'text', text: JSON.stringify(planWith()) }], usage: { input: 3200, output: 900 } })
    await mockClaudeScript(page, [], { fallback: answer() })
    const { db, row } = await setup(page)
    // no worker yet: the consent is given (it needs no worker), the press is kept
    expect(await orders(page).autoOn(db)).toMatchObject({ ok: true })
    await openRow(page, row)
    await pressPlan(page)
    await expect(page.getByTestId('order-pre')).toContainText('Plans and starts without confirming once the worker is back')
    // the worker comes back: the kept press plans (mode 'trigger') and the chain starts — no ↵
    fake = await worker(['website'])
    await connected(page)
    await expect.poll(async () => (await orders(page).record(row))?.state, { timeout: 30_000 }).toBe('running')
    expect(await statusOf(page, row)).toBe(ST.running)
    const rec = (await orders(page).record(row))!
    expect(rec.chain.steps).toHaveLength(3)
    expect(rec.draft.auto).toBeUndefined()
    await expect(page.locator('.toast').filter({ hasText: /chain started without confirming/ })).toBeVisible()
    // still the 10 s count — Z takes it back whole
    expect(await orders(page).undo(row)).toMatchObject({ ok: true })
    await expect.poll(() => statusOf(page, row)).toBe(ST.ready)
  })

  test('falls back to “Chain ready” and says why: an open point · a missing repo · another repo · a named branch', async ({ page }) => {
    test.setTimeout(180_000)
    let plan = planWith()
    await mockClaudeScript(page, [], { fallback: (() => ({ blocks: [{ type: 'text', text: JSON.stringify(plan) }], usage: { input: 3200, output: 900 } })) as never })
    fake = await worker(['website', 'shop'])
    const { db, row } = await setup(page)
    await connected(page)
    expect(await orders(page).autoOn(db)).toMatchObject({ ok: true })
    await openRow(page, row)
    const cases: Array<[(p: AnyState) => void, OrderAutoWhy, RegExp]> = [
      [(p) => (p.questions = ['Welche Sitzungsdauer ist gewünscht?']), { why: 'open', n: 1 }, /1 open point/],
      [(p) => (p.steps[1].repo = null), { why: 'repo', step: 2 }, /repo missing at 02/],
      [(p) => (p.steps[1].repo = 'shop'), { why: 'otherRepo', step: 2 }, /other repo at 02/],
      [(p) => (p.steps[1].branch = 'one/nordlicht-footer'), { why: 'branch', step: 2 }, /named branch at 02/],
    ]
    for (const [change, why, words] of cases) {
      plan = planWith(change)
      const before = (await orders(page).record(row))?.draft?.run ?? null
      await pressByStatus(page, row)
      await expect.poll(async () => ((await orders(page).record(row))?.draft?.run ?? null) !== before && (await reasonsOf(page, row)).length > 0, { timeout: 30_000 }).toBe(true)
      expect(await reasonsOf(page, row)).toContainEqual(why)
      const rec = (await orders(page).record(row))!
      expect(rec.state).toBe('draft')
      expect(await statusOf(page, row)).toBe(ST.ready)
      await expect(page.getByTestId('order-auto-fallback')).toContainText(words)
      await expect(page.getByTestId('order-auto-fallback')).toContainText('Not started automatically:')
    }
    // the consent stays (a fallback is no lapse); nothing was created
    expect(await orders(page).auto(db)).not.toBeNull()
    expect(await wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).filter((p) => p.title === 'Session-Timeout beheben').length)).toBe(0)
  })

  test('falls back on a page from mails and on a request an agent wrote', async ({ page }) => {
    await mockClaudeScript(page, [], { fallback: { blocks: [{ type: 'text', text: JSON.stringify(planWith()) }], usage: { input: 3200, output: 900 } } })
    fake = await worker(['website'])
    const { db, row } = await setup(page)
    await connected(page)
    // a mail of the Mails database the request links (the planner reads it; auto never starts on it)
    const mailRow = await wsEval(
      page,
      (s, a) => {
        const mails = s.createDatabase({ title: 'Mails', properties: [{ id: 'mlSubj', name: 'Betreff', type: 'title' }] })
        s.updateDatabase(mails, { system: 'mails' })
        const m = s.createRow(mails, { id: a.MAIL, title: 'Login bricht ab (Tessera)', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Mara Lind schreibt: seit gestern bricht der Login nach 30 s ab.' }] }] } })
        const body = [{ type: 'paragraph', content: [{ type: 'text', text: 'Prüfe den Abbruch beim Login nach 30 Sekunden, siehe ' }, { type: 'mention', attrs: { id: m, label: 'Login bricht ab (Tessera)', kind: 'page' } }, { type: 'text', text: '. Repo website.' }] }]
        return { m, row: s.createRow(a.db, { title: 'Login aus der Mail prüfen', properties: { woStatus: a.draft, woRepo: 'rWeb' }, content: { type: 'doc', content: body } }) }
      },
      { MAIL, db, draft: ST.draft },
    )
    // a request an agent filed (the press's provenance names the agent)
    await wsEval(page, (s, id) => s.updatePage(id, { updatedBy: 'agent:agTessera1' }), row)
    expect(await orders(page).autoOn(db)).toMatchObject({ ok: true })

    await openRow(page, mailRow.row)
    await pressPlan(page)
    await expect.poll(() => reasonsOf(page, mailRow.row), { timeout: 30_000 }).toContainEqual({ why: 'outside', page: MAIL, cls: 'mail' })
    expect((await orders(page).record(mailRow.row))!.state).toBe('draft')
    await expect(page.getByTestId('order-auto-fallback')).toContainText('‹Login bricht ab (Tessera)› comes from mails')

    await openRow(page, row)
    await pressPlan(page)
    await expect.poll(() => reasonsOf(page, row), { timeout: 30_000 }).toContainEqual({ why: 'outside', page: row, cls: 'foreign' })
    expect((await orders(page).record(row))!.state).toBe('draft')
    await expect(page.getByTestId('order-auto-fallback')).toContainText('the request was written from outside')
    expect(await statusOf(page, row)).toBe(ST.ready)
  })

  test('a restored backup never carries it: not in the file, and a restore drops this device’s consent', async ({ page, errors }, testInfo) => {
    // no worker here: the link's own reconnect attempts
    errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
    const { db } = await setup(page)
    expect(await orders(page).autoOn(db)).toMatchObject({ ok: true })
    const consent = (await orders(page).auto(db)) as { sig: string }
    const { json, file } = await exportBackup(page, testInfo, 'full.json')
    // the file: the work orders' settings (positive control), never the consent or its key
    const text = JSON.stringify(json)
    expect((json.workspace.databases as AnyState)[db].orders.budgetUsd).toBe(5)
    expect(text).not.toContain(consent.sig)
    expect(text).not.toContain('one.orders.auto')
    // a file that tries to bring one along in the config (an unknown key the reader keeps — nobody reads it as consent)
    const crafted = JSON.parse(JSON.stringify(json))
    ;(crafted.workspace.databases as AnyState)[db].orders.auto = { sig: consent.sig, at: Date.now() }
    const craftedFile = testInfo.outputPath('crafted.json')
    writeFileSync(craftedFile, JSON.stringify(crafted))
    // the restore of this device's own backup: the consent goes (the restored wiring is confirmed by hand again)
    await importBackup(page, file, 'replace')
    await expect.poll(() => orders(page).auto(db)).toBeNull()
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('one.orders.auto:')))).toEqual([])
    // the crafted one restored over a fresh consent: none either
    expect(await orders(page).autoOn(db)).toMatchObject({ ok: true })
    await importBackup(page, craftedFile, 'merge')
    await expect.poll(() => orders(page).auto(db)).toBeNull()
  })
})
