/**
 * The Patchbay's performance budget (plan §4 B17, §1.2, §1.17, §6 A21 / A32) on a large workspace — the perf-budget
 * fixture (tests/e2e/helpers/bigWorkspace.ts: ≈ 13,000 pages, 500 rich, 25 databases × 400 rows) with bigPatchbay(60)
 * wired into it (≈ 64 modules / 126 cables; its agents switched off so nothing calls Claude by itself, a repeating
 * template on „Tessera 2“, a Claude key against a mocked API for autofill):
 *
 *  - boot: `one-patchbay` is opened, the compute chunk requested and the first model built only after the app's first
 *    paint; the ledger (`one-ledger`) is never opened for the LED; the sidebar LED lights from that idle build;
 *  - typing 200 characters in a page — before the Patchbay was ever opened, and again after a visit (the route closed):
 *    0 model builds, 0 input builds, 0 referenced-page rechecks, no button-index read; the longest task the same as
 *    with the Patchbay never opened (and typing in a page the model references — a report page with buttons — rechecks
 *    nothing either: §6 A32, refined in B17);
 *  - #/patchbay: the first rack paint ≤ 250 ms after the chunk (User Timing `pb-first-rack`, ui/paintMark.ts — the
 *    median of three cold opens, each from the big page with the mouse resting over it); the model build (graph +
 *    reach + chains + fuses, a fresh input each time) median ≤ 10 ms; relayout (measure + render + commit) median
 *    ≤ 16 ms; the button index's cold build in idle slices, the longest ≤ 50 ms;
 *  - an automation run, an autofill fill and a repeating occurrence: 0 model builds, 0 input builds (their bookkeeping —
 *    `lastRunAt`, `fills`, a template's `lastRunAt` — is no wiring), with the route closed and open;
 *  - back on the route, the button index reads what changed meanwhile in one catch-up (slices ≤ 50 ms), never a second
 *    cold build.
 * Plus a Node guard: the Patchbay's eager modules (what the boot chunk loads through its index, the hint line and the
 * strings) never import the model, the layout, the inputs or the page statically.
 * Budgets that time something are medians or maxima of several runs (the first rack: the median of three cold opens,
 * a page load each — the chunk is evaluated anew every time); the sharp ones count work. Every name is fictional.
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect, openApp, flush, waitForApp, wsEval } from './fixtures'
import { BIG_DEFAULTS, generateBigWorkspace, type BigInfo } from './helpers/bigWorkspace'
import { bigPatchbay, ordersWorld, type PbWorld } from '../fixtures/patchbay'

// no trace: its DOM snapshots of the big workspace are main-thread work the budgets would count
test.use({ trace: 'off' })

const BUDGET = { buildMs: 10, firstRackMs: 250, relayoutMs: 16, buttonSliceMs: 50, typingExtraMs: 30 }
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0
const note = (what: string, value: unknown) => test.info().annotations.push({ type: what, description: JSON.stringify(value) })
const DAY = 86_400_000

/** bigPatchbay(60) for the browser: agents off (still deciders — their fuses stay), a repeating template on „Tessera 2“. */
function perfWorld(): PbWorld {
  const w = bigPatchbay(60)
  for (const [id, a] of Object.entries(w.ws.agents ?? {})) w.ws.agents![id] = { ...a, enabled: false }
  const db = w.ws.databases.dbBig1
  // nothing due at boot (its last run in the future); the test moves it back a day, then the service ticks
  w.ws.databases.dbBig1 = { ...db, templates: [{ id: 'tplBigDaily', name: 'Tagesnotiz', content: null, properties: {}, repeat: { freq: 'daily', time: '06:00', start: '2026-01-01', lastRunAt: Date.now() + 3 * DAY } }] }
  // Orders B10: the work orders and a BA, a Coding and a QA project on the same rack — the planner, its cables to the
  // projects, the chain edges (the next step, Then: BA → Coding / QA, QA → Coding); the budget is unchanged
  const o = ordersWorld({ server: null })
  Object.assign(w.ws.databases, o.ws.databases)
  Object.assign(w.ws.pages, o.ws.pages)
  return w
}

