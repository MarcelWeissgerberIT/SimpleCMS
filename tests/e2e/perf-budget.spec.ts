/**
 * Performance budget on a big workspace (tests/e2e/helpers/bigWorkspace.ts: 3,000 pages — 500 of
 * them with 30–200 rich blocks — and 25 databases × 400 rows, ≈ 13,000 pages / 45 MB of JSON).
 *
 * Budgets are generous on purpose (a loaded CI box must pass), and the sharp ones COUNT work
 * instead of timing it, so they hold on any machine:
 *  - a typing pause writes that page's record to IndexedDB — never the whole workspace;
 *  - a store write walks the page map (Object.keys / values / entries of every page) once or
 *    twice, whatever is mounted (sidebar, backlinks, unlinked mentions, status bar …) — for the
 *    editor's text, a title typed key by key and a table cell alike;
 *  - the boot walks it a bounded number of times and never builds the home screen on its way to
 *    the start page; a ⌘K query does not walk it per key;
 *  - an idle app changes nothing, writes nothing and runs no script (V8 tidying a big heap after
 *    a burst of work is not the app: the busy share is read in the quieter of two windows).
 * Timings guard against order-of-magnitude regressions: the whole-workspace saves this suite was
 * written against blocked the main thread for ~1.5 s after every typing pause.
 *
 * The storage layout this relies on (one record per page) gets its own tests below: conversion
 * from the old single-record layout and the page order surviving a reload.
 */
import type { CDPSession, Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, wsEval, flush } from './fixtures'
import { loadBigWorkspace, type BigInfo } from './helpers/bigWorkspace'

// no trace in this file: its DOM snapshot after every action walks the whole page (the big table, the 300-task page)
// in the page's own main thread — 50–200 ms on a busy box, counted as the app's long tasks
test.use({ trace: 'off' })

/**
 * Page-map scans (Object.keys / values / entries of ≥ 2,000 entries) allowed until the app is up,
 * and per store write. Today: ~20 at boot; 1 per write (its copy of the map — the diff every reader
 * asks for comes with it) + 1 for a title (unlinked mentions look for the new title). Through an Immer
 * draft a write took 2 more, before the shared diff 12+.
 */
const BOOT_SCANS = 40
const WRITE_SCANS = { content: 2, title: 3, cell: 2 }

/** Counters installed before the app runs (survive reloads of the page). */
function installCounters() {
  const w = window as unknown as { __perf: PerfCounters; __perfStopWatch: () => void }
  const perf: PerfCounters = (w.__perf = { scans: 0, puts: [], longTasks: [], keys: [], homeSeen: false })
  // the home screen (a pass over every page for its stats + the agenda panel) must not render on the way to the start page
  const watch = new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) if (n instanceof Element && (n.matches('.home') || n.querySelector('.home'))) perf.homeSeen = true
  })
  watch.observe(document, { childList: true, subtree: true })
  w.__perfStopWatch = () => watch.disconnect()
  // a "scan": Object.keys / values / entries of a map with thousands of entries (the page map)
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
    let size = 0
    try {
      size = JSON.stringify(value)?.length ?? 0
    } catch {
      /* not JSON-able (files): not the workspace */
    }
    perf.puts.push({ t: performance.now(), db: this.transaction.db.name, key: String(key ?? ''), size })
    return put.call(this, value, key)
  } as typeof put
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) perf.longTasks.push({ t: e.startTime, d: e.duration })
    }).observe({ type: 'longtask', buffered: true })
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (e.name === 'keydown') perf.keys.push({ t: e.startTime, d: e.duration })
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit)
  } catch {
    /* observers unsupported */
  }
}

interface PerfCounters {
  scans: number
  puts: Array<{ t: number; db: string; key: string; size: number }>
  longTasks: Array<{ t: number; d: number }>
  keys: Array<{ t: number; d: number }>
  homeSeen: boolean
}

const now = (page: Page) => page.evaluate(() => performance.now())
const counters = (page: Page) => page.evaluate(() => (window as unknown as { __perf: PerfCounters }).__perf)
const scans = (page: Page) => page.evaluate(() => (window as unknown as { __perf: PerfCounters }).__perf.scans)
const since = <T extends { t: number }>(list: T[], t0: number) => list.filter((x) => x.t >= t0)
/** A reading for the report (playwright's JSON / HTML reporters show it). */
const note = (what: string, value: unknown) => test.info().annotations.push({ type: what, description: JSON.stringify(value) })
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0

