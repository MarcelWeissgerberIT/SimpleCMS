/**
 * Work orders (Prüfaufträge) B5 — the planner in the app (a fake worker on CODING_E2E_PORT, api.anthropic.com scripted;
 * the server "Wissensbasis" is fictional and never contacted — Anthropic would call it, the script plays its blocks):
 *  - a pick: the request body holds EXACTLY that server with its READ tools (default off, OUT tool absent), never the
 *    "All AI calls" server; the system prompt names it by the person's name; the call list, the draft (hash, receipt,
 *    provenance pins, tools, left-out tools), links to pages the request does not link turned into text, Status → Kette
 *    bereit (written by the order writer); the request's golden body;
 *  - no pick: no server at all — not the "All AI calls" one either; an untested pick: no server, the reason noted;
 *  - nothing is sent for a key typed into the request, an empty request, Coding off, no worker;
 *  - a malformed answer: ONE repair round, without the server, then the plan;
 *  - questions: the draft holds them, the Status stays Planen; the answers go under "Answers" into the row (the person's
 *    write) and the request is planned again with them;
 *  - the Regler: a manual run at the line asks (the brake with E / B, nothing sent; E's retry plans), a deferred run
 *    ('trigger') holds — one info toast, Status Planen, nothing sent.
 * Fictional data only (Nordlicht, Tessera, Mara Lind, Wissensbasis).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval } from './fixtures'
import { mockClaudeScript, type ClaudeTurn } from './helpers/providers'
import { startFakeWorker, type FakeWorker } from './helpers/fakeWorker'
import { expectGolden } from './helpers/golden'
import { budget } from './helpers/governor'
import { WORKER_CAN, type WorkerInfo } from '../../src/app/features/coding/protocol'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** CODING_E2E_PORT: one port for the coding suites when they run side by side (one worker at a time) */
const PORT = Number(process.env.CODING_E2E_PORT) || 47384
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
/** The person's own servers (fictional): Wissensbasis (free-form only, tested) and one set to "All AI calls". */
const KB = { id: 'srvkb000001', name: 'wissensbasis', url: 'https://kb.example.test/mcp', token: 'kb-e2e-PLAINTEXT-token-0001', enabled: true, prompt: '**Wissensbasis** holds the support records.', promptSource: 'auto', tools: ['kb_search', 'kb_get', 'kb_post_note', 'kb_delete_record'], checkedAt: 1 }
const ALL = { id: 'srvall00001', name: 'tessera', url: 'https://tessera.example.test/mcp', token: 'tessera-e2e-PLAINTEXT-token-0001', enabled: true, scope: 'all', prompt: '**Tessera** is the team archive.', promptSource: 'auto', tools: ['tessera_find'], checkedAt: 1 }
/** the note tool is a send route (OUT on every request) */
const PROFILE = {
  schema: 'one.integration/1',
  id: 'kbprofile01',
  name: 'Wissensbasis',
  match: { name: 'wissensbasis' },
  reads: ['kb_search', 'kb_get'],
  sends: [{ id: 'note', role: 'reply', label: { en: 'Add a note', de: 'Notiz anlegen' }, tool: 'kb_post_note', args: { ref: '{key}', body: '{draft}' }, params: [{ name: 'draft', type: 'text', max: 4000 }] }],
}
const WELCOME: WorkerInfo = { worker: '1.11.0', name: 'website-box', repos: [{ name: 'website', baseBranch: 'main', branches: ['main', 'one/nordlicht-footer', 'feature/login'], mcp: ['docs'] }], parallel: 1, busy: [], spentToday: 0, dayLimit: null, claude: { found: true, version: '2.0.0' }, setup: true, mcp: [] }
const REQUEST = 'Prüfe, warum der Login von Nordlicht nach 30 Sekunden abbricht. Siehe '

