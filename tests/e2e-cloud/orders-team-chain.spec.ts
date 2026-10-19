/**
 * Work orders (Prüfaufträge) B12 — a team, two devices of the SAME member against the real team server (spec §3.10):
 * device A holds the worker link (a fake worker on CODING_E2E_PORT, the Local link — the app served from elsewhere: this
 * server's CSP would refuse ws://127.0.0.1, so the contexts bypass it), device B is the member's other browser (its own
 * IndexedDB: its own records), whose Cloud link says the worker hangs on another device.
 *
 *  1. request on B → "Hier planen" on A: ↵ Planen on B writes Planen — nothing kept or planned on B; A sees the Planen
 *     arrive and shows Preflight's VON HAND card; its ↵ plans on A. B only DISPLAYS from then on (its plate: what the
 *     tasks show, D Verwerfen / H Anhalten — no start, no Weiter, no Fortsetzen; its keys refused 'elsewhere'). A done
 *     move made on B gives A no evidence (A asks "weiter?"); A advances; exactly one Grundlage per step; H on B halts A's
 *     chain (sticky) — the steps B moves meanwhile start nothing; resume refused on B, ↵ Fortsetzen on A goes on; the end.
 *  2. the worker moves to B: B holds no record — ONE "Kette bestätigen" card there; its ↵ adopts the chain under B's
 *     Approvals and B goes on; A (no link now, a stale record) never halts the chain it no longer steers.
 *  3. `Database.orders` makes the round trip (A's settings reach B, and a reload); no "Ohne Bestätigung starten" in a
 *     team; a work order moved out of Private is never planned ("only your private work orders").
 * api.anthropic.com is scripted (the planner's answer). Fictional data (Nordlicht, Tessera, Mara Lind, Supportfall 4711).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect, email, signIn, openApp, waitOnline, createWorkspace, api, wsEval } from './fixtures'
import { mockClaudeScript, type ClaudeTurn } from '../e2e/helpers/providers'
import { startFakeWorker, type FakeWorker } from '../e2e/helpers/fakeWorker'
import { WORKER_CAN, type WorkerInfo } from '../../src/app/features/coding/protocol'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

// the app reaches the Local fake worker on 127.0.0.1 — served by the team server, its CSP would refuse that
test.use({ bypassCSP: true })

/** CODING_E2E_PORT: the fake worker's port (one worker at a time) */
const PORT = Number(process.env.CODING_E2E_PORT) || 47584 + 10 * Number(process.env.TEST_PARALLEL_INDEX ?? 0)

const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/ai/anthropic/orders-plan-kb.json', import.meta.url)), 'utf8')) as AnyState
const WELCOME: WorkerInfo = { worker: '1.11.0', name: 'website-box', repos: [{ name: 'website', baseBranch: 'main', branches: ['main', 'one/nordlicht-footer'], mcp: [] }], parallel: 1, busy: [], spentToday: 0, dayLimit: null, claude: { found: true, version: '2.0.0' }, setup: true, mcp: [] }
const REQUEST = 'Prüfe, warum der Login von Nordlicht nach 30 Sekunden abbricht. Siehe '
const BRANCH = 'one/login-timeout'

const errors: string[] = []
function watch(p: Page, who: string) {
  p.on('pageerror', (e) => errors.push(`${who} pageerror: ${e.message}`))
  p.on('console', (m) => {
    // the browser's own network lines: a Local link nobody listens on, a refused relay upgrade
    if (m.type() === 'error' && !/WebSocket connection to 'ws:\/\/127\.0\.0\.1|WebSocket connection to .*\/coding\/tab|Refused to connect to 'ws:\/\/127\.0\.0\.1/.test(m.text())) errors.push(`${who} console.error: ${m.text()}`)
  })
}
test.beforeEach(() => {
  errors.length = 0
})
test.afterEach(() => {
  expect.soft(errors, 'browser errors').toEqual([])
})

let fake: FakeWorker | null = null
test.afterEach(async () => {
  await fake?.close()
  fake = null
})

/** Another browser of the SAME member (own IndexedDB and localStorage: a device of its own), CSP bypassed as A's. */
async function device(context: BrowserContext): Promise<Page> {
  const ctx = await context.browser()!.newContext({ baseURL: test.info().project.use.baseURL, locale: 'en-US', timezoneId: 'Europe/Berlin', serviceWorkers: 'block', viewport: { width: 1440, height: 900 }, bypassCSP: true })
  return ctx.newPage()
}

