/**
 * Work orders (Prüfaufträge) B9 in a team workspace — Preflight on a device WITHOUT the worker link (spec §3.10:
 * "Resuming, Sofort stoppen and Kette starten work only on the worker device"), against the real team server. The
 * member's cloud worker was downloaded on another device (its token is on the server, its key only there). This device
 * holds a halted chain of the member's request: Preflight shows the card "Kette angehalten", but ↵ Fortsetzen and S are
 * refused here with their reason ("press it there") — VON HAND or not, nothing resumes and nothing is skipped; no
 * "requested elsewhere" card appears on a device without the worker link. Fictional data (Nordlicht, Tessera).
 */
import type { Page } from '@playwright/test'
import { test, expect, email, signIn, openApp, waitOnline, createWorkspace, api, wsEval, gotoPage } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const errors: string[] = []
function watch(p: Page, who: string) {
  p.on('pageerror', (e) => errors.push(`${who} pageerror: ${e.message}`))
  p.on('console', (m) => {
    if (m.type() === 'error' && !/WebSocket connection to 'ws:\/\/127\.0\.0\.1|Refused to connect to 'ws:\/\/127\.0\.0\.1:\d+\/' because it violates the following Content Security Policy/.test(m.text())) errors.push(`${who} console.error: ${m.text()}`)
  })
}
test.beforeEach(() => {
  errors.length = 0
})
test.afterEach(() => {
  expect.soft(errors, 'browser errors').toEqual([])
})

const seam = <R,>(p: Page, name: string, fn: (s: any, arg: any) => R | Promise<R>, arg?: unknown): Promise<R> => // eslint-disable-line @typescript-eslint/no-explicit-any
  p.evaluate(({ name, src, arg }) => new Function('s', 'arg', `return (${src})(s, arg)`)((window as unknown as Record<string, unknown>)[name], arg), { name, src: fn.toString(), arg }) as Promise<R>

const card = (p: Page) => p.locator('.pf-q article.pf-card[data-current]')

test('a device without the worker link: the halted chain is a card here, but ↵ Fortsetzen and S are refused — "press it there"; nothing resumes', async ({ page: a }) => {
  watch(a, 'ada')
  await a.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
  await signIn(a, email('ada'))
  const wsId = await createWorkspace(a, 'Nordlicht team')
  await openApp(a, wsId)
  await waitOnline(a)
  await a.waitForFunction(() => !!(window as unknown as { __oneOrderEntries?: unknown; __oneOrders?: unknown }).__oneOrders)

  // ada's cloud worker was downloaded on another device: the link here pairs with nobody
  expect((await api(a, 'POST', `/api/workspaces/${wsId}/coding/workers`, { label: 'Tessera laptop' })).status).toBe(201)
  await a.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
  await a.getByRole('tab', { name: /Coding worker|Coding-Worker/ }).click()
  await a.getByTestId('coding-via-cloud').click()
  await a.getByRole('switch', { name: 'Connect to my cloud worker through the team server' }).click()
  await expect(a.getByTestId('coding-conn')).toContainText('Paired with another device', { timeout: 15_000 })
  await a.keyboard.press('Escape')

  // a request of ada's (private work orders, "Have it checked")
  const src = await wsEval(a, (s) => s.createPage({ title: 'Launch plan Nordlicht', parentId: null }) as string)
  await gotoPage(a, src)
  await a.locator('.tb').getByRole('button', { name: 'Page options' }).click()
  await a.getByRole('menuitem', { name: 'Have it checked', exact: true }).click()
  await expect(a.getByTestId('order-plate').first()).toBeVisible()
  const db = (await seam<string | null>(a, '__oneOrderEntries', (s) => s.dbId()))!
  const row = await wsEval(a, (s, d) => (Object.values(s.pages as Record<string, AnyState>).find((x) => x.databaseId === d && !x.trashed)?.id ?? null) as string | null, db)
  expect(row).not.toBeNull()

  // this device holds a halted chain of it (the worker device halted it; its first step stopped)
  const now = Date.now()
  const chain = {
    run: 'runE2eHalt01',
    confirmedAt: now - 60_000,
    startAt: now - 50_000,
    steps: [
      { n: 1, id: 'stepE2eGone01', kind: 'spec', project: 'projE2eGone1', line: 'x', approvals: 'all', refs: {}, basisBlock: null },
      { n: 2, id: 'stepE2eGone02', kind: 'coding', project: 'projE2eGone2', line: 'x', approvals: 'all', refs: {}, basisBlock: 'stepE2eGone02-wait' },
    ],
    doneBy: {},
    halted: { at: now - 30_000, why: 'stopped', by: 'you~ui', step: 1 },
    checkpoint: true,
    advanced: { 1: now - 50_000 },
    moved: { 1: now - 50_000 },
  }
  await seam(a, '__oneOrders', (s, x) => s.putRecord(x.row, { v: 1, state: 'halted', chain: x.chain }), { row, chain })
  expect((await seam<AnyState>(a, '__oneOrders', (s, r) => s.record(r), row)).state).toBe('halted')

  // Preflight: the card is there, its keys refused here with their reason
  await a.evaluate(() => (window.location.hash = '#/'))
  await expect.poll(async () => {
    await a.evaluate(() => (window as unknown as { __onePreflight: { flush: () => Promise<void> } }).__onePreflight.flush())
    return a.locator('.pf-cap[data-lamp="orders"]').count()
  }, { timeout: 20_000 }).toBe(1)
  expect((await seam<AnyState[]>(a, '__oneOrders', (s) => s.cards())).map((c) => c.kind)).toEqual(['halted'])
  await a.locator('.pf-cap[data-lamp="orders"]').focus()
  await a.keyboard.press('Enter')
  await expect(card(a)).toHaveAttribute('data-kind', 'halted')
  await expect(card(a)).not.toHaveAttribute('aria-busy', 'true')
  const resume = card(a).locator('.pf-key[data-key="a"]')
  const skip = card(a).locator('.pf-key[data-key="1"]')
  await expect(resume).toHaveAttribute('aria-disabled', 'true')
  await expect(resume).toHaveAttribute('title', 'The worker is attached to another device — press it there')
  await expect(skip).toHaveAttribute('aria-disabled', 'true')
  await card(a).focus()
  await a.keyboard.press('a')
  await expect(a.getByTestId('pf-confirm')).toHaveCount(0)
  await expect(a.getByTestId('pf-live')).toContainText('The worker is attached to another device — press it there')
  await a.keyboard.press('1')
  await expect(a.getByTestId('pf-confirm')).toHaveCount(0)
  await a.waitForTimeout(400)
  const rec = await seam<AnyState>(a, '__oneOrders', (s, r) => s.record(r), row)
  expect(rec.state).toBe('halted')
  expect(rec.chain.skipped ?? []).toEqual([])
  expect(rec.chain.resumedAt).toBeUndefined()
})
