/**
 * Regler (governor) — the ledger's new reads and pings in the browser (features/governor/ledger.ts, book.ts, totals.ts):
 *  - a written batch pings the other tabs with `{ scope, day, usd, unpriced, batch }` — slice 1's `{ scope }` listeners
 *    still read it; an older tab's `{ scope }` reaches the delta listeners as "read again" (batch null);
 *  - ledgerDay(scope, day) reads one scope's one day only (two scopes × two days seeded through the seam);
 *  - the book: a reservation in tab A reaches tab B on `one-ledger-res` and never a ledger-ping listener; adjust / settle;
 *  - totals: nothing opened before a load is called; meters, the other tab's deltas, the full read, the cache and the
 *    device line over two scopes.
 * No AI host is reached (entries are seeded or metered through the seam). Every value is fictional.
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp } from './fixtures'

type Entry = Record<string, unknown> & { id: string; at: number; scope: string; usd: number | null }
type Delta = { scope: string | null; day: string | null; usd: number; unpriced: number; batch: string | null }
type LedgerSeam = {
  meter: (e: Entry) => Entry
  flush: () => Promise<void>
  seed: (list: Entry[]) => Promise<void>
  day: (scope: string, day: string) => Promise<Entry[]>
  scope: () => string | null
  listen: () => void
  heard: () => { pings: Array<string | null>; deltas: Delta[] }
}

/** A ledger entry of a fictional response (ids and numbers only). */
const entry = (id: string, at: number, scope: string, usd: number | null): Entry => ({
  id,
  at,
  scope,
  purpose: 'menu.action',
  cls: 'write',
  source: `ai:run-${id}:improve`,
  role: 'main',
  route: 'anthropic:claude-sonnet-5-5',
  served: { p: 'anthropic', model: 'claude-sonnet-5-5' },
  classes: ['page'],
  usage: { input: 1000, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, output: 200, reasoning: 0 },
  usd,
  costSource: usd === null ? 'none' : 'table',
  priceAt: '2026-10-12',
  mcpCalls: 0,
  outcome: 'ok',
})

type Totals = { known: boolean; day: string; scopeId: string | null; scope: { spentToday: number; spentMonth: number; unpricedToday: number }; device: { spentToday: number; spentMonth: number; scopes: string[] }; reserved: number }
type GovSeam = {
  totals: () => Totals
  reserved: (scope?: string, except?: string) => number
  reservedOthers: () => number
  opened: () => { ledger: number; governor: number }
  start: () => void
  load: () => Promise<void>
  flush: () => Promise<void>
  reserve: (usd: number, source: string) => string
  adjust: (id: string, usd: number) => boolean
  settle: (id: string) => void
}
const gov = <T>(p: Page, fn: (g: GovSeam) => T | Promise<T>): Promise<T> =>
  p.evaluate(`(${fn.toString()})(window.__oneGovernor)`) as Promise<T>

const heardIn = (p: Page) => p.evaluate(() => (window as unknown as { __oneLedger: LedgerSeam }).__oneLedger.heard())

/** The local day of a time in the browser's zone (the spec runs in Europe/Berlin). */
const dayIn = (page: Page, at: number) => page.evaluate((t) => {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}, at)

