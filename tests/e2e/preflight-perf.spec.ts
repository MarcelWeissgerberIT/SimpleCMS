/**
 * Preflight's performance budget (T-P1-7: PB1–PB5, PB8–PB10 and the PB2 runtime guard) on a big workspace of
 * 2,500 and of 13,000 pages (tests/e2e/helpers/bigWorkspace.ts):
 *
 *  - PB8  the held boot (lamps lit at the last count): page-map scans until the app is up ≤ BOOT_SCANS, the plate
 *         usable < 3 s (2,500 pages), Home's own sections never mounted;
 *  - PB2  the shared row index builds once; Preflight's reads after a write cause 0 page-map scans (runtime guard);
 *  - PB1  page-map scans per store write (content, title, cell) with Preflight on ≤ WRITE_SCANS, counted over 1,500 ms
 *         after each write (the idle recount included), and Σ on ≤ Σ off;
 *  - PB3  one pass over every built-in lamp: p95 < 8 ms (2,500) / < 16 ms (13,000); no Preflight pass > 50 ms;
 *  - PB4  typing in a page re-reads no lamp — in a pipeline task page too (its lamps at most once, after a pause);
 *  - PB5  MASTER CAUTION renders only when `mc` / `lit` change; one changed reading = ≤ 1 cap render, ≤ 1 plate render;
 *  - PB9  idle 10 s windows on the plate: no store change, no keyval-store / one-preflight put, no Preflight record
 *         written, script share < 2 %;
 *  - T-P2-12  PB3 and PB4 again with a lamp's queue open in the tab (a pass on Start with the queue on screen; typing
 *         in a page and in a task page while the queue waits).
 * PB10 (perf-budget.spec green with the hold off and a flush before its write step) is that spec itself.
 */
import type { CDPSession, Page } from '@playwright/test'
import { test, expect, flush } from './fixtures'
import { loadBigWorkspace, type BigOptions } from './helpers/bigWorkspace'
import { seedPipeline } from './helpers/preflightStory.mjs'

const BOOT_SCANS = 40
const WRITE_SCANS = { content: 2, title: 3, cell: 2 }

interface Counters {
  scans: number
  puts: Array<{ t: number; db: string }>
  sets: Array<{ t: number; key: string }>
  sections: boolean
}

/** Counters installed before the app runs (every navigation). */
function installCounters() {
  const w = window as unknown as { __pfPerf: Counters }
  const perf: Counters = (w.__pfPerf = { scans: 0, puts: [], sets: [], sections: false })
  for (const name of ['keys', 'values', 'entries'] as const) {
    const orig = Object[name] as (o: object) => unknown[]
    ;(Object as unknown as Record<string, unknown>)[name] = function (o: object) {
      const r = orig(o)
      if (r.length >= 2000) perf.scans++
      return r
    }
  }
  const put = IDBObjectStore.prototype.put
  IDBObjectStore.prototype.put = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
    perf.puts.push({ t: performance.now(), db: this.transaction.db.name })
    return put.call(this, value, key)
  } as typeof put
  const set = Storage.prototype.setItem
  Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
    if (key.startsWith('one.preflight.')) perf.sets.push({ t: performance.now(), key })
    return set.call(this, key, value)
  }
  new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) if (n instanceof Element && (n.matches('.home-sections') || n.querySelector('.home-sections'))) perf.sections = true
  }).observe(document, { childList: true, subtree: true })
}

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const counters = (page: Page) => page.evaluate(() => (window as unknown as { __pfPerf: Counters }).__pfPerf)
const scans = (page: Page) => page.evaluate(() => (window as unknown as { __pfPerf: Counters }).__pfPerf.scans)
const pf = <R,>(page: Page, src: string): Promise<R> => page.evaluate((src) => new Function('p', `return (${src})`)((window as unknown as { __onePreflight: AnyState }).__onePreflight), src) as Promise<R>
const note = (what: string, value: unknown) => test.info().annotations.push({ type: what, description: JSON.stringify(value) })
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * 0.95) - 1)] ?? 0

async function scriptMs(cdp: CDPSession): Promise<number> {
  const { metrics } = (await cdp.send('Performance.getMetrics')) as { metrics: Array<{ name: string; value: number }> }
  const ms = (name: string) => (metrics.find((m) => m.name === name)?.value ?? 0) * 1000
  return ms('ScriptDuration') + ms('RecalcStyleDuration') + ms('LayoutDuration')
}