const seam = <R,>(p: Page, name: string, fn: (s: any, arg: any) => R | Promise<R>, arg?: unknown): Promise<R> => // eslint-disable-line @typescript-eslint/no-explicit-any
  p.evaluate(({ name, src, arg }) => new Function('s', 'arg', `return (${src})(s, arg)`)((window as unknown as Record<string, unknown>)[name], arg), { name, src: fn.toString(), arg }) as Promise<R>
const orders = (p: Page) => ({
  record: (row: string) => seam<AnyState | null>(p, '__oneOrders', (s, r) => s.record(r), row),
  start: (row: string) => seam<AnyState>(p, '__oneOrders', (s, r) => s.start(r), row),
  startNow: (row: string) => seam<AnyState>(p, '__oneOrders', (s, r) => s.startNow(r), row),
  move: (row: string) => seam<AnyState | null>(p, '__oneOrders', (s, r) => s.move(r), row),
  advance: (row: string, step: number, passes: string[]) => seam<AnyState>(p, '__oneOrders', (s, a) => s.advance(a.row, a.step, a.passes), { row, step, passes }),
  resume: (row: string) => seam<AnyState>(p, '__oneOrders', (s, r) => s.resume(r), row),
  cards: () => seam<AnyState[]>(p, '__oneOrders', (s) => s.cards()),
  planned: () => seam<AnyState[]>(p, '__oneOrderEntries', (s) => s.planned()),
  status: (row: string) => seam<string | null>(p, '__oneOrderEntries', (s, r) => s.status(r), row),
})
const conn = (p: Page) => p.evaluate(() => (window as unknown as { __onePreflight: { stores: { coding: { getState: () => AnyState } } } }).__onePreflight.stores.coding.getState().conn as string)

const fill = (plan: AnyState, ids: { case: string; other: string }) => JSON.parse(JSON.stringify(plan).split('{{case}}').join(ids.case).split('{{other}}').join(ids.other)) as AnyState
const answer = (ids: { case: string; other: string }): ClaudeTurn => ({ blocks: [{ type: 'text', text: JSON.stringify({ ...fill(FIXTURE.plan, ids), context: null }) }], usage: { input: 3200, output: 900 } })

/** What the fake worker answers per stage kind (`over`: per task — null leaves it running). */
function plays(f: FakeWorker, over: (task: AnyState) => AnyState | null | undefined = () => undefined) {
  f.auto = (task) => {
    const o = over(task)
    if (o !== undefined) return o
    const kind = task.stage.kind as string
    if (kind === 'doc' || kind === 'analyze') return { status: 'ok', plan: `## ${task.stage.name}\n\nErgebnis von ${task.stage.name}: der Gateway beendet die Sitzung nach 30 s (Nordlicht).` }
    if (kind === 'plan') return { status: 'ok', plan: 'Plan: Session-Timeout im Gateway auf 5 Minuten setzen.' }
    if (kind === 'implement') return { status: 'ok', summary: 'Timeout geändert.', branch: BRANCH }
    if (kind === 'test') return { status: 'ok', test: { ok: true, output: 'ok', ms: 12, code: 0 } }
    if (kind === 'git') return { status: 'ok', branch: BRANCH, url: 'https://git.example.test/nordlicht/website/-/merge_requests/7' }
    return { status: 'ok' }
  }
}

const stageOf = (p: Page, id: string) =>
  wsEval(
    p,
    (s, id) => {
      const row = s.pages[id]
      if (!row) return null
      const db = s.databases[row.databaseId]
      const stage = db.properties.find((x: AnyState) => x.name === 'Stage')
      return (stage.options.find((o: AnyState) => o.id === row.properties[stage.id])?.name ?? null) as string | null
    },
    id,
  )
/** The person on this device sets a task's Stage (the test hook writes as you~ui). */
const setStage = (p: Page, id: string, name: string) =>
  wsEval(
    p,
    (s, [id, name]) => {
      const row = s.pages[id]
      const db = s.databases[row.databaseId]
      const stage = db.properties.find((x: AnyState) => x.name === 'Stage')
      s.setRowProperty(id, stage.id, stage.options.find((o: AnyState) => o.name === name).id)
    },
    [id, name] as const,
  )
/** How many blocks of a page carry this id (anywhere in it) and the first one's type. */
const slotOf = (p: Page, page: string, block: string) =>
  wsEval(
    p,
    (s, a) => {
      const out: string[] = []
      const walk = (n: AnyState) => {
        if (n.attrs?.id === a.block) out.push(n.type)
        for (const c of n.content ?? []) walk(c)
      }
      if (s.pages[a.page]?.content) walk(s.pages[a.page].content)
      return out
    },
    { page, block },
  )