interface PbPerf {
  idb: Array<{ name: string; t: number }>
  appPaint: number | null
  long: Array<{ t: number; d: number }>
}

/** Before the app runs (every navigation): IndexedDB opens, the app's first painted frame, long tasks. */
function installCounters() {
  const w = window as unknown as { __pbPerf: PbPerf }
  const pb: PbPerf = (w.__pbPerf = { idb: [], appPaint: null, long: [] })
  const open = IDBFactory.prototype.open
  IDBFactory.prototype.open = function (this: IDBFactory, name: string, version?: number) {
    pb.idb.push({ name: String(name), t: performance.now() })
    return version === undefined ? open.call(this, name) : open.call(this, name, version)
  } as typeof open
  // the app's first paint: the frame in which `.app` is first there (its rAF callbacks run right before that paint)
  const mo = new MutationObserver(() => {
    if (pb.appPaint !== null || !document.querySelector('.app')) return
    pb.appPaint = -1
    mo.disconnect()
    requestAnimationFrame(() => (pb.appPaint = performance.now()))
  })
  mo.observe(document, { childList: true, subtree: true })
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) pb.long.push({ t: e.startTime, d: e.duration })
    }).observe({ type: 'longtask', buffered: true })
  } catch {
    /* no long-task timing */
  }
}

interface Seam {
  builds(): number
  inputBuilds(): number
  pageChecks(): number
  firstBuildAt(): number | null
  buildMs(n?: number): number[]
  buttons(): { ready: boolean; holders: number; dirty: number; build: { slices: number; maxMs: number; pages: number }; catchUps: { runs: number; pages: number; maxMs: number } }
}
interface Work {
  builds: number
  inputBuilds: number
  pageChecks: number
  catchUps: number
}
const work = (page: Page): Promise<Work> =>
  page.evaluate(() => {
    const s = (window as unknown as { __onePatchbay: Seam }).__onePatchbay
    return { builds: s.builds(), inputBuilds: s.inputBuilds(), pageChecks: s.pageChecks(), catchUps: s.buttons().catchUps.runs }
  })
const delta = (a: Work, b: Work): Work => ({ builds: b.builds - a.builds, inputBuilds: b.inputBuilds - a.inputBuilds, pageChecks: b.pageChecks - a.pageChecks, catchUps: b.catchUps - a.catchUps })
const now = (page: Page) => page.evaluate(() => performance.now())
const longest = (page: Page, from: number, to = Infinity) => page.evaluate(({ from, to }) => Math.max(0, ...(window as unknown as { __pbPerf: PbPerf }).__pbPerf.long.filter((x) => x.t >= from && x.t <= to).map((x) => x.d)), { from, to })

/** The big workspace with the Patchbay's world wired into it — ONE replaceAll, saved; the caller reloads (cold boot). */
async function loadBigPatchbay(page: Page, w: PbWorld): Promise<BigInfo> {
  await openApp(page)
  const info = await page.evaluate(
    ({ src, o, w }) => {
      // eslint-disable-next-line no-new-func
      const gen = new Function(`return (${src})`)() as (o: unknown) => { pages: Record<string, unknown>; databases: Record<string, unknown>; people: unknown[]; info: BigInfo }
      const out = gen(o)
      const hook = (window as unknown as { __one: { workspace: { getState: () => Record<string, unknown> & { replaceAll: (ws: unknown) => void; updateSettings: (p: unknown) => void } } } }).__one
      const s = hook.workspace.getState()
      s.replaceAll({
        version: s.version,
        epoch: s.epoch,
        pages: { ...(s.pages as object), ...out.pages, ...w.ws.pages },
        databases: { ...(s.databases as object), ...out.databases, ...w.ws.databases },
        people: [...(s.people as unknown[]), ...out.people],
        settings: { ...(s.settings as object), mcpServers: w.ws.settings.mcpServers ?? [] },
        recent: s.recent,
        functions: s.functions ?? {},
        agents: w.ws.agents ?? {},
        scripts: w.ws.scripts ?? {},
        kit: s.kit,
        integrations: w.ws.integrations ?? [],
        look: s.look,
        ai: s.ai,
        governor: s.governor,
      })
      // a Claude key (sealed by the store) for autofill — answered by the spec's mock, never a real host
      hook.workspace.getState().updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' })
      return out.info
    },
    { src: generateBigWorkspace.toString(), o: BIG_DEFAULTS, w },
  )
  await flush(page)
  return info
}