/** Main-thread time (ms): every task (`busy`), and the part that is the app's own work (`work`: script, style, layout). */
async function mainThread(cdp: CDPSession): Promise<{ busy: number; work: number }> {
  const { metrics } = (await cdp.send('Performance.getMetrics')) as { metrics: Array<{ name: string; value: number }> }
  const ms = (name: string) => (metrics.find((m) => m.name === name)?.value ?? 0) * 1000
  return { busy: ms('TaskDuration'), work: ms('ScriptDuration') + ms('RecalcStyleDuration') + ms('LayoutDuration') }
}

/** Navigate by hash and resolve with the ms until `ready` holds in a rendered frame. */
async function timeTo(page: Page, hash: string, ready: string): Promise<number> {
  return page.evaluate(
    async ({ hash, ready }) => {
      const t = performance.now()
      window.location.hash = hash
      // eslint-disable-next-line no-new-func
      const ok = new Function(`return (${ready})`) as () => boolean
      await new Promise<void>((resolve) => {
        const check = () => (ok() ? requestAnimationFrame(() => setTimeout(resolve, 0)) : requestAnimationFrame(check))
        check()
      })
      return performance.now() - t
    },
    { hash, ready },
  )
}

test.describe('performance budget (big workspace)', () => {
  test('boot, idle, typing, store writes, big table and search stay within budget', async ({ page, errors }) => {
    test.setTimeout(420_000)
    // the generated page mentions point at pages by id only: nothing to fetch, nothing should fail
    void errors
    await page.addInitScript(installCounters)
    // no Preflight morning hold here: the boot to the start page is measured (the held boot: preflight-perf.spec)
    await page.addInitScript(() => localStorage.setItem('one.preflight.prefs', JSON.stringify({ hold: false })))
    const big: BigInfo = await loadBigWorkspace(page)
    expect(big.pages).toBeGreaterThan(12_000)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Performance.enable')

    await test.step('cold boot', async () => {
      await page.goto('app/?e2e')
      await page.waitForFunction(() => !!document.querySelector('.app') && !document.getElementById('boot'), null, { polling: 'raf', timeout: 90_000 })
      const bootMs = await now(page)
      const c = await counters(page)
      await page.evaluate(() => (window as unknown as { __perfStopWatch: () => void }).__perfStopWatch())
      note('boot', { ms: Math.round(bootMs), scans: c.scans })
      // "#/" opens the start page: the home screen is never built just to be replaced (it was: ~1 s here)
      expect(c.homeSeen, 'home screen rendered on the way to the start page').toBe(false)
      expect(c.scans, 'page-map scans until the app is up').toBeLessThanOrEqual(BOOT_SCANS)
      // wall clock: order-of-magnitude only (a loaded box takes several times longer than a quiet one)
      expect(bootMs, 'cold boot of ~13,000 pages to a usable app').toBeLessThan(45_000)
      await page.waitForTimeout(4000) // the services' first passes (inbox, synced blocks, sync)
    })

    const pageHash = `#/p/${big.bigPageId}`
    const editorReady = `(document.querySelector('#main .ProseMirror[data-page-id="${big.bigPageId}"]')?.childElementCount ?? 0) >= ${big.bigPageBlocks}`

    await test.step('open the 200-block page', async () => {
      const ms = await timeTo(page, pageHash, editorReady)
      note('open page ms', Math.round(ms))
      expect(ms, 'opening a page with 200 blocks').toBeLessThan(6000)
      await page.waitForTimeout(2500)
    })

    await test.step('idle: no store changes, no saves, a free main thread', async () => {
      await page.evaluate(() => {
        const w = window as unknown as { __perfIdle: number; __one: { workspace: { subscribe: (fn: () => void) => void } } }
        w.__perfIdle = 0
        w.__one.workspace.subscribe(() => w.__perfIdle++)
      })
      const t0 = await now(page)
      // V8 tidies a big heap a few seconds after a burst of work (incremental marking + a major GC,
      // ~1 s here): housekeeping, not the app. Collect now; should it still run, the second window is quiet.
      await cdp.send('HeapProfiler.enable')
      await cdp.send('HeapProfiler.collectGarbage')
      const windows: Array<{ busy: number; work: number }> = []
      for (let i = 0; i < 2; i++) {
        const a = await mainThread(cdp)
        const wall0 = Date.now()
        await page.waitForTimeout(10_000)
        const b = await mainThread(cdp)
        const wall = Date.now() - wall0
        windows.push({ busy: (b.busy - a.busy) / wall, work: (b.work - a.work) / wall })
        if (windows[i].busy < 0.05) break
      }
      note('idle', windows)
      const c = await counters(page)
      expect(await page.evaluate(() => (window as unknown as { __perfIdle: number }).__perfIdle), 'store changes while idle').toBe(0)
      expect(since(c.puts, t0).filter((p) => p.db === 'keyval-store'), 'workspace writes while idle').toEqual([])
      for (const w of windows) expect(w.work, 'script / style / layout share of an idle 10 s window').toBeLessThan(0.02)
      expect(Math.min(...windows.map((w) => w.busy)), 'main-thread busy share while idle (quietest 10 s window)').toBeLessThan(0.05)
    })

    await test.step('store writes of the open page walk the page map only a few times', async () => {
      // Preflight's first pass (the row index's one build) is done before the writes are counted
      await page.evaluate(() => (window as unknown as { __onePreflight?: { flush: () => Promise<void> } }).__onePreflight?.flush())
      const res = await page.evaluate(
        async ({ id, rowId, propId }) => {
          const w = window as unknown as { __perf: PerfCounters; __one: { workspace: { getState: () => Record<string, any> } } } // eslint-disable-line @typescript-eslint/no-explicit-any
          const out: Record<'content' | 'title' | 'cell', number[]> = { content: [], title: [], cell: [] }
          // scans of one write + the renders it causes (sidebar, backlinks, unlinked mentions, status bar …) + deferred work
          const measure = async (kind: keyof typeof out, write: () => void) => {
            const before = w.__perf.scans
            write()
            await new Promise((r) => setTimeout(r, 120))
            out[kind].push(w.__perf.scans - before)
          }
          for (let i = 0; i < 4; i++) {
            const s = w.__one.workspace.getState()
            const content = JSON.parse(JSON.stringify(s.pages[id].content))
            content.content[1].content.push({ type: 'text', text: ` budget ${i}` })
            await measure('content', () => s.setContent(id, content, 'perf-budget'))
            // a title typed key by key, a table cell
            await measure('title', () => s.updatePage(id, { title: `Perf · Big page ${'x'.repeat(i + 1)}` }))
            await measure('cell', () => s.setRowProperty(rowId, propId, 100 + i))
          }
          w.__one.workspace.getState().updatePage(id, { title: 'Perf · Big page' })
          return out
        },
        { id: big.bigPageId, rowId: big.bigTableRowId, propId: big.bigTableNumberProp },
      )
      note('write scans', res)
      for (const kind of ['content', 'title', 'cell'] as const) for (const n of res[kind]) expect(n, `page-map scans per store write: ${kind} (${res[kind].join(', ')})`).toBeLessThanOrEqual(WRITE_SCANS[kind])
      await page.waitForTimeout(1500)
    })

    await test.step('typing on the big page: no whole-workspace saves, no long freezes', async () => {
      const ed = page.locator(`#main .ProseMirror[data-page-id="${big.bigPageId}"]`)
      // a reader scrolls first: until the column is touched it undoes scrolls nobody asked for (useColumnScroll)
      await page.locator('#main').hover()
      await page.mouse.wheel(0, 300)
      await ed.locator(':scope > p').nth(8).click()
      await page.keyboard.press('End')
      await page.waitForTimeout(800)
      const t0 = await now(page)
      const sentence = ' the quick brown fox jumps over the lazy dog again'
      for (const word of sentence.split(/(?= )/)) {
        await page.keyboard.type(word, { delay: 40 })
        await page.waitForTimeout(380) // a typing pause: the editor hands its text to the store, the store saves
      }
      await page.waitForTimeout(1500)
      await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain.includes('the lazy dog again'), big.bigPageId)).toBe(true)
      const c = await counters(page)
      const puts = since(c.puts, t0).filter((p) => p.db === 'keyval-store')
      expect(puts.length, 'saves during the typing session').toBeGreaterThan(0)
      for (const p of puts) expect(p.key, 'only page records and the meta record are written').toMatch(/^one\.(page\.v2:|ws\.v2$)/)
      const bytes = puts.reduce((n, p) => n + p.size, 0)
      expect(bytes, `bytes saved while typing 50 characters (workspace: ${big.jsonChars})`).toBeLessThan(big.jsonChars / 20)
      const long = since(c.longTasks, t0)
      const longMs = long.reduce((n, x) => n + x.d, 0)
      expect(Math.max(0, ...long.map((x) => x.d)), 'longest main-thread task while typing').toBeLessThan(1000)
      expect(longMs, 'main-thread time in long tasks during a 10-word typing session').toBeLessThan(8000)
      const keys = since(c.keys, t0).map((k) => k.d).sort((a, b) => a - b)
      note('typing', { saves: puts.length, bytes, longTasks: long.length, longMs: Math.round(longMs), keysOver16: keys })
      if (keys.length) expect(keys[Math.floor(keys.length / 2)], 'median keypress → paint (Event Timing)').toBeLessThan(200)
    })

    await test.step('the 400-row table and its board', async () => {
      const home = await wsEval(page, (s) => s.settings.startPageId as string)
      await page.evaluate((id) => (window.location.hash = `#/p/${id}`), home)
      await page.waitForTimeout(800)
      const tableMs = await timeTo(page, `#/p/${big.bigTableId}`, `document.querySelectorAll('#main section.db .dbt-body .dbt-row[role="row"]').length > 10`)
      note('open table ms', Math.round(tableMs))
      expect(tableMs, 'opening a 400-row table').toBeLessThan(6000)
      expect(await page.locator('#main section.db .dbt-body .dbt-row[role="row"]').count(), 'table rows stay virtualised').toBeLessThan(200)
      // a write elsewhere does not make the open table re-derive its rows (see useRelevantPages)
      const walked = await page.evaluate(async (id) => {
        const w = window as unknown as { __perf: PerfCounters; __one: { workspace: { getState: () => Record<string, any> } } } // eslint-disable-line @typescript-eslint/no-explicit-any
        const before = w.__perf.scans
        w.__one.workspace.getState().updatePage(id, { title: 'Perf · Big page (edited)' })
        await new Promise((r) => setTimeout(r, 120))
        return w.__perf.scans - before
      }, big.bigPageId)
      expect(walked, 'page-map scans for a write outside the open table').toBeLessThanOrEqual(WRITE_SCANS.title)
    })

    await test.step('⌘K search', async () => {
      // a page to find by a typo (fuzzy title match)
      await wsEval(page, (s) => s.createPage({ title: 'Quarterly roadmap' }))
      await page.keyboard.press('Escape')
      await page.locator('#main').click({ position: { x: 5, y: 5 } })
      await page.keyboard.press('Control+k')
      const input = page.locator('.pal-input input')
      await expect(input).toBeVisible()
      const t0 = Date.now()
      await input.fill(big.titleWord)
      await expect(page.locator('.pal-item').first()).toBeVisible()
      expect(Date.now() - t0, '⌘K title search over ~13,000 pages').toBeLessThan(3000)
      const t1 = Date.now()
      await input.fill(big.bodyWord)
      await expect(page.locator('.pal').getByText(big.bodyWord).first()).toBeVisible()
      expect(Date.now() - t1, '⌘K body-text search').toBeLessThan(3000)
      // a typo, key by key: from "quartel" on nothing matches literally, so every key runs the fuzzy
      // title match (Fuse over the titles that can still match: ~5× less work than over all of them)
      await input.fill('')
      await page.waitForTimeout(300)
      const s0 = await scans(page)
      const k0 = await now(page)
      await input.pressSequentially('quartely roadmap', { delay: 60 })
      await expect(page.locator('.pal-item', { hasText: 'Quarterly roadmap' }).first()).toBeVisible()
      expect((await scans(page)) - s0, 'page-map scans while typing a query (the index is built once per open)').toBeLessThanOrEqual(1)
      const slow = since((await counters(page)).keys, k0).map((k) => k.d)
      note('palette keys over 16 ms', slow)
      if (slow.length) expect(median(slow), `median keypress → paint in ⌘K, of the keys over 16 ms (${slow.length})`).toBeLessThan(300)

      // property filters (shell/palette/filters.ts): they walk the search index's array, never the page map
      await input.fill('')
      await page.waitForTimeout(300)
      const t2 = Date.now()
      await input.fill('status:done ')
      await expect(page.locator('.pal-chip')).toHaveCount(1)
      await expect(page.locator('.pal-item--page').first()).toBeVisible()
      expect(Date.now() - t2, '⌘K status:done over ~10,000 rows').toBeLessThan(3000)
      const s1 = await scans(page)
      const k1 = await now(page)
      await input.pressSequentially('in:perf owner:ada score:>10 notes:a', { delay: 60 })
      await expect(page.locator('.pal-chip')).toHaveCount(4)
      await expect(page.locator('.pal-input__field')).toHaveValue('notes:a')
      await page.waitForTimeout(300)
      expect((await scans(page)) - s1, 'page-map scans while typing filters').toBeLessThanOrEqual(1)
      const slowFilters = since((await counters(page)).keys, k1).map((k) => k.d)
      note('palette filter keys over 16 ms', slowFilters)
      if (slowFilters.length) expect(median(slowFilters), `median keypress → paint while typing filters, of the keys over 16 ms (${slowFilters.length})`).toBeLessThan(300)
      await page.keyboard.press('Escape')
    })

    await test.step('memory', async () => {
      await cdp.send('HeapProfiler.enable')
      await cdp.send('HeapProfiler.collectGarbage')
      const { metrics } = (await cdp.send('Performance.getMetrics')) as { metrics: Array<{ name: string; value: number }> }
      const heap = metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0
      expect(heap / 1048576, 'JS heap (MB) after GC').toBeLessThan(450)
    })
  })
})