const handed = (f: FakeWorker, id: string) => f.handed().some((t) => t.id === id)
/** The kind of the stage a task stands in (its pipeline's own entry for that Stage option). */
const stageKindOf = (p: Page, id: string) =>
  wsEval(
    p,
    (s, id) => {
      const row = s.pages[id]
      if (!row) return null
      const db = s.databases[row.databaseId]
      const stage = db.properties.find((x: AnyState) => x.name === 'Stage')
      return ((db.pipeline ?? []).find((st: AnyState) => st.id === row.properties[stage.id])?.kind ?? null) as string | null
    },
    id,
  )

/** Settings › Coding worker (the modal). */
async function codingSettings(p: Page) {
  await p.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
  await p.getByRole('tab', { name: /Coding worker|Coding-Worker/ }).click()
  await expect(p.getByTestId('coding-settings')).toBeVisible()
}

/** Device A: the member signed in, the workspace made, Coding on with the Local link to the fake worker, the AI key. */
async function deviceA(a: Page, approvals: 'all' | 'none'): Promise<{ wsId: string; address: string }> {
  watch(a, 'A')
  await a.addInitScript(
    ([port, approvals]) => {
      localStorage.setItem('one.coding', JSON.stringify({ enabled: true, port }))
      localStorage.setItem('one.coding.approvals', approvals)
      localStorage.setItem('one.tour', '{"off":true}')
    },
    [PORT, approvals] as const,
  )
  const address = email('ada')
  await signIn(a, address)
  const wsId = await createWorkspace(a, 'Nordlicht team')
  await openApp(a, wsId)
  await waitOnline(a)
  await a.waitForFunction(() => !!(window as unknown as { __oneOrders?: unknown; __oneOrderEntries?: unknown }).__oneOrders && !!(window as unknown as { __oneOrderEntries?: unknown }).__oneOrderEntries)
  await wsEval(a, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', mcpServers: [] }))
  await expect.poll(() => conn(a), { timeout: 30_000 }).toBe('connected')
  return { wsId, address }
}

/** On A: the three private projects, two pages the request links, the private work orders with one request. */
async function seedRequest(a: Page, status: 'draft' | 'plan'): Promise<{ db: string; row: string; ids: { case: string; other: string } }> {
  for (const kind of ['spec', 'coding', 'qa']) {
    const seed = (await a.evaluate((k) => (window as unknown as { __oneCodingWrites: { create: (t: string, k: string) => string } }).__oneCodingWrites.create('seed', k), kind)) as string
    await wsEval(a, (s, id) => s.deletePagePermanently(id), seed)
  }
  const ids = await wsEval(a, (s) => {
    const page = (title: string, text: string) => {
      const id = s.createPage({ title, parentId: null }) as string
      s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, 'import')
      return id
    }
    return { case: page('Supportfall 4711', 'Kunde Tessera meldet: der Login bricht nach 30 Sekunden ab, die Eingaben sind weg. Gemeldet von Mara Lind.'), other: page('Tessera intern', 'Interne Notizen zum Gateway.') }
  })
  const db = await seam<string>(a, '__oneOrderEntries', (s) => s.ensure())
  const row = await wsEval(
    a,
    (s, x) => {
      const d = s.databases[x.db]
      const prop = d.properties.find((p: AnyState) => p.type === 'select' && p.options?.some((o: AnyState) => o.id === d.orders.status.draft))
      const body = [{ type: 'paragraph', content: [{ type: 'text', text: x.REQUEST }, { type: 'mention', attrs: { id: x.ids.case, label: 'Supportfall 4711', kind: 'page' } }, { type: 'text', text: ' und ' }, { type: 'mention', attrs: { id: x.ids.other, label: 'Tessera intern', kind: 'page' } }, { type: 'text', text: '. Repo website.' }] }]
      return s.createRow(x.db, { title: 'Login-Timeout prüfen', properties: { [prop.id]: d.orders.status[x.status] }, content: { type: 'doc', content: body } }) as string
    },
    { db, ids, REQUEST, status },
  )
  expect(await wsEval(a, (s, x) => [s.pages[x.db]?.private, s.pages[x.row]?.private], { db, row })).toEqual([true, true])
  return { db, row, ids }
}

