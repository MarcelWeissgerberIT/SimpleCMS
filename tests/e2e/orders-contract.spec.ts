/**
 * Work orders (Prüfaufträge) B1 — the contract: the config reader (bounds, unknown keys kept, a later version unreadable),
 * the plan / record limits, the chain roles on a project, the `order` writer and its recorder lane, the purpose
 * `coding.plan` and its run mode, and completeStructured's MCP part: `mcp: false` sends no server at all (also with a
 * server set to "All AI calls"), a pick sends exactly that server with its read tools only (OUT tools off, the "All AI
 * calls" one absent) — the planner's call in B5. Node cases first (no page), then the wire cases against a scripted
 * api.anthropic.com (nothing reaches a real host; the servers are fictional and never contacted).
 */
import { test as node, expect as nodeExpect } from '@playwright/test'
import { test, expect, openApp, wsEval } from './fixtures'
import { mockClaudeScript, text } from './helpers/providers'
import { expectGolden } from './helpers/golden'
import { BUDGET_RANGE, ORDER_KINDS, ORDER_STATUS_KEYS, newOrderConfig, orderCheckpoint, orderConfigUsable, readOrderConfig, sanitizeOrderConfig } from '../../src/app/features/coding/orders/config'
import { ORDER_LIMITS, PLAN_LIMITS, type OrderPlanV1, type OrderRecord } from '../../src/app/features/coding/orders/types'
import { chainRolesOf, isStepNamed } from '../../src/app/features/coding/orders/roles'
import { messages as codingMessages } from '../../src/app/features/coding/messages'
import { formatWriterKey, type Writer } from '../../src/app/store/writer'
import { laneOf, parseWriterKey, runKeyOf, runKindOf, runRefOf, segKeyOf } from '../../src/app/features/recorder/model/writerKeys'
import { laneMeta } from '../../src/app/features/recorder/ui/lanes'
import { messages as recorderMessages } from '../../src/app/features/recorder/messages'
import type { Translate } from '../../src/shared/i18n'
import { PURPOSES } from '../../src/app/features/ai/core/purposes'
import { CALLER_MODE, RUN_MODES, SOURCE_RE, minOut, missesMode, modeOf, sourceFor } from '../../src/app/features/governor/modes'
import { outToolsOf, sanitizeIntegration } from '../../src/app/store/integrations'
import type { Page as WsPage, PropertyDef, Workspace } from '../../src/app/store/types'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const STATUS = { draft: 'optDraft01', plan: 'optPlan001', ready: 'optReady01', running: 'optRun0001', halted: 'optHalt001', done: 'optDone001' }
const ok = (v: unknown) => {
  const r = sanitizeOrderConfig(v)
  if (r.kind !== 'ok') throw new Error(`not readable: ${r.kind}`)
  return r
}

/* ------------------------------------------------------------------ */
/* Database.orders — readOrderConfig                                    */
/* ------------------------------------------------------------------ */