/** The lamps' read counts now (stats().reads[lamp].n). */
const readCounts = (page: Page) => pf<Record<string, number>>(page, 'Object.fromEntries(Object.entries(p.stats().reads).map(([k, v]) => [k, v.n]))')
const delta = (a: Record<string, number>, b: Record<string, number>) => Object.fromEntries(Object.keys(b).filter((k) => (b[k] ?? 0) !== (a[k] ?? 0)).map((k) => [k, b[k] - (a[k] ?? 0)]))

/** Store writes on the open big page, a page title and a table cell; page-map scans over 1,500 ms after each. */
async function writeScans(page: Page, big: { id: string; rowId: string; propId: string }, tag: string) {
  return page.evaluate(
    async ({ id, rowId, propId, tag }) => {
      const w = window as unknown as { __pfPerf: Counters; __one: { workspace: { getState: () => AnyState } } }
      const out: Record<'content' | 'title' | 'cell', number[]> = { content: [], title: [], cell: [] }
      const measure = async (kind: keyof typeof out, write: () => void) => {
        const before = w.__pfPerf.scans
        write()
        await new Promise((r) => setTimeout(r, 1500))
        out[kind].push(w.__pfPerf.scans - before)
      }
      for (let i = 0; i < 3; i++) {
        const s = w.__one.workspace.getState()
        const content = JSON.parse(JSON.stringify(s.pages[id].content))
        content.content[1].content.push({ type: 'text', text: ` ${tag} ${i}` })
        await measure('content', () => s.setContent(id, content, 'preflight-perf'))
        await measure('title', () => s.updatePage(id, { title: `Perf · Big page ${tag}${'x'.repeat(i + 1)}` }))
        await measure('cell', () => s.setRowProperty(rowId, propId, 300 + i))
      }
      w.__one.workspace.getState().updatePage(id, { title: 'Perf · Big page' })
      return out
    },
    { ...big, tag },
  )
}

const SIZES: Array<{ name: string; opts: Partial<BigOptions>; minPages: number; passP95: number; bootMs: number | null; taskPage: boolean }> = [
  { name: '2,500 pages', opts: { pages: 1500, richPages: 200, databases: 5, rowsPerDb: 200, syncedGroups: 10, commentedPages: 20 }, minPages: 2500, passP95: 8, bootMs: 3000, taskPage: true },
  { name: '13,000 pages', opts: {}, minPages: 12_000, passP95: 16, bootMs: null, taskPage: false },
]