/** Device B: the same member's other browser, its Cloud link paired with another device ("the worker hangs elsewhere"). */
async function deviceB(context: BrowserContext, address: string, wsId: string, link: 'cloud' | 'none'): Promise<Page> {
  const b = await device(context)
  watch(b, 'B')
  await b.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
  await signIn(b, address)
  await openApp(b, wsId)
  await waitOnline(b)
  await b.waitForFunction(() => !!(window as unknown as { __oneOrders?: unknown }).__oneOrders)
  if (link === 'cloud') {
    // the member's cloud worker was downloaded on another device: its token on the server, its key only there
    expect((await api(b, 'POST', `/api/workspaces/${wsId}/coding/workers`, { label: 'Tessera laptop' })).status).toBe(201)
    await codingSettings(b)
    await b.getByTestId('coding-via-cloud').click()
    await b.getByRole('switch', { name: 'Connect to my cloud worker through the team server' }).click()
    await expect(b.getByTestId('coding-conn')).toContainText('Paired with another device', { timeout: 15_000 })
    await b.keyboard.press('Escape')
  }
  return b
}

const pfCard = (p: Page) => p.locator('.pf-q article.pf-card[data-current]')
/** Start (Preflight), the work orders' lamp read now, its queue opened — the card takes the keyboard. */
async function openOrdersLamp(p: Page) {
  await p.evaluate(() => (window.location.hash = '#/'))
  await p.waitForFunction(() => !!(window as unknown as { __onePreflight?: unknown }).__onePreflight)
  await expect.poll(async () => {
    await p.evaluate(() => (window as unknown as { __onePreflight: { flush: () => Promise<void> } }).__onePreflight.flush())
    return p.locator('.pf-cap[data-lamp="orders"]').count()
  }, { timeout: 30_000 }).toBe(1)
  await p.locator('.pf-cap[data-lamp="orders"]').focus()
  await p.keyboard.press('Enter')
  await expect(pfCard(p)).toBeVisible()
}
/** A on the card, then the VON HAND confirm row's key. */
async function pressHand(p: Page) {
  await expect(pfCard(p)).not.toHaveAttribute('aria-busy', 'true')
  await expect(pfCard(p).locator('.pf-key[data-key="a"]')).not.toHaveAttribute('aria-disabled', 'true', { timeout: 20_000 })
  await pfCard(p).focus()
  await p.keyboard.press('a')
  await expect(p.getByTestId('pf-confirm')).toBeVisible()
  await p.getByTestId('pf-confirm-key').press('Enter')
}
/** Fix 2: the chain card's step and Grundlage read to their ends (its ↵ acts only then). */
async function readCard(p: Page) {
  const card = p.getByTestId('order-plate').getByTestId('order-chain-card')
  await expect(card).toBeVisible()
  // a key press: the column's scroll hold (shell/lib/hooks.ts useColumnScroll) undoes scrolls until the reader acts
  await p.keyboard.press('Shift')
  // read again while what it shows still changes (a step's text arriving): until its ↵ is ready
  await expect(async () => {
    const edges = card.locator('.orc-edge')
    for (let i = 0; i < (await edges.count()); i++) await edges.nth(i).scrollIntoViewIfNeeded()
    await expect(card.getByTestId('order-card-go')).toHaveAttribute('data-ready', '', { timeout: 1500 })
  }).toPass({ timeout: 20_000 })
}
const openRow = async (p: Page, row: string) => {
  await p.evaluate((id) => (window.location.hash = `#/p/${id}`), row)
  await expect(p.getByTestId('order-plate')).toBeVisible()
}

