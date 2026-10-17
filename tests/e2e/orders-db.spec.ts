/**
 * Work orders (Prüfaufträge) B4 — the database and its entry points (spec §1.1–§1.3, §1.10, §2.2 items 1–6, §2.3,
 * §3.1). The planner is the real one (orders/planner.ts, B5) — this suite sets up no AI, so a press that reaches it ends
 * at its item 7 ('blocked' · 'ai': nothing read, nothing sent); every call into it is noted by the entry points
 * (`__oneOrderEntries.planned()`), so every case asks "did this plan — how, in which mode — or not".
 *
 *  - Node: the preconditions in their order (which keep the press), the kept press's reader bounds.
 *  - the database: Status options by id (six lanes on the board), Pipelines, the id prefix, the #/coding key + N, the
 *    Settings row; the database head links back to #/coding.
 *  - Coding off: the menus offer no "Have it checked"; ⌘K finds it and says why, with the key to Settings.
 *  - worker away: the press is kept on this device, the plate says so — the worker comes back (fake worker) and it
 *    plans 5 s later in mode 'trigger', once; an expired press never fires, ↵ Plan again does.
 *  - "Have it checked" on a page: a row + the peek, the source page unchanged; a second time opens the first;
 *    "Have it checked …" puts the note above the page mention.
 *  - the allow-list: only the person's Status write in this tab plans — an Undo, a template, an automation, the terminal,
 *    an agent, the sync, the bridge, a script, an import, another tab's replay never do; a new card in the Plan lane is
 *    no press.
 *  - the lane rules: put back (Running / Chain ready by hand, Plan or Draft while running), ask on Done while running,
 *    Draft from Chain ready discards the plan (Undo); a real board drag into Plan plans.
 *  - the outdated worker and the command Planen (⌘K, the request in the peek); the worker with the security gap
 *    (unsafe): its notice and fix key, the press kept until a safe worker is back.
 *  (The team cases — a private database, the worker on another device, viewers — are tests/e2e-cloud/orders-team.spec.ts.)
 * Fictional data (Nordlicht, Tessera, Launch plan). The worker is played by the test (helpers/fakeWorker.ts).
 */
import type { Page } from '@playwright/test'
import { test as node, expect as nodeExpect } from '@playwright/test'
import { test, expect, openApp, wsEval, gotoPage } from './fixtures'
import { startFakeWorker, type FakeWorker } from './helpers/fakeWorker'
import { WORKER_CAN, type WorkerInfo } from '../../src/app/features/coding/protocol'
import { orderPre, type OrderPreFacts } from '../../src/app/features/coding/orders/pre'
import { readOrderRecord, readPress } from '../../src/app/features/coding/orders/record'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/* ------------------------------------------------------------------ Node */

node.describe('the preconditions of a press (§2.2 items 1–6) and the kept press', () => {
  const facts = (over: Partial<OrderPreFacts> = {}): OrderPreFacts => ({
    enabled: true,
    readOnly: false,
    online: true,
    elsewhere: false,
    verdict: 'ok',
    repos: 1,
    docs: true,
    kinds: [
      { kind: 'spec', project: null, problem: null },
      { kind: 'coding', project: 'cdP', problem: null },
      { kind: 'qa', project: 'qaP', problem: 'startsAtOnce' },
    ],
    ...over,
  })
  node('in their order — the first that fails decides; worker-side failures keep the press', () => {
    nodeExpect(orderPre(facts({ enabled: false, readOnly: true, online: false }))).toMatchObject({ ok: false, why: 'codingOff', want: true })
    nodeExpect(orderPre(facts({ readOnly: true, online: false }))).toMatchObject({ ok: false, why: 'readOnly', want: false })
    nodeExpect(orderPre(facts({ online: false, verdict: null }))).toMatchObject({ ok: false, why: 'offline', want: true })
    nodeExpect(orderPre(facts({ online: false, elsewhere: true, verdict: null }))).toMatchObject({ ok: false, why: 'elsewhere', want: false })
    nodeExpect(orderPre(facts({ verdict: 'outdated' }))).toMatchObject({ ok: false, why: 'outdated', want: true })
    nodeExpect(orderPre(facts({ verdict: 'unsafe', repos: 0, docs: false }))).toMatchObject({ ok: false, why: 'unsafe', want: true })
    nodeExpect(orderPre(facts({ repos: 0, docs: false }))).toMatchObject({ ok: false, why: 'noRepos', want: false })
    // doc stages alone are enough (BA / QA without a repo)
    nodeExpect(orderPre(facts({ repos: 0, docs: true })).ok).toBe(true)
  })
  node('usable kinds: a project that cannot take chain steps is left out and named; none left → noProject', () => {
    const ok = orderPre(facts())
    nodeExpect(ok).toMatchObject({ ok: true, usable: ['spec', 'coding'] })
    nodeExpect(ok.ok && ok.left.map((k) => [k.kind, k.problem])).toEqual([['qa', 'startsAtOnce']])
    const none = orderPre(facts({ kinds: [{ kind: 'coding', project: 'cdP', problem: 'locked' }] }))
    nodeExpect(none).toMatchObject({ ok: false, why: 'noProject', want: false })
    nodeExpect(!none.ok && none.left.map((k) => k.problem)).toEqual(['locked'])
  })
  node('a kept press is read within bounds: its run, how and provenance; anything else is dropped', () => {
    const press = { run: 'run0001', at: 5, how: 'status', prov: { rowA1: { createdBy: 'agent:x1', updatedBy: null, contentOrigin: 'ai', contentRev: 3 }, 'bad id!': { contentRev: 1 } }, pins: { rowA1: 3, pageB1: -1 } }
    nodeExpect(readPress(press)).toEqual({ run: 'run0001', at: 5, how: 'status', prov: { rowA1: { createdBy: 'agent:x1', updatedBy: null, contentOrigin: 'ai', contentRev: 3 } }, pins: { rowA1: 3 } })
    nodeExpect(readPress({ ...press, how: 'automation' })).toBeNull()
    nodeExpect(readPress({ ...press, run: 'no spaces allowed' })).toBeNull()
    const rec = readOrderRecord({ v: 1, state: 'draft', want: { at: 9, mode: 'trigger', press } })
    nodeExpect(rec?.want?.press?.how).toBe('status')
    nodeExpect(readOrderRecord({ v: 1, state: 'draft', want: { at: 9, mode: 'trigger', press: { junk: true } } })?.want).toEqual({ at: 9, mode: 'trigger' })
  })
})

