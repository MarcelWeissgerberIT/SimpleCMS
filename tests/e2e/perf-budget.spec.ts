/**
 * Performance budget on a big workspace (tests/e2e/helpers/bigWorkspace.ts: 3,000 pages — 500 of
 * them with 30–200 rich blocks — and 25 databases × 400 rows, ≈ 13,000 pages / 45 MB of JSON).
 *
 * Budgets are generous on purpose (a loaded CI box must pass), and the sharp ones COUNT work
 * instead of timing it, so they hold on any machine:
 *  - a typing pause writes that page's record to IndexedDB — never the whole workspace;
 *  - a store write walks the page map (Object.keys / values / entries of every page) only a
 *    handful of times, whatever is mounted (sidebar, backlinks, unlinked mentions, status bar …);
 *  - an idle app changes nothing, writes nothing and keeps the main thread (almost) free.
 * Timings guard against order-of-magnitude regressions: the whole-workspace saves this suite was
 * written against blocked the main thread for ~1.5 s after every typing pause.
 *
 * The storage layout this relies on (one record per page) gets its own tests below: conversion
 * from the old single-record layout and the page order surviving a reload.
 */
import type { CDPSession, Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, wsEval, flush } from './fixtures'
import { loadBigWorkspace, type BigInfo } from './helpers/bigWorkspace'

/** Counters installed before the app runs (survive reloads of the page). */
function installCounters() {
  const w = window as unknown as { __perf: PerfCounters }
  const perf: PerfCounters = (w.__perf = { scans: 0, puts: [], longTasks: [], keys: [] })
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
}

const now = (page: Page) => page.evaluate(() => performance.now())
const counters = (page: Page) => page.evaluate(() => (window as unknown as { __perf: PerfCounters }).__perf)
const since = <T extends { t: number }>(list: T[], t0: number) => list.filter((x) => x.t >= t0)

async function busyMs(cdp: CDPSession): Promise<number> {
  const { metrics } = (await cdp.send('Performance.getMetrics')) as { metrics: Array<{ name: string; value: number }> }
  return (metrics.find((m) => m.name === 'TaskDuration')?.value ?? 0) * 1000
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
    const big: BigInfo = await loadBigWorkspace(page)
    expect(big.pages).toBeGreaterThan(12_000)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Performance.enable')

    await test.step('cold boot', async () => {
      await page.goto('app/?e2e')
      await page.waitForFunction(() => !!document.querySelector('.app') && !document.getElementById('boot'), null, { polling: 'raf', timeout: 60_000 })
      const bootMs = await now(page)
      expect(bootMs, 'cold boot of ~13,000 pages to a usable app').toBeLessThan(20_000)
      await page.waitForTimeout(4000) // the services' first passes (inbox, synced blocks, sync)
    })

    const pageHash = `#/p/${big.bigPageId}`
    const editorReady = `(document.querySelector('#main .ProseMirror[data-page-id="${big.bigPageId}"]')?.childElementCount ?? 0) >= ${big.bigPageBlocks}`

    await test.step('open the 200-block page', async () => {
      const ms = await timeTo(page, pageHash, editorReady)
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
      const busy0 = await busyMs(cdp)
      const wall0 = Date.now()
      await page.waitForTimeout(10_000)
      const busy = (await busyMs(cdp)) - busy0
      const wall = Date.now() - wall0
      const c = await counters(page)
      expect(await page.evaluate(() => (window as unknown as { __perfIdle: number }).__perfIdle), 'store changes while idle').toBe(0)
      expect(since(c.puts, t0).filter((p) => p.db === 'keyval-store'), 'workspace writes while idle').toEqual([])
      expect(busy / wall, 'main-thread busy share while idle').toBeLessThan(0.05)
    })

    await test.step('store writes of the open page walk the page map only a few times', async () => {
      const res = await page.evaluate(async (id) => {
        const w = window as unknown as { __perf: PerfCounters; __one: { workspace: { getState: () => Record<string, any> } } } // eslint-disable-line @typescript-eslint/no-explicit-any
        const scans: number[] = []
        for (let i = 0; i < 4; i++) {
          const s = w.__one.workspace.getState()
          const content = JSON.parse(JSON.stringify(s.pages[id].content))
          content.content[1].content.push({ type: 'text', text: ` budget ${i}` })
          const before = w.__perf.scans
          s.setContent(id, content, 'perf-budget')
          // the renders it causes (sidebar, backlinks, unlinked mentions, status bar …) + deferred ones
          await new Promise((r) => setTimeout(r, 120))
          scans.push(w.__perf.scans - before)
        }
        return scans
      }, big.bigPageId)
      // today: 1 shared diff + 1 shared stats pass; before the fix: 12+ (each reader scanned for itself)
      for (const n of res) expect(n, `page-map scans per store write (${res.join(', ')})`).toBeLessThanOrEqual(5)
      await page.waitForTimeout(1500)
    })

    await test.step('typing on the big page: no whole-workspace saves, no long freezes', async () => {
      const ed = page.locator(`#main .ProseMirror[data-page-id="${big.bigPageId}"]`)
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
      if (keys.length) expect(keys[Math.floor(keys.length / 2)], 'median keypress → paint (Event Timing)').toBeLessThan(200)
    })

    await test.step('the 400-row table and its board', async () => {
      const home = await wsEval(page, (s) => s.settings.startPageId as string)
      await page.evaluate((id) => (window.location.hash = `#/p/${id}`), home)
      await page.waitForTimeout(800)
      const tableMs = await timeTo(page, `#/p/${big.bigTableId}`, `document.querySelectorAll('#main section.db .dbt-body .dbt-row[role="row"]').length > 10`)
      expect(tableMs, 'opening a 400-row table').toBeLessThan(6000)
      expect(await page.locator('#main section.db .dbt-body .dbt-row[role="row"]').count(), 'table rows stay virtualised').toBeLessThan(200)
      // a write elsewhere does not make the open table re-derive its rows (see useRelevantPages)
      const scans = await page.evaluate(async (id) => {
        const w = window as unknown as { __perf: PerfCounters; __one: { workspace: { getState: () => Record<string, any> } } } // eslint-disable-line @typescript-eslint/no-explicit-any
        const before = w.__perf.scans
        w.__one.workspace.getState().updatePage(id, { title: 'Perf · Big page (edited)' })
        await new Promise((r) => setTimeout(r, 120))
        return w.__perf.scans - before
      }, big.bigPageId)
      expect(scans, 'page-map scans for a write outside the open table').toBeLessThanOrEqual(5)
    })

    await test.step('⌘K search', async () => {
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