test('request on B → "Hier planen" on A; A plans and advances, B only displays; a done move on B is no evidence on A; one Grundlage per step; H on B halts A; resume refused on B', async ({ page: a, context }) => {
  test.setTimeout(300_000)
  fake = await startFakeWorker(PORT, WELCOME)
  fake.can = [...WORKER_CAN]
  plays(fake)
  const { wsId, address } = await deviceA(a, 'all')
  const { row, ids } = await seedRequest(a, 'draft')
  await mockClaudeScript(a.context(), [], { fallback: answer(ids) })
  const b = await deviceB(context, address, wsId, 'cloud')
  await expect.poll(() => wsEval(b, (s, id) => !!s.pages[id], row), { timeout: 20_000 }).toBe(true)

  // ── B: the plate says where the worker is; ↵ Planen asks the worker device for it — nothing kept or planned here
  await openRow(b, row)
  const plateB = b.getByTestId('order-plate')
  await expect(plateB.getByTestId('order-pre')).toHaveAttribute('data-why', 'elsewhere')
  await expect(plateB.getByTestId('order-remote')).toHaveCount(0)
  await plateB.getByTestId('order-plan').click()
  await expect.poll(() => orders(b).status(row)).toBe('plan')
  await expect(b.locator('.toast', { hasText: 'WO-1: asked for — the device with the worker shows “Plan here”' })).toBeVisible()
  await expect(plateB.getByTestId('order-remote-line')).toHaveText('Asked for — the device with the worker shows “Plan here”')
  await expect(plateB.getByTestId('order-chip')).toHaveText('asked for')
  await expect(plateB.getByTestId('order-plan')).toHaveCount(0)
  expect(await orders(b).planned()).toEqual([])
  expect(await orders(b).record(row)).toBeNull()

  // ── A: the Planen arrived from the server — recorded, a VON HAND card in Preflight; its ↵ plans HERE
  await expect.poll(async () => (await orders(a).record(row))?.asked?.at ?? null, { timeout: 20_000 }).not.toBeNull()
  expect((await orders(a).cards()).map((c) => c.kind)).toEqual(['request'])
  expect(await orders(a).planned()).toEqual([])
  await openRow(a, row)
  await expect(a.getByTestId('order-asked')).toHaveText('Asked for on another device — ↵ Plan plans it here')
  await expect(a.getByTestId('order-chip')).toHaveText('asked for')
  await openOrdersLamp(a)
  await expect(pfCard(a)).toHaveAttribute('data-kind', 'request')
  await expect(pfCard(a)).toHaveAttribute('data-hand', '')
  await expect(pfCard(a).getByTestId('pf-order-request-card')).toContainText('WO-1 was asked for on another device')
  await pressHand(a)
  await expect.poll(() => orders(a).status(row), { timeout: 30_000 }).toBe('ready')
  const planned = await orders(a).planned()
  expect(planned.map((p) => [p.how, p.mode])).toEqual([['card', 'manual']])
  const drafted = (await orders(a).record(row))!
  expect(drafted.state).toBe('draft')
  expect(drafted.draft.plan.steps).toHaveLength(3)
  expect(drafted.asked).toBeUndefined()
  expect((await orders(a).cards()).map((c) => c.kind)).toEqual(['ready'])

  // ── B: Kette bereit — the plan lives on A; B shows where, keeps only D; ↵ Kette starten is refused here
  await expect.poll(() => orders(b).status(row), { timeout: 20_000 }).toBe('ready')
  await expect(plateB.getByTestId('order-remote-line')).toHaveText('Chain ready on the device with the worker — read it and start it there')
  await expect(plateB.getByTestId('order-discard')).toBeVisible()
  await expect(plateB.getByTestId('order-start')).toHaveCount(0)
  expect(await orders(b).start(row)).toMatchObject({ ok: false })
  expect(await orders(b).cards()).toEqual([])

  // ── A starts it (B6's seam: the plan's hash as the plate shows it); step 01 runs on A's worker up to its gate
  const started = await orders(a).start(row)
  expect(started, JSON.stringify(started)).toMatchObject({ ok: true })
  const steps = started.steps as string[]
  await orders(a).startNow(row)
  await expect.poll(() => stageKindOf(a, steps[0]!), { timeout: 40_000 }).toBe('gate')
  // the roles live on private pipelines (the member's own)
  expect(await wsEval(a, (s, id) => !!s.pages[s.pages[id].databaseId]?.private, steps[0]!)).toBe(true)

  // ── B displays what the tasks show — no record, no card, its Weiter refused
  await expect(plateB.getByTestId('order-remote-row')).toHaveCount(3, { timeout: 20_000 })
  await expect(plateB.getByTestId('order-remote-row').first()).toHaveAttribute('data-lane', 'waiting')
  await expect(plateB.getByTestId('order-remote-row').nth(1)).toHaveAttribute('data-lane', 'parked')
  await expect(plateB.getByTestId('order-remote-line')).toHaveText('The chain runs on the device with the worker — H halts it after the running step; stop now and resume there')
  expect(await orders(b).record(row)).toBeNull()
  expect(await orders(b).cards()).toEqual([])
  expect(await orders(b).advance(row, 2, ['checkpoint'])).toMatchObject({ ok: false, why: 'elsewhere' })

  // ── a done move on B (the person there): A records no evidence — A asks "weiter?" (and the analysis checkpoint)
  await setStage(b, steps[0]!, 'Done')
  await expect.poll(async () => (await orders(a).move(row))?.kind ?? null, { timeout: 20_000 }).toBe('card')
  expect(await orders(a).move(row)).toMatchObject({ kind: 'card', step: 2, all: ['evidence', 'checkpoint'], by: null })
  expect((await orders(a).record(row))!.chain.doneBy['1']).toBeUndefined()
  await a.waitForTimeout(2000)
  expect(handed(fake, steps[1]!)).toBe(false)

  // ── A: ↵ Weiter on its plate card (VON HAND) — step 02 gets ONE Grundlage, then runs on A's worker
  await openRow(a, row)
  const go = a.getByTestId('order-card-go')
  await readCard(a)
  await expect(go).toHaveAttribute('data-ready', '')
  await go.click()
  await expect.poll(() => handed(fake!, steps[1]!), { timeout: 20_000 }).toBe(true)
  expect(await slotOf(a, steps[1]!, `${steps[1]}-wait`)).toEqual(['callout'])
  await expect.poll(() => slotOf(b, steps[1]!, `${steps[1]}-wait`), { timeout: 20_000 }).toEqual(['callout'])
  await expect.poll(() => stageKindOf(a, steps[1]!), { timeout: 40_000 }).toBe('gate')

  // ── H on B (any device): the Status Angehalten — A's chain halts (sticky), recorded as another device's
  await expect(plateB.getByTestId('order-halt')).toBeVisible()
  await plateB.getByTestId('order-halt').click()
  await expect.poll(async () => (await orders(a).record(row))?.state, { timeout: 20_000 }).toBe('halted')
  // why 'status': the Status B wrote (seen as another device's change, or read by a run of A's engine already under way)
  const haltedA = (await orders(a).record(row))!.chain.halted
  expect(haltedA).toMatchObject({ why: 'status' })
  expect(['remote', 'order']).toContain(haltedA.by)
  await expect(plateB.getByTestId('order-remote-line')).toHaveText('Halted — resume it on the device with the worker')
  await expect(plateB.getByTestId('order-resume')).toHaveCount(0)
  // B moves step 02 to Done meanwhile: the halt holds — step 03 never starts
  await setStage(b, steps[1]!, 'Done')
  await expect.poll(() => stageOf(a, steps[1]!), { timeout: 20_000 }).toBe('Done')
  await a.waitForTimeout(3000)
  expect(await stageOf(a, steps[2]!)).toBe('Backlog')
  expect(handed(fake, steps[2]!)).toBe(false)
  // resume is refused on B (the worker is attached to A)
  expect(await orders(b).resume(row)).toMatchObject({ ok: false, why: 'elsewhere' })
  expect((await orders(a).record(row))!.state).toBe('halted')

  // ── A: ↵ Fortsetzen — the done move B made is still no evidence: "weiter?"; ↵ Weiter → step 03 with ONE Grundlage
  await expect(a.getByTestId('order-resume')).toHaveAttribute('data-ready', '')
  await a.getByTestId('order-resume').click()
  await expect.poll(async () => (await orders(a).move(row))?.kind ?? null, { timeout: 20_000 }).toBe('card')
  expect(await orders(a).move(row)).toMatchObject({ kind: 'card', step: 3, all: ['evidence'] })
  await readCard(a)
  await expect(a.getByTestId('order-card-go')).toHaveAttribute('data-ready', '')
  await a.getByTestId('order-card-go').click()
  await expect.poll(() => handed(fake!, steps[2]!), { timeout: 20_000 }).toBe(true)
  expect(await slotOf(a, steps[2]!, `${steps[2]}-wait`)).toEqual(['callout'])
  await expect.poll(() => stageKindOf(a, steps[2]!), { timeout: 40_000 }).toBe('gate')
  // the last step done (on B): the chain ends on A; B shows the end
  await setStage(b, steps[2]!, 'Done')
  await expect.poll(async () => (await orders(a).record(row))?.state, { timeout: 20_000 }).toBe('done')
  await expect.poll(() => orders(b).status(row), { timeout: 20_000 }).toBe('done')
  await expect(plateB.getByTestId('order-remote-line')).toHaveText('Done — each step’s result is on its task')
  await expect(plateB.locator('[data-testid="order-remote-row"][data-lane="done"]')).toHaveCount(3)
  // B never held a chain of it, never planned, never wrote a Grundlage (each step holds exactly one)
  expect(await orders(b).record(row)).toBeNull()
  expect(await orders(b).planned()).toEqual([])
  for (const id of steps.slice(1)) expect(await slotOf(b, id, `${id}-wait`)).toEqual(['callout'])
  await b.context().close()
})

