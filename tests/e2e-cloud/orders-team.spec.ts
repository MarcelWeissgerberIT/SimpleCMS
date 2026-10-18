/**
 * Work orders (Prüfaufträge) B4 in a team workspace, against the real team server (spec §1.1, §2.2 items 2–3, §3.10):
 *
 *  - "Have it checked" makes the work-orders database PRIVATE (createPrivateDatabase) — a colleague never receives it
 *    or its rows; the request row is private too.
 *  - the member's cloud worker hangs on ANOTHER DEVICE (its download made there — this browser holds no key): the plate
 *    says "The worker is attached to another device — plan / start there", its WORKER lamp "on another device", no fix
 *    key; the press is a REQUEST for that device (B12, §3.10): the request stands in Planen ("asked for"), never kept as
 *    a want here and never planned here — the worker device's card plans it (orders-team-chain.spec).
 *  - a viewer: no "Have it checked" in the page menu or ⌘K (also with Coding switched on), the Settings row says
 *    "You can only view this workspace."; a request row someone moved out of Private shows its plate read-only — the
 *    strip says so, no ↵ Plan.
 * The planner is B5's: orders/plan.ts planOrder notes its calls (`__oneOrderEntries.planned()`). No worker runs here —
 * the other device's worker is only its token on the server. Fictional data (Nordlicht, Tessera, Launch plan).
 */