test.describe('the ledger: pings carry deltas', () => {
  test("a written batch pings the other tab per scope and day; slice 1's `{ scope }` reading still works", async ({ page }) => {
    await openApp(page)
    const b = await page.context().newPage()
    await openApp(b)
    // tab B: the app's own listeners (slice 1's ping + the delta) and a raw slice-1-shaped reader of the channel
    await b.evaluate(() => (window as unknown as { __oneLedger: LedgerSeam }).__oneLedger.listen())
    await b.evaluate(() => {
      const raw: Array<string | null> = []
      ;(window as unknown as { __raw: typeof raw }).__raw = raw
      const ch = new BroadcastChannel('one-ledger')
      ch.onmessage = (ev) => raw.push(typeof ev.data?.scope === 'string' ? ev.data.scope : null)
    })
    const scope = await page.evaluate(() => (window as unknown as { __oneLedger: LedgerSeam }).__oneLedger.scope())
    expect(scope).toBe('local:local')
    const now = Date.now()
    await page.evaluate((list) => {
      const l = (window as unknown as { __oneLedger: LedgerSeam }).__oneLedger
      for (const e of list) l.meter(e)
      return l.flush()
    }, [entry('e1', now, '', 0.25), entry('e2', now + 1, '', 0.5), entry('e3', now + 2, '', null)])
    await expect.poll(async () => (await heardIn(b)).deltas.length).toBe(1)
    const heard = await heardIn(b)
    expect(heard.pings).toEqual(['local:local'])
    expect(heard.deltas).toEqual([{ scope: 'local:local', day: await dayIn(page, now), usd: 0.75, unpriced: 1, batch: expect.stringMatching(/^[A-Za-z0-9_-]{6,64}$/) }])
    expect(await b.evaluate(() => (window as unknown as { __raw: Array<string | null> }).__raw)).toEqual(['local:local'])

    // an older tab's ping ({ scope } only): slice 1's listener reads the scope, the delta says "read again"
    await page.evaluate(() => new BroadcastChannel('one-ledger').postMessage({ scope: 'local:local' }))
    await expect.poll(async () => (await heardIn(b)).deltas.length).toBe(2)
    const after = await heardIn(b)
    expect(after.pings).toEqual(['local:local', 'local:local'])
    expect(after.deltas[1]).toEqual({ scope: 'local:local', day: null, usd: 0, unpriced: 0, batch: null })
    await b.close()
  })
})

test.describe('the ledger: one scope, one day', () => {
  test('ledgerDay reads only that scope and that local day (two scopes × two days seeded)', async ({ page }) => {
    await openApp(page)
    const today = Date.now()
    const yesterday = today - 86_400_000
    const other = 'cloud:ws-tessera-0001:u:acc-mara-lind'
    await page.evaluate((list) => (window as unknown as { __oneLedger: LedgerSeam }).__oneLedger.seed(list), [
      entry('a-today', today, 'local:local', 0.1),
      entry('a-yday', yesterday, 'local:local', 0.2),
      entry('b-today', today, other, 0.3),
      entry('b-yday', yesterday, other, 0.4),
      // a scope that merely starts like this one is another scope
      entry('c-today', today, 'local:local2', 0.5),
    ])
    const d0 = await dayIn(page, today)
    const d1 = await dayIn(page, yesterday)
    const ids = (scope: string, day: string) =>
      page.evaluate(async ([s, d]) => (await (window as unknown as { __oneLedger: LedgerSeam }).__oneLedger.day(s, d)).map((e) => e.id), [scope, day])
    expect(await ids('local:local', d0)).toEqual(['a-today'])
    expect(await ids('local:local', d1)).toEqual(['a-yday'])
    expect(await ids(other, d0)).toEqual(['b-today'])
    expect(await ids(other, d1)).toEqual(['b-yday'])
    expect(await ids('local:local2', d0)).toEqual(['c-today'])
    expect(await ids('local:local', '2020-01-01')).toEqual([])
    // this tab's metered entries are merged in (written first) — the same scope and day only
    await page.evaluate((e) => (window as unknown as { __oneLedger: LedgerSeam }).__oneLedger.meter(e), entry('a-new', today + 5, '', 0.05))
    expect(await ids('local:local', d0)).toEqual(['a-today', 'a-new'])
    expect(await ids(other, d0)).toEqual(['b-today'])
  })
})

test.describe('the book: reservations across tabs', () => {
  test("tab A's reservation reaches tab B on its own channel — never a ledger-ping listener; adjust and settle follow", async ({ page }) => {
    await openApp(page)
    const b = await page.context().newPage()
    await openApp(b)
    await b.evaluate(() => (window as unknown as { __oneLedger: LedgerSeam }).__oneLedger.listen())
    await gov(b, (g) => g.start())
    await gov(page, (g) => g.start())
    const id = await gov(page, (g) => g.reserve(0.75, 'ai:run-launch:improve'))
    // positive control: the other tab hears it
    await expect.poll(() => gov(b, (g) => g.reservedOthers())).toBe(0.75)
    expect(await gov(b, (g) => g.reserved('local:local'))).toBe(0.75)
    // tab A: its own reservation counts, except for the request that holds it
    expect(await gov(page, (g) => g.reserved('local:local'))).toBe(0.75)
    expect(await page.evaluate((x) => (window as unknown as { __oneGovernor: GovSeam }).__oneGovernor.reserved('local:local', x), id)).toBe(0)
    await page.evaluate(([x]) => (window as unknown as { __oneGovernor: GovSeam }).__oneGovernor.adjust(x, 0.3), [id] as const)
    await expect.poll(() => gov(b, (g) => g.reservedOthers())).toBe(0.3)
    await page.evaluate((x) => (window as unknown as { __oneGovernor: GovSeam }).__oneGovernor.settle(x), id)
    await expect.poll(() => gov(b, (g) => g.reservedOthers())).toBe(0)
    // no `res` / `bye` ever reached the ledger's listeners in tab B
    expect(await heardIn(b)).toEqual({ pings: [], deltas: [] })
    await b.close()
  })
})