test('the worker moves to B: ONE "Kette bestätigen" card there, its ↵ adopts the chain (B\'s Approvals) and B goes on; A\'s stale record never halts it', async ({ page: a, context }) => {
  test.setTimeout(300_000)
  fake = await startFakeWorker(PORT, WELCOME)
  fake.can = [...WORKER_CAN]
  plays(fake)
  const { wsId, address } = await deviceA(a, 'none')
  const { row, ids } = await seedRequest(a, 'plan')
  await mockClaudeScript(a.context(), [], { fallback: answer(ids) })
  const b = await deviceB(context, address, wsId, 'none')
  await b.evaluate(() => localStorage.setItem('one.coding.approvals', 'none'))

  // A plans and starts it; step 01 (the analysis) runs through on A's worker — the chain waits at its checkpoint card
  expect(await seam<AnyState>(a, '__oneOrders', (s, r) => s.plan(r, { mode: 'manual', replace: true }), row)).toMatchObject({ kind: 'ready', steps: 3 })
  const started = await orders(a).start(row)
  expect(started, JSON.stringify(started)).toMatchObject({ ok: true })
  const steps = started.steps as string[]
  await orders(a).startNow(row)
  await expect.poll(() => stageOf(a, steps[0]!), { timeout: 40_000 }).toBe('Done')
  await expect.poll(async () => (await orders(a).move(row))?.kind ?? null, { timeout: 20_000 }).toBe('card')

  // the worker moves: A switches Coding off, B connects to it (Local) — B holds no record of the chain
  await codingSettings(a)
  const localA = a.getByRole('switch', { name: 'Connect to a coding worker on this computer' })
  await localA.click()
  await expect(localA).toHaveAttribute('aria-checked', 'false')
  await a.keyboard.press('Escape')
  await expect.poll(() => conn(a)).not.toBe('connected')
  await codingSettings(b)
  const port = b.getByLabel('Port', { exact: true })
  await port.fill(String(PORT))
  await port.press('Enter')
  const localB = b.getByRole('switch', { name: 'Connect to a coding worker on this computer' })
  await localB.click()
  await expect(localB).toHaveAttribute('aria-checked', 'true')
  await b.keyboard.press('Escape')
  await expect.poll(() => conn(b), { timeout: 30_000 }).toBe('connected')
  expect(await orders(b).record(row)).toBeNull()
  // B's plate: the chain was started elsewhere — confirm it in Preflight first
  await expect.poll(() => wsEval(b, (s, id) => !!s.pages[id], steps[2]!), { timeout: 20_000 }).toBe(true)
  await openRow(b, row)
  await expect(b.getByTestId('order-remote-line')).toHaveText('This chain was started on another device — “Confirm chain” in Preflight first, then it goes on here')
  await expect(b.getByTestId('order-halt')).toHaveCount(0)

  // exactly ONE card: Kette bestätigen (after the Status settled); every step's version, where it stops HERE
  await expect.poll(async () => (await orders(b).cards()).map((c) => c.kind), { timeout: 30_000 }).toEqual(['chainConfirm'])
  await openOrdersLamp(b)
  await expect(pfCard(b)).toHaveAttribute('data-kind', 'chainConfirm')
  await pressHand(b)
  await expect.poll(async () => (await orders(b).record(row))?.state ?? null, { timeout: 20_000 }).not.toBeNull()
  const adopted = (await orders(b).record(row))!
  expect(adopted.chain.adopted).toBeGreaterThan(0)
  expect(adopted.chain.steps.map((s: AnyState) => s.id)).toEqual(steps)
  // this device's Approvals ('none') — never the ones A confirmed under
  expect(adopted.chain.steps.map((s: AnyState) => s.approvals)).toEqual(['none', 'none', 'none'])
  // Fix 3: "Kette bestätigen" never counts as having seen step 02 — the analysis checkpoint asks once on B
  expect(adopted.chain.doneBy['1']).toMatchObject({ kind: 'you', via: 'preflight' })
  expect(adopted.chain.doneBy['1'].sawNext).toBeUndefined()
  await expect.poll(async () => (await orders(b).cards()).map((c) => c.kind), { timeout: 30_000 }).toEqual(['next'])
  await openOrdersLamp(b)
  await expect(pfCard(b)).toHaveAttribute('data-kind', 'next')
  // read step 02 and its Grundlage to their ends (A acts only then)
  await b.keyboard.press('Shift')
  const edges = pfCard(b).getByTestId('pf-order-next').locator('.orc-edge')
  for (let i = 0; i < (await edges.count()); i++) await edges.nth(i).scrollIntoViewIfNeeded()
  await pressHand(b)

  // B goes on: step 02 with ONE Grundlage, then QA, then the end — all on B's link
  await expect.poll(() => stageOf(b, steps[2]!), { timeout: 60_000 }).toBe('Done')
  await expect.poll(async () => (await orders(b).record(row))?.state, { timeout: 30_000 }).toBe('done')
  expect(await orders(b).status(row)).toBe('done')
  for (const id of steps.slice(1)) expect(await slotOf(b, id, `${id}-wait`)).toEqual(['callout'])
  // A (no link, its record stale) never halted the chain B steered — never wrote Angehalten
  const recA = (await orders(a).record(row))!
  expect(recA.chain.halted).toBeNull()
  expect(['running', 'done']).toContain(recA.state)
  await expect.poll(async () => (await orders(a).move(row))?.why ?? null, { timeout: 10_000 }).not.toBe('outOfOrder')
  await b.context().close()
})

