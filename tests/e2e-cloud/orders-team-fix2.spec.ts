/**
 * Work orders in a team — review Fix 2 (two devices of the SAME member against the real team server, a fake worker):
 *  1. Fertig taken back on the other device ("End the chain?" → No): the worker device had ended the chain on reading
 *     that Fertig — the halt stays (only ↵ Fortsetzen lifts it) and the Status says Angehalten on every device; its
 *     Preflight card "Kette angehalten" is there (never a chain stopped under a Status that reads Läuft).
 *  2. A request made on the worker device itself straight into Planen (a duplicate, a template …) is never "asked for on
 *     another device".
 *  3. Two Local workers of one member: a step another worker has claimed — the other device offers no "Kette bestätigen"
 *     and refuses to take the chain over ('steered').
 * Fictional data (Nordlicht, Tessera, Mara Lind, Supportfall 4711).
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
const PORT = Number(process.env.CODING_E2E_PORT) || 47384

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
  const edges = card.locator('.orc-edge')
  for (let i = 0; i < (await edges.count()); i++) await edges.nth(i).scrollIntoViewIfNeeded()
}
const openRow = async (p: Page, row: string) => {
  await p.evaluate((id) => (window.location.hash = `#/p/${id}`), row)
  await expect(p.getByTestId('order-plate')).toBeVisible()
}


test('Fix 2: Fertig taken back on B (its "No") — A keeps the chain halted and the Status says Angehalten on both; A\'s card asks ↵ Fortsetzen', async ({ page: a, context }) => {
  test.setTimeout(300_000)
  fake = await startFakeWorker(PORT, WELCOME)
  fake.can = [...WORKER_CAN]
  plays(fake)
  const { wsId, address } = await deviceA(a, 'all')
  const { row, ids } = await seedRequest(a, 'plan')
  await mockClaudeScript(a.context(), [], { fallback: answer(ids) })
  expect(await seam<AnyState>(a, '__oneOrders', (s, r) => s.plan(r, { mode: 'manual', replace: true }), row)).toMatchObject({ kind: 'ready' })
  const started = await orders(a).start(row)
  expect(started, JSON.stringify(started)).toMatchObject({ ok: true })
  const steps = started.steps as string[]
  await orders(a).startNow(row)
  await expect.poll(() => stageKindOf(a, steps[0]!), { timeout: 40_000 }).toBe('gate')

  const b = await deviceB(context, address, wsId, 'none')
  await expect.poll(() => orders(b).status(row), { timeout: 20_000 }).toBe('running')
  // B: the person sets Fertig — "End the chain?" opens on B; A reads the Fertig as the end
  await seam(b, '__oneOrderEntries', (s, r) => s.setStatusAs(r, 'done', { kind: 'you', via: 'ui' }), row)
  const ask = b.getByRole('dialog')
  await expect(ask).toBeVisible()
  await expect.poll(async () => (await orders(a).record(row))?.chain?.halted?.why ?? null, { timeout: 20_000 }).toBe('finished')
  // B: No — the Status goes back to Läuft there …
  await b.keyboard.press('Escape')
  await expect(ask).toHaveCount(0)
  // … and A, which ended the chain on that Fertig, says so: Angehalten on every device, A's card asks ↵ Fortsetzen
  await expect.poll(() => orders(a).status(row), { timeout: 20_000 }).toBe('halted')
  await expect.poll(() => orders(b).status(row), { timeout: 20_000 }).toBe('halted')
  const rec = (await orders(a).record(row))!
  expect(rec.state).toBe('halted')
  expect(rec.chain.halted.why).toBe('finished')
  await expect.poll(async () => (await orders(a).cards()).filter((c) => c.row === row).map((c) => c.kind), { timeout: 20_000 }).toEqual(['halted'])
  // nothing started meanwhile; ↵ Fortsetzen (A) goes on from there
  expect(handed(fake, steps[1]!)).toBe(false)
  expect(await orders(a).resume(row)).toMatchObject({ ok: true })
  await expect.poll(() => orders(a).status(row), { timeout: 20_000 }).toBe('running')
  await b.context().close()
})

test('Fix 2: a request made on the worker device straight into Planen is never "asked for on another device"', async ({ page: a }) => {
  test.setTimeout(180_000)
  fake = await startFakeWorker(PORT, WELCOME)
  fake.can = [...WORKER_CAN]
  plays(fake)
  await deviceA(a, 'none')
  const { db, row } = await seedRequest(a, 'draft')
  // a duplicate of a request in Planen (as a duplicate, a template, an automation or an import makes it) — made HERE
  const dup = await wsEval(
    a,
    (s, x) => {
      const d = s.databases[x.db]
      const prop = d.properties.find((p: AnyState) => p.type === 'select' && p.options?.some((o: AnyState) => o.id === d.orders.status.plan))
      return s.createRow(x.db, { title: 'Login-Timeout prüfen (Kopie)', properties: { [prop.id]: d.orders.status.plan }, content: s.pages[x.row].content }) as string
    },
    { db, row },
  )
  await a.waitForTimeout(3000)
  await a.evaluate(() => (window as unknown as { __onePreflight: { flush: () => Promise<void> } }).__onePreflight.flush())
  expect((await orders(a).cards()).filter((c) => c.row === dup)).toEqual([])
  expect((await orders(a).record(dup))?.asked).toBeUndefined()
  await openRow(a, dup)
  await expect(a.getByTestId('order-asked')).toHaveCount(0)
})

test('Fix 2: two Local workers of one member — a step another worker claimed: no "Kette bestätigen" on the other device, its take-over refused', async ({ page: a, context }) => {
  test.setTimeout(300_000)
  fake = await startFakeWorker(PORT, WELCOME)
  fake.can = [...WORKER_CAN]
  // step 01 stays running on A's worker (claimed by it)
  plays(fake, () => null)
  const second = await startFakeWorker(PORT + 1, { ...WELCOME, name: 'tessera-laptop' })
  second.can = [...WORKER_CAN]
  try {
    const { wsId, address } = await deviceA(a, 'none')
    const { row, ids } = await seedRequest(a, 'plan')
    await mockClaudeScript(a.context(), [], { fallback: answer(ids) })
    expect(await seam<AnyState>(a, '__oneOrders', (s, r) => s.plan(r, { mode: 'manual', replace: true }), row)).toMatchObject({ kind: 'ready' })
    const started = await orders(a).start(row)
    expect(started, JSON.stringify(started)).toMatchObject({ ok: true })
    const steps = started.steps as string[]
    await orders(a).startNow(row)
    await expect.poll(() => handed(fake!, steps[0]!), { timeout: 40_000 }).toBe(true)

    // B: the member's other computer with its own Local worker
    const b = await deviceB(context, address, wsId, 'none')
    await b.evaluate(() => localStorage.setItem('one.coding.approvals', 'none'))
    await codingSettings(b)
    const port = b.getByLabel('Port', { exact: true })
    await port.fill(String(PORT + 1))
    await port.press('Enter')
    const localB = b.getByRole('switch', { name: 'Connect to a coding worker on this computer' })
    await localB.click()
    await expect(localB).toHaveAttribute('aria-checked', 'true')
    await b.keyboard.press('Escape')
    await expect.poll(() => conn(b), { timeout: 30_000 }).toBe('connected')
    await expect.poll(() => wsEval(b, (s, id) => !!s.pages[id], steps[2]!), { timeout: 20_000 }).toBe(true)
    await expect.poll(() => seam<boolean>(b, '__oneOrders', (s, x) => s.claimedElsewhere(x), steps), { timeout: 45_000 }).toBe(true)
    // past the settle time: still no card on B
    await b.waitForTimeout(12_000)
    expect((await orders(b).cards()).filter((c) => c.row === row)).toEqual([])
    // the take-over itself refuses
    const shown = steps.map((id) => ({ id, hash: 'f'.repeat(64) }))
    expect(await seam<AnyState>(b, '__oneOrders', (s, x) => s.confirmChain(x.row, x.shown), { row, shown })).toMatchObject({ ok: false, why: 'steered' })
    expect(await orders(b).record(row)).toBeNull()
    await b.context().close()
  } finally {
    await second.close()
  }
})
