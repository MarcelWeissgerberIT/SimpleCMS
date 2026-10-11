/**
 * Flight recorder — what recording costs (design §3.10, B7), on a 2,500-page workspace and on the perf
 * budget's big workspace (tests/e2e/helpers/bigWorkspace.ts, ≈ 13,000 pages), with a real clock (page.clock
 * fakes performance.now, so these timings live here and not in recorder-journal):
 *  - the hot path (the recorder's store listener) stays under 1 ms p95 for 200 writes each of content, title and
 *    a cell — the typing path — and for 20 Immer writes (trash, move, a new row);
 *  - it never walks the page map: the idle processor takes the shared diff (no idle scan), and a store write walks
 *    the page map no more often with the recorder than without it (perf-budget's WRITE_SCANS hold);
 *  - while a script writes 1,000 rows, no stretch of the recorder's own work (a slice, a timer, a part of a flush)
 *    becomes a long task (> 50 ms);
 *  - typing in a 2,500-paragraph page (every update a new JSON, as the editor's getJSON makes it): one update is
 *    recorded in a few ms (its words from the changed block), no slice longer than a frame;
 *  - one store update changing every page and row (a restore) with the retention prune right after: the prune waits for the
 *    queue through the slices (its synchronous start is one slice), no stretch over 50 ms;
 *  - system writes (stamps) while ~2,700 segments are open: the hot path stays O(1) (under 0.5 ms p95 — walking them
 *    cost ~1 ms).
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval } from './fixtures'
import { loadBigWorkspace, type BigInfo, type BigOptions } from './helpers/bigWorkspace'
import { rec, startRecorder } from './helpers/recorder'

/** perf-budget.spec's bound per store write (page-map scans) — the recorder adds none. */
const WRITE_SCANS = { content: 2, title: 3, cell: 2 }
const HOT_P95_MS = 1
const LONG_TASK_MS = 50

type AnyRec = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

interface Stats {
  hot: { p50: number; p95: number; max: number; n: number }
  items: { p50: number; p95: number; max: number; n: number }
  idleDiffScans: number
  queue: number
  sliceMax: number
  itemMax: number
  taskMax: number
  long: Array<{ at: number; ms: number; what: string }>
  waiting: number
}

/** Page-map scans (Object.keys / values / entries of ≥ 2,000 entries), counted before the app runs. */
function installScanCounter() {
  const w = window as unknown as { __scans: number }
  w.__scans = 0
  for (const name of ['keys', 'values', 'entries'] as const) {
    const orig = Object[name] as (o: object) => unknown[]
    ;(Object as unknown as Record<string, unknown>)[name] = function (o: object) {
      const r = orig(o)
      if (r.length >= 2000) w.__scans++
      return r
    }
  }
}

const stats = (page: Page) => rec<Stats>(page, 'stats')
const note = (what: string, value: unknown) => {
  test.info().annotations.push({ type: what, description: JSON.stringify(value) })
  console.log(`[recorder-perf] ${what}: ${JSON.stringify(value)}`)
}

/** No page-map scan for 1.5 s: the deferred work of earlier writes (repairs, the search index …) is done. */
async function quiet(page: Page): Promise<void> {
  let last = -1
  let since = Date.now()
  const end = Date.now() + 30_000
  while (Date.now() < end) {
    const n = await page.evaluate(() => (window as unknown as { __scans: number }).__scans)
    if (n !== last) {
      last = n
      since = Date.now()
    } else if (Date.now() - since >= 1500) return
    await page.waitForTimeout(250)
  }
}

/** The queue drained and everything written. */
async function settled(page: Page): Promise<void> {
  await expect.poll(async () => (await stats(page)).queue, { timeout: 60_000 }).toBe(0)
  await rec(page, 'flush')
}

/** 200 writes of one kind (each one store update under the writer the app uses for it), then the hot path's numbers. */
async function writes(page: Page, kind: 'content' | 'title' | 'cell', big: BigInfo, n = 200): Promise<Stats['hot']> {
  await settled(page)
  await rec(page, 'resetStats')
  await page.evaluate(
    async ({ kind, n, id, rowId, propId }) => {
      const r = (window as unknown as { __oneRecorder: { step: (s: unknown) => Promise<unknown> } }).__oneRecorder
      const s = (window as unknown as { __one: { workspace: { getState: () => AnyRec } } }).__one.workspace.getState()
      const content = JSON.parse(JSON.stringify(s.pages[id].content))
      const para = content.content.find((b: AnyRec) => b.type === 'paragraph' && Array.isArray(b.content))
      for (let i = 0; i < n; i++) {
        if (kind === 'content') {
          para.content.push({ type: 'text', text: ` w${i}` })
          await r.step({ writer: { kind: 'editor', id: 'perf' }, calls: [['setContent', id, JSON.parse(JSON.stringify(content)), 'editor:perf']] })
        } else if (kind === 'title') await r.step({ writer: { kind: 'you', via: 'ui' }, calls: [['updatePage', id, { title: `Perf · Big page ${'x'.repeat((i % 20) + 1)}` }]] })
        else await r.step({ writer: { kind: 'you', via: 'ui' }, calls: [['setRowProperty', rowId, propId, 1000 + i]] })
        // a typing rhythm: the recorder's idle slices run between the writes
        await new Promise((res) => setTimeout(res, 4))
      }
    },
    { kind, n, id: big.bigPageId, rowId: big.bigTableRowId, propId: big.bigTableNumberProp },
  )
  const s = await stats(page)
  expect(s.hot.n, `${kind}: store updates the hot path saw`).toBeGreaterThanOrEqual(n)
  return s.hot
}