test('Database.orders makes the round trip (A → B, a reload); no "Ohne Bestätigung starten" in a team; a work order moved out of Private is never planned', async ({ page: a, context }) => {
  test.setTimeout(180_000)
  fake = await startFakeWorker(PORT, WELCOME)
  fake.can = [...WORKER_CAN]
  const { wsId, address } = await deviceA(a, 'none')
  const { db, row } = await seedRequest(a, 'draft')
  const b = await deviceB(context, address, wsId, 'none')
  await expect.poll(() => wsEval(b, (s, id) => !!s.databases[id]?.orders, db), { timeout: 20_000 }).toBe(true)

  // A's settings: the analysis stop off, a budget — through the plate's settings popover (saveOrderConfig)
  await openRow(a, row)
  await a.getByTestId('order-plate').getByTestId('order-settings-key').click()
  const pop = a.getByTestId('order-settings')
  await expect(pop).toBeVisible()
  // a team: never "Ohne Bestätigung starten"
  await expect(pop.getByTestId('order-auto')).toHaveCount(0)
  await pop.getByRole('switch', { name: 'Stop after the analysis' }).click()
  const budget = pop.getByTestId('order-settings-budget')
  await budget.fill('7.5')
  await budget.press('Enter')
  await expect.poll(() => wsEval(a, (s, id) => JSON.parse(JSON.stringify(s.databases[id].orders)), db)).toMatchObject({ v: 1, checkpoint: false, budgetUsd: 7.5 })
  await a.keyboard.press('Escape')
  const want = await wsEval(a, (s, id) => JSON.parse(JSON.stringify(s.databases[id].orders)), db)
  // B reads exactly that value; after a reload too (the server keeps it as a plain database value)
  await expect.poll(() => wsEval(b, (s, id) => JSON.parse(JSON.stringify(s.databases[id]?.orders ?? null)), db), { timeout: 20_000 }).toEqual(want)
  await openApp(b, wsId)
  await waitOnline(b)
  await expect.poll(() => wsEval(b, (s, id) => JSON.parse(JSON.stringify(s.databases[id]?.orders ?? null)), db), { timeout: 20_000 }).toEqual(want)
  expect(await wsEval(b, (s, id) => s.databases[id].system, db)).toBe('workorders')

  // the database moved out of Private: its plate says so on the worker device, a press plans nothing
  await a.evaluate((id) => (window as unknown as { __one: { cloud: { movePagePrivacy: (id: string, p: boolean) => Promise<void> } } }).__one.cloud.movePagePrivacy(id, false), db)
  await expect.poll(() => wsEval(a, (s, id) => !!s.pages[id]?.private, db)).toBe(false)
  await openRow(a, row)
  await expect(a.getByTestId('order-pre')).toHaveAttribute('data-why', 'shared')
  await expect(a.getByTestId('order-pre')).toHaveText('Only your private work orders are planned — this database lies in the workspace')
  await expect(a.getByTestId('order-plan')).toHaveCount(0)
  // the person drags it into Planen there: no press (the trigger, the command and the press share the row test)
  await seam(a, '__oneOrderEntries', (s, r) => s.setStatusAs(r, 'plan', { kind: 'you', via: 'ui' }), row)
  await a.waitForTimeout(1500)
  expect(await orders(a).planned()).toEqual([])
  expect(await orders(a).record(row)).toBeNull()
  await b.context().close()
})