/**
 * Tasks (P1, brief §17) on the same big workspace with `{ tasks: true }`: 3,000 tasks on the rich pages, ~1,000
 * links, 20 in a template, "Perf · Task page" with 300 (task 0 blocks tasks 1–3). The index is lazy and incremental
 * (pageChanges, no page-map scan of its own); placards re-render only where their view changed.
 * Measured budgets (TASKS) — measured first on this box, medians of repeated runs inside the test (see the commit
 * message of P1 B21); the brief's ceilings are the limits.
 */
const TASKS = { coldMs: 60, incrementalMs: 5, graphMs: 15, pickerOpenMs: 50, pickerKeyMs: 8, longTaskMs: 50, inboxColdMs: 400 }

test.describe('performance budget: tasks (big workspace + 3,300 tasks)', () => {
  test('the index stays incremental and cheap, placards re-render only where they change, the link picker stays quick', async ({ page, errors }) => {
    test.setTimeout(480_000)
    void errors
    await page.addInitScript(installCounters)
    const big: BigInfo = await loadBigWorkspace(page, { tasks: true })
    const taskPage = big.taskPageId!
    expect(big.taskCount).toBeGreaterThanOrEqual(3300)
    // the start page is the 300-task page: the index is used on the way up
    await wsEval(page, (s, id) => s.updateSettings({ startPageId: id }), taskPage)
    await flush(page)
    const placards = `#main .ProseMirror[data-page-id="${taskPage}"] [data-type="work-item"]`
    type Seam = { renders: number; rebuild: (fromScratch?: boolean) => number; flushMs: () => number; graphMs: () => { ms: number; items: number; edges: number } }
    const renders = () => page.evaluate(() => (window as unknown as { __oneItems: Seam }).__oneItems.renders)

    await test.step('cold boot onto the 300-task page', async () => {
      await page.goto('app/?e2e')
      await page.waitForFunction((sel) => document.querySelectorAll(sel).length >= 300, placards, { polling: 'raf', timeout: 120_000 })
      const c = await counters(page)
      await page.waitForTimeout(3000) // the services' first passes; the index's first notification
      const r = await renders()
      note('tasks boot', { scans: c.scans, renders: r })
      expect(c.scans, 'page-map scans until the app is up (the index adds none)').toBeLessThanOrEqual(BOOT_SCANS)
      expect(r, 'placard renders opening the 300-task page (≤ 2 each)').toBeLessThanOrEqual(600)
    })

    await test.step('cold build, incremental update, graph pass', async () => {
      const m = await page.evaluate(async (id) => {
        const w = window as unknown as { __oneItems: Seam; __one: { workspace: { getState: () => Record<string, any> } } } // eslint-disable-line @typescript-eslint/no-explicit-any
        const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
        // a REAL cold build: every page's content walked again (the cached walks forgotten first) — the first build
        // of a session; `warm` reuses the walks the inbox / placards already cached
        const cold: number[] = []
        const warm: number[] = []
        for (let i = 0; i < 5; i++) {
          cold.push(w.__oneItems.rebuild(true))
          await frame()
          warm.push(w.__oneItems.rebuild())
          await frame()
        }
        // a typing pause on task #150's title: the store gets the page's new content, the index rescans that page
        const inc: number[] = []
        for (let i = 0; i < 10; i++) {
          const s = w.__one.workspace.getState()
          const content = JSON.parse(JSON.stringify(s.pages[id].content))
          content.content[150].content[0].content[0].text += ` ${i}`
          s.setContent(id, content, 'perf-budget')
          inc.push(w.__oneItems.flushMs())
          await frame()
        }
        const graph: Array<{ ms: number; items: number; edges: number }> = []
        for (let i = 0; i < 5; i++) graph.push(w.__oneItems.graphMs())
        return { cold, warm, inc, graph }
      }, taskPage)
      const med = { cold: median(m.cold), warm: median(m.warm), inc: median(m.inc), graph: median(m.graph.map((g) => g.ms)) }
      note('tasks index ms', { ...med, items: m.graph[0].items, edges: m.graph[0].edges, cold: m.cold.map(Math.round), warm: m.warm.map(Math.round), inc: m.inc.map((x) => +x.toFixed(2)) })
      expect(m.graph[0].items, 'live tasks in the index').toBeGreaterThanOrEqual(3000)
      expect(med.cold, 'a cold build of the index, every content walked again (median of 5)').toBeLessThanOrEqual(TASKS.coldMs)
      expect(med.warm, 'a build over the cached walks (median of 5)').toBeLessThanOrEqual(TASKS.coldMs)
      expect(med.inc, 'an incremental update after a typing pause (median of 10)').toBeLessThanOrEqual(TASKS.incrementalMs)
      expect(med.graph, 'the graph pass (dependents, related, loops) over ~3,000 tasks (median of 5)').toBeLessThanOrEqual(TASKS.graphMs)
    })

    await test.step("the inbox's first pass walks only the contents that hold a task for its task reminders", async () => {
      type Inbox = { collectCold: () => { ms: number; taskWalks: number; reminders: number } }
      const runs: Array<{ ms: number; taskWalks: number; reminders: number }> = []
      for (let i = 0; i < 3; i++) runs.push(await page.evaluate(() => (window as unknown as { __oneInbox: Inbox }).__oneInbox.collectCold()))
      const holding = await wsEval(page, (s) => Object.values(s.pages as Record<string, { content?: unknown }>).filter((p) => JSON.stringify(p.content ?? null).includes('"workItem"')).length)
      note('inbox first pass', { ms: runs.map((r) => Math.round(r.ms)), taskWalks: runs[0].taskWalks, holding, reminders: runs[0].reminders })
      // counted, not timed: the task walk reads the pages holding a task (~550), never every page's content (3,300+)
      expect(runs[0].taskWalks, 'contents the task walk read in the inbox pass').toBeLessThanOrEqual(holding)
      expect(median(runs.map((r) => r.ms)), "the inbox's whole reminder collection, every cache cold (median of 3)").toBeLessThanOrEqual(TASKS.inboxColdMs)
    })

    await test.step('store writes on the task page walk the page map as often as before', async () => {
      const res = await page.evaluate(async (id) => {
        const w = window as unknown as { __perf: PerfCounters; __one: { workspace: { getState: () => Record<string, any> } } } // eslint-disable-line @typescript-eslint/no-explicit-any
        const out: number[] = []
        for (let i = 0; i < 4; i++) {
          const s = w.__one.workspace.getState()
          const content = JSON.parse(JSON.stringify(s.pages[id].content))
          content.content[20].content[0].content[0].text += ` w${i}`
          const before = w.__perf.scans
          s.setContent(id, content, 'perf-budget')
          await new Promise((r) => setTimeout(r, 120))
          out.push(w.__perf.scans - before)
        }
        return out
      }, taskPage)
      note('tasks write scans', res)
      for (const n of res) expect(n, `page-map scans per content write on the task page (${res.join(', ')})`).toBeLessThanOrEqual(WRITE_SCANS.content)
      await page.waitForTimeout(1500)
    })

    await test.step('typing in task #150: its page record + shadow copy only, no long task; ≤ 2 placards re-render per key', async () => {
      // the caret at the end of task #150's title (placed by the editor: the column holds its scroll until a reader
      // touches it, and a click could land on a neighbour's chips)
      await page.evaluate((id) => {
        const el = document.querySelector(`.ProseMirror[data-page-id="${id}"]`) as unknown as { editor: { state: { doc: { descendants: (fn: (n: { type: { name: string }; nodeSize: number; firstChild: { nodeSize: number } | null }, pos: number) => boolean | void) => void } }; commands: { focus: (pos: number, o?: unknown) => void } } }
        let n = 0
        let at = -1
        el.editor.state.doc.descendants((node, pos) => {
          if (at >= 0) return false
          if (node.type.name !== 'workItem') return true
          if (n++ === 150) at = pos + 1 + (node.firstChild?.nodeSize ?? 2) - 1
          return false
        })
        el.editor.commands.focus(at, { scrollIntoView: true })
      }, taskPage)
      await page.waitForTimeout(800)
      // one key, the placards it re-renders (median over 6 keys)
      const perKey: number[] = []
      for (const ch of 'abcdef') {
        const r0 = await renders()
        await page.keyboard.type(ch)
        await page.waitForTimeout(250)
        perKey.push((await renders()) - r0)
      }
      await page.waitForTimeout(1200)
      const t0 = await now(page)
      for (const word of ' the quick brown fox jumps'.split(/(?= )/)) {
        await page.keyboard.type(word, { delay: 40 })
        await page.waitForTimeout(380)
      }
      await page.waitForTimeout(1500)
      const c = await counters(page)
      const puts = since(c.puts, t0).filter((p) => p.db === 'keyval-store')
      const keys = [...new Set(puts.map((p) => p.key))].sort()
      const long = since(c.longTasks, t0)
      note('tasks typing', { perKey, keys, longTasks: long.map((x) => Math.round(x.d)) })
      expect(median(perKey), `placards re-rendered per key in task #150 (${perKey.join(', ')})`).toBeLessThanOrEqual(2)
      expect(keys, 'records written while typing on the task page').toEqual(expect.arrayContaining([`one.page.v2:${taskPage}`, `one.page.g1:${taskPage}`]))
      for (const k of keys) expect(k, 'only this page (record + shadow copy) and the meta record').toMatch(new RegExp(`^one\\.(page\\.v2:${taskPage}|page\\.g1:${taskPage}|ws\\.v2)$`))
      expect(Math.max(0, ...long.map((x) => x.d)), 'longest main-thread task while typing on the 300-task page').toBeLessThanOrEqual(TASKS.longTaskMs)
    })

    await test.step('toggling a blocker re-renders itself and its dependents only', async () => {
      const r0 = await renders()
      await page.evaluate((id) => {
        const seam = (window as unknown as { __oneItemsEditor: { commit: (p: string, t: unknown, patch: unknown) => boolean; itemPos: (p: string, n: number) => number } }).__oneItemsEditor
        const el = document.querySelector(`.ProseMirror[data-page-id="${id}"]`) as unknown as { editor: { state: { doc: { nodeAt: (p: number) => { attrs: Record<string, unknown> } } } } }
        const pos = seam.itemPos(id, 0)
        const attrs = el.editor.state.doc.nodeAt(pos).attrs
        seam.commit(id, { pos, itemId: attrs.itemId, blockId: attrs.id }, { status: 'done' })
      }, taskPage)
      await page.waitForTimeout(600)
      const delta = (await renders()) - r0
      note('tasks blocker toggle renders', delta)
      // the blocker (its attrs, then its view) + its three dependents (their views)
      expect(delta, 'placard renders after marking a blocker of 3 tasks done').toBeLessThanOrEqual(5)
    })

    await test.step('the link picker over ~3,300 tasks', async () => {
      const m = await page.evaluate(async (id) => {
        const seam = (window as unknown as { __oneItemsEditor: { openPicker: (p: string, pos: number, kind: string) => boolean; itemPos: (p: string, n: number) => number } }).__oneItemsEditor
        const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))
        const open: number[] = []
        const keys: number[] = []
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
        for (let round = 0; round < 3; round++) {
          const t0 = performance.now()
          seam.openPicker(id, seam.itemPos(id, 200), 'blockedBy')
          while (!document.querySelector('[role="dialog"] [role="option"]')) await frame()
          open.push(performance.now() - t0)
          const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!
          let q = ''
          for (const ch of 'ledger') {
            q += ch
            const k0 = performance.now()
            setter.call(input, q)
            input.dispatchEvent(new Event('input', { bubbles: true }))
            keys.push(performance.now() - k0)
            await frame()
          }
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
          while (document.querySelector('[role="dialog"] [role="option"]')) await frame()
        }
        return { open, keys }
      }, taskPage)
      note('tasks picker ms', { open: m.open.map(Math.round), keys: m.keys.map((x) => +x.toFixed(1)) })
      expect(median(m.open), 'opening the blocked-by picker (median of 3)').toBeLessThanOrEqual(TASKS.pickerOpenMs)
      expect(median(m.keys), 'a keystroke in its search (median)').toBeLessThanOrEqual(TASKS.pickerKeyMs)
    })
  })
})