node.describe('the config reader (Database.orders)', () => {
  node('only a work-orders database has one; a new one is readable as it is', () => {
    const config = newOrderConfig(STATUS)
    nodeExpect(readOrderConfig({ system: 'coding', orders: config })).toEqual({ kind: 'none' })
    nodeExpect(readOrderConfig({ orders: config })).toEqual({ kind: 'none' })
    nodeExpect(readOrderConfig(null)).toEqual({ kind: 'none' })
    nodeExpect(readOrderConfig({ system: 'workorders' })).toEqual({ kind: 'none' })
    const r = readOrderConfig({ system: 'workorders', orders: config })
    nodeExpect(r).toEqual({ kind: 'ok', config: { v: 1, status: STATUS, server: null, kinds: ['spec', 'coding', 'qa'], checkpoint: true }, missing: [], repaired: false })
    nodeExpect(orderConfigUsable(r)).toBe(true)
    nodeExpect(orderCheckpoint(r)).toBe(true)
    // the planner's order and the board's lanes
    nodeExpect([...ORDER_KINDS]).toEqual(['spec', 'coding', 'qa'])
    nodeExpect([...ORDER_STATUS_KEYS]).toEqual(['draft', 'plan', 'ready', 'running', 'halted', 'done'])
  })

  node('a full config round-trips: server by its name, pinned projects, the checkpoint off, a budget', () => {
    const full = { v: 1, status: STATUS, server: { name: 'wissensbasis' }, kinds: ['coding', 'qa'], projects: { coding: 'dbCoding0001', qa: 'dbQa0000001' }, checkpoint: false, budgetUsd: 12.5 }
    const r = ok(full)
    nodeExpect(r.config).toEqual(full)
    nodeExpect(r.repaired).toBe(false)
    nodeExpect(orderCheckpoint(r)).toBe(false)
  })

  node('bounds: status ids, kinds, projects, the server name, the checkpoint, the budget', () => {
    // a state without a valid option id is missing — never guessed; one option never serves two states
    const r1 = ok({ v: 1, status: { ...STATUS, ready: 'has space', done: STATUS.draft, halted: 7 }, server: null, kinds: ['spec', 'coding', 'qa'], checkpoint: true })
    nodeExpect(r1.missing).toEqual(['ready', 'halted', 'done'])
    nodeExpect(Object.keys(r1.config.status).sort()).toEqual(['draft', 'plan', 'running'])
    nodeExpect(r1.repaired).toBe(true)
    nodeExpect(orderConfigUsable(r1)).toBe(false)
    // kinds: known ones once each in the planner's order; nothing left → all three
    nodeExpect(ok({ v: 1, status: STATUS, server: null, kinds: ['qa', 'coding', 'qa', 'deploy'], checkpoint: true }).config.kinds).toEqual(['coding', 'qa'])
    nodeExpect(ok({ v: 1, status: STATUS, server: null, kinds: [], checkpoint: true }).config.kinds).toEqual(['spec', 'coding', 'qa'])
    nodeExpect(ok({ v: 1, status: STATUS, server: null, kinds: 'coding', checkpoint: true }).config.kinds).toEqual(['spec', 'coding', 'qa'])
    // projects: known kinds with valid ids only
    nodeExpect(ok({ v: 1, status: STATUS, server: null, kinds: ['coding'], projects: { coding: 'dbCoding0001', deploy: 'dbX00000001', qa: '../x' }, checkpoint: true }).config.projects).toEqual({ coding: 'dbCoding0001' })
    nodeExpect(ok({ v: 1, status: STATUS, server: null, kinds: ['coding'], projects: { deploy: 'x' }, checkpoint: true }).config).not.toHaveProperty('projects')
    // the server: a valid MCP server name, nothing else of it; junk → without a server
    nodeExpect(ok({ v: 1, status: STATUS, server: { name: 'wissensbasis', url: 'https://kb.example.test/mcp', token: 'x' }, kinds: ['coding'], checkpoint: true }).config.server).toEqual({ name: 'wissensbasis' })
    for (const server of [{ name: 'Wissens Basis' }, { name: '' }, 'wissensbasis', { name: 'x'.repeat(33) }]) nodeExpect(ok({ v: 1, status: STATUS, server, kinds: ['coding'], checkpoint: true }).config.server, JSON.stringify(server)).toBeNull()
    // the checkpoint stays on unless stored as false
    for (const checkpoint of [undefined, 'false', 0, null]) nodeExpect(ok({ v: 1, status: STATUS, server: null, kinds: ['coding'], checkpoint }).config.checkpoint, String(checkpoint)).toBe(true)
    // the budget: clamped into its range; junk dropped
    const budget = (budgetUsd: unknown) => ok({ v: 1, status: STATUS, server: null, kinds: ['coding'], checkpoint: true, budgetUsd }).config.budgetUsd
    nodeExpect(budget(0)).toBe(BUDGET_RANGE[0])
    nodeExpect(budget(-5)).toBe(BUDGET_RANGE[0])
    nodeExpect(budget(1e9)).toBe(BUDGET_RANGE[1])
    nodeExpect(budget(3.75)).toBe(3.75)
    nodeExpect(budget('3')).toBeUndefined()
    nodeExpect(budget(Number.NaN)).toBeUndefined()
  })

  node('unknown keys are kept (≤ 4 KB); a junk version reads as 1; a later version is unreadable and acts on nothing', () => {
    const later = { lanes: { compact: true }, note: 'Nordlicht' }
    const r = ok({ v: 1, status: STATUS, server: null, kinds: ['coding'], checkpoint: true, ...later })
    nodeExpect(r.config).toMatchObject(later)
    nodeExpect(r.repaired).toBe(false)
    // too much unknown data: dropped as a whole, the known part stays
    const big = ok({ v: 1, status: STATUS, server: null, kinds: ['coding'], checkpoint: true, blob: 'x'.repeat(5000) })
    nodeExpect(big.config).not.toHaveProperty('blob')
    nodeExpect(big.repaired).toBe(true)
    // a junk / absent version: read as 1
    for (const v of [undefined, '2', 0, null]) nodeExpect(sanitizeOrderConfig({ v, status: STATUS, server: null, kinds: ['coding'], checkpoint: true }).kind, String(v)).toBe('ok')
    // v 2: unreadable — no auto, the checkpoint on (never what it stored), never used
    const v2 = readOrderConfig({ system: 'workorders', orders: { v: 2, status: STATUS, server: null, kinds: ['coding'], checkpoint: false } as never })
    nodeExpect(v2).toEqual({ kind: 'unreadable' })
    nodeExpect(orderCheckpoint(v2)).toBe(true)
    nodeExpect(orderConfigUsable(v2)).toBe(false)
    nodeExpect(sanitizeOrderConfig('workorders')).toEqual({ kind: 'none' })
    nodeExpect(sanitizeOrderConfig([STATUS])).toEqual({ kind: 'none' })
  })
})