/** Claude for autofill: every Messages request is answered `{"value": "Kurzfassung n"}` (structured, not streamed). */
async function mockClaudeValues(page: Page): Promise<() => number> {
  let n = 0
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
  await page.context().route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const body = JSON.parse(req.postData() ?? '{}') as { model?: string }
    n++
    return route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({ id: `msg_pb${n}`, type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify({ value: `Kurzfassung ${n}` }) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 120, output_tokens: 8 } }),
    })
  })
  return () => n
}

/** Type ~200 characters into the open editor in words, with typing pauses (the editor hands its text to the store). */
async function type200(page: Page): Promise<void> {
  const text = ' Nordlicht prüft den Launch plan mit Mara Lind und Tessera, Woche für Woche, ohne Eile und ohne Lärm.'
  for (let round = 0; round < 2; round++)
    for (const word of text.split(/(?= )/)) {
      await page.keyboard.type(word, { delay: 25 })
      await page.waitForTimeout(120)
    }
  await page.waitForTimeout(1500)
}

/** Open a page and put the caret at the end of one of its paragraphs (after a scroll: the column holds still until read). */
async function caretIn(page: Page, id: string, nth: number): Promise<void> {
  await page.evaluate((h) => (window.location.hash = h), `#/p/${id}`)
  const ed = page.locator(`#main .ProseMirror[data-page-id="${id}"]`)
  await expect(ed).toBeVisible({ timeout: 30_000 })
  await page.locator('#main').hover()
  await page.mouse.wheel(0, 200)
  await ed.locator(':scope > p').nth(nth).click()
  await page.keyboard.press('End')
  await page.waitForTimeout(800)
}