/** 20 Immer writes: 5 trash, 5 moves, 10 new rows. */
async function immerWrites(page: Page, big: BigInfo): Promise<Stats['hot']> {
  await settled(page)
  await rec(page, 'resetStats')
  await page.evaluate(
    async ({ tableId }) => {
      const r = (window as unknown as { __oneRecorder: { step: (s: unknown) => Promise<unknown> } }).__oneRecorder
      const s = (window as unknown as { __one: { workspace: { getState: () => AnyRec } } }).__one.workspace.getState()
      const pages = Object.values(s.pages as Record<string, AnyRec>).filter((p) => !p.databaseId && p.kind === 'page' && !p.trashed && p.parentId)
      const w = { kind: 'agent', id: 'perf-agent', run: 'p1' }
      for (let i = 0; i < 5; i++) await r.step({ writer: w, calls: [['trashPage', pages[i].id]] })
      for (let i = 5; i < 10; i++) await r.step({ writer: w, calls: [['movePage', pages[i].id, null]] })
      for (let i = 0; i < 10; i++) await r.step({ writer: w, calls: [['createRow', tableId, { title: `Tessera ${i}` }]] })
    },
    { tableId: big.bigTableId },
  )
  const s = await stats(page)
  expect(s.hot.n).toBeGreaterThanOrEqual(20)
  return s.hot
}

/** Page-map scans per write (the write and what it wakes, the recorder's idle work included). */
async function scansPerWrite(page: Page, big: BigInfo): Promise<Record<'content' | 'title' | 'cell', number[]>> {
  return page.evaluate(
    async ({ id, rowId, propId }) => {
      const w = window as unknown as { __scans: number; __oneRecorder: { flush: () => Promise<void> }; __one: { workspace: { getState: () => AnyRec } } }
      const out: Record<'content' | 'title' | 'cell', number[]> = { content: [], title: [], cell: [] }
      const measure = async (kind: keyof typeof out, write: () => void) => {
        const before = w.__scans
        write()
        await new Promise((r) => setTimeout(r, 120))
        await w.__oneRecorder.flush()
        out[kind].push(w.__scans - before)
      }
      for (let i = 0; i < 4; i++) {
        const s = w.__one.workspace.getState()
        const content = JSON.parse(JSON.stringify(s.pages[id].content))
        content.content[1].content.push({ type: 'text', text: ` scan ${i}` })
        await measure('content', () => s.setContent(id, content, 'perf-scan'))
        await measure('title', () => s.updatePage(id, { title: `Perf · Big page ${'y'.repeat(i + 1)}` }))
        await measure('cell', () => s.setRowProperty(rowId, propId, 500 + i))
      }
      return out
    },
    { id: big.bigPageId, rowId: big.bigTableRowId, propId: big.bigTableNumberProp },
  )
}

const SHAPES: Array<{ name: string; opts: Partial<BigOptions>; minPages: number }> = [
  { name: '2,500 pages', opts: { pages: 1500, richPages: 250, databases: 5, rowsPerDb: 200, syncedGroups: 20, commentedPages: 50 }, minPages: 2500 },
  { name: 'big workspace', opts: {}, minPages: 12_000 },
]