test.describe('storage layout', () => {
  test('a workspace stored in the old single-record layout loads, and is converted to one record per page', async ({ page }) => {
    await openApp(page)
    const before = await wsEval(page, (s) => ({ ids: Object.keys(s.pages), titles: Object.values(s.pages as Record<string, { title: string }>).map((p) => p.title), start: s.settings.startPageId }))
    // write the workspace the way older versions did (one record), drop the new records, reload
    await page.evaluate(async () => {
      const s = window.__one.workspace.getState()
      const legacy = JSON.parse(JSON.stringify({ version: s.version, epoch: s.epoch, pages: s.pages, databases: s.databases, people: s.people, settings: s.settings, recent: s.recent }))
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open('keyval-store')
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
      })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('keyval', 'readwrite')
        const os = tx.objectStore('keyval')
        os.clear()
        os.put(legacy, 'one.workspace.v1')
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      db.close()
    })
    await page.reload()
    await page.waitForFunction(() => !!(window as unknown as { __one?: unknown }).__one && !document.getElementById('boot'))
    const after = await wsEval(page, (s) => ({ ids: Object.keys(s.pages), titles: Object.values(s.pages as Record<string, { title: string }>).map((p) => p.title), start: s.settings.startPageId }))
    expect(after).toEqual(before)
    await flush(page)
    // converted: the meta record + a record per page, the old record gone
    const stored = await page.evaluate(
      () =>
        new Promise<{ keys: string[] }>((resolve, reject) => {
          const r = indexedDB.open('keyval-store')
          r.onerror = () => reject(r.error)
          r.onsuccess = () => {
            const q = r.result.transaction('keyval', 'readonly').objectStore('keyval').getAllKeys()
            q.onsuccess = () => resolve({ keys: q.result.map(String) })
            q.onerror = () => reject(q.error)
          }
        }),
    )
    expect(stored.keys).toContain('one.ws.v2')
    expect(stored.keys).not.toContain('one.workspace.v1')
    expect(stored.keys.filter((k) => k.startsWith('one.page.v2:')).length).toBe(before.ids.length)
  })

  test('pages keep their order in the page map across reloads (first match by title, ties in lists)', async ({ page }) => {
    await openApp(page)
    // pages created in an order unlike their ids, two with the same title
    await wsEval(page, (s) => {
      for (const id of ['zz-order-1', 'aa-order-2', 'mm-order-3']) s.createPage({ id, title: 'Same title' })
    })
    await reloadApp(page)
    const ids = await wsEval(page, (s) => Object.keys(s.pages))
    const ours = ids.filter((id) => id.endsWith(/-order-\d/.exec(id)?.[0] ?? '\u0000'))
    expect(ours).toEqual(['zz-order-1', 'aa-order-2', 'mm-order-3'])
    expect(await wsEval(page, (s) => (Object.values(s.pages) as Array<{ id: string; title: string }>).find((p) => p.title === 'Same title')?.id)).toBe('zz-order-1')
    // deleting one rewrites the order; the rest keeps it
    await wsEval(page, (s) => s.deletePagePermanently('aa-order-2'))
    await reloadApp(page)
    expect((await wsEval(page, (s) => Object.keys(s.pages))).filter((id) => /-order-\d$/.test(id))).toEqual(['zz-order-1', 'mm-order-3'])
  })
})