type Seam = { __oneOrders: Record<string, (...a: any[]) => Promise<AnyState>>; __onePreflight: { stores: { coding: { getState: () => AnyState } } }; __oneGovernor: Record<string, (...a: any[]) => any> } // eslint-disable-line @typescript-eslint/no-explicit-any
const orders = (page: Page) => ({
  plan: (row: string, o: AnyState = { mode: 'manual' }) => page.evaluate(([r, x]) => (window as unknown as Seam).__oneOrders.plan(r, x), [row, o] as const),
  answer: (row: string, a: AnyState[]) => page.evaluate(([r, x]) => (window as unknown as Seam).__oneOrders.answer(r, x), [row, a] as const),
  record: (row: string) => page.evaluate((r) => (window as unknown as Seam).__oneOrders.record(r), row),
  run: (row: string) => page.evaluate((r) => (window as unknown as Seam).__oneOrders.run(r), row),
  retryWith: (row: string, token: string) => page.evaluate(([r, x]) => (window as unknown as Seam).__oneOrders.retryWith(r, x), [row, token] as const),
})

/** The planner's answer: the fixture's plan (ids filled in), with the server's blocks before it when `calls`. */
function answer(o: { calls?: boolean; plan?: AnyState } = {}): ClaudeTurn {
  const plan = o.plan ?? JSON.parse(JSON.stringify(FIXTURE.plan).split('{{case}}').join(CASE).split('{{other}}').join(OTHER))
  const blocks: ClaudeTurn['blocks'] = []
  if (o.calls) for (const c of FIXTURE.calls) blocks.push({ type: 'mcp_tool_use', id: c.id, server: c.server, name: c.name, input: c.input }, { type: 'mcp_tool_result', id: c.id, text: c.result })
  blocks.push({ type: 'text', text: JSON.stringify(plan) })
  return { blocks, usage: { input: 3200, output: 900 } }
}
const withoutContext = () => ({ ...JSON.parse(JSON.stringify(FIXTURE.plan).split('{{case}}').join(CASE).split('{{other}}').join(OTHER)), context: null })

/** Coding on (this device), the fake worker, the AI key, the servers + profile, a work-orders database with one request. */
async function setup(page: Page, o: { server?: string | null; kb?: AnyState; text?: string; coding?: boolean } = {}) {
  if (o.coding !== false) await page.addInitScript((port) => localStorage.setItem('one.coding', JSON.stringify({ enabled: true, port })), PORT)
  await openApp(page)
  await wsEval(page, (s, a) => {
    s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', mcpServers: a.list })
    s.upsertIntegration(a.profile)
  }, { list: [{ ...KB, ...(o.kb ?? {}) }, ALL], profile: PROFILE })
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
      s.updateDatabase(db, { system: 'workorders', orders: { v: 1, status: a.ST, server: a.server ? { name: a.server } : null, kinds: ['spec', 'coding', 'qa'], checkpoint: true } })
      const body = a.text === undefined ? [{ type: 'paragraph', content: [{ type: 'text', text: a.REQUEST }, { type: 'mention', attrs: { id: a.CASE, label: 'Supportfall 4711', kind: 'page' } }, { type: 'text', text: '. Repo website.' }] }] : [{ type: 'paragraph', content: a.text ? [{ type: 'text', text: a.text }] : [] }]
      const row = s.createRow(db, { title: 'Login-Timeout prüfen', properties: { woStatus: a.ST.plan, woRepo: 'rWeb' }, content: { type: 'doc', content: body } })
      return { db, row }
    },
    { CASE, OTHER, ST, statusOptions, server: o.server === undefined ? 'wissensbasis' : o.server, text: o.text, REQUEST },
  )
  if (o.coding !== false) await expect.poll(() => page.evaluate(() => (window as unknown as Seam).__onePreflight.stores.coding.getState().conn), { timeout: 15_000 }).toBe('connected')
  return ids
}

const statusOf = (page: Page, row: string) => wsEval(page, (s, id) => s.pages[id].properties.woStatus as string, row)
const toolsetOf = (body: AnyState, name: string) => (body.tools as AnyState[] | undefined)?.find((x) => x.mcp_server_name === name)

