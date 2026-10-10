/**
 * Flight recorder — what recording costs (design §3.10, B7), on a 2,500-page workspace and on the perf
 * budget's big workspace (tests/e2e/helpers/bigWorkspace.ts, ≈ 13,000 pages), with a real clock (page.clock
 * fakes performance.now, so these timings live here and not in recorder-journal):
 *  - the hot path (the recorder's store listener) stays under 1 ms p95 for 200 writes each of content, title and
 *    a cell — the typing path — and for 20 Immer writes (trash, move, a new row);
 *  - it never walks the page map: the idle processor takes the shared diff (no idle scan), and a store write walks
 *    the page map no more often with the recorder than without it (perf-budget's WRITE_SCANS hold);
 *  - while a script writes 1,000 rows, no stretch of the recorder's own work (a slice, a timer, a part of a flush)
 *    becomes a long task (> 50 ms).
 */
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { loadBigWorkspace, type BigInfo, type BigOptions } from './helpers/bigWorkspace'
import { rec, startRecorder } from './helpers/recorder'

/** perf-budget.spec's bound per store write (page-map scans) — the recorder adds none. */
const WRITE_SCANS = { content: 2, title: 3, cell: 2 }
const HOT_P95_MS = 1
const LONG_TASK_MS = 50

type AnyRec = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

interface Stats {
  hot: { p50: number; p95: number; max: number; n: number }
  idleDiffScans: number
  queue: number
  sliceMax: number
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

      // a store write walks the page map no more often with the recorder than without it
      await rec(page, 'resetStats')
      const on = await scansPerWrite(page, big)
      expect((await stats(page)).idleDiffScans).toBe(0)
      await rec(page, 'stop')
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
})