/* ------------------------------------------------------------------ in the app */

const CODING_PORT = Number(process.env.CODING_E2E_PORT) || 47396
const INFO: WorkerInfo = { worker: '1.11.0', name: 'nordlicht-box', repos: [{ name: 'website', baseBranch: 'main' }], parallel: 1, busy: [], spentToday: 0, dayLimit: null, claude: { found: true, version: '2.0.0' }, setup: true, mcp: [] }

type Planned = { rowId: string; mode: 'manual' | 'trigger'; how: string; run: string; prov: string[] }
type Seam = {
  planned: () => Planned[]
  clearPlanned: () => void
  dbId: () => string | null
  ensure: () => string
  status: (row: string) => string | null
  setStatusAs: (row: string, key: string, writer: unknown) => boolean
  record: (row: string) => Promise<AnyState | null>
  ageWant: (row: string, ms: number) => Promise<unknown>
  fireWants: () => Promise<void>
  send: (pageId: string, note?: string) => string
}
const seam = <R,>(page: Page, fn: (s: Seam, arg: any) => R | Promise<R>, arg?: unknown): Promise<R> => // eslint-disable-line @typescript-eslint/no-explicit-any
  page.evaluate(
    ({ src, arg }) => new Function('s', 'arg', `return (${src})(s, arg)`)((window as unknown as { __oneOrderEntries: unknown }).__oneOrderEntries, arg),
    { src: fn.toString(), arg },
  ) as Promise<R>
const planned = (page: Page) => seam(page, (s) => s.planned())
const statusOf = (page: Page, row: string) => seam(page, (s, r) => s.status(r), row)
const want = (page: Page, row: string) => seam(page, async (s, r) => (await s.record(r))?.want ?? null, row)

async function ready(page: Page): Promise<void> {
  await openApp(page)
  await page.waitForFunction(() => !!(window as unknown as { __oneOrderEntries?: unknown }).__oneOrderEntries)
}

/** Settings → Coding worker: the test port, switched on (connected only when `fake` is running). */
async function switchOn(page: Page, connected = true) {
  await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
  await page.getByRole('tab', { name: /Coding worker|Coding-Worker/ }).click()
  const port = page.getByLabel('Port', { exact: true })
  await port.fill(String(CODING_PORT))
  await port.press('Enter')
  await page.getByRole('switch', { name: 'Connect to a coding worker on this computer' }).click()
  if (connected) await expect(page.getByTestId('coding-conn')).toContainText('nordlicht-box')
  await page.keyboard.press('Escape')
}

/** A page to have checked (fictional), and its id. */
const sourcePage = (page: Page, title = 'Launch plan Nordlicht') =>
  wsEval(page, (s, title) => {
    const id = s.createPage({ title, parentId: null }) as string
    s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Tessera rollout: the login stops after 30 s on the staging box; the footer links are dead.' }] }] }, 'import')
    return id
  }, title)