test.describe('totals', () => {
  test('nothing is opened before a load is called; then the ledger (and the month records) are', async ({ page }) => {
    await openApp(page)
    expect(await gov(page, (g) => g.opened())).toEqual({ ledger: 0, governor: 0 })
    await gov(page, (g) => g.start())
    await page.waitForTimeout(500)
    expect(await gov(page, (g) => g.opened())).toEqual({ ledger: 0, governor: 0 })
    expect((await gov(page, (g) => g.totals())).known).toBe(false)
    await gov(page, (g) => g.load())
    const opened = await gov(page, (g) => g.opened())
    expect(opened.ledger).toBeGreaterThanOrEqual(1)
    // the month's closed days live in one-governor (none on the 1st of a month)
    const dom = await page.evaluate(() => new Date().getDate())
    expect(opened.governor).toBeGreaterThanOrEqual(dom > 1 ? 1 : 0)
    expect((await gov(page, (g) => g.totals())).known).toBe(true)
  })

  test("meters, the other tab's deltas once, the full read and its cache; the device line counts a second scope", async ({ page }) => {
    await openApp(page)
    const b = await page.context().newPage()
    await openApp(b)
    await gov(page, (g) => g.start())
    await gov(b, (g) => g.start())
    const now = Date.now()
    // tab A meters 0.25 + 0.5 + one unpriced response
    await page.evaluate((list) => {
      const l = (window as unknown as { __oneLedger: LedgerSeam }).__oneLedger
      for (const e of list) l.meter(e)
      return l.flush()
    }, [entry('t1', now, '', 0.25), entry('t2', now + 1, '', 0.5), entry('t3', now + 2, '', null)])
    const a = await gov(page, (g) => g.totals())
    expect(a.scope).toMatchObject({ spentToday: 0.75, unpricedToday: 1 })
    // tab B heard the delta (once) without reading
    await expect.poll(async () => (await gov(b, (g) => g.totals())).scope.spentToday).toBe(0.75)
    expect((await gov(b, (g) => g.totals())).known).toBe(false)
    // the full read agrees and writes the cache
    await gov(b, (g) => g.load())
    expect((await gov(b, (g) => g.totals())).scope).toMatchObject({ spentToday: 0.75, unpricedToday: 1 })
    const cache = JSON.parse((await b.evaluate(() => localStorage.getItem('one.governor.today:local:local'))) ?? 'null')
    expect(cache).toMatchObject({ day: await dayIn(page, now), usd: 0.75, unpriced: 1 })
    expect(cache.monthUsd).toBeGreaterThanOrEqual(0.75)

    // the person's line: a second workspace of this browser (seeded) counts there — never in this workspace's numbers
    const other = 'cloud:ws-tessera-0001:u:acc-mara-lind'
    const day = await dayIn(page, now)
    await page.evaluate(
      ([o, d]) => {
        localStorage.setItem('one.governor.device', JSON.stringify({ v: 1, day: 8, at: Date.now() }))
        localStorage.setItem('one.governor.scopes', JSON.stringify([{ scope: o, last: d }]))
      },
      [other, day] as const,
    )
    await page.evaluate((list) => (window as unknown as { __oneLedger: LedgerSeam }).__oneLedger.seed(list), [entry('o1', now, other, 1.2), entry('o2', now, other, 0.3)])
    await gov(page, (g) => g.load())
    const t = await gov(page, (g) => g.totals())
    expect(t.scope.spentToday).toBe(0.75)
    expect(t.device.scopes).toEqual(['local:local', other])
    expect(t.device.spentToday).toBeCloseTo(2.25, 10)
    expect(JSON.parse((await page.evaluate((o) => localStorage.getItem(`one.governor.today:${o}`), other)) ?? 'null')).toMatchObject({ usd: 1.5 })
    await b.close()
  })
})