test.describe('flight recorder: performance', () => {
  for (const shape of SHAPES)
    test(`the hot path stays under 1 ms p95 and walks no page map (${shape.name})`, async ({ page }) => {
      test.setTimeout(480_000)
      await page.addInitScript(installScanCounter)
      const big = await loadBigWorkspace(page, shape.opts)
      expect(big.pages).toBeGreaterThan(shape.minPages)
      await startRecorder(page)
      // the services' first passes, then a quiet start
      await page.waitForTimeout(3000)
      await settled(page)

      const hot: Record<string, Stats['hot']> = {}
      for (const kind of ['content', 'title', 'cell'] as const) hot[kind] = await writes(page, kind, big)
      hot.immer = await immerWrites(page, big)
      note('hot path ms', hot)
      for (const [kind, h] of Object.entries(hot)) expect(h.p95, `hot path p95 (${kind}): ${JSON.stringify(h)}`).toBeLessThan(HOT_P95_MS)

      // the idle processor took the shared diff every time: no page-map scan of its own
      await settled(page)
      const s = await stats(page)
      expect(s.idleDiffScans, 'idle page-map diffs').toBe(0)

      // a store write walks the page map no more often with the recorder than without it (each from a quiet start)
      await rec(page, 'resetStats')
      await quiet(page)
      const on = await scansPerWrite(page, big)
      expect((await stats(page)).idleDiffScans).toBe(0)
      await rec(page, 'stop')
      await quiet(page)
      const off = await scansPerWrite(page, big)
      note('page-map scans per write (recorder on / off)', { on, off })
      for (const kind of ['content', 'title', 'cell'] as const) {
        for (const n of on[kind]) expect(n, `page-map scans per store write with the recorder: ${kind} (${on[kind].join(', ')})`).toBeLessThanOrEqual(WRITE_SCANS[kind])
        const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
        expect(sum(on[kind]), `scans with the recorder vs without (${kind})`).toBeLessThanOrEqual(sum(off[kind]))
      }
    })

  test('a script writing 1,000 rows: no stretch of the recorder becomes a long task', async ({ page }) => {
    test.setTimeout(480_000)
    const big = await loadBigWorkspace(page, SHAPES[0].opts)
    await startRecorder(page)
    await page.waitForTimeout(3000)
    await settled(page)
    await rec(page, 'resetStats')
    await page.evaluate(() => {
      const w = window as unknown as { __long: Array<{ t: number; d: number }> }
      w.__long = []
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) w.__long.push({ t: e.startTime, d: e.duration })
      }).observe({ type: 'longtask' })
    })
    const t0 = await page.evaluate(() => performance.now())
    // the script's run: one store update per row, an await between rows (the interpreter yields), a pause every 25
    await page.evaluate(async (tableId) => {
      const r = (window as unknown as { __oneRecorder: { step: (s: unknown) => Promise<unknown> } }).__oneRecorder
      const writer = { kind: 'script', id: 'tagesplan', run: 'perf-1000' }
      for (let i = 0; i < 1000; i++) {
        await r.step({ writer, calls: [['createRow', tableId, { title: `Nordlicht ${i}` }]], ...(i === 0 ? { note: true } : {}), ...(i === 999 ? { end: true } : {}) })
        if (i % 25 === 24) await new Promise((res) => setTimeout(res, 0))
      }
    }, big.bigTableId)
    await settled(page)
    const s = await stats(page)
    const long = await page.evaluate((t0) => (window as unknown as { __long: Array<{ t: number; d: number }> }).__long.filter((x) => x.t >= t0), t0)
    note('recorder stretches', { taskMax: Math.round(s.taskMax), sliceMax: Math.round(s.sliceMax), long: s.long, pageLongTasks: long.length })
    expect(s.long, 'stretches of the recorder over 50 ms').toEqual([])
    expect(s.taskMax, 'the longest stretch of the recorder').toBeLessThan(LONG_TASK_MS)
    // a long task of the page while the recorder worked on its own: none may contain one of its stretches over 50 ms
    // (the store writes themselves, React and the workspace's save are the app's, not the recorder's)
    const ops = await rec<AnyRec[]>(page, 'ops')
    expect(ops.filter((o) => o.r === 'script:tagesplan:perf-1000')).toHaveLength(1000)
    expect(await rec(page, 'unknowns')).toEqual([])
  })
  test('typing in a 2,500-paragraph page: each update recorded in a few ms, its words from the changed block', async ({ page }) => {
    test.setTimeout(240_000)
    await openApp(page)
    await startRecorder(page)
    const id = await wsEval(page, (s) => {
      const content = { type: 'doc', content: Array.from({ length: 2500 }, (_, i) => ({ type: 'paragraph', attrs: { id: `b${i}` }, content: [{ type: 'text', text: `Nordlicht Absatz ${i}: ${'Tessera Wort '.repeat(12)}` }] })) }
      return s.createPage({ title: 'Nordlicht Handbuch', content }) as string
    })
    await settled(page)
    await rec(page, 'resetStats')
    const since = await page.evaluate(() => Date.now())
    await page.evaluate(async (id) => {
      const r = (window as unknown as { __oneRecorder: { step: (s: unknown) => Promise<unknown> } }).__oneRecorder
      const s = (window as unknown as { __one: { workspace: { getState: () => AnyRec } } }).__one.workspace.getState()
      let content = s.pages[id].content
      for (let i = 0; i < 100; i++) {
        // the editor's getJSON: every block a new object, one paragraph changed
        const next = JSON.parse(JSON.stringify(content))
        next.content[1200].content[0].text += ` w${i}`
        content = next
        await r.step({ writer: { kind: 'editor', id: 'perf' }, calls: [['setContent', id, next, 'editor:perf']] })
        await new Promise((res) => setTimeout(res, 100))
      }
    }, id)
    await settled(page)
    // the person's segment closes (its touched parts summed up): no long task either
    await rec(page, 'settle')
    const st = await stats(page)
    note('typing on a 2,500-paragraph page', { items: st.items, sliceMax: Math.round(st.sliceMax * 10) / 10, taskMax: Math.round(st.taskMax), long: st.long })
    // one typing update is one place: it fits the visible slice (8 ms) — p95, a busy machine's stray pause aside
    expect(st.items.n).toBeGreaterThanOrEqual(100)
    expect(st.items.p95, `recording one typing update (ms): ${JSON.stringify(st.items)}`).toBeLessThan(8)
    expect(st.long, 'stretches of the recorder over 50 ms').toEqual([])
    const events = (await rec<AnyRec[]>(page, 'events', { from: since })).filter((e) => e.p === `p:${id}`)
    expect(events.reduce((n, e) => n + (e.wa ?? 0), 0), 'words typed').toBe(100)
    expect(await rec(page, 'unknowns')).toEqual([])
  })

  test('one update changing every page and the prune right after: the prune waits for the slices; stamps with every segment open stay O(1)', async ({ page }) => {
    test.setTimeout(480_000)
    await loadBigWorkspace(page, SHAPES[0].opts)
    await startRecorder(page)
    await page.waitForTimeout(3000)
    await settled(page)
    await rec(page, 'resetStats')
    // a restore: one store update changing every page and row — then the retention prune at once
    const r = await page.evaluate(async () => {
      const rr = (window as unknown as { __oneRecorder: { step: (s: unknown) => Promise<unknown>; prune: () => Promise<unknown> } }).__oneRecorder
      const s = (window as unknown as { __one: { workspace: { getState: () => AnyRec } } }).__one.workspace.getState()
      const pages: Record<string, AnyRec> = { ...s.pages }
      const ids: string[] = []
      for (const [id, p] of Object.entries(pages))
        if (!p.trashed) {
          pages[id] = { ...p, title: `${p.title} ·` }
          ids.push(id)
        }
      const ws = { version: s.version, pages, databases: s.databases, people: s.people, settings: s.settings, recent: s.recent, functions: s.functions, agents: s.agents, scripts: s.scripts, kit: s.kit, look: s.look, integrations: s.integrations }
      await rr.step({ writer: { kind: 'import', run: 'perf-restore', source: 'backup' }, calls: [['replaceAll', ws]] })
      const t0 = performance.now()
      const pruned = rr.prune()
      const sync = performance.now() - t0
      await pruned
      return { n: ids.length, sync, ids: ids.slice(0, 50) }
    })
    await settled(page)
    const st = await stats(page)
    note('restore + prune', { pages: r.n, pruneSync: Math.round(r.sync * 10) / 10, taskMax: Math.round(st.taskMax), sliceMax: Math.round(st.sliceMax), long: st.long })
    expect(r.n).toBeGreaterThan(2500)
    expect(r.sync, 'the prune’s synchronous start (one slice, not the queue)').toBeLessThan(30)
    expect(st.long, 'stretches of the recorder over 50 ms').toEqual([])
    expect(st.taskMax).toBeLessThan(LONG_TASK_MS)
    // the restore's segments stay open (its run did not end): system writes must not walk them
    const open = await rec<AnyRec[]>(page, 'open')
    expect(open.length).toBeGreaterThan(2500)
    await rec(page, 'resetStats')
    await page.evaluate(async (ids) => {
      const rr = (window as unknown as { __oneRecorder: { step: (s: unknown) => Promise<unknown> } }).__oneRecorder
      for (const id of ids) {
        await rr.step({ writer: { kind: 'system', why: 'stamp' }, calls: [['updatePage', id, { updatedBy: 'acc-nordlicht' }]] })
        await new Promise((res) => setTimeout(res, 4))
      }
    }, r.ids)
    const hot = (await stats(page)).hot
    note('hot path, stamps with segments open', hot)
    expect(hot.n).toBeGreaterThanOrEqual(50)
    // (walking the open segments inside set() cost ~1 ms p95 here; the queue push costs ~0.1 ms)
    expect(hot.p95, `hot path p95 (system writes): ${JSON.stringify(hot)}`).toBeLessThan(HOT_P95_MS / 2)
    expect(await rec(page, 'unknowns')).toEqual([])
  })
})