test.describe('Patchbay performance budget (big workspace + bigPatchbay(60))', () => {
  test('boot after paint, typing rebuilds nothing, first rack, build, relayout, button index, bookkeeping', async ({ page }) => {
    test.setTimeout(600_000)
    const hooks: string[] = []
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, PUT, OPTIONS' }
    await page.context().route('https://hook0.example/**', (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      hooks.push(route.request().method())
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: '{"ok":true}' })
    })
    const asked = await mockClaudeValues(page)
    const big = await loadBigPatchbay(page, perfWorld())
    expect(big.pages).toBeGreaterThan(12_000)

    // a returning person (the Patchbay seen before: the setup record is read too), no tour, no morning hold
    await page.addInitScript(() => {
      localStorage.setItem('one.patchbay.seen', '1')
      localStorage.setItem('one.tour', JSON.stringify({ off: true }))
      localStorage.setItem('one.preflight.prefs', JSON.stringify({ hold: false }))
    })
    await page.addInitScript(installCounters)

    await test.step('cold boot: one-patchbay, the compute chunk and the first model only after the first paint', async () => {
      const chunks: Array<{ url: string; at: number }> = []
      page.on('request', (r) => {
        if (/\/compute-[\w-]+\.js$/.test(r.url())) chunks.push({ url: r.url(), at: Date.now() })
      })
      await page.reload()
      await waitForApp(page)
      await expect.poll(() => page.evaluate(() => (window as unknown as { __onePatchbay?: Seam }).__onePatchbay?.builds() ?? 0), { timeout: 60_000 }).toBeGreaterThan(0)
      // the sidebar LED from that idle build
      await expect(page.getByTestId('patchbay-nav-led')).toBeVisible({ timeout: 30_000 })
      await page.waitForTimeout(3000) // the services' first passes (the lazy cache, the setup record)
      const r = await page.evaluate(() => {
        const pb = (window as unknown as { __pbPerf: PbPerf }).__pbPerf
        const s = (window as unknown as { __onePatchbay: Seam }).__onePatchbay
        const res = performance.getEntriesByType('resource').filter((e) => /\/compute-[\w-]+\.js$/.test(e.name)).map((e) => e.startTime)
        return { appPaint: pb.appPaint, idb: pb.idb, firstBuild: s.firstBuildAt(), compute: res }
      })
      note('boot', { appPaint: Math.round(r.appPaint ?? -1), firstBuild: Math.round(r.firstBuild ?? -1), compute: r.compute.map(Math.round), patchbayDb: r.idb.filter((x) => x.name === 'one-patchbay').map((x) => Math.round(x.t)), dbs: [...new Set(r.idb.map((x) => x.name))] })
      expect(r.appPaint, 'the app painted').toBeGreaterThan(0)
      expect(chunks.length, 'the compute chunk loaded').toBeGreaterThan(0)
      for (const t of r.compute) expect(t, 'compute chunk requested after the first paint').toBeGreaterThan(r.appPaint!)
      expect(r.firstBuild!, 'the first model built after the first paint').toBeGreaterThan(r.appPaint!)
      const pbDb = r.idb.filter((x) => x.name === 'one-patchbay')
      expect(pbDb.length, 'one-patchbay read in idle (the lazy cache, the setup record)').toBeGreaterThan(0)
      for (const x of pbDb) expect(x.t, 'one-patchbay opened after the first paint').toBeGreaterThan(r.appPaint!)
      expect(r.idb.filter((x) => x.name === 'one-ledger'), 'the ledger is never read for the LED').toEqual([])
    })

    let typingBefore = 0
    /** the first rack after the chunk, one per page load (the budget: their median) */
    const firstRacks: number[] = []
    await test.step('typing 200 characters, the Patchbay never opened: nothing built, nothing rechecked', async () => {
      await caretIn(page, big.bigPageId, 8)
      const w0 = await work(page)
      const t0 = await now(page)
      await type200(page)
      const w1 = await work(page)
      typingBefore = await longest(page, t0)
      await expect.poll(() => wsEval(page, (s, id) => (s.pages[id].plain as string).includes('ohne Eile und ohne Lärm'), big.bigPageId)).toBe(true)
      note('typing, never opened', { ...delta(w0, w1), longestMs: Math.round(typingBefore) })
      expect(delta(w0, w1), 'model builds / input builds / page rechecks while typing').toEqual({ builds: 0, inputBuilds: 0, pageChecks: 0, catchUps: 0 })
    })

    await test.step('#/patchbay: the first rack paint after the chunk (one cold open), the button index in idle slices', async () => {
      // the typing above left garbage behind: collected first, so the open is timed on the page's own work (as perf-budget
      // times its idle windows)
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('HeapProfiler.enable')
      await cdp.send('HeapProfiler.collectGarbage')
      await page.waitForTimeout(500)
      const t0 = await now(page)
      await page.evaluate(() => (window.location.hash = '#/patchbay'))
      await expect(page.getByTestId('patchbay-page')).toBeVisible()
      await expect.poll(() => page.evaluate(() => performance.getEntriesByName('pb-first-rack', 'measure').length)).toBe(1)
      const first = await page.evaluate(() => performance.getEntriesByName('pb-first-rack', 'measure')[0].duration)
      await expect.poll(() => page.evaluate(() => (window as unknown as { __onePatchbay: Seam }).__onePatchbay.buttons().ready), { timeout: 60_000 }).toBe(true)
      const t1 = await now(page)
      const b = await page.evaluate(() => (window as unknown as { __onePatchbay: Seam }).__onePatchbay.buttons())
      const longOpen = await longest(page, t0, t1)
      firstRacks.push(first)
      note('first rack', { ms: Math.round(first) })
      note('button index', { ...b.build, maxMs: +b.build.maxMs.toFixed(1), longestTaskWhileOpening: Math.round(longOpen) })
      expect(b.build.pages, 'the cold build read every page').toBeGreaterThanOrEqual(big.pages)
      expect(b.build.slices, 'the cold build ran in slices').toBeGreaterThan(1)
      expect(b.build.maxMs, 'the longest slice of the cold build (ms)').toBeLessThanOrEqual(BUDGET.buttonSliceMs)
      // the report page's buttons are modules once the index is read
      await expect.poll(() => page.evaluate(() => (window as unknown as { __onePatchbay: { model: () => { modules: Array<{ key: string }> } } }).__onePatchbay.model().modules.filter((m) => m.key.startsWith('button:')).length)).toBeGreaterThan(0)
    })

    await test.step('the model build (graph + reach + chains + fuses) median ≤ 10 ms', async () => {
      const ms = await page.evaluate(() => (window as unknown as { __onePatchbay: Seam }).__onePatchbay.buildMs(15))
      const warm = ms.slice(3)
      const m = await page.evaluate(() => {
        const model = (window as unknown as { __onePatchbay: { model: () => { modules: unknown[]; edges: unknown[]; fuses: unknown[]; chains: unknown[] } } }).__onePatchbay.model()
        return { modules: model.modules.length, edges: model.edges.length, chains: model.chains.length, fuses: model.fuses.length }
      })
      note('model build ms', { median: +median(warm).toFixed(2), runs: ms.map((x) => +x.toFixed(1)), ...m })
      expect(m.modules, 'modules on the rack').toBeGreaterThanOrEqual(55)
      expect(median(warm), 'model build, median (ms)').toBeLessThanOrEqual(BUDGET.buildMs)
    })

    await test.step('relayout ≤ 16 ms (the whole rack)', async () => {
      await page.getByTestId('pb-filter').click()
      await page.getByTestId('pb-filter-preset').filter({ hasText: 'Everything' }).click()
      await page.keyboard.press('Escape')
      await expect.poll(() => page.locator('[data-wire]').count()).toBeGreaterThan(100)
      await page.evaluate(() => performance.clearMeasures('pb-relayout'))
      for (const w of [1400, 1440, 1380, 1440, 1420, 1440, 1390, 1440]) {
        await page.setViewportSize({ width: w, height: 900 })
        await page.waitForTimeout(150)
      }
      const times = await page.evaluate(() => performance.getEntriesByName('pb-relayout', 'measure').map((e) => e.duration))
      note('relayout ms', { median: +median(times).toFixed(1), runs: times.map((x) => +x.toFixed(1)) })
      expect(times.length).toBeGreaterThanOrEqual(6)
      expect(median(times), 'relayout, median (ms)').toBeLessThanOrEqual(BUDGET.relayoutMs)
    })

    await test.step('an automation run and an autofill fill with the route open: 0 builds', async () => {
      // a row of „Tessera 1“ (its autofill fills it once — before the count starts)
      const row = await wsEval(page, (s) => s.createPage({ parentId: 'dbBig0', databaseId: 'dbBig0', title: 'Nordlicht Zeile' }) as string)
      await expect.poll(() => wsEval(page, (s, id) => s.pages[id]?.properties?.dbBig0Note ?? null, row), { timeout: 30_000 }).not.toBeNull()
      await page.waitForTimeout(1500)
      const w0 = await work(page)
      const n0 = asked()
      await wsEval(page, (s, id) => s.setRowProperty(id, 'dbBig0Flag', true), row)
      await expect.poll(() => hooks.length, { timeout: 20_000 }).toBeGreaterThan(0)
      await expect.poll(() => wsEval(page, (s) => (s.databases.dbBig0.automations as Array<{ id: string; lastRunAt: number | null }>).find((a) => a.id === 'autBig0')?.lastRunAt ?? null), { timeout: 20_000 }).not.toBeNull()
      await expect.poll(() => asked(), { timeout: 30_000 }).toBeGreaterThan(n0)
      await expect.poll(() => wsEval(page, (s, id) => s.pages[id].properties.dbBig0Note, row), { timeout: 30_000 }).toBe(`Kurzfassung ${asked()}`)
      await page.waitForTimeout(1500)
      const w1 = await work(page)
      note('route open: automation + autofill', delta(w0, w1))
      expect({ builds: w1.builds - w0.builds, inputBuilds: w1.inputBuilds - w0.inputBuilds }, 'model / input builds for an automation run and an autofill fill').toEqual({ builds: 0, inputBuilds: 0 })
    })

    await test.step('route closed: an automation run, an autofill fill and a repeating occurrence — 0 builds', async () => {
      await page.evaluate((h) => (window.location.hash = h), `#/p/${big.bigPageId}`)
      await expect(page.getByTestId('patchbay-page')).toHaveCount(0)
      await page.waitForTimeout(1000)
      const row = await wsEval(page, (s) => (Object.values(s.pages) as Array<{ id: string; databaseId?: string; title: string }>).find((p) => p.databaseId === 'dbBig0' && p.title === 'Nordlicht Zeile')!.id)
      const w0 = await work(page)
      const hooks0 = hooks.length
      const n0 = asked()
      const runAt0 = await wsEval(page, (s) => (s.databases.dbBig0.automations as Array<{ id: string; lastRunAt: number | null }>).find((a) => a.id === 'autBig0')!.lastRunAt)
      // the automation (its webhook) and, a few seconds later, the autofill on the changed row
      await wsEval(page, (s, id) => s.setRowProperty(id, 'dbBig0Flag', false), row)
      await expect.poll(() => hooks.length, { timeout: 20_000 }).toBeGreaterThan(hooks0)
      await expect.poll(() => wsEval(page, (s) => (s.databases.dbBig0.automations as Array<{ id: string; lastRunAt: number | null }>).find((a) => a.id === 'autBig0')!.lastRunAt), { timeout: 20_000 }).not.toBe(runAt0)
      await expect.poll(() => asked(), { timeout: 30_000 }).toBeGreaterThan(n0)
      await expect.poll(() => wsEval(page, (s, id) => s.pages[id].properties.dbBig0Note, row), { timeout: 30_000 }).toBe(`Kurzfassung ${asked()}`)
      // the repeating template: its last run moved back a day (bookkeeping, no wiring), then the service ticks
      const rows0 = await wsEval(page, (s) => (Object.values(s.pages) as Array<{ databaseId?: string }>).filter((p) => p.databaseId === 'dbBig1').length)
      await wsEval(
        page,
        (s, day) => {
          const db = s.databases.dbBig1
          s.updateDatabase('dbBig1', { templates: db.templates.map((t: { repeat?: object }) => (t.repeat ? { ...t, repeat: { ...t.repeat, lastRunAt: Date.now() - day - 2 * 3_600_000 } } : t)) })
        },
        DAY,
      )
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
      await expect.poll(() => wsEval(page, (s) => (Object.values(s.pages) as Array<{ databaseId?: string }>).filter((p) => p.databaseId === 'dbBig1').length), { timeout: 20_000 }).toBeGreaterThan(rows0)
      await page.waitForTimeout(2500)
      const w1 = await work(page)
      note('route closed: automation + autofill + repeating', delta(w0, w1))
      expect(delta(w0, w1), 'model builds / input builds / page rechecks / button reads for the bookkeeping writes').toEqual({ builds: 0, inputBuilds: 0, pageChecks: 0, catchUps: 0 })
    })

    await test.step('typing 200 characters after a visit (the route closed): nothing built, nothing read, no longer tasks', async () => {
      await caretIn(page, big.bigPageId, 12)
      const w0 = await work(page)
      const t0 = await now(page)
      await type200(page)
      const w1 = await work(page)
      const after = await longest(page, t0)
      const b = await page.evaluate(() => (window as unknown as { __onePatchbay: Seam }).__onePatchbay.buttons())
      note('typing, after a visit', { ...delta(w0, w1), longestMs: Math.round(after), neverOpenedMs: Math.round(typingBefore), buttonIndex: { holders: b.holders, dirty: b.dirty } })
      expect(delta(w0, w1), 'model builds / input builds / page rechecks / button reads while typing').toEqual({ builds: 0, inputBuilds: 0, pageChecks: 0, catchUps: 0 })
      expect(b.holders, 'nobody holds the inputs open').toBe(0)
      expect(b.dirty, 'the typed page is only noted').toBeGreaterThan(0)
      expect(after, `longest task while typing (never opened: ${Math.round(typingBefore)} ms)`).toBeLessThanOrEqual(Math.max(50, typingBefore + BUDGET.typingExtraMs))
    })

    await test.step('typing in a page the model references (the report page with its buttons): nothing rechecked', async () => {
      await caretIn(page, 'pgBigReport', 0)
      const w0 = await work(page)
      await type200(page)
      const w1 = await work(page)
      note('typing in a referenced page', delta(w0, w1))
      expect(delta(w0, w1), 'model builds / input builds / page rechecks / button reads').toEqual({ builds: 0, inputBuilds: 0, pageChecks: 0, catchUps: 0 })
      // back on the route, the button index reads only what changed meanwhile — in one catch-up
      const c0 = await work(page)
      const visits0 = await page.evaluate(() => performance.getEntriesByName('pb-rack-paint', 'measure').length)
      await page.evaluate(() => (window.location.hash = '#/patchbay'))
      await expect(page.getByTestId('patchbay-page')).toBeVisible()
      // a later visit: the chunk is there, the page renders at once (noted, not budgeted — its commit also takes down the
      // page the person came from, an editor here; the plan's budget is the first rack after the chunk)
      await expect.poll(() => page.evaluate(() => performance.getEntriesByName('pb-rack-paint', 'measure').length)).toBeGreaterThan(visits0)
      const again = await page.evaluate(() => performance.getEntriesByName('pb-rack-paint', 'measure').at(-1)!.duration)
      note('rack paint, a later visit', { ms: Math.round(again) })
      await expect.poll(() => page.evaluate(() => (window as unknown as { __onePatchbay: Seam }).__onePatchbay.buttons().dirty)).toBe(0)
      const c1 = await work(page)
      const b = await page.evaluate(() => (window as unknown as { __onePatchbay: Seam }).__onePatchbay.buttons())
      note('catch-up on the visit', { new: c1.catchUps - c0.catchUps, ...b.catchUps })
      expect(c1.catchUps - c0.catchUps, 'one catch-up of the noted pages').toBeGreaterThanOrEqual(1)
      expect(b.catchUps.maxMs, 'the catch-up slice (ms)').toBeLessThanOrEqual(BUDGET.buttonSliceMs)
      expect(b.build.slices, 'no second cold build').toBeGreaterThan(1)
    })

    await test.step('first rack paint ≤ 250 ms after the chunk: the median of three cold opens (a page load each)', async () => {
      const cdp = await page.context().newCDPSession(page)
      for (let i = 0; i < 2; i++) {
        await page.reload()
        await waitForApp(page)
        await expect.poll(() => page.evaluate(() => (window as unknown as { __onePatchbay?: Seam }).__onePatchbay?.builds() ?? 0), { timeout: 60_000 }).toBeGreaterThan(0)
        await page.waitForTimeout(2000)
        // as for the first open: from the big page, the mouse resting over it, the garbage collected
        await caretIn(page, big.bigPageId, 8)
        await cdp.send('HeapProfiler.enable')
        await cdp.send('HeapProfiler.collectGarbage')
        await page.waitForTimeout(500)
        await page.evaluate(() => (window.location.hash = '#/patchbay'))
        await expect(page.getByTestId('patchbay-page')).toBeVisible()
        await expect.poll(() => page.evaluate(() => performance.getEntriesByName('pb-first-rack', 'measure').length)).toBe(1)
        firstRacks.push(await page.evaluate(() => performance.getEntriesByName('pb-first-rack', 'measure')[0].duration))
      }
      note('first rack, three cold opens', { ms: firstRacks.map(Math.round), median: Math.round(median(firstRacks)) })
      expect(median(firstRacks), 'first rack paint after the chunk, median of three cold opens (ms)').toBeLessThanOrEqual(BUDGET.firstRackMs)
    })
  })
})

