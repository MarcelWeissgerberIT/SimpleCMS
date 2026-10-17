/**
 * Work orders (Prüfaufträge) B9 — Preflight (spec §5 "Preflight", §3.4): the lamp "Work orders" and its cards, a fake
 * worker on CODING_E2E_PORT, api.anthropic.com scripted (the planner's answer). Fictional data only (Nordlicht, Tessera,
 * Mara Lind, Login-Timeout).
 *  - Kette bereit: ⇧A never takes it; A is VON HAND and acts only once every station was seen in full (the plate's book);
 *    ↵ on the confirm key starts exactly the plan the card rendered; Z takes the chain back as a whole;
 *  - a changed hash (this device's Approvals moved since the card read the plan): ↵ is refused, nothing is created, the
 *    card reads again ("Read again") and shows the plan as it resolves now — that one starts;
 *  - Weiter mit Schritt n?: ⇧A skips it; its body shows the step as it will run and the Grundlage; ↵ goes on (VON HAND);
 *    the releasing gate card (Approvals all) carries the chain chip and is skipped by ⇧A too;
 *  - Kette bestätigen (a Läuft request whose chain this device holds no record of): every step's version in full; ↵ is all
 *    or nothing — a step changed since the card read it: nothing trusted, no record; read again: all trusted, the record
 *    is this device's, the engine goes on;
 *  - Kette angehalten: ↵ Fortsetzen only where the chain may start something — refused with an outdated worker (its
 *    reason on the key), resumes with a current one.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval } from './fixtures'
import { mockClaudeScript, type ClaudeTurn } from './helpers/providers'
import { startFakeWorker, type FakeWorker } from './helpers/fakeWorker'
import { flushLamps, waitPreflight } from './helpers/preflightStory.mjs'
import { test as node, expect as nodeExpect } from '@playwright/test'
import { WORKER_CAN, type WorkerInfo } from '../../src/app/features/coding/protocol'
import { messages as cards } from '../../src/app/features/coding/orders/preflightMessages'
import { messages as preflight } from '../../src/app/features/preflight/messages'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** CODING_E2E_PORT: one port for the coding suites when they run side by side (one worker at a time) */
const PORT = Number(process.env.CODING_E2E_PORT) || 47384

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
const WELCOME: WorkerInfo = { worker: '1.11.0', name: 'website-box', repos: [{ name: 'website', baseBranch: 'main', branches: ['main', 'one/nordlicht-footer'], mcp: [] }], parallel: 1, busy: [], spentToday: 0, dayLimit: null, claude: { found: true, version: '2.0.0' }, setup: true, mcp: [] }
const REQUEST = 'Prüfe, warum der Login von Nordlicht nach 30 Sekunden abbricht. Siehe '
const BRANCH = 'one/login-timeout'

type Seam = { __oneOrders: Record<string, (...a: any[]) => Promise<any>>; __onePreflight: AnyState; __oneCodingWrites: Record<string, (...a: any[]) => any> } // eslint-disable-line @typescript-eslint/no-explicit-any
const call = (page: Page, name: string, ...args: unknown[]) => page.evaluate(([n, a]) => (window as unknown as Seam).__oneOrders[n as string]!(...(a as unknown[])), [name, args] as const)
const orders = (page: Page) => ({
  plan: (row: string) => call(page, 'plan', row, { mode: 'manual', replace: true }) as Promise<AnyState>,
  record: (row: string) => call(page, 'record', row) as Promise<AnyState | null>,
  start: (row: string) => call(page, 'start', row) as Promise<AnyState>,
  startNow: (row: string) => call(page, 'startNow', row) as Promise<AnyState>,
  move: (row: string) => call(page, 'move', row) as Promise<AnyState | null>,
  halt: (row: string) => call(page, 'halt', row) as Promise<AnyState>,
  cards: () => call(page, 'cards') as Promise<AnyState[]>,
  dropRecord: (row: string) => call(page, 'dropRecord', row) as Promise<AnyState>,
  trusted: (task: string) => call(page, 'trusted', task) as Promise<boolean>,
  agentAppend: (task: string, text: string) => call(page, 'agentAppend', task, text) as Promise<boolean>,
})