/* ------------------------------------------------------------------ */
/* Plan + record limits, chain roles                                    */
/* ------------------------------------------------------------------ */

node.describe('plan limits, the record, the chain roles', () => {
  node('the plan and request limits are the spec\'s (§2.7, §2.11)', () => {
    nodeExpect(PLAN_LIMITS).toMatchObject({ summary: 600, contextNote: 2000, steps: 6, codingSteps: 3, title: 200, goal: 2000, criteria: 10, criterion: 300, why: 300, refs: 8, questions: 5, question: 300, refused: 300 })
    nodeExpect(ORDER_LIMITS).toMatchObject({ requestChars: 40_000, linkedPages: 8, linkedChars: 20_000, serverCalls: 6, quoteChars: 4_000, basisChars: 20_000, runsPerRow: 1, runsPerTab: 3, rowsPerCommand: 5, startDelayMs: 10_000, minWords: 40 })
    nodeExpect(ORDER_LIMITS.wantMs).toBe(24 * 3600_000)
    nodeExpect(ORDER_LIMITS.keepMs).toBe(30 * 24 * 3600_000)
    // the shapes compile as the spec writes them (a typed plan and a running chain on this device)
    const plan: OrderPlanV1 = {
      v: 1,
      summary: 'Der Login bricht nach 30 s ab.',
      context: { server: 'wissensbasis', note: 'Supportfall 4711: Timeout im Login.', links: ['https://kb.example.test/r/4711'] },
      steps: [{ kind: 'spec', title: 'Login-Timeout klären', goal: 'Ursache finden.', criteria: ['Ursache benannt'], repo: null, branch: null, priority: 'high', refs: [], why: 'Unklar, wo der Timeout entsteht.' }],
      questions: [],
      refused: null,
    }
    const record: OrderRecord = {
      v: 1,
      state: 'running',
      chain: { run: 'run1', confirmedAt: 1, startAt: 10_001, steps: [{ n: 1, id: 'task00000001', kind: 'spec', project: 'dbSpec000001', line: 'Backlog → Spec', approvals: 'review', refs: {}, basisBlock: null }], doneBy: { 1: { kind: 'coding', at: 2 } }, halted: null, checkpoint: true },
    }
    nodeExpect(plan.steps).toHaveLength(1)
    nodeExpect(record.chain!.steps[0]!.n).toBe(1)
  })

  node('roles: the Prüfauftrag relation only by its target, Schritt only by name and only beside it', () => {
    const stepNames = [codingMessages.en['features.coding.prop.step']!, codingMessages.de['features.coding.prop.step']!].map((n) => n.toLowerCase())
    nodeExpect(stepNames).toEqual(['step', 'schritt'])
    const orders = (id: string) => id === 'dbOrders0001'
    const prop = (id: string, name: string, type: PropertyDef['type'], extra: Partial<PropertyDef> = {}): PropertyDef => ({ id, name, type, ...extra }) as PropertyDef
    const named = prop('pRel1', 'Prüfauftrag', 'relation', { relationDatabaseId: 'dbOther0001' })
    const real = prop('pRel2', 'Herkunft', 'relation', { relationDatabaseId: 'dbOrders0001' })
    const step = prop('pStep', 'Schritt', 'number')
    const cost = prop('pCost', 'Ausgaben', 'number')
    // a relation named like the role but pointing elsewhere is not it; one to a work-orders database is, whatever its name
    nodeExpect(chainRolesOf([named, step], orders, stepNames)).toEqual({})
    nodeExpect(chainRolesOf([named, cost, real, step], orders, stepNames)).toEqual({ order: 'pRel2', step: 'pStep' })
    // Schritt only by name (a number of another name is not it) and only next to the relation
    nodeExpect(chainRolesOf([real, cost], orders, stepNames)).toEqual({ order: 'pRel2' })
    nodeExpect(chainRolesOf([step, cost], orders, stepNames)).toEqual({})
    // the Cost fallback's guard: a number named Step / Schritt (any case, trimmed)
    nodeExpect(isStepNamed({ name: ' SCHRITT ' }, stepNames)).toBe(true)
    nodeExpect(isStepNamed({ name: 'Step' }, stepNames)).toBe(true)
    nodeExpect(isStepNamed({ name: 'Ausgaben' }, stepNames)).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* The order writer + its recorder lane                                 */
/* ------------------------------------------------------------------ */

node.describe('the order writer', () => {
  node('keys: order:<row>:<run>[#c<n> | #a<n> | #s]; invalid ids become "-"', () => {
    const cases: Array<[Writer, string]> = [
      [{ kind: 'order', row: 'rowPA0000012', run: 'or1' }, 'order:rowPA0000012:or1'],
      [{ kind: 'order', row: 'rowPA0000012', run: 'or1', change: 'c3' }, 'order:rowPA0000012:or1#c3'],
      [{ kind: 'order', row: 'rowPA0000012', run: 'or1', change: 'a2' }, 'order:rowPA0000012:or1#a2'],
      [{ kind: 'order', row: 'rowPA0000012', run: 'or1', change: 's' }, 'order:rowPA0000012:or1#s'],
      [{ kind: 'order', row: 'has space', run: 'or1', change: 'c1+c2' }, 'order:-:or1#-'],
    ]
    for (const [w, key] of cases) nodeExpect(formatWriterKey(w)).toBe(key)
  })

  node('parse, lane, run and segment: one lane per request, one run per chain', () => {
    const key = 'order:rowPA0000012:or1#c3'
    nodeExpect(parseWriterKey(key)).toMatchObject({ kind: 'order', parts: ['rowPA0000012', 'or1'], change: 'c3' })
    nodeExpect(laneOf(key)).toBe('order:rowPA0000012')
    nodeExpect(runKeyOf(key)).toBe('order:rowPA0000012:or1')
    nodeExpect(segKeyOf('order:rowPA0000012:or1#a2')).toBe('order:rowPA0000012:or1')
    nodeExpect(runKindOf('order:rowPA0000012:or1')).toBe('order')
    nodeExpect(runRefOf('order:rowPA0000012:or1')).toBe('or1')
  })

  node('the recorder labels it "Prüfauftrag · <title>" — never a private row\'s title', () => {
    const page = (id: string, title: string, o: Partial<WsPage> = {}) => ({ id, title, ...o }) as WsPage
    const pages = { rowPA0000012: page('rowPA0000012', 'Login-Timeout prüfen'), rowPA0000013: page('rowPA0000013', 'Tessera intern', { private: true }) } as unknown as Workspace['pages']
    const ws = { agents: {}, scripts: {}, databases: {}, settings: {} as Workspace['settings'], pages } as unknown as Parameters<typeof laneMeta>[2]
    // the recorder's own strings (src/shared/i18n is not for Node: it reads the build's base path)
    const tr = (lang: 'en' | 'de') => ((key: string) => (recorderMessages[lang] as Record<string, string>)[key] ?? key) as Translate
    const de = tr('de')
    const en = tr('en')
    nodeExpect(laneMeta('order:rowPA0000012', de, ws).title).toBe('Prüfauftrag · Login-Timeout prüfen')
    nodeExpect(laneMeta('order:rowPA0000012', en, ws).title).toBe('Work order · Login-Timeout prüfen')
    nodeExpect(laneMeta('order:rowPA0000013', de, ws).title).toBe('Prüfauftrag')
    nodeExpect(laneMeta('order:rowGone00001', de, ws).title).toBe('Prüfauftrag · gelöscht')
    nodeExpect(laneMeta('order:rowPA0000012', de, { ...ws, pages: undefined }).title).toBe('Prüfauftrag')
  })
})

/* ------------------------------------------------------------------ */
/* The purpose and its run mode                                         */
/* ------------------------------------------------------------------ */

node.describe('purpose coding.plan', () => {
  node('class terminal, needs rows + structure, may page / private / mcp, a structured answer', () => {
    const d = PURPOSES['coding.plan']
    nodeExpect({ cls: d.cls, needs: [...d.needs], may: [...d.may], caps: [...d.caps], pageless: d.pageless }).toEqual({ cls: 'terminal', needs: ['rows', 'structure'], may: ['page', 'private', 'mcp'], caps: ['structured'], pageless: false })
  })

  node('run mode: the caller says (manual · trigger), never capped, source order:<row>:<run>', () => {
    nodeExpect(RUN_MODES['coding.plan']).toEqual({ mode: 'caller', answer: 'structured', series: 'order' })
    nodeExpect(CALLER_MODE).toContain('coding.plan')
    nodeExpect(missesMode('coding.plan')).toBe(true)
    nodeExpect(missesMode('coding.plan', 'manual')).toBe(false)
    nodeExpect(modeOf('coding.plan', 'trigger')).toBe('trigger')
    // without a mode it never asks
    nodeExpect(modeOf('coding.plan')).toBe('trigger')
    nodeExpect(minOut('coding.plan', true)).toBeNull()
    const src = sourceFor('coding.plan', 'rowPA0000012:or1')
    nodeExpect(src).toBe('order:rowPA0000012:or1')
    nodeExpect(src).toMatch(SOURCE_RE)
  })
})

/* ------------------------------------------------------------------ */
/* completeStructured: no pick → no server; a pick → exactly that one   */
/* ------------------------------------------------------------------ */

/** The person's own servers here (fictional): "Wissensbasis" (free-form requests only) and a server for all AI calls. */
const KB = { id: 'srvkb000001', name: 'wissensbasis', url: 'https://kb.example.test/mcp', token: 'kb-e2e-PLAINTEXT-token-0001', enabled: true, prompt: '**Wissensbasis** holds the support records.', promptSource: 'auto', tools: ['kb_search', 'kb_get', 'kb_post_note'], checkedAt: 1 }
const ALL = { id: 'srvall00001', name: 'tessera', url: 'https://tessera.example.test/mcp', token: 'tessera-e2e-PLAINTEXT-token-0001', enabled: true, scope: 'all', prompt: '**Tessera** is the team archive.', promptSource: 'auto', tools: ['tessera_find'], checkedAt: 1 }
/** a profile that marks Wissensbasis' note tool as a send route (OUT on every request) */
const PROFILE = {
  schema: 'one.integration/1',
  id: 'kbprofile01',
  name: 'Wissensbasis',
  match: { name: 'wissensbasis' },
  reads: ['kb_search', 'kb_get'],
  sends: [{ id: 'note', role: 'reply', label: { en: 'Add a note', de: 'Notiz anlegen' }, tool: 'kb_post_note', args: { ref: '{key}', body: '{draft}' }, params: [{ name: 'draft', type: 'text', max: 4000 }] }],
}
/** The planner's purpose with what it reads (a request row + the catalogue's database) and its run (manual, source order:…). */
async function plannerQ(page: import('@playwright/test').Page): Promise<AnyState> {
  const { row, db } = await wsEval(page, (s) => {
    const db = Object.values(s.databases as Record<string, AnyState>).find((d) => Object.values(s.pages as Record<string, AnyState>).some((p) => p.databaseId === d.id && !p.trashed))!
    const row = Object.values(s.pages as Record<string, AnyState>).find((p) => p.databaseId === db.id && !p.trashed)!
    return { row: row.id as string, db: db.id as string }
  })
  return { purpose: 'coding.plan', prompt: 'Was steht im Supportfall 4711?', structured: true, sources: [{ row }, { db }], run: { mode: 'manual', source: `order:${row}:or1` } }
}
const answer = () => text(JSON.stringify({ answer: 'Ein Timeout im Login.' }))
type Seam = { __oneAI: { ask(o: AnyState): Promise<AnyState> } }
const ask = (page: import('@playwright/test').Page, o: AnyState) => page.evaluate((o) => (window as unknown as Seam).__oneAI.ask(o), o)

node('the fixture: the profile makes the note tool OUT on Wissensbasis (and only there)', () => {
  const p = sanitizeIntegration(PROFILE)
  nodeExpect(p).not.toBeNull()
  nodeExpect(outToolsOf([p!], { name: KB.name, url: KB.url })).toEqual(['kb_post_note'])
  nodeExpect(outToolsOf([p!], { name: ALL.name, url: ALL.url })).toEqual([])
})

test.describe('completeStructured: the MCP part of a structured request', () => {
  test('no pick (mcp: false) sends no server — not even one set to "All AI calls"; the default still takes that one (positive control)', async ({ page }) => {
    const { requests } = await mockClaudeScript(page.context(), [answer(), answer(), answer()])
    await openApp(page)
    await wsEval(page, (s, list) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', mcpServers: list }), [KB, ALL])
    const Q = await plannerQ(page)
    expect(await ask(page, { ...Q, mcp: false })).toMatchObject({ ok: true, text: expect.stringContaining('Timeout') })
    expect(requests).toHaveLength(1)
    expect(requests[0].body.mcp_servers).toBeUndefined()
    expect(requests[0].body.tools).toBeUndefined()
    // a pick with mcp: false said outright: still no server
    expect(await ask(page, { ...Q, mcp: false, pick: { server: 'wissensbasis', reads: ['kb_search'] } })).toMatchObject({ ok: true })
    expect(requests).toHaveLength(2)
    expect(requests[1].body.mcp_servers).toBeUndefined()
    // positive control: the default ('fixed') takes the "All AI calls" server
    expect(await ask(page, { ...Q, mcp: 'fixed' })).toMatchObject({ ok: true })
    expect(requests).toHaveLength(3)
    expect((requests[2].body.mcp_servers as AnyState[]).map((s) => s.name)).toEqual(['tessera'])
  })

  test('a pick: exactly that server with only its read tools — the "All AI calls" server absent, an OUT tool off even when listed', async ({ page }) => {
    const { requests } = await mockClaudeScript(page.context(), [answer()])
    await openApp(page)
    await wsEval(page, (s, a) => {
      s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', mcpServers: a.list })
      s.upsertIntegration(a.profile)
    }, { list: [KB, ALL], profile: PROFILE })
    const Q = await plannerQ(page)
    // the picked server is free-form only: forced in all the same; the note tool is OUT (a send route) and stays off
    const got = await ask(page, { ...Q, pick: { server: 'wissensbasis', reads: ['kb_search', 'kb_get', 'kb_post_note'] } })
    expect(got, JSON.stringify(got)).toMatchObject({ ok: true })
    expect(requests).toHaveLength(1)
    const body = requests[0].body
    expect((body.mcp_servers as AnyState[]).map((s) => s.name)).toEqual(['wissensbasis'])
    expect(body.mcp_servers[0].authorization_token).toBe(KB.token)
    expect(JSON.stringify(body)).not.toContain('tessera')
    // picked in a setting, not addressed in the request: no codeword note
    expect(body.system).not.toContain('<mcp_codeword>')
    const toolset = (body.tools as AnyState[]).find((x) => x.mcp_server_name === 'wissensbasis')
    expect(toolset.default_config).toEqual({ enabled: false })
    // every tool off by default, only the read tools on — the OUT tool is not among them although the pick listed it
    expect(toolset.configs).toEqual({ kb_search: { enabled: true }, kb_get: { enabled: true } })
    // the exact body of the planner's MCP part (helpers/golden.ts; GOLDEN_WRITE=1 wrote it once) — the model is this
    // device's default (any), the rest byte for byte
    expect(typeof body.model).toBe('string')
    expectGolden('orders-structured-pick', requests.map((r) => ({ ...r, body: { ...r.body, model: '<default>' } })))
  })

  test('a picked server that is not enabled here is no request at all', async ({ page }) => {
    const { requests } = await mockClaudeScript(page.context(), [answer()])
    await openApp(page)
    await wsEval(page, (s, list) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', mcpServers: list }), [{ ...KB, enabled: false }, ALL])
    const Q = await plannerQ(page)
    expect(await ask(page, { ...Q, pick: { server: 'wissensbasis', reads: ['kb_search'] } })).toMatchObject({ ok: false, code: 'contract' })
    await page.waitForTimeout(300)
    expect(requests).toHaveLength(0)
  })
})