/* ------------------------------------------------------------------ the eager closure (Node) */

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const AREA = resolve(ROOT, 'src/app/features/patchbay')

/** Relative static imports of a module (type-only ones left out). */
const staticOf = (src: string): string[] =>
  [...src.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;'"]*?from\s+'(\.{1,2}\/[^']+)'|^\s*import\s+'(\.{1,2}\/[^']+)'/gm)].map((m) => m[1] ?? m[2])

const resolveIn = (from: string, spec: string): string | null => {
  const base = resolve(dirname(from), spec)
  for (const ext of ['', '.ts', '.tsx', '/index.ts']) if (existsSync(base + ext) && statSync(base + ext).isFile()) return base + ext
  return null
}

/** The Patchbay files a set of entries loads statically (only files inside the area are followed). */
function eagerClosure(entries: string[]): string[] {
  const seen = new Set<string>()
  const queue = entries.map((e) => resolve(AREA, e))
  while (queue.length) {
    const f = queue.shift()!
    if (seen.has(f) || !f.startsWith(AREA)) continue
    seen.add(f)
    if (!/\.tsx?$/.test(f)) continue
    for (const s of staticOf(readFileSync(f, 'utf8'))) {
      const r = resolveIn(f, s)
      if (r) queue.push(r)
    }
  }
  return [...seen].map((f) => relative(AREA, f)).sort()
}

test.describe('Patchbay eager closure (Node)', () => {
  test("the boot chunk's Patchbay modules never import the model, the layout, the inputs or the page", () => {
    // what the app loads at boot: the area's index (features/index.ts), the hint line (agent editor, automations), the strings
    const eager = eagerClosure(['index.ts', 'hint.ts', 'messages.ts'])
    const HEAVY = ['model.ts', 'layout.ts', 'fuses.ts', 'reach.ts', 'chains.ts', 'sig.ts', 'plain.ts', 'tools.ts', 'rules.ts', 'source.ts', 'inputs.ts', 'state.ts', 'compute.ts', 'buttons.ts', 'scripts.ts', 'keys.ts', 'patch.ts', 'patchApply.ts', 'patchPick.ts', 'patching.ts', 'render.ts', 'live/live.ts', 'live/core.ts', 'live/legs.ts', 'live/costs.ts', 'ui/Patchbay.tsx', 'ui/Rack.tsx', 'ui/Wires.tsx', 'setup/facts.ts', 'setup/lamps.ts', 'setup/drop.ts', 'setup/merge.ts']
    for (const h of HEAVY) expect(existsSync(resolve(AREA, h)), `${h} exists`).toBe(true)
    expect(eager.filter((f) => HEAVY.includes(f)), 'heavy modules in the eager closure').toEqual([])
    // the whole eager set, named: a new boot-time module is a decision (B17 measured these)
    expect(eager.filter((f) => /\.tsx?$/.test(f))).toEqual([
      'cache.ts',
      'counts.ts',
      'hint.ts',
      'index.ts',
      'inventory.ts',
      'lamp.ts',
      'live/bus.ts',
      'live/runs.ts',
      'messages-fuses.ts',
      'messages-hint.ts',
      'messages-live.ts',
      // B18: the page's strings, split out of messages.ts (the names guard reads every file in Node)
      'messages-page.ts',
      'messages-patch.ts',
      'messages-plate.ts',
      'messages-setup.ts',
      'messages-wires.ts',
      'messages.ts',
      'open.ts',
      'readers.ts',
      'ref.ts',
      'route.tsx',
      'scope.ts',
      'service.ts',
      'setup/record.ts',
      'setup/return.ts',
      'setup/returnValue.ts',
      'ui/NavRow.tsx',
      'ui/ReturnChip.tsx',
      'ui/StatusCells.tsx',
      'ui/seen.ts',
    ])
    // positive controls: the heavy parts load only through import()
    expect(readFileSync(resolve(AREA, 'counts.ts'), 'utf8')).toContain("import('./compute')")
    expect(readFileSync(resolve(AREA, 'live/bus.ts'), 'utf8')).toContain("import('./live')")
    expect(readFileSync(resolve(AREA, 'route.tsx'), 'utf8')).toContain("import('./ui/Patchbay')")
    // and the page's paint mark is its first import (it marks the chunk's arrival)
    expect(staticOf(readFileSync(resolve(AREA, 'ui/Patchbay.tsx'), 'utf8'))[0]).toBe('./paintMark')
  })
})