const fill = (plan: AnyState) => JSON.parse(JSON.stringify(plan).split('{{case}}').join(CASE).split('{{other}}').join(OTHER)) as AnyState
const answer = (): ClaudeTurn => ({ blocks: [{ type: 'text', text: JSON.stringify({ ...fill(FIXTURE.plan), context: null }) }], usage: { input: 3200, output: 900 } })

/** Coding on (this device), the fake worker, the AI key, a work-orders database with one request, the three projects. */
async function setup(page: Page, o: { approvals?: 'all' | 'review' | 'none' } = {}) {
  await page.addInitScript(
    ([port, approvals]) => {
      localStorage.setItem('one.coding', JSON.stringify({ enabled: true, port }))
      localStorage.setItem('one.tour', '{"off":true}')
      if (approvals) localStorage.setItem('one.coding.approvals', approvals)
    },
    [PORT, o.approvals ?? null] as const,
  )
  // nothing leaves the machine but the scripted API
  await openApp(page)
  await waitPreflight(page)
  await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', mcpServers: [] }))
  const ids = await wsEval(
    page,
    (s, a) => {
      const p = (id: string, name: string, type: string, extra: AnyState = {}) => ({ id, name, type, ...extra })
      s.createPage({ id: a.CASE, title: 'Supportfall 4711', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Kunde Tessera meldet: der Login bricht nach 30 Sekunden ab, die Eingaben sind weg. Gemeldet von Mara Lind.' }] }] } })
      s.createPage({ id: a.OTHER, title: 'Tessera intern', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Interne Notizen.' }] }] } })
      const db = s.createDatabase({
        title: 'Work orders',
        properties: [p('woName', 'Name', 'title'), p('woStatus', 'Status', 'select', { options: a.statusOptions }), p('woRepo', 'Repo', 'select', { options: [{ id: 'rWeb', name: 'website', color: 'gray' }] }), p('woId', 'ID', 'unique_id', { idPrefix: 'PA' })],
      })
      s.updateDatabase(db, { system: 'workorders', orders: { v: 1, status: a.ST, server: null, kinds: ['spec', 'coding', 'qa'], checkpoint: true } })
      const body = [{ type: 'paragraph', content: [{ type: 'text', text: a.REQUEST }, { type: 'mention', attrs: { id: a.CASE, label: 'Supportfall 4711', kind: 'page' } }, { type: 'text', text: '. Repo website.' }] }]
      const row = s.createRow(db, { title: 'Login-Timeout prüfen', properties: { woStatus: a.ST.plan, woRepo: 'rWeb' }, content: { type: 'doc', content: body } })
      return { db, row }
    },
    { CASE, OTHER, ST, statusOptions, REQUEST },
  )
  for (const kind of ['spec', 'coding', 'qa']) {
    const seed = await page.evaluate((k) => (window as unknown as Seam).__oneCodingWrites.create('seed', k), kind)
    await wsEval(page, (s, id) => s.deletePagePermanently(id), seed as string)
  }
  await expect.poll(() => page.evaluate(() => (window as unknown as Seam).__onePreflight.stores.coding.getState().conn), { timeout: 30_000 }).toBe('connected')
  return ids
}

/** What the fake worker answers per stage kind. */
function plays(fake: FakeWorker) {
  fake.auto = (task) => {
    const kind = task.stage.kind as string
    if (kind === 'doc' || kind === 'analyze') return { status: 'ok', plan: `## ${task.stage.name}\n\nErgebnis von ${task.stage.name}: der Gateway beendet die Sitzung nach 30 s (Nordlicht).` }
    if (kind === 'plan') return { status: 'ok', plan: 'Plan: Session-Timeout im Gateway auf 5 Minuten setzen.' }
    if (kind === 'implement') return { status: 'ok', summary: 'Timeout geändert.', branch: BRANCH }
    if (kind === 'test') return { status: 'ok', test: { ok: true, output: 'ok', ms: 12, code: 0 } }
    if (kind === 'git') return { status: 'ok', branch: BRANCH, url: 'https://git.example.test/nordlicht/website/-/merge_requests/7' }
    return { status: 'ok' }
  }
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

/* ---------------- Preflight */

const pf = <R, A = null>(page: Page, fn: (s: AnyState, arg: A) => R | Promise<R>, arg?: A): Promise<R> =>
  page.evaluate(({ src, arg }) => new Function('s', 'arg', `return (${src})(s, arg)`)((window as unknown as Seam).__onePreflight, arg), { src: fn.toString(), arg: (arg ?? null) as A }) as Promise<R>
const cap = (page: Page, id: string) => page.locator(`.pf-cap[data-lamp="${id}"]`)
const card = (page: Page) => page.locator('.pf-q article.pf-card[data-current]')
const queue = (page: Page) => page.getByTestId('pf-queue')
const tab = (page: Page, id: string) => queue(page).locator(`.pf-tab[data-lamp="${id}"]`)
const live = (page: Page) => page.getByTestId('pf-live')
const q = (page: Page) => pf(page, (p) => {
  const s = p.stores.queue.getState()
  return { done: s.done.map((e: AnyState) => ({ id: e.id, outcome: e.outcome, undone: !!e.undone })), confirm: s.confirm, bulk: s.bulk, error: s.error }
})

/** Start (Preflight's plate), the lamps read now, a lamp's queue opened with ↵ on its cap; the card takes the keyboard. */
async function openLamp(page: Page, id: string): Promise<void> {
  await page.evaluate(() => (window.location.hash = '#/'))
  await waitPreflight(page)
  await expect.poll(async () => {
    await flushLamps(page)
    return cap(page, id).count()
  }, { timeout: 20_000 }).toBe(1)
  await cap(page, id).focus()
  await page.keyboard.press('Enter')
  await expect(tab(page, id)).toHaveAttribute('aria-selected', 'true')
  await expect(card(page)).toBeFocused()
}

/** The current card prepared (its keys usable). */
async function ready(page: Page, kind: string): Promise<string> {
  await expect(card(page)).toHaveAttribute('data-kind', kind, { timeout: 20_000 })
  await expect(card(page)).not.toHaveAttribute('aria-busy', 'true')
  return (await card(page).getAttribute('data-id'))!
}

/** Read every station of the ready card in full: each edge on screen, each page that goes along opened. */
async function readStations(page: Page): Promise<void> {
  const body = card(page).getByTestId('pf-order-ready')
  await expect(body).toBeVisible()
  await page.keyboard.press('Shift')
  const edges = body.locator('.orc-edge')
  for (let i = 0; i < (await edges.count()); i++) await edges.nth(i).scrollIntoViewIfNeeded()
  const folds = body.getByTestId('order-plan-ref')
  for (let i = 0; i < (await folds.count()); i++) {
    const fold = folds.nth(i)
    if ((await fold.getAttribute('open')) === null) await fold.locator('summary').first().click()
    await expect(fold).toHaveAttribute('data-seen', '')
  }
}

/** A key on the current card by its letter: the card focused first (keys act only with focus in the queue). */
async function press(page: Page, key: string): Promise<void> {
  await card(page).focus()
  await page.keyboard.press(key)
}

test.describe('work orders in Preflight (B9)', () => {
  // one after another (every case plays the worker on the same port), each on its own
  test.describe.configure({ mode: 'default' })
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

  test('Kette bereit: ⇧A never takes it; A waits until every station was seen in full; ↵ starts exactly that plan; Z takes it back whole', async ({ page }) => {
    await mockClaudeScript(page.context(), [], { fallback: answer() })
    const { row } = await setup(page, { approvals: 'none' })
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'ready' })
    await openLamp(page, 'orders')
    const id = await ready(page, 'ready')
    expect(id).toMatch(new RegExp(`^order:${row}:ready@`))
    // VON HAND on the card's head; out of every bulk
    await expect(card(page)).toHaveAttribute('data-hand', '')
    await expect(card(page).getByTestId('pf-order-stations').getByTestId('order-plan-step')).toHaveCount(3)
    await expect(card(page).locator('.pf-card__key')).toHaveText('#PA-1')

    // ⇧A: nothing clean here — no sheet, no confirm row, nothing started
    await press(page, 'Shift+A')
    await expect(live(page)).toContainText('No clean card to apply here.')
    await expect(page.getByTestId('pf-bulk')).toHaveCount(0)
    expect((await orders(page).record(row))!.state).toBe('draft')

    // A before the stations were seen: refused with the reason (no confirm row)
    const a = card(page).locator('.pf-key[data-key="a"]')
    await expect(a).toHaveAttribute('aria-disabled', 'true')
    await expect(a).toHaveText(/Start chain/)
    await expect(card(page).getByTestId('pf-order-why')).toHaveText(/^See every step in full first — still: 01, 02, 03$/)
    await press(page, 'a')
    await expect(page.getByTestId('pf-confirm')).toHaveCount(0)
    await expect(live(page)).toContainText('See every step in full first')
    expect((await orders(page).record(row))!.state).toBe('draft')

    // read in full: the key is ready; A opens the VON HAND row, only its confirm key starts the chain
    await readStations(page)
    await expect(card(page).getByTestId('pf-order-why')).toHaveCount(0)
    await expect(a).not.toHaveAttribute('aria-disabled', 'true')
    await press(page, 'a')
    const confirmRow = page.getByTestId('pf-confirm')
    await expect(confirmRow).toBeVisible()
    await expect(confirmRow).toContainText('starts the worker · goes to Claude Code')
    await expect(page.getByTestId('pf-confirm-key')).toBeFocused()
    expect((await orders(page).record(row))!.state).toBe('draft')
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await orders(page).record(row))!.state, { timeout: 15_000 }).toBe('running')
    const rec = (await orders(page).record(row))!
    expect(rec.chain.steps).toHaveLength(3)
    expect(rec.draft.hash).toBe((await orders(page).record(row))!.draft.hash)
    expect(await statusOf(page, row)).toBe(ST.running)
    await expect.poll(async () => (await q(page)).done.map((d: AnyState) => d.id)).toContain(id)

    // Z: the whole chain back (its steps to the trash, the plan stands again) — the card is there again
    await page.locator('.pf-undo').first().click()
    await expect.poll(async () => (await orders(page).record(row))!.state, { timeout: 10_000 }).toBe('draft')
    expect(await statusOf(page, row)).toBe(ST.ready)
    for (const step of rec.chain.steps as AnyState[]) expect(await wsEval(page, (s, x) => !!s.pages[x]?.trashed, step.id as string)).toBe(true)
    await expect.poll(async () => (await orders(page).cards()).map((c) => c.id)).toContain(id)
  })
  test('a changed hash: ↵ is refused and nothing is created; the card reads the plan again as it resolves now — that one starts', async ({ page }) => {
    await mockClaudeScript(page.context(), [], { fallback: answer() })
    const { row } = await setup(page, { approvals: 'none' })
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'ready' })
    await openLamp(page, 'orders')
    const id = await ready(page, 'ready')
    await readStations(page)
    const first = card(page).getByTestId('order-plan-step').first()
    await expect(first).toContainText('stops at: after the analysis')
    // this device's Approvals move: the plan resolves to another hash (where each step stops)
    await page.evaluate(() => localStorage.setItem('one.coding.approvals', 'all'))
    await press(page, 'a')
    await expect(page.getByTestId('pf-confirm')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(card(page).locator('.pf-card__error')).toContainText('Changed since — read it again.')
    const rec = (await orders(page).record(row))!
    expect(rec.state).toBe('draft')
    expect(rec.chain).toBeUndefined()
    expect(await statusOf(page, row)).toBe(ST.ready)
    // read again: the same plan as it resolves now (it stops at the analysis' gate) — seen already, it starts
    await card(page).getByRole('button', { name: 'Read again' }).click()
    await ready(page, 'ready')
    expect(await card(page).getAttribute('data-id')).toBe(id)
    await expect(card(page).getByTestId('order-plan-step').first()).toContainText('stops at: Approve spec')
    await expect(card(page).locator('.pf-key[data-key="a"]')).not.toHaveAttribute('aria-disabled', 'true')
    await press(page, 'a')
    await page.getByTestId('pf-confirm-key').press('Enter')
    await expect.poll(async () => (await orders(page).record(row))!.state, { timeout: 15_000 }).toBe('running')
    expect(((await orders(page).record(row))!.chain.steps as AnyState[]).map((s) => s.approvals)).toEqual(['all', 'all', 'all'])
  })

  test('Weiter mit Schritt 02?: the step as it will run and its Grundlage on the card; ⇧A skips it; ↵ goes on (VON HAND)', async ({ page }) => {
    await mockClaudeScript(page.context(), [], { fallback: answer() })
    const { row } = await setup(page, { approvals: 'none' })
    plays(fake!)
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'ready' })
    const ids = (await orders(page).start(row)).steps as string[]
    await orders(page).startNow(row)
    await expect.poll(async () => (await orders(page).move(row))?.why ?? null, { timeout: 40_000 }).toBe('checkpoint')
    await openLamp(page, 'orders')
    const id = await ready(page, 'next')
    expect(id).toMatch(new RegExp(`^order:${row}:next:2@`))
    await expect(card(page)).toHaveAttribute('data-hand', '')
    const body = card(page).getByTestId('pf-order-next')
    await expect(body.getByTestId('pf-order-why-line')).toHaveText('Analysis done → 02 coding ‹Session-Timeout beheben›')
    await expect(body.getByTestId('pf-order-step-text')).toContainText('Login bleibt 5 Minuten offen')
    await expect(body.getByTestId('pf-order-basis')).toContainText('der Gateway beendet die Sitzung nach 30 s')
    // ⇧A: no clean card — the step stays parked
    await press(page, 'Shift+A')
    await expect(live(page)).toContainText('No clean card to apply here.')
    expect((await orders(page).record(row))!.chain.advanced?.['2']).toBeUndefined()
    expect(await stageOf(page, ids[1]!)).toBe('Backlog')
    // A: the VON HAND row; only its confirm key goes on
    await press(page, 'a')
    await expect(page.getByTestId('pf-confirm')).toContainText('starts the worker · goes to Claude Code')
    expect((await orders(page).record(row))!.chain.advanced?.['2']).toBeUndefined()
    await page.getByTestId('pf-confirm-key').press('Enter')
    await expect.poll(async () => (await orders(page).record(row))!.chain.advanced?.['2'] ?? null, { timeout: 15_000 }).not.toBeNull()
    await expect.poll(() => stageOf(page, ids[1]!), { timeout: 15_000 }).not.toBe('Backlog')
    await expect.poll(async () => (await q(page)).done.map((d: AnyState) => d.id)).toContain(id)
  })

  test('Approvals all: the gate card whose approval starts the next step carries the chain chip, is VON HAND and ⇧A skips it', async ({ page }) => {
    await mockClaudeScript(page.context(), [], { fallback: answer() })
    const { row } = await setup(page, { approvals: 'all' })
    plays(fake!)
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'ready' })
    const ids = (await orders(page).start(row)).steps as string[]
    await orders(page).startNow(row)
    await expect.poll(() => stageOf(page, ids[0]!), { timeout: 40_000 }).toBe('Approve spec')
    await openLamp(page, 'gate')
    await expect(card(page)).toHaveAttribute('data-kind', 'gate')
    await expect(card(page)).not.toHaveAttribute('aria-busy', 'true')
    expect(await card(page).getAttribute('data-id')).toContain(ids[0]!)
    await expect(card(page).getByTestId('pf-chip')).toHaveText('PA-1 · 1/3')
    await expect(queue(page).locator('.pf-qr__chip')).toHaveCount(0)
    await expect(card(page).getByTestId('pf-chain-next')).toBeVisible()
    await expect(card(page)).toHaveAttribute('data-hand', '')
    // ⇧A: the releasing approval is never clean — the step stays at its gate
    await press(page, 'Shift+A')
    await expect(live(page)).toContainText('No clean card to apply here.')
    await page.waitForTimeout(500)
    expect(await stageOf(page, ids[0]!)).toBe('Approve spec')
    // A: VON HAND, it goes to Claude Code
    await press(page, 'a')
    await expect(page.getByTestId('pf-confirm')).toContainText('goes to Claude Code')
    await page.getByTestId('pf-confirm-key').press('Enter')
    await expect.poll(() => stageOf(page, ids[0]!), { timeout: 20_000 }).not.toBe('Approve spec')
  })

  test('Kette bestätigen: every step in full; ↵ is all or nothing — a step changed since: nothing trusted, no record; read again: this device carries the chain', async ({ page }) => {
    await mockClaudeScript(page.context(), [], { fallback: answer() })
    const { row } = await setup(page, { approvals: 'none' })
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'ready' })
    const ids = (await orders(page).start(row)).steps as string[]
    // no worker from here on; this device forgets the chain (as a device the worker moved to, or a restored backup)
    await fake!.close()
    fake = null
    await orders(page).dropRecord(row)
    expect(await orders(page).record(row)).toBeNull()
    expect(await statusOf(page, row)).toBe(ST.running)
    // an agent appends to step 01: its version waits for Confirm on this device
    expect(await orders(page).agentAppend(ids[0]!, 'Notiz vom Agenten: bitte auch Tessera fragen.')).toBe(true)
    await expect.poll(() => orders(page).trusted(ids[0]!)).toBe(false)
    // the card comes once the Status settled (10 s)
    await expect.poll(async () => (await orders(page).cards()).map((c) => c.kind), { timeout: 25_000 }).toContain('chainConfirm')
    await openLamp(page, 'orders')
    const id = await ready(page, 'chainConfirm')
    const body = card(page).getByTestId('pf-order-confirm')
    await expect(body.getByTestId('pf-order-step')).toHaveCount(3)
    await expect(body.getByTestId('pf-order-step').nth(0)).toContainText('Notiz vom Agenten: bitte auch Tessera fragen.')
    await expect(body.getByTestId('pf-order-step').nth(1)).toContainText('Session-Timeout beheben')
    await expect(card(page)).toHaveAttribute('data-hand', '')
    // step 02 changes after the card read it: ↵ trusts nothing and writes no record
    await wsEval(page, (s, x) => s.updatePage(x, { title: 'Session-Timeout im Gateway beheben' }), ids[1]!)
    await press(page, 'a')
    await expect(page.getByTestId('pf-confirm')).toBeVisible()
    await page.getByTestId('pf-confirm-key').press('Enter')
    await expect(card(page).locator('.pf-card__error')).toContainText('Changed since — read it again.')
    expect(await orders(page).record(row)).toBeNull()
    expect(await orders(page).trusted(ids[0]!)).toBe(false)
    // read again: the steps as they are now — ↵ confirms all of them, this device carries the chain on
    await card(page).getByRole('button', { name: 'Read again' }).click()
    await ready(page, 'chainConfirm')
    expect(await card(page).getAttribute('data-id')).toBe(id)
    await expect(card(page).getByTestId('pf-order-step').nth(1)).toContainText('Session-Timeout im Gateway beheben')
    await press(page, 'a')
    await page.getByTestId('pf-confirm-key').press('Enter')
    await expect.poll(async () => (await orders(page).record(row))?.state ?? null, { timeout: 15_000 }).toBe('running')
    const rec = (await orders(page).record(row))!
    expect((rec.chain.steps as AnyState[]).map((s) => s.id)).toEqual(ids)
    expect((rec.chain.steps as AnyState[]).map((s) => s.n)).toEqual([1, 2, 3])
    expect(rec.chain.adopted).toBeGreaterThan(0)
    for (const t of ids) expect(await orders(page).trusted(t)).toBe(true)
    // the engine goes on from here: step 01 leaves its park stage; Z never takes an adopted chain back
    await expect.poll(async () => (await orders(page).record(row))!.chain.advanced?.['1'] ?? null, { timeout: 15_000 }).not.toBeNull()
    expect(await call(page, 'undoable', row)).toBe('taken')
  })

  test('Kette angehalten: ↵ Fortsetzen only where the chain may start something — an outdated worker refuses it (the reason on the key); a current one resumes', async ({ page }) => {
    await mockClaudeScript(page.context(), [], { fallback: answer() })
    const { row } = await setup(page, { approvals: 'none' })
    plays(fake!)
    expect(await orders(page).plan(row)).toMatchObject({ kind: 'ready' })
    await orders(page).start(row)
    await orders(page).startNow(row)
    await expect.poll(async () => (await orders(page).move(row))?.why ?? null, { timeout: 40_000 }).toBe('checkpoint')
    expect(await orders(page).halt(row)).toMatchObject({ ok: true })
    expect((await orders(page).record(row))!.state).toBe('halted')
    // an outdated worker in place of the current one
    await fake!.close()
    fake = await startFakeWorker(PORT, { ...WELCOME, worker: '1.9.0' })
    fake.can = WORKER_CAN.filter((c) => c !== 'permission')
    await expect.poll(() => page.evaluate(() => (window as unknown as Seam).__onePreflight.stores.coding.getState().can?.length ?? -1), { timeout: 30_000 }).toBe(WORKER_CAN.length - 1)
    await openLamp(page, 'orders')
    await ready(page, 'halted')
    const body = card(page).getByTestId('pf-order-halted')
    await expect(body).toContainText('Chain halted: set to Halted')
    await expect(body.getByTestId('pf-order-step').locator('.ord-step__head')).toHaveText('Resume starts: 02 coding ‹Session-Timeout beheben›')
    await expect(body.getByTestId('pf-order-step-text')).toContainText('Login bleibt 5 Minuten offen')
    const a = card(page).locator('.pf-key[data-key="a"]')
    await expect(a).toHaveAttribute('aria-disabled', 'true')
    await expect(a).toHaveAttribute('title', /Update the worker first/)
    await press(page, 'a')
    await expect(page.getByTestId('pf-confirm')).toHaveCount(0)
    await expect(live(page)).toContainText('Update the worker first')
    expect((await orders(page).record(row))!.state).toBe('halted')
    // the current worker back: the key acts (VON HAND)
    await fake!.close()
    fake = await startFakeWorker(PORT, WELCOME)
    fake.can = [...WORKER_CAN]
    plays(fake)
    await expect(a).not.toHaveAttribute('aria-disabled', 'true', { timeout: 30_000 })
    await press(page, 'a')
    await expect(page.getByTestId('pf-confirm')).toContainText('starts the worker · goes to Claude Code')
    await page.getByTestId('pf-confirm-key').press('Enter')
    await expect.poll(async () => (await orders(page).record(row))!.state, { timeout: 15_000 }).toBe('running')
    expect(await statusOf(page, row)).toBe(ST.running)
  })
})