for (const size of SIZES) {
  test.describe(`Preflight performance budget — ${size.name} (T-P1-7)`, () => {
    test('held boot, row index, writes, a full pass, typing, renders and idle stay within budget', async ({ page, errors }) => {
      test.setTimeout(480_000)
      void errors
      await page.addInitScript(installCounters)
      await page.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
      const big = await loadBigWorkspace(page, size.opts)
      expect(big.pages + big.rows).toBeGreaterThan(size.minPages)
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Performance.enable')

      await test.step('PB8 — the held boot', async () => {
        // the last count had a lamp lit, today's record gone: the next boot is this Preflight day's first, held on "#/"
        // (after this tab's own first count, which writes the real last count)
        // a lamp really lit at boot (an MCP server whose token the last check refused): the plate stays full
        await page.evaluate(() =>
          (window as unknown as { __one: { workspace: { getState: () => AnyState } } }).__one.workspace.getState().updateSettings({
            mcpServers: [{ id: 'm-perf', name: 'relay', url: 'https://relay.perf.example/mcp', token: '', enabled: true, prompt: '', tools: [], checkedAt: Date.now(), checkAuth: true, checkError: 'refused' }],
          }),
        )
        await page.waitForFunction(() => (window as unknown as { __onePreflight?: AnyState }).__onePreflight?.state().ready === true, null, { timeout: 90_000 })
        await pf(page, 'p.flush()')
        await page.evaluate(() => {
          localStorage.setItem('one.preflight.last:local:local', JSON.stringify({ at: Date.now() - 86_400_000, lamps: [['inbox', 'amber']] }))
          localStorage.removeItem('one.preflight.today:local:local')
        })
        await flush(page)
        await page.goto('app/?e2e')
        await page.waitForFunction(() => !!document.querySelector('.app') && !document.getElementById('boot'), null, { polling: 'raf', timeout: 90_000 })
        const upScans = await scans(page)
        await page.waitForFunction(
          () => {
            const p = (window as unknown as { __onePreflight?: AnyState }).__onePreflight
            return !!p && p.state().ready && !!document.querySelector('[data-testid="pf-plate"] .pf-cap:not([aria-busy="true"])')
          },
          null,
          { polling: 'raf', timeout: 90_000 },
        )
        const usableMs = await page.evaluate(() => performance.now())
        const c = await counters(page)
        note('held boot', { usableMs: Math.round(usableMs), upScans, plateScans: c.scans })
        expect(new URL(page.url()).hash, 'the held boot stays on "#/"').toMatch(/^(#\/?)?$/)
        expect(c.sections, 'Home’s own sections mounted behind the held boot').toBe(false)
        await expect(page.locator('.home-sections')).toHaveCount(0)
        expect(upScans, 'page-map scans until the app is up').toBeLessThanOrEqual(BOOT_SCANS)
        // wall clock: a loaded box takes longer than a quiet one — the budget holds on a quiet one
        if (size.bootMs) expect(usableMs, 'the held boot to a usable plate (ms)').toBeLessThan(size.bootMs)
      })

      await test.step('PB2 — the row index builds once; Preflight’s reads after a write scan nothing', async () => {
        await pf(page, 'p.flush()')
        expect(await pf<number>(page, 'p.stats().rowIndex.builds')).toBe(1)
        for (let i = 0; i < 3; i++) {
          await page.evaluate(
            ({ rowId, propId, i }) => (window as unknown as { __one: { workspace: { getState: () => AnyState } } }).__one.workspace.getState().setRowProperty(rowId, propId, 200 + i),
            { rowId: big.bigTableRowId, propId: big.bigTableNumberProp, i },
          )
          await page.waitForTimeout(150)
          const s0 = await scans(page)
          await pf(page, 'p.pass()')
          expect((await scans(page)) - s0, 'page-map scans of a Preflight pass after a write').toBe(0)
        }
        expect(await pf<number>(page, 'p.stats().rowIndex.builds')).toBe(1)
      })

      await test.step('PB5 — one changed reading renders one cap; MASTER CAUTION only on mc / lit', async () => {
        await pf(page, `p.stores.mail.setState({ account: 'perf@example.org', reconnect: true, errorAt: null })`)
        await pf(page, 'p.flush()')
        await expect(page.locator('.pf-cap[data-lamp="mail"]')).toHaveCount(1)
        await page.waitForTimeout(300)
        const r0 = await pf<Record<string, number>>(page, 'p.renders()')
        await pf(page, `p.stores.mail.setState({ errorAt: 'sync' })`)
        await pf(page, 'p.flush()')
        await expect(page.locator('.pf-cap[data-lamp="mail"]')).toHaveAttribute('data-lit', 'red')
        await page.waitForTimeout(300)
        const r1 = await pf<Record<string, number>>(page, 'p.renders()')
        const d = delta(r0, r1)
        note('renders for one changed reading', d)
        expect(d.cap ?? 0, 'cap renders').toBeLessThanOrEqual(1)
        expect(d.plate ?? 0, 'plate renders').toBeLessThanOrEqual(1)
        expect(d.mc ?? 0, 'MASTER CAUTION renders (amber → red: lit unchanged, mc may change)').toBeLessThanOrEqual(1)
        await pf(page, `p.stores.mail.setState({ account: null, reconnect: false, errorAt: null })`)
        await pf(page, 'p.flush()')
      })

      await test.step('PB9 — idle on the plate: nothing written, nothing changed, script share < 2 %', async () => {
        // acknowledged: nothing flashes (MASTER CAUTION's flash is its own, bounded work)
        await page.getByTestId('pf-mc').click()
        await page.waitForTimeout(3000)
        await page.evaluate(() => {
          const w = window as unknown as { __one: { workspace: { subscribe: (fn: () => void) => () => void } }; __pfStore: number }
          w.__pfStore = 0
          w.__one.workspace.subscribe(() => w.__pfStore++)
        })
        for (let i = 0; i < 2; i++) {
          const t0 = await page.evaluate(() => performance.now())
          const m0 = await scriptMs(cdp)
          const s0 = await page.evaluate(() => (window as unknown as { __pfStore: number }).__pfStore)
          await page.waitForTimeout(10_000)
          const m1 = await scriptMs(cdp)
          const c = await counters(page)
          const s1 = await page.evaluate(() => (window as unknown as { __pfStore: number }).__pfStore)
          const puts = c.puts.filter((p) => p.t >= t0)
          const sets = c.sets.filter((p) => p.t >= t0)
          note(`idle window ${i + 1}`, { script: Number(((m1 - m0) / 10_000).toFixed(4)), puts: puts.length, sets: sets.map((s) => s.key), store: s1 - s0 })
          expect(s1 - s0, 'store changes while idle').toBe(0)
          expect(puts.filter((p) => p.db === 'keyval-store' || p.db === 'one-preflight'), 'keyval-store / one-preflight puts while idle').toEqual([])
          expect(sets, 'Preflight records written while idle').toEqual([])
          expect((m1 - m0) / 10_000, 'script / style / layout share of an idle 10 s window').toBeLessThan(0.02)
        }
      })

      await test.step('PB1 — page-map scans per write: ≤ WRITE_SCANS, Σ on ≤ Σ off', async () => {
        await page.evaluate((id) => (window.location.hash = `#/p/${id}`), big.bigPageId)
        await expect(page.locator('#main .pv-title')).toBeVisible()
        await page.waitForTimeout(1500)
        const on = await writeScans(page, { id: big.bigPageId, rowId: big.bigTableRowId, propId: big.bigTableNumberProp }, 'on')
        await pf(page, 'p.setPrefs({ on: false })')
        await page.waitForTimeout(1500)
        const off = await writeScans(page, { id: big.bigPageId, rowId: big.bigTableRowId, propId: big.bigTableNumberProp }, 'off')
        await pf(page, 'p.setPrefs({ on: true })')
        await pf(page, 'p.flush()')
        note('write scans', { on, off })
        for (const kind of ['content', 'title', 'cell'] as const) for (const n of on[kind]) expect(n, `page-map scans per store write with Preflight on: ${kind} (${on[kind].join(', ')})`).toBeLessThanOrEqual(WRITE_SCANS[kind])
        const sum = (r: typeof on) => [...r.content, ...r.title, ...r.cell].reduce((a, b) => a + b, 0)
        expect(sum(on), `Σ scans on (${sum(on)}) ≤ Σ off (${sum(off)})`).toBeLessThanOrEqual(sum(off))
      })

      await test.step('PB3 — one pass over every built-in lamp', async () => {
        const passes: number[] = []
        for (let i = 0; i < 20; i++) {
          await page.evaluate(
            ({ rowId, propId, i }) => (window as unknown as { __one: { workspace: { getState: () => AnyState } } }).__one.workspace.getState().setRowProperty(rowId, propId, 400 + i),
            { rowId: big.bigTableRowId, propId: big.bigTableNumberProp, i },
          )
          passes.push(await pf<number>(page, 'p.pass()'))
        }
        const st = await pf<{ reads: Record<string, { n: number; p95: number; max: number }>; passMax: number; longTasks: number }>(page, 'p.stats()')
        note('passes', { p95: Number(p95(passes).toFixed(2)), max: Number(Math.max(...passes).toFixed(2)), passMax: st.passMax, lamps: st.reads })
        expect(p95(passes), `a full pass, p95 (ms) on ${size.name}`).toBeLessThan(size.passP95)
        for (const [id, r] of Object.entries(st.reads)) expect(r.p95, `lamp ${id} p95 (ms)`).toBeLessThan(size.passP95)
        expect(st.longTasks, 'Preflight passes over 50 ms').toBe(0)
      })

      await test.step('PB4 + PB5 — typing in a page re-reads no lamp and renders no MASTER CAUTION', async () => {
        const editor = page.locator('#main .ProseMirror').first()
        await editor.click()
        await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+End`)
        await page.waitForTimeout(800)
        const r0 = await readCounts(page)
        const m0 = await pf<Record<string, number>>(page, 'p.renders()')
        await page.keyboard.type(' preflight stays quiet while you type', { delay: 40 })
        await page.waitForTimeout(1500)
        await pf(page, 'p.flush()')
        const r1 = await readCounts(page)
        const m1 = await pf<Record<string, number>>(page, 'p.renders()')
        note('typing in a page', { reads: delta(r0, r1), renders: delta(m0, m1) })
        expect(delta(r0, r1), 'lamps re-read by typing in a page').toEqual({})
        expect((m1.mc ?? 0) - (m0.mc ?? 0), 'MASTER CAUTION renders while typing').toBe(0)
      })

      if (size.taskPage) {
        await test.step('PB4 — typing in a pipeline task page: no read while typing, its lamps at most once after a pause', async () => {
          const pipe = (await seedPipeline(page)) as { tasks: string[] }
          await pf(page, 'p.flush()')
          await page.evaluate((id) => (window.location.hash = `#/p/${id}`), pipe.tasks[0])
          const editor = page.locator('#main .ProseMirror').first()
          await expect(editor).toBeVisible()
          await editor.click()
          await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+End`)
          await page.waitForTimeout(2500)
          await pf(page, 'p.flush()')
          const r0 = await readCounts(page)
          await page.keyboard.type(' — notes for the review', { delay: 40 })
          const during = delta(r0, await readCounts(page))
          await page.waitForTimeout(3000)
          await pf(page, 'p.flush()')
          const after = delta(r0, await readCounts(page))
          note('typing in a task page', { during, after })
          expect(during, 'lamps read while typing in a task page').toEqual({})
          for (const [id, n] of Object.entries(after)) {
            expect(['gate', 'question', 'failed'], `lamp ${id} re-read by typing in a task page`).toContain(id)
            expect(n, `lamp ${id} reads after the pause`).toBeLessThanOrEqual(1)
          }
        })
      }

      await test.step('T-P2-12 — the queue open: a full pass (PB3), typing in a page and in a task page (PB4)', async () => {
        await page.evaluate(() => (window.location.hash = '#/'))
        await pf(page, 'p.unfold()')
        await pf(page, 'p.flush()')
        // the refused relay's lamp: its queue open, its card current
        await page.locator('.pf-cap[data-lamp="token"]').focus()
        await page.keyboard.press('Enter')
        await expect(page.locator('.pf-q article.pf-card[data-current]')).toBeVisible()
        const passes: number[] = []
        for (let i = 0; i < 20; i++) {
          await page.evaluate(
            ({ rowId, propId, i }) => (window as unknown as { __one: { workspace: { getState: () => AnyState } } }).__one.workspace.getState().setRowProperty(rowId, propId, 600 + i),
            { rowId: big.bigTableRowId, propId: big.bigTableNumberProp, i },
          )
          passes.push(await pf<number>(page, 'p.pass()'))
        }
        note('passes, queue open', { p95: Number(p95(passes).toFixed(2)), max: Number(Math.max(...passes).toFixed(2)) })
        expect(p95(passes), `a full pass with the queue open, p95 (ms) on ${size.name}`).toBeLessThan(size.passP95)
        expect(await pf<string | null>(page, 'p.stores.queue.getState().lamp')).toBe('token')

        // typing in a page with the queue open in this tab
        await page.evaluate((id) => (window.location.hash = `#/p/${id}`), big.bigPageId)
        const editor = page.locator('#main .ProseMirror').first()
        await expect(editor).toBeVisible()
        await editor.click()
        await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+End`)
        await page.waitForTimeout(800)
        const r0 = await readCounts(page)
        await page.keyboard.type(' the queue waits on Start', { delay: 40 })
        await page.waitForTimeout(1500)
        await pf(page, 'p.flush()')
        expect(delta(r0, await readCounts(page)), 'lamps re-read by typing in a page (queue open)').toEqual({})

        if (size.taskPage) {
          const task = await page.evaluate(() => {
            const s = (window as unknown as { __one: { workspace: { getState: () => AnyState } } }).__one.workspace.getState()
            const db = Object.values(s.databases as Record<string, AnyState>).find((d) => d.system === 'coding')
            return (Object.values(s.pages as Record<string, AnyState>).find((p) => p.databaseId === db?.id && !p.trashed)?.id as string) ?? null
          })
          expect(task).not.toBeNull()
          await page.evaluate((id) => (window.location.hash = `#/p/${id}`), task)
          const ed = page.locator('#main .ProseMirror').first()
          await expect(ed).toBeVisible()
          await ed.click()
          await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+End`)
          await page.waitForTimeout(2500)
          await pf(page, 'p.flush()')
          const t0 = await readCounts(page)
          await page.keyboard.type(' — with the queue open', { delay: 40 })
          const during = delta(t0, await readCounts(page))
          await page.waitForTimeout(3000)
          await pf(page, 'p.flush()')
          const after = delta(t0, await readCounts(page))
          note('typing in a task page, queue open', { during, after })
          expect(during, 'lamps read while typing in a task page (queue open)').toEqual({})
          for (const [id, n] of Object.entries(after)) {
            expect(['gate', 'question', 'failed'], `lamp ${id} re-read by typing in a task page (queue open)`).toContain(id)
            expect(n, `lamp ${id} reads after the pause (queue open)`).toBeLessThanOrEqual(1)
          }
        }
      })
    })
  })
}