test.describe('the work-order planner', () => {
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

  test('a pick: exactly that server with its READ tools (OUT off, the "All AI calls" server absent); the calls, the draft, Status → Kette bereit', async ({ page }) => {
    const { requests } = await mockClaudeScript(page.context(), [answer({ calls: true })])
    const { row, db } = await setup(page)
    const out = await orders(page).plan(row)
    expect(out, JSON.stringify(out)).toMatchObject({ kind: 'ready', steps: 3 })
    expect(requests).toHaveLength(1)
    const body = requests[0]!.body
    // exactly the picked server, its token, its read tools only — never "tessera" (All AI calls)
    expect((body.mcp_servers as AnyState[]).map((s) => s.name)).toEqual(['wissensbasis'])
    expect(body.mcp_servers[0].authorization_token).toBe(KB.token)
    expect(JSON.stringify(body)).not.toContain('tessera_find')
    expect(JSON.stringify(body)).not.toContain(ALL.url)
    const ts = toolsetOf(body, 'wissensbasis')
    expect(ts.default_config).toEqual({ enabled: false })
    expect(ts.configs).toEqual({ kb_search: { enabled: true }, kb_get: { enabled: true } })
    // the system prompt names the server by the person's name, asks for read tools only, at most 6 calls
    expect(body.system).toContain('The MCP server "wissensbasis": the person\'s own server, with read tools only.')
    expect(body.system).toContain('at most 6 calls')
    expect(body.system).not.toContain('<mcp_codeword>')
    // the request as material: the row, its linked page by id, the catalogue
    const prompt = (body.messages as AnyState[])[0].content as string
    expect(prompt).toContain('<request title="Login-Timeout prüfen">')
    expect(prompt).toContain('Repo: website')
    expect(prompt).toContain(`<page id="${CASE}" title="Supportfall 4711">`)
    expect(prompt).not.toContain(OTHER)
    expect(prompt).toContain('<pipeline kind="spec"')
    expect(prompt).toContain('website · base branch main · branches: one/nordlicht-footer, feature/login · Claude Code reads itself: docs')
    // the golden body of the planner's request (model and ids normalised)
    expectGolden('orders-planner-pick', requests.map((r) => ({ ...r, body: { ...r.body, model: '<default>' } })), { ids: [row, db, CASE, OTHER] })

    // the draft on this device: the plan made safe, the server's part, provenance, the receipt
    const rec = await orders(page).record(row)
    expect(rec.state).toBe('draft')
    const d = rec.draft
    expect(d.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(d.plan.steps.map((s: AnyState) => s.kind)).toEqual(['spec', 'coding', 'qa'])
    // the page the request does not link: dropped from refs, its link plain text
    expect(d.plan.steps[0].refs).toEqual([CASE])
    expect(d.plan.steps[0].goal).toContain(`[Supportfall 4711](#/p/${CASE})`)
    expect(d.plan.steps[0].goal).toContain('Nicht: Tessera intern.')
    expect(JSON.stringify(d.plan)).not.toContain(OTHER)
    expect(d.notes).toEqual([
      { kind: 'refs', step: 1, count: 1 },
      { kind: 'links', step: 1, count: 1 },
    ])
    expect(d.plan.context).toEqual({ server: 'wissensbasis', note: FIXTURE.plan.context.note, links: ['https://kb.example.test/r/4711'] })
    expect(d.source.server).toBe('wissensbasis')
    expect(d.source.tools).toEqual(['kb_search', 'kb_get'])
    expect(d.source.left).toEqual([
      { tool: 'kb_post_note', why: 'out' },
      { tool: 'kb_delete_record', why: 'notRead' },
    ])
    expect(d.source.calls).toEqual([{ tool: 'kb_search', args: '"query":"Supportfall 4711"', bytes: new TextEncoder().encode(FIXTURE.calls[0].result).length, ok: true }])
    expect(Object.keys(d.source.prov).sort()).toEqual([CASE, row].sort())
    expect(d.source.pins[row]).toBe(d.source.prov[row].contentRev)
    expect(d.receipt).not.toBeNull()
    // Status → Kette bereit, written by the order writer (never `you`: it plans nothing again)
    expect(await statusOf(page, row)).toBe(ST.ready)
    const run = await orders(page).run(row)
    expect(run).toMatchObject({ phase: 'done', server: 'wissensbasis', read: { pages: 1, cut: false }, outcome: { kind: 'ready' } })
  })

  test('no pick: no server at all — not even the one set to "All AI calls"; an untested pick: no server, and why', async ({ page }) => {
    const { requests } = await mockClaudeScript(page.context(), [answer({ plan: withoutContext() }), answer({ plan: withoutContext() })])
    const { row } = await setup(page, { server: null })
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'ready' })
    expect(requests).toHaveLength(1)
    expect(requests[0]!.body.mcp_servers).toBeUndefined()
    expect(requests[0]!.body.tools).toBeUndefined()
    expect(JSON.stringify(requests[0]!.body)).not.toContain('tessera')
    expect(requests[0]!.body.system).toContain('"context": null.')
    expect((await orders(page).record(row)).draft.source).toMatchObject({ server: null, tools: [], calls: [] })

    // the pick never tested on this device: the request goes without it, the plate can say why ("Server testen")
    await wsEval(page, (s, kb) => s.updateSettings({ mcpServers: [{ ...kb, tools: [], checkedAt: undefined }] }), KB)
    await wsEval(page, (s, db) => s.updateDatabase(db, { orders: { ...s.databases[db].orders, server: { name: 'wissensbasis' } } }), (await wsEval(page, (s, id) => s.pages[id].databaseId as string, row)))
    expect(await orders(page).plan(row, { mode: 'manual', replace: true })).toMatchObject({ kind: 'ready' })
    expect(requests).toHaveLength(2)
    expect(requests[1]!.body.mcp_servers).toBeUndefined()
    expect(await orders(page).run(row)).toMatchObject({ server: null, skip: { server: 'wissensbasis', why: 'untested' } })
    expect((await orders(page).record(row)).draft.source.skip).toEqual({ server: 'wissensbasis', why: 'untested' })
  })

  test('nothing is sent: a key typed into the request, an empty request', async ({ page, aiNet }) => {
    const { requests } = await mockClaudeScript(page.context(), [answer()])
    const { row } = await setup(page, { text: 'Prüfe den Login, der Schlüssel ist sk-ant-api03-NORDLICHTKEY0123456789 im Wiki.' })
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'blocked', block: { why: 'refused', code: 'key_in_text' } })
    // an empty request (a title, no text): said, nothing sent
    await wsEval(page, (s, id) => s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Login?' }] }] }, 'e2e'), row)
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'blocked', block: { why: 'empty' } })
    await page.waitForTimeout(300)
    expect(requests).toHaveLength(0)
    expect(aiNet.count('anthropic')).toBe(0)
    expect(await orders(page).record(row)).toBeNull()
    expect(await statusOf(page, row)).toBe(ST.plan)
  })

  test('a malformed answer: one repair round, without the server, then the plan', async ({ page }) => {
    const bad: ClaudeTurn = { blocks: [{ type: 'text', text: JSON.stringify({ ...FIXTURE.plan, steps: Array.from({ length: 7 }, () => FIXTURE.plan.steps[1]) }) }] }
    const { requests } = await mockClaudeScript(page.context(), [bad, answer({ plan: withoutContext() })])
    const { row } = await setup(page)
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'ready', steps: 3 })
    expect(requests).toHaveLength(2)
    expect((requests[0]!.body.mcp_servers as AnyState[]).map((s) => s.name)).toEqual(['wissensbasis'])
    // the repair round: no server, the same request, the problems and the refused answer
    expect(requests[1]!.body.mcp_servers).toBeUndefined()
    const repair = (requests[1]!.body.messages as AnyState[])[0].content as string
    expect(repair).toContain('<previous_answer>')
    expect(repair).toContain('- steps has 7 steps — at most 6.')
    expect(repair).toContain('<request title="Login-Timeout prüfen">')
  })

  test('questions: the draft holds them, Status stays Planen; the answers go under "Answers" into the row and it plans again', async ({ page }) => {
    const ask = { v: 1, summary: 'Unklar, welcher Login gemeint ist.', context: null, steps: [], questions: ['Welcher Login ist gemeint — Web oder App?'], refused: null }
    const { requests } = await mockClaudeScript(page.context(), [answer({ plan: ask }), answer({ plan: withoutContext() })])
    const { row } = await setup(page, { server: null })
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'questions' })
    expect((await orders(page).record(row)).draft.plan.questions).toEqual(ask.questions)
    expect(await statusOf(page, row)).toBe(ST.plan)
    const out = await orders(page).answer(row, [{ q: ask.questions[0], a: 'Der Web-Login von Nordlicht.' }])
    expect(out).toMatchObject({ kind: 'ready' })
    // written into the row as the person's write, read by the second request
    const content = await wsEval(page, (s, id) => JSON.stringify(s.pages[id].content), row)
    expect(content).toContain('"text":"Answers"')
    expect(content).toContain('Der Web-Login von Nordlicht.')
    expect(requests).toHaveLength(2)
    expect((requests[1]!.body.messages as AnyState[])[0].content).toContain('Der Web-Login von Nordlicht.')
    const rec = await orders(page).record(row)
    expect(rec.draft.answers).toEqual([{ q: ask.questions[0], a: 'Der Web-Login von Nordlicht.' }])
    expect(await statusOf(page, row)).toBe(ST.ready)
  })

  test('the Regler: a manual run at the line asks (E / B, nothing sent; E plans); a deferred run holds — one info toast, Status Planen', async ({ page }) => {
    const { requests } = await mockClaudeScript(page.context(), [answer({ plan: withoutContext() })])
    const { row } = await setup(page, { server: null })
    // a day budget with almost nothing left (an open reservation holds the rest of it)
    await budget(page, { v: 1, day: 0.1 })
    await page.evaluate(() => (window as unknown as Seam).__oneGovernor.reserve(0.098, 'spec:hold'))
    const manual = await orders(page).plan(row)
    expect(manual).toMatchObject({ kind: 'brake', error: { code: 'budget' } })
    expect(manual.error.fixes[0]).toMatchObject({ kind: 'brake', purpose: 'coding.plan', allow: 1 })
    expect(await orders(page).run(row)).toMatchObject({ outcome: { kind: 'brake' } })
    // deferred (the press kept until the worker came back): it stops, one info toast, never a key
    expect(await orders(page).plan(row, { mode: 'trigger' })).toMatchObject({ kind: 'held' })
    await expect(page.getByText('PA-1: the Regler holds the planning')).toBeVisible()
    expect(await orders(page).plan(row, { mode: 'trigger' })).toMatchObject({ kind: 'held' })
    await expect(page.getByText('PA-1: the Regler holds the planning')).toHaveCount(1)
    await page.waitForTimeout(300)
    expect(requests).toHaveLength(0)
    expect(await statusOf(page, row)).toBe(ST.plan)
    expect(await orders(page).record(row)).toBeNull()
    // E on the plate's brake note: an allowance for exactly this retry — it plans
    const token = await page.evaluate(() => (window as unknown as Seam).__oneGovernor.allowOnce(1) as string)
    expect(await orders(page).retryWith(row, token)).toMatchObject({ kind: 'ready' })
    expect(requests).toHaveLength(1)
  })

  test('one run per request: a second press while it plans is "planning already"; ⌘. stops it — nothing written', async ({ page }) => {
    let asked = 0
    await page.context().route('https://api.anthropic.com/**', async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
      asked++
      // an answer that takes its time (the stop arrives first)
      await new Promise((r) => setTimeout(r, 4000))
      await route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{}' }).catch(() => undefined)
    })
    const { row } = await setup(page, { server: null })
    const first = page.evaluate((r) => (window as unknown as Seam).__oneOrders.plan(r, { mode: 'manual' }), row)
    await expect.poll(() => asked).toBe(1)
    expect(await orders(page).plan(row)).toEqual({ kind: 'busy' })
    expect(await orders(page).run(row)).toMatchObject({ phase: 'asking' })
    expect(await page.evaluate((r) => (window as unknown as Seam).__oneOrders.stop(r), row)).toBe(true)
    expect(await first).toMatchObject({ kind: 'stopped' })
    expect(asked).toBe(1)
    expect(await orders(page).record(row)).toBeNull()
    expect(await statusOf(page, row)).toBe(ST.plan)
  })

  test('preconditions before anything is read: Coding off · no worker link', async ({ page }) => {
    const { requests } = await mockClaudeScript(page.context(), [answer()])
    const { row } = await setup(page, { coding: false })
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'blocked', block: { why: 'codingOff' } })
    // switched on, the worker not reachable: the link's own reason
    await fake!.close()
    fake = null
    await page.evaluate(async () => {
      localStorage.setItem('one.coding', JSON.stringify({ enabled: true, port: 1029 }))
    })
    await page.reload()
    await page.waitForFunction(() => !!(window as unknown as { __oneOrders?: unknown }).__oneOrders)
    const out = await orders(page).plan(row)
    expect(out).toMatchObject({ kind: 'blocked', block: { why: 'offline' } })
    expect(requests).toHaveLength(0)
  })
})