/* ------------------------------------------------------------------ Node cases */

node('the cards\' strings: EN = DE (keys and placeholders), the names, never "danach" / "Plan bereit" / "Prüfung"', () => {
  const en = cards.en as Record<string, string>
  const de = cards.de as Record<string, string>
  nodeExpect(Object.keys(de).sort()).toEqual(Object.keys(en).sort())
  const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
  for (const k of Object.keys(en)) nodeExpect(holes(de[k]!), k).toEqual(holes(en[k]!))
  const pen = preflight.en as Record<string, string>
  const pde = preflight.de as Record<string, string>
  const lamp = Object.keys(pen).filter((k) => k.startsWith('features.preflight.lamp.orders.') || /^features\.preflight\.(kind|card\.aria)\.(ready|next|halted|interrupted|chainConfirm|request)$/.test(k))
  nodeExpect(lamp.length).toBeGreaterThanOrEqual(10)
  for (const k of lamp) nodeExpect(pde[k], k).toBeTruthy()
  const allDe = [...Object.entries(de), ...lamp.map((k) => [k, pde[k]!] as const)]
  const allEn = [...Object.entries(en), ...lamp.map((k) => [k, pen[k]!] as const)]
  for (const [k, v] of allDe) {
    nodeExpect(v, k).not.toMatch(/\bdanach\b|Plan bereit|Prüfung\b/i)
    nodeExpect(v, k).not.toMatch(/\bWork order\b|\bChain\b|\bPlanner\b/)
  }
  for (const [k, v] of allEn) nodeExpect(v, k).not.toMatch(/Prüfauftrag|\bKette\b|\bPlaner\b/)
  nodeExpect(pde['features.preflight.lamp.orders.legend']).toBe('Prüfaufträge')
  nodeExpect(pen['features.preflight.lamp.orders.legend']).toBe('Work orders')
  nodeExpect(de['features.coding.order.preflight.halted']).toBe('Kette angehalten')
  nodeExpect(en['features.coding.order.preflight.next']).toBe('Go on with step {n}?')
})