import type { Page } from '@playwright/test'
import { test, expect, email, signIn, newPerson, openApp, waitOnline, createWorkspace, join, api, wsEval, gotoPage } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const errors: string[] = []
function watch(p: Page, who: string) {
  p.on('pageerror', (e) => errors.push(`${who} pageerror: ${e.message}`))
  p.on('console', (m) => {
    // a Local worker link (the viewer's): the browser's own log lines — nobody on its port, or this server's CSP
    // (connect-src: its own origin + https) refusing ws://127.0.0.1 — not ours
    if (m.type() === 'error' && !/WebSocket connection to 'ws:\/\/127\.0\.0\.1|Refused to connect to 'ws:\/\/127\.0\.0\.1:\d+\/' because it violates the following Content Security Policy/.test(m.text())) errors.push(`${who} console.error: ${m.text()}`)
  })
}
test.beforeEach(() => {
  errors.length = 0
})
test.afterEach(() => {
  expect.soft(errors, 'browser errors').toEqual([])
})

type Planned = { rowId: string; mode: string; how: string }
const entries = <R,>(p: Page, fn: (s: any, arg: any) => R | Promise<R>, arg?: unknown): Promise<R> => // eslint-disable-line @typescript-eslint/no-explicit-any
  p.evaluate(
    ({ src, arg }) => new Function('s', 'arg', `return (${src})(s, arg)`)((window as unknown as { __oneOrderEntries: unknown }).__oneOrderEntries, arg),
    { src: fn.toString(), arg },
  ) as Promise<R>
const planned = (p: Page) => entries<Planned[]>(p, (s) => s.planned())
const want = (p: Page, row: string) => entries(p, async (s, r) => (await s.record(r))?.want ?? null, row)
const statusOf = (p: Page, row: string) => entries<string | null>(p, (s, r) => s.status(r), row)

async function ready(p: Page, wsId: string) {
  await openApp(p, wsId)
  await waitOnline(p)
  await p.waitForFunction(() => !!(window as unknown as { __oneOrderEntries?: unknown }).__oneOrderEntries)
}

async function codingSettings(p: Page) {
  await p.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
  await p.getByRole('tab', { name: /Coding worker|Coding-Worker/ }).click()
  await expect(p.getByTestId('coding-settings')).toBeVisible()
}

/** A shared page to have checked (fictional). */
const sourcePage = (p: Page, title: string) =>
  wsEval(p, (s, title) => {
    const id = s.createPage({ title, parentId: null }) as string
    s.setContent(id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Tessera rollout: the login stops after 30 s on the staging box.' }] }] }, 'import')
    return id
  }, title)

const orderRows = (p: Page) =>
  entries<string[]>(p, (s) => {
    const w = (window as unknown as { __one: { workspace: { getState: () => AnyState } } }).__one.workspace.getState()
    return Object.values(w.pages as Record<string, AnyState>)
      .filter((x) => x.databaseId === s.dbId() && !x.trashed)
      .map((x) => x.id as string)
  })

test('"Have it checked" in a team makes a PRIVATE database; the worker on another device: the plate says so, the press is refused — never kept, nothing planned; a colleague sees none of it', async ({ page: a, context }) => {
  watch(a, 'ada')
  await signIn(a, email('ada'))
  const wsId = await createWorkspace(a, 'Nordlicht team')
  const b = await newPerson(context)
  watch(b, 'bob')
  await signIn(b, email('bob'))
  await join(a, b, wsId, 'member')
  await ready(a, wsId)

  // ada's cloud worker was downloaded on another device: its token is on the server, its key only in that browser
  expect((await api(a, 'POST', `/api/workspaces/${wsId}/coding/workers`, { label: 'Tessera laptop' })).status).toBe(201)
  await codingSettings(a)
  await a.getByTestId('coding-via-cloud').click()
  await a.getByRole('switch', { name: 'Connect to my cloud worker through the team server' }).click()
  await expect(a.getByTestId('coding-conn')).toContainText('Paired with another device', { timeout: 15_000 })
  await a.keyboard.press('Escape')

  // Coding is on here: the page menu offers "Have it checked" — the first use makes the database
  const src = await sourcePage(a, 'Launch plan Nordlicht')
  await gotoPage(a, src)
  await a.locator('.tb').getByRole('button', { name: 'Page options' }).click()
  await a.getByRole('menuitem', { name: 'Have it checked', exact: true }).click()
  await expect(a.locator('.toast', { hasText: 'Work orders created · WO-1' })).toBeVisible()
  const peek = a.locator('.peek')
  await expect(peek.getByTestId('order-plate')).toBeVisible()
  const db = (await entries<string | null>(a, (s) => s.dbId()))!
  const [row] = await orderRows(a)
  // private: the database and its request (a page of ada's private documents)
  expect(await wsEval(a, (s, ids) => ids.map((id: string) => !!s.pages[id]?.private), [db, row])).toEqual([true, true])
  expect(await statusOf(a, row!)).toBe('plan')

  // the worker on another device: said on the plate — no fix key here (it is pressed on that device)
  await expect(peek.getByTestId('order-pre')).toHaveAttribute('data-why', 'elsewhere')
  await expect(peek.getByTestId('order-pre')).toContainText('The worker is attached to another device — plan / start there')
  await expect(peek.getByTestId('order-lamp-worker')).toContainText('on another device')
  await expect(peek.getByTestId('order-fix')).toHaveCount(0)
  // B12: asked for on the worker device — never kept here, nothing planned here; no ↵ Plan while it is asked for
  await expect(a.locator('.toast', { hasText: 'WO-1: asked for — the device with the worker shows “Plan here”' })).toBeVisible()
  expect(await want(a, row!)).toBeNull()
  await expect(peek.getByTestId('order-remote-line')).toHaveText('Asked for — the device with the worker shows “Plan here”')
  await expect(peek.getByTestId('order-chip')).toHaveText('asked for')
  await expect(peek.getByTestId('order-plan')).toHaveCount(0)
  await a.waitForTimeout(400)
  expect(await want(a, row!)).toBeNull()
  expect(await planned(a)).toEqual([])

  // the colleague: neither the database nor the request reaches bob; the shared page is there
  await ready(b, wsId)
  await expect.poll(() => wsEval(b, (s, id) => !!s.pages[id], src)).toBe(true)
  expect(await wsEval(b, (s, ids) => ids.map((id: string) => !!s.pages[id] || !!s.databases[id]), [db, row])).toEqual([false, false])
  expect(await entries<string | null>(b, (s) => s.dbId())).toBeNull()
  await b.close()
})

test('a viewer: no "Have it checked" in the page menu or ⌘K (Coding on), the Settings row says so; a request row moved out of Private shows its plate read-only', async ({ page: a, context }) => {
  watch(a, 'ada')
  await signIn(a, email('ada'))
  const wsId = await createWorkspace(a, 'Tessera team')
  const b = await newPerson(context)
  watch(b, 'vera')
  await signIn(b, email('vera'))
  await join(a, b, wsId, 'viewer')
  await ready(a, wsId)

  // ada: a request in her (private) work orders, then the database moved into the workspace — everyone sees it now
  const src = await sourcePage(a, 'Launch plan Tessera')
  const db = await entries<string>(a, (s) => s.ensure())
  const row = await wsEval(a, (s, a) => {
    const d = s.databases[a.db]
    const prop = d.properties.find((p: AnyState) => p.type === 'select' && p.options?.some((o: AnyState) => o.id === d.orders.status.draft))
    return s.createRow(a.db, { title: 'Login-Timeout prüfen', properties: { [prop.id]: d.orders.status.draft }, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Prüfe, warum der Login nach 30 s abbricht.' }] }] } }) as string
  }, { db })
  expect(await wsEval(a, (s, id) => !!s.pages[id]?.private, db)).toBe(true)
  await a.evaluate((id) => (window as unknown as { __one: { cloud: { movePagePrivacy: (id: string, p: boolean) => Promise<void> } } }).__one.cloud.movePagePrivacy(id, false), db)
  await expect.poll(() => wsEval(a, (s, id) => !!s.pages[id]?.private, db)).toBe(false)

  // vera (a viewer) switches Coding on here (Local — nobody listens on its port)
  await ready(b, wsId)
  await codingSettings(b)
  await expect(b.getByTestId('coding-orders-viewer')).toHaveText('You can only view this workspace.')
  await expect(b.getByTestId('coding-orders-create')).toHaveCount(0)
  await expect(b.getByTestId('coding-orders-open')).toHaveCount(0)
  const port = b.getByLabel('Port', { exact: true })
  await port.fill(String(Number(process.env.CODING_E2E_PORT) || 48403))
  await port.press('Enter')
  const local = b.getByRole('switch', { name: 'Connect to a coding worker on this computer' })
  await local.click()
  await expect(local).toHaveAttribute('aria-checked', 'true')
  await b.keyboard.press('Escape')

  // no "Have it checked" anywhere for her: the page menu, ⌘K
  await expect.poll(() => wsEval(b, (s, id) => !!s.pages[id], src)).toBe(true)
  await gotoPage(b, src)
  await b.locator('.tb').getByRole('button', { name: 'Page options' }).click()
  await expect(b.getByRole('menuitem').first()).toBeVisible()
  await expect(b.getByRole('menuitem', { name: /Have it checked/ })).toHaveCount(0)
  await b.keyboard.press('Escape')
  await b.keyboard.press('Control+k')
  await b.locator('.pal-input input').fill('Have it checked')
  await b.waitForTimeout(300)
  await expect(b.locator('[cmdk-item]', { hasText: 'Have it checked' })).toHaveCount(0)
  await b.keyboard.press('Escape')

  // the request row (in the workspace now): its plate is read-only for her
  await expect.poll(() => wsEval(b, (s, id) => !!s.pages[id], row), { timeout: 15_000 }).toBe(true)
  await b.evaluate((id) => (window.location.hash = `#/p/${id}`), row)
  const plate = b.getByTestId('order-plate')
  await expect(plate).toBeVisible()
  await expect(b.getByTestId('order-pre')).toHaveAttribute('data-why', 'viewer')
  await expect(b.getByTestId('order-pre')).toHaveText('You can only view this request.')
  await expect(b.getByTestId('order-plan')).toHaveCount(0)
  await expect(b.getByTestId('order-fix')).toHaveCount(0)
  expect(await entries<Planned[]>(b, (s) => s.planned())).toEqual([])
  await b.close()
})