/** A request row in the work-orders database (made through the app's own ensure), its Status by key. */
async function request(page: Page, title: string, key: string): Promise<string> {
  return seam(
    page,
    (s, a) => {
      const db = s.ensure()
      const w = (window as unknown as { __one: { workspace: { getState: () => AnyState } } }).__one.workspace.getState()
      const d = w.databases[db]
      const prop = d.properties.find((p: { type: string; options?: Array<{ id: string }> }) => p.type === 'select' && p.options?.some((o) => o.id === d.orders.status.draft))
      return w.createRow(db, { title: a.title, properties: { [prop.id]: d.orders.status[a.key] }, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Prüfe, warum der Login nach 30 s abbricht; Repo website.' }] }] } }) as string
    },
    { title, key },
  )
}

// every case plays the worker on the same port: one after another, in one worker process (never side by side)
test.describe.configure({ mode: 'default' })

let fake: FakeWorker | null = null
test.afterEach(async () => {
  await fake?.close()
  fake = null
})

test('the database: Status options by id (six lanes), Pipelines, the id prefix — made from the #/coding key; its head links back; N makes a request in Draft', async ({ page }) => {
  await ready(page)
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await page.getByTestId('coding-orders').click()
  await expect(page.getByTestId('order-db-head')).toContainText('0 open')
  const db = await wsEval(page, (s) => {
    const d = Object.values(s.databases as Record<string, AnyState>).find((x) => x.system === 'workorders')!
    const status = d.properties.find((p: AnyState) => p.type === 'select' && p.options?.some((o: AnyState) => o.id === d.orders.status.draft))
    const board = d.views.find((v: AnyState) => v.type === 'board')
    return {
      id: d.id as string,
      title: s.pages[d.id].title,
      options: status.options.map((o: AnyState) => o.name),
      byId: Object.entries(d.orders.status).map(([k, id]) => [k, status.options.find((o: AnyState) => o.id === id)?.name]),
      board: { groupBy: board.groupBy === status.id, hidden: board.hiddenGroups },
      props: d.properties.map((p: AnyState) => `${p.name}:${p.type}${p.idPrefix ? `:${p.idPrefix}` : ''}`),
      pipelines: d.properties.find((p: AnyState) => p.type === 'multi_select').options.map((o: AnyState) => o.name),
      config: { kinds: d.orders.kinds, checkpoint: d.orders.checkpoint, server: d.orders.server },
    }
  })
  expect(db.title).toBe('Work orders')
  expect(db.options).toEqual(['Draft', 'Plan', 'Chain ready', 'Running', 'Halted', 'Done'])
  expect(db.byId).toEqual([
    ['draft', 'Draft'],
    ['plan', 'Plan'],
    ['ready', 'Chain ready'],
    ['running', 'Running'],
    ['halted', 'Halted'],
    ['done', 'Done'],
  ])
  expect(db.board).toEqual({ groupBy: true, hidden: ['__none__'] })
  expect(db.props).toEqual(['Name:title', 'Status:select', 'Repo:select', 'Pipelines:multi_select', 'Priority:select', 'ID:unique_id:WO', 'Created:created_time'])
  expect(db.pipelines).toEqual(['Business analysis', 'Coding', 'QA'])
  expect(db.config).toEqual({ kinds: ['spec', 'coding', 'qa'], checkpoint: true, server: null })
  // the six lanes on the board
  for (const lane of ['Draft', 'Plan', 'Chain ready', 'Running', 'Halted', 'Done']) await expect(page.locator('#main').getByText(lane, { exact: true }).first()).toBeVisible()
  // back to #/coding; the key counts what is open; N makes a request (Draft — it plans nothing by itself)
  await page.getByTestId('order-db-back').click()
  await expect(page.getByTestId('coding-orders')).toContainText('0 open')
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('n')
  await page.waitForFunction(() => window.location.hash.startsWith('#/p/'))
  const row = await page.evaluate(() => window.location.hash.slice(4))
  expect(await statusOf(page, row)).toBe('draft')
  await expect(page.getByTestId('order-plate')).toBeVisible()
  await expect(page.getByTestId('order-status')).toContainText('Draft')
  // Coding is off here: the plate's strip says so first, with the key to Settings
  await expect(page.getByTestId('order-pre')).toHaveAttribute('data-why', 'codingOff')
  await expect(page.getByTestId('order-pre')).toContainText('Coding is off on this device')
  await expect(page.getByTestId('order-lamp-coding')).toContainText('off')
  await expect(page.getByTestId('order-lamp-context')).toContainText('without server')
  expect(await planned(page)).toEqual([])
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await expect(page.getByTestId('coding-orders')).toContainText('1 open')
  // a row made here without a Status (a table's New, the sidebar's + entry) stands in Draft — the board hides none
  const bare = await wsEval(page, (s, db) => s.createRow(db, { title: 'Tessera-Suche prüfen' }) as string, db.id)
  await expect.poll(() => statusOf(page, bare)).toBe('draft')
  expect(await planned(page)).toEqual([])
})

test('Coding off: the menus offer no "Have it checked"; ⌘K finds it and says why, with the key to Settings › Coding worker', async ({ page }) => {
  await ready(page)
  const src = await sourcePage(page)
  await gotoPage(page, src)
  await page.locator('.tb').getByRole('button', { name: 'Page options' }).click()
  await expect(page.getByRole('menuitem', { name: 'Copy for AI context' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Have it checked' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+k')
  await page.locator('.pal-input input').fill('Have it checked')
  await page.waitForTimeout(250)
  await page.keyboard.press('Enter')
  const toast = page.locator('.toast', { hasText: 'Coding is off on this device' })
  await expect(toast).toBeVisible()
  // nothing was made, nothing planned
  expect(await seam(page, (s) => s.dbId())).toBeNull()
  await toast.getByRole('button', { name: 'Coding worker' }).click()
  await expect(page.getByTestId('coding-settings')).toBeVisible()
})

test('worker away: the press is kept on this device and the plate says so — the worker comes back and it plans 5 s later (trigger), once; the page is not changed; a second send opens the first', async ({ page, errors }) => {
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  await ready(page)
  await switchOn(page, false)
  const src = await sourcePage(page)
  const before = await wsEval(page, (s, id) => ({ rev: s.pages[id].contentRev, plain: s.pages[id].plain, title: s.pages[id].title }), src)
  await gotoPage(page, src)
  await page.locator('.tb').getByRole('button', { name: 'Page options' }).click()
  await page.getByRole('menuitem', { name: 'Have it checked', exact: true }).click()
  // a row titled like the page, body "Page: @…", Status Plan, opened in the side peek; the first use made the database
  await expect(page.locator('.toast', { hasText: 'Work orders created · WO-1' })).toBeVisible()
  const peek = page.locator('.peek')
  await expect(peek.getByTestId('order-plate')).toBeVisible()
  const row = (await seam(page, (s) => {
    const w = (window as unknown as { __one: { workspace: { getState: () => AnyState } } }).__one.workspace.getState()
    return Object.values(w.pages as Record<string, AnyState>).find((p) => p.databaseId === s.dbId())!.id as string
  })) as string
  expect(await statusOf(page, row)).toBe('plan')
  expect(await wsEval(page, (s, id) => ({ title: s.pages[id].title, plain: s.pages[id].plain }), row)).toEqual({ title: 'Launch plan Nordlicht', plain: expect.stringContaining('Page: @Launch plan Nordlicht') })
  // kept, not planned: the plate says why and until when
  await expect(peek.getByTestId('order-chip')).toHaveText('waiting for the worker')
  await expect(peek.getByTestId('order-pre')).toHaveAttribute('data-why', 'later')
  await expect(peek.getByTestId('order-pre')).toContainText('Plans when the worker is back (until')
  expect(await planned(page)).toEqual([])
  const kept = await want(page, row)
  expect(kept).toMatchObject({ mode: 'trigger', press: { how: 'send' } })
  expect(Object.keys(kept!.press.prov)).toEqual([row, src])
  // the source page is not changed (the mention is its backlink)
  expect(await wsEval(page, (s, id) => ({ rev: s.pages[id].contentRev, plain: s.pages[id].plain, title: s.pages[id].title }), src)).toEqual(before)

  // the worker comes back: 5 s after it is online with an 'ok' verdict the kept press plans — mode 'trigger', once
  fake = await startFakeWorker(CODING_PORT, INFO)
  fake.can = [...WORKER_CAN]
  await expect(peek.getByTestId('order-lamp-worker')).toContainText('nordlicht-box', { timeout: 30_000 })
  const at = Date.now()
  await expect.poll(() => planned(page), { timeout: 20_000 }).toHaveLength(1)
  expect(Date.now() - at).toBeGreaterThan(3000)
  expect((await planned(page))[0]).toMatchObject({ rowId: row, mode: 'trigger', how: 'send', prov: [row, src] })
  // the planner itself (no AI set up in this suite) refuses at item 7 — nothing read or sent; the press is put back
  // and parked: the next pass (the records' own channel message, or a call) does not plan it again — only the worker's
  // next return does (no loop every 5 s)
  await expect.poll(() => page.evaluate((r) => (window as unknown as { __oneOrders: { run(r: string): Promise<AnyState | null> } }).__oneOrders.run(r), row)).toMatchObject({ run: kept!.press.run, outcome: { kind: 'blocked', block: { why: 'ai' } } })
  await expect.poll(() => want(page, row)).toMatchObject({ at: kept!.at, press: { run: kept!.press.run } })
  await expect(peek.getByTestId('order-outcome')).toHaveText('AI is not set up for this kind of work on this device')
  await expect(peek.getByTestId('order-chip')).toHaveCount(0)
  await seam(page, (s) => s.fireWants())
  await page.waitForTimeout(6_000)
  expect(await planned(page)).toHaveLength(1)

  // a second "Have it checked" of the same page opens the open request instead; "New request" makes another
  await seam(page, (s, id) => s.send(id), src)
  await expect(page.locator('.toast', { hasText: 'Already in WO-1 (Plan)' })).toBeVisible()
  expect(await wsEval(page, (s, db) => Object.values(s.pages as Record<string, AnyState>).filter((p) => p.databaseId === db && !p.trashed).length, await seam(page, (s) => s.dbId()))).toBe(1)
  await page.locator('.toast', { hasText: 'Already in WO-1 (Plan)' }).getByRole('button', { name: 'New request' }).click()
  const rows = () =>
    seam(page, (s) => {
      const w = (window as unknown as { __one: { workspace: { getState: () => AnyState } } }).__one.workspace.getState()
      return Object.values(w.pages as Record<string, AnyState>).filter((p) => p.databaseId === s.dbId() && !p.trashed).length
    })
  await expect.poll(rows).toBe(2)
  // online now: the second one planned at once (manual)
  await expect.poll(() => planned(page)).toHaveLength(2)
  expect((await planned(page))[1]).toMatchObject({ mode: 'manual', how: 'send' })
})

test('the first "Have it checked" makes the database — its toast\'s Undo takes both back; the Settings row makes it too', async ({ page, errors }) => {
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  await ready(page)
  await switchOn(page, false)
  const src = await sourcePage(page, 'Tessera onboarding')
  expect(await seam(page, (s, id) => s.send(id), src)).toBe('made')
  const db = (await seam(page, (s) => s.dbId()))!
  const toast = page.locator('.toast', { hasText: 'Work orders created · WO-1' })
  await toast.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(() => seam(page, (s) => s.dbId())).toBeNull()
  expect(await wsEval(page, (s, id) => !!s.pages[id]?.trashed, db)).toBe(true)
  await expect(page.locator('.peek')).toHaveCount(0)
  // Settings › Coding worker › Work orders: Create the database
  await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
  await page.getByRole('tab', { name: /Coding worker|Coding-Worker/ }).click()
  await page.getByTestId('coding-orders-create').click()
  await expect(page.getByTestId('order-db-head')).toBeVisible()
  expect(await seam(page, (s) => s.dbId())).not.toBeNull()
})

test('"Have it checked …": the note goes above the page mention, then the press; a kept press expires after 24 h (never fires) and ↵ Plan again presses anew', async ({ page, errors }) => {
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  await ready(page)
  await switchOn(page, false)
  const src = await sourcePage(page, 'Tessera footer')
  await gotoPage(page, src)
  await page.locator('.tb').getByRole('button', { name: 'Page options' }).click()
  await page.getByRole('menuitem', { name: 'Have it checked …' }).click()
  await page.getByTestId('order-note').fill('Watch the dead footer links')
  await page.keyboard.press('Enter')
  const peek = page.locator('.peek')
  await expect(peek.getByTestId('order-plate')).toBeVisible()
  const row = await seam(page, (s) => {
    const w = (window as unknown as { __one: { workspace: { getState: () => AnyState } } }).__one.workspace.getState()
    return Object.values(w.pages as Record<string, AnyState>).find((p) => p.databaseId === s.dbId())!.id as string
  })
  expect(await wsEval(page, (s, id) => (s.pages[id].content.content as AnyState[]).map((b) => (b.content as AnyState[]).map((n) => n.text ?? `@${n.attrs.label}`).join('')), row)).toEqual(['Watch the dead footer links', 'Page: @Tessera footer'])
  expect(await want(page, row)).not.toBeNull()
  // 25 h later the worker is back: the press has expired — it never fires; a fresh read drops it (records.ts)
  await seam(page, (s, r) => s.ageWant(r, 25 * 3600_000), row)
  fake = await startFakeWorker(CODING_PORT, INFO)
  fake.can = [...WORKER_CAN]
  await expect(peek.getByTestId('order-lamp-worker')).toContainText('nordlicht-box', { timeout: 30_000 })
  await page.waitForTimeout(6000)
  await seam(page, (s) => s.fireWants())
  expect(await planned(page)).toEqual([])
  expect(await want(page, row)).toBeNull()
  await expect(peek.getByTestId('order-chip')).toHaveCount(0)
  await expect(peek.getByTestId('order-pre')).toHaveAttribute('data-why', 'ok')
  // ↵ Plan presses anew
  await peek.getByTestId('order-plan').click()
  await expect.poll(() => planned(page)).toHaveLength(1)
  expect((await planned(page))[0]).toMatchObject({ rowId: row, mode: 'manual', how: 'plate' })
  expect(await want(page, row)).toBeNull()
})

test('the allow-list: only the person in this tab plans — an Undo, a template, an automation, the terminal, an agent, the sync, the bridge, a script, an import, another tab\'s replay never do; a new card in Plan is no press', async ({ page, errors }) => {
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  fake = await startFakeWorker(CODING_PORT, INFO)
  fake.can = [...WORKER_CAN]
  await ready(page)
  await switchOn(page)
  const row = await request(page, 'Login-Timeout prüfen', 'draft')
  const writers = [
    { kind: 'you', via: 'undo' },
    { kind: 'you', via: 'template' },
    { kind: 'you', via: 'command' },
    { kind: 'template', id: 'tpl1', run: 'r1' },
    { kind: 'automation', db: 'db1', id: 'au1', run: 'r1' },
    { kind: 'terminal', run: 'r1', change: 'c1' },
    { kind: 'agent', id: 'ag1', run: 'r1' },
    { kind: 'sync', source: 'folder', run: 'r1' },
    { kind: 'mcp', session: 's1', call: 'c1', tool: 'one_update_row' },
    { kind: 'script', id: null, run: 'r1' },
    { kind: 'import', run: 'r1', source: 'csv' },
    { kind: 'history', snap: 'snap1' },
    { kind: 'system', why: 'tab' },
    { kind: 'team' },
  ]
  for (const w of writers) {
    expect(await seam(page, (s, a) => s.setStatusAs(a.row, 'plan', a.w), { row, w })).toBe(true)
    await page.waitForTimeout(50)
    expect(await statusOf(page, row)).toBe('plan')
    expect(await seam(page, (s, a) => s.setStatusAs(a.row, 'draft', { kind: 'system', why: 'repair' }), { row })).toBe(true)
  }
  await page.waitForTimeout(300)
  expect(await planned(page)).toEqual([])
  // a new card standing in Plan (a row added there) is no press — a half-written request never plans
  const fresh = await request(page, 'Tessera-Footer prüfen', 'plan')
  await page.waitForTimeout(300)
  expect(await planned(page)).toEqual([])
  // the person (via none / 'ui') in this tab: a press — mode 'manual', how 'status', with the provenance of the row
  expect(await seam(page, (s, r) => s.setStatusAs(r, 'plan', { kind: 'you', via: 'ui' }), row)).toBe(true)
  await expect.poll(() => planned(page)).toHaveLength(1)
  expect((await planned(page))[0]).toMatchObject({ rowId: row, mode: 'manual', how: 'status', prov: [row] })
  // the test hook writes as the person too (you~ui:e2e) — via 'ui'
  await wsEval(page, (s, a) => {
    const d = s.databases[s.pages[a.row].databaseId]
    const prop = d.properties.find((p: AnyState) => p.type === 'select' && p.options?.some((o: AnyState) => o.id === d.orders.status.draft))
    s.setRowProperty(a.row, prop.id, d.orders.status.draft)
    s.setRowProperty(a.row, prop.id, d.orders.status.plan)
  }, { row: fresh })
  await expect.poll(() => planned(page)).toHaveLength(2)
  expect((await planned(page))[1]).toMatchObject({ rowId: fresh, mode: 'manual', how: 'status' })
})

test('the lane rules: Running / Chain ready by hand go back with the key named; Plan or Draft while running go back; Done while running asks; Draft from Chain ready is D (Undo)', async ({ page, errors }) => {
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  fake = await startFakeWorker(CODING_PORT, INFO)
  fake.can = [...WORKER_CAN]
  await ready(page)
  await switchOn(page)
  const row = await request(page, 'Nordlicht-Login prüfen', 'draft')
  const ORDER = { kind: 'order', row, run: 'chainR1', change: 's' }
  const you = (key: string) => seam(page, (s, a) => s.setStatusAs(a.row, a.key, { kind: 'you', via: 'ui' }), { row, key })
  const order = (key: string) => seam(page, (s, a) => s.setStatusAs(a.row, a.key, a.w), { row, key, w: ORDER })

  // into Running by hand (from Draft): back, the toast names what to do
  await you('running')
  await expect.poll(() => statusOf(page, row)).toBe('draft')
  await expect(page.locator('.toast', { hasText: 'plan it first — ↵ Plan' })).toBeVisible()
  // into Chain ready by hand: back
  await you('ready')
  await expect.poll(() => statusOf(page, row)).toBe('draft')
  await expect(page.locator('.toast', { hasText: '“Chain ready” comes from the planner' })).toBeVisible()
  // the order writer (the chain itself) moves it: no rule applies
  await order('ready')
  await page.waitForTimeout(200)
  expect(await statusOf(page, row)).toBe('ready')
  // Chain ready → Running by hand: back, "↵ Start chain"
  await you('running')
  await expect.poll(() => statusOf(page, row)).toBe('ready')
  await expect(page.locator('.toast', { hasText: 'it runs only with ↵ Start chain' })).toBeVisible()
  // Chain ready → Draft by hand = D: the plan discarded, Undo brings the Status back
  await you('draft')
  const discarded = page.locator('.toast', { hasText: 'plan discarded' })
  await expect(discarded).toBeVisible()
  expect(await statusOf(page, row)).toBe('draft')
  await discarded.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(() => statusOf(page, row)).toBe('ready')

  // a running chain: Plan and Draft by hand go back ("halt it first"); nothing plans
  await order('running')
  await you('plan')
  await expect.poll(() => statusOf(page, row)).toBe('running')
  await expect(page.locator('.toast', { hasText: 'chain running — halt it first' }).first()).toBeVisible()
  await you('draft')
  await expect.poll(() => statusOf(page, row)).toBe('running')
  expect(await planned(page)).toEqual([])
  // Done while running asks — Cancel puts it back, End the chain keeps Done
  await you('done')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('The running step finishes; then nothing more starts.')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect.poll(() => statusOf(page, row)).toBe('running')
  await you('done')
  await page.getByRole('dialog').getByRole('button', { name: 'End the chain' }).click()
  await page.waitForTimeout(300)
  expect(await statusOf(page, row)).toBe('done')
  // Halted → Running by hand names ↵ Resume
  await order('halted')
  await you('running')
  await expect.poll(() => statusOf(page, row)).toBe('halted')
  await expect(page.locator('.toast', { hasText: 'it goes on only with ↵ Resume' })).toBeVisible()
  // from Halted into Plan: a follow-up chain may be planned
  await you('plan')
  await expect.poll(() => planned(page)).toHaveLength(1)
})

test('a real board drag into Plan plans (the person, in this tab); a drag into Chain ready goes back', async ({ page, errors }) => {
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  fake = await startFakeWorker(CODING_PORT, INFO)
  fake.can = [...WORKER_CAN]
  await ready(page)
  await switchOn(page)
  const row = await request(page, 'Wissensbasis prüfen', 'draft')
  const db = await seam(page, (s) => s.dbId())
  await gotoPage(page, db!)
  const lane = (name: string) => page.locator(`#main section.dbb-col[aria-label="${name}"]`)
  await expect(lane('Draft').locator('.dbc', { hasText: 'Wissensbasis prüfen' })).toBeVisible()
  const drag = async (from: string, to: string) => {
    const card = lane(from).locator('.dbc', { hasText: 'Wissensbasis prüfen' })
    const a = (await card.boundingBox())!
    const b = (await lane(to).locator('.dbb-col__body').boundingBox())!
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 4, { steps: 4 })
    await page.mouse.move(b.x + b.width / 2, b.y + 30, { steps: 20 })
    await page.waitForTimeout(150)
    await page.mouse.up()
  }
  // (the third lane: one the board need not scroll to)
  await drag('Draft', 'Chain ready')
  await expect(page.locator('.toast', { hasText: '“Chain ready” comes from the planner' })).toBeVisible()
  await expect.poll(() => statusOf(page, row)).toBe('draft')
  await expect(lane('Draft').locator('.dbc', { hasText: 'Wissensbasis prüfen' })).toBeVisible()
  expect(await planned(page)).toEqual([])
  await drag('Draft', 'Plan')
  await expect.poll(() => statusOf(page, row)).toBe('plan')
  await expect.poll(() => planned(page)).toHaveLength(1)
  expect((await planned(page))[0]).toMatchObject({ rowId: row, how: 'status', mode: 'manual' })
})

test('an outdated worker: the press is kept and the plate names the fix; the command Planen (⌘K, the request in the peek) keeps it too — an ok worker plans it', async ({ page, errors }) => {
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  // an older worker (it names no capabilities): outdated
  fake = await startFakeWorker(CODING_PORT, { ...INFO, worker: '1.9.0' })
  await ready(page)
  await switchOn(page)
  const row = await request(page, 'Launch plan prüfen', 'draft')
  await page.evaluate((r) => (window as unknown as { __one: { ui: { getState: () => { openPeek: (id: string) => void } } } }).__one.ui.getState().openPeek(r), row)
  const peek = page.locator('.peek')
  await expect(peek.getByTestId('order-pre')).toHaveAttribute('data-why', 'outdated')
  await expect(peek.getByTestId('order-fix')).toHaveText(/Update the worker/)
  await page.keyboard.press('Control+k')
  await page.locator('.pal-input input').fill('Work orders: Plan')
  await page.waitForTimeout(250)
  await page.keyboard.press('Enter')
  await expect(page.locator('.toast', { hasText: 'waits for the worker' })).toBeVisible()
  expect(await statusOf(page, row)).toBe('plan')
  expect(await want(page, row)).toMatchObject({ press: { how: 'command' } })
  expect(await planned(page)).toEqual([])
  await expect(peek.getByTestId('order-pre')).toHaveAttribute('data-why', 'later')
  // a worker that runs everything takes its place: the kept press plans (trigger)
  await fake.close()
  fake = await startFakeWorker(CODING_PORT, INFO)
  fake.can = [...WORKER_CAN]
  await expect.poll(() => planned(page), { timeout: 40_000 }).toHaveLength(1)
  expect((await planned(page))[0]).toMatchObject({ rowId: row, mode: 'trigger', how: 'command' })
})

test('a worker with the security gap (unsafe): the plate names the notice and its fix — ↵ Plan keeps the press; a safe worker plans it (trigger)', async ({ page, errors }) => {
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  // a worker inside the ZIP-import gap (WORKER_IMPORT_SINCE ≤ v < WORKER_SAFE) that runs everything: 'unsafe', not 'outdated'
  fake = await startFakeWorker(CODING_PORT, { ...INFO, worker: '1.8.0' })
  fake.can = [...WORKER_CAN]
  await ready(page)
  await switchOn(page)
  const row = await request(page, 'Tessera-Login prüfen', 'draft')
  await page.evaluate((r) => (window as unknown as { __one: { ui: { getState: () => { openPeek: (id: string) => void } } } }).__one.ui.getState().openPeek(r), row)
  const peek = page.locator('.peek')
  await expect(peek.getByTestId('order-pre')).toHaveAttribute('data-why', 'unsafe')
  await expect(peek.getByTestId('order-pre')).toContainText('This worker (1.8.0) has a security gap in ZIP import')
  await expect(peek.getByTestId('order-fix')).toHaveText(/Update the worker/)
  // the worker is there (its name and version), its lamp not green
  await expect(peek.getByTestId('order-lamp-worker')).toContainText('nordlicht-box · 1.8.0')
  await expect(peek.getByTestId('order-lamp-worker').locator('.led')).toHaveClass(/led--on/)
  // ↵ Plan: kept on this device (the Status moves to Plan), nothing planned
  await peek.getByTestId('order-plan').click()
  await expect.poll(() => want(page, row)).toMatchObject({ mode: 'trigger', press: { how: 'plate' } })
  expect(await statusOf(page, row)).toBe('plan')
  expect(await planned(page)).toEqual([])
  await expect(peek.getByTestId('order-chip')).toHaveText('waiting for the worker')
  await expect(peek.getByTestId('order-pre')).toHaveAttribute('data-why', 'later')
  await expect(peek.getByTestId('order-pre')).toContainText('security gap in ZIP import')
  // the fix key opens Settings › Coding worker
  await peek.getByTestId('order-fix').click()
  await expect(page.getByTestId('coding-settings')).toBeVisible()
  await page.keyboard.press('Escape')
  // the new worker takes its place: the kept press plans (trigger), once
  const kept = await want(page, row)
  await fake.close()
  fake = await startFakeWorker(CODING_PORT, INFO)
  fake.can = [...WORKER_CAN]
  await expect.poll(() => planned(page), { timeout: 40_000 }).toHaveLength(1)
  expect((await planned(page))[0]).toMatchObject({ rowId: row, mode: 'trigger', how: 'plate', run: kept!.press.run })
  // the real planner (no AI set up in this suite) refuses at item 7 — nothing read or sent; the press is put back and
  // waits for the worker's next return (parked: no second plan from the records' own channel message)
  await expect.poll(() => page.evaluate((r) => (window as unknown as { __oneOrders: { run(r: string): Promise<AnyState | null> } }).__oneOrders.run(r), row)).toMatchObject({ run: kept!.press.run, outcome: { kind: 'blocked', block: { why: 'ai' } } })
  await expect.poll(() => want(page, row)).toMatchObject({ at: kept!.at, press: { how: 'plate', run: kept!.press.run } })
  await expect(peek.getByTestId('order-outcome')).toHaveText('AI is not set up for this kind of work on this device')
  await page.waitForTimeout(6_000)
  expect(await planned(page)).toHaveLength(1)
})
