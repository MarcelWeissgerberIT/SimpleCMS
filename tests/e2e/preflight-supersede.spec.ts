/**
 * Preflight pre-work in the agents area (T-P2-9): reviews of a browser run happen under the agent's run lock — the run is
 * read again, only proposals still open are acted on, and only what changed is written back (patchRun) — so two tabs
 * never apply a proposal twice and never put back a status the other tab wrote. Discard says what it dropped and its
 * Undo puts back exactly that (and the agent state, while it is still the one put back).
 * Fictional data only; no Claude request is made (the runs are seeded).
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, waitForApp, wsEval, flush, createPage } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Run a function against window.__oneAgents (agents/review.ts, loaded with the agents page). */
const ag = <R, A = null>(page: Page, fn: (a: AnyState, arg: A) => R | Promise<R>, arg?: A): Promise<R> =>
  page.evaluate(({ src, arg }) => new Function('a', 'arg', `return (${src})(a, arg)`)((window as unknown as { __oneAgents: AnyState }).__oneAgents, arg), { src: fn.toString(), arg: (arg ?? null) as A }) as Promise<R>

const AGENT = 'ag-ledger'
const DAY = 86_400_000

async function start(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
  await openApp(page)
}

/** A browser agent that stages (manual trigger). */
async function addAgent(page: Page, id = AGENT, name = 'Ledger keeper'): Promise<void> {
  await wsEval(
    page,
    (s, a) => {
      const now = Date.now()
      s.upsertAgent({ id: a.id, name: a.name, icon: null, instructions: 'Keep the ledger in step.', trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'stage', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdAt: now - 30 * 86_400_000, updatedAt: now - 30 * 86_400_000 })
    },
    { id, name },
  )
}

/** Store runs (newest first or not: putRun sorts) through the Preflight seam. */
const seedRuns = (page: Page, runs: AnyState[]) => page.evaluate((runs) => (window as unknown as { __onePreflight: AnyState }).__onePreflight.seedRuns(runs), runs)

const run = (id: string, startedAt: number, staged: AnyState[], x: AnyState = {}): AnyState => ({ id, agentId: AGENT, runner: 'browser', trigger: { type: 'manual' }, startedAt, endedAt: startedAt + 60_000, status: 'staged', summary: '', steps: [], staged, ...x })
const append = (id: string, n: number, pageId: string, markdown: string, x: AnyState = {}): AnyState => ({ id, n, kind: 'append', status: 'pending', pageId, title: 'Ledger', markdown, ...x })

/** The agents page of the agent: loads the review code (window.__oneAgents). */
async function openAgent(page: Page, id = AGENT): Promise<void> {
  await page.evaluate((id) => (window.location.hash = `#/agents/${id}`), id)
  await page.waitForFunction(() => !!(window as unknown as { __oneAgents?: unknown }).__oneAgents)
}

/** The run as stored in IndexedDB "one-agents" (not this tab's copy). */
async function stored(page: Page, runId: string, agentId = AGENT): Promise<AnyState | null> {
  return page.evaluate(
    async ({ runId, agentId }) => {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open('one-agents')
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
      })
      try {
        const list = await new Promise<AnyState[] | undefined>((res, rej) => {
          const q = db.transaction('runs').objectStore('runs').get(`runs:${agentId}`)
          q.onsuccess = () => res(q.result)
          q.onerror = () => rej(q.error)
        })
        return (list ?? []).find((r) => r.id === runId) ?? null
      } finally {
        db.close()
      }
    },
    { runId, agentId },
  )
}
const statuses = async (page: Page, runId: string) => Object.fromEntries(((await stored(page, runId))?.staged ?? []).map((c: AnyState) => [c.id, c.status]))

/** The page's text (its content as JSON). */
const textOf = (page: Page, id: string) => wsEval(page, (s, id) => JSON.stringify(s.pages[id]?.content ?? null), id)
const times = (hay: string, needle: string) => hay.split(needle).length - 1

/** A second tab of the same browser, on the agents page. */
async function secondTab(page: Page): Promise<Page> {
  await flush(page)
  const second = await page.context().newPage()
  await second.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
  await second.goto('app/?e2e')
  await waitForApp(second)
  await expect.poll(() => wsEval(second, (s, id) => !!s.agents?.[id], AGENT)).toBe(true)
  await openAgent(second)
  return second
}

test.describe('agent reviews under the run lock (T-P2-9, two tabs)', () => {
  /** This tab's copy of the run (what a review key holds while another tab acts). */
  const copy = (p: Page) => ag(p, async (a) => (await a.loadRuns('ag-ledger'))[0])

  test('A in both tabs applies the proposal once: the second tab’s copy is stale, the stored run says applied', async ({ page }) => {
    await start(page)
    await addAgent(page)
    const ledger = await createPage(page, { title: 'Ledger' })
    await seedRuns(page, [run('r1', Date.now() - 60_000, [append('c1', 1, ledger, 'Entry from the keeper.')])])
    await openAgent(page)
    const second = await secondTab(page)
    const [mine, theirs] = [await copy(page), await copy(second)]
    expect(theirs.staged[0].status).toBe('pending')

    expect(await ag(page, (a, r) => a.applyRun(r, ['c1'], { row: true }).then((x: AnyState | null) => x?.applied ?? null), mine)).toEqual(['c1'])
    // the other tab presses A on the copy it still holds: nothing is left to apply
    expect(await ag(second, (a, r) => a.applyRun(r, ['c1'], { row: true }), theirs)).toBeNull()
    expect(await statuses(page, 'r1')).toEqual({ c1: 'applied' })
    expect(times(await textOf(page, ledger), 'Entry from the keeper.')).toBe(1)
    await flush(page)
    await expect.poll(() => textOf(second, ledger).then((t) => times(t, 'Entry from the keeper.'))).toBe(1)
    // both tabs' copies follow the stored run
    for (const p of [page, second]) await expect.poll(() => ag(p, (a) => a.loadRuns('ag-ledger').then((rs: AnyState[]) => rs[0].staged[0].status))).toBe('applied')
    await second.close()
  })

  test('A pressed in both tabs at the same moment: applied once', async ({ page }) => {
    await start(page)
    await addAgent(page)
    const ledger = await createPage(page, { title: 'Ledger' })
    await seedRuns(page, [run('r1', Date.now() - 60_000, [append('c1', 1, ledger, 'Same moment.')])])
    await openAgent(page)
    const second = await secondTab(page)
    const press = (p: Page) => ag(p, async (a) => (await a.applyRun((await a.loadRuns('ag-ledger'))[0], ['c1'], { row: true }))?.applied ?? null)
    const [one, two] = await Promise.all([press(page), press(second)])
    expect([one, two].filter((x) => x !== null)).toEqual([['c1']])
    expect(await statuses(page, 'r1')).toEqual({ c1: 'applied' })
    const winner = one ? page : second
    await flush(winner)
    for (const p of [page, second]) await expect.poll(() => textOf(p, ledger).then((t) => times(t, 'Same moment.'))).toBe(1)
    await second.close()
  })

  test('a review waits for the lock another tab holds, then reads the run again', async ({ page }) => {
    await start(page)
    await addAgent(page)
    const ledger = await createPage(page, { title: 'Ledger' })
    await seedRuns(page, [run('r1', Date.now() - 60_000, [append('c1', 1, ledger, 'Held back.')])])
    await openAgent(page)
    const second = await secondTab(page)
    // the first tab holds the agent's run lock (as a review going on there does) …
    await page.evaluate(() => {
      void navigator.locks.request('one-agents-run:local:local:ag-ledger', () => new Promise<void>((r) => ((window as AnyState).__release = r)))
    })
    await page.waitForFunction(() => typeof (window as AnyState).__release === 'function')
    // … the second tab presses A: it waits
    await second.evaluate(() => {
      const a = (window as AnyState).__oneAgents
      ;(window as AnyState).__pressed = a.loadRuns('ag-ledger').then((rs: AnyState[]) => a.applyRun(rs[0], ['c1'], { row: true })).then((x: AnyState | null) => (x ? x.applied : null))
    })
    await second.waitForTimeout(600)
    expect(await statuses(page, 'r1')).toEqual({ c1: 'pending' })
    // meanwhile the first tab's review decides c1 (written straight into the store, as it would under its lock)
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open('one-agents')
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
      })
      try {
        await new Promise<void>((res, rej) => {
          const tx = db.transaction('runs', 'readwrite')
          const store = tx.objectStore('runs')
          const q = store.get('runs:ag-ledger')
          q.onsuccess = () => store.put((q.result as AnyState[]).map((r) => ({ ...r, staged: r.staged.map((c: AnyState) => ({ ...c, status: 'discarded' })) })), 'runs:ag-ledger')
          tx.oncomplete = () => res()
          tx.onerror = () => rej(tx.error)
        })
      } finally {
        db.close()
      }
      ;(window as AnyState).__release()
    })
    expect(await second.evaluate(() => (window as AnyState).__pressed)).toBeNull()
    expect(await statuses(page, 'r1')).toEqual({ c1: 'discarded' })
    expect(times(await textOf(second, ledger), 'Held back.')).toBe(0)
    await second.close()
  })

  test('apply in one tab, discard in the other on its stale copy: neither status is lost', async ({ page }) => {
    await start(page)
    await addAgent(page)
    const ledger = await createPage(page, { title: 'Ledger' })
    const notes = await createPage(page, { title: 'Notes' })
    await seedRuns(page, [run('r1', Date.now() - 60_000, [append('c1', 1, ledger, 'First entry.'), append('c2', 2, notes, 'Second entry.')])])
    await openAgent(page)
    const second = await secondTab(page)
    const [mine, theirs] = [await copy(page), await copy(second)]
    expect(await ag(page, (a, r) => a.applyRun(r, ['c1'], { row: true }).then((x: AnyState | null) => x?.applied ?? null), mine)).toEqual(['c1'])
    expect((await ag(second, (a, r) => a.discardRun(r, 'c2'), theirs)).dropped).toEqual(['c2'])
    expect(await statuses(page, 'r1')).toEqual({ c1: 'applied', c2: 'discarded' })
    for (const p of [page, second]) await expect.poll(() => ag(p, (a) => a.loadRuns('ag-ledger').then((rs: AnyState[]) => rs[0].staged.map((c: AnyState) => c.status).join()))).toBe('applied,discarded')
    // and the other way round in one go: both at once
    await seedRuns(page, [run('r2', Date.now() - 30_000, [append('c1', 1, ledger, 'Third entry.'), append('c2', 2, notes, 'Fourth entry.')])])
    const both = await Promise.all([
      ag(page, async (a) => (await a.applyRun((await a.loadRuns('ag-ledger')).find((r: AnyState) => r.id === 'r2'), ['c1'], { row: true }))?.applied ?? null),
      ag(second, async (a) => (await a.discardRun((await a.loadRuns('ag-ledger')).find((r: AnyState) => r.id === 'r2'), 'c2')).dropped),
    ])
    expect(both).toEqual([['c1'], ['c2']])
    expect(await statuses(page, 'r2')).toEqual({ c1: 'applied', c2: 'discarded' })
    await second.close()
  })

  test('a row’s Apply on a stale copy applies nothing that was decided elsewhere', async ({ page }) => {
    await start(page)
    await addAgent(page)
    const ledger = await createPage(page, { title: 'Ledger' })
    await seedRuns(page, [run('r1', Date.now() - 60_000, [append('c1', 1, ledger, 'Only once.')])])
    await openAgent(page)
    const stale = await copy(page)
    // discarded in the store (as another tab would) — this tab still holds the pending copy
    expect((await ag(page, (a, r) => a.discardRun(r, 'c1'), stale)).dropped).toEqual(['c1'])
    expect(await ag(page, (a, r) => a.applyRun(r, ['c1'], { row: true }), stale)).toBeNull()
    expect(await statuses(page, 'r1')).toEqual({ c1: 'discarded' })
    expect(times(await textOf(page, ledger), 'Only once.')).toBe(0)
  })
})

test.describe('discard: what it dropped, and its Undo', () => {
  test('a parent and the proposal that builds on it go together; Undo brings exactly those back (failed stays failed)', async ({ page }) => {
    await start(page)
    await addAgent(page)
    const ledger = await createPage(page, { title: 'Ledger' })
    const notes = await createPage(page, { title: 'Notes' })
    await seedRuns(page, [
      run('r1', Date.now() - 60_000, [
        { id: 'c1', n: 1, kind: 'create_page', status: 'pending', pageId: 'staged-p1', parentId: null, title: 'Weekly ledger', markdown: 'Week 41.' },
        append('c2', 2, 'staged-p1', 'Follow-up line.', { dependsOn: 'c1' }),
        append('c3', 3, notes, 'Unrelated.', { status: 'failed', error: 'The page changed.' }),
        append('c4', 4, ledger, 'Applied already.', { status: 'applied' }),
      ]),
    ])
    await openAgent(page)
    const out = await ag(page, async (a) => {
      const r = (await a.loadRuns('ag-ledger'))[0]
      const d = await a.discardRun(r, ['c1', 'c3', 'c4'], { undo: true })
      ;(window as AnyState).__undo = d.undo
      return d.dropped
    })
    // the applied one is never discarded; the child of c1 goes with it
    expect(out.sort()).toEqual(['c1', 'c2', 'c3'])
    expect(await statuses(page, 'r1')).toEqual({ c1: 'discarded', c2: 'discarded', c3: 'discarded', c4: 'applied' })
    expect(await page.evaluate(() => (window as AnyState).__undo())).toBe(true)
    expect(await statuses(page, 'r1')).toEqual({ c1: 'pending', c2: 'pending', c3: 'failed', c4: 'applied' })
    // a second Undo finds nothing to put back
    expect(await page.evaluate(() => (window as AnyState).__undo())).toBe(false)
  })

  test('every proposal discarded puts the agent state back; Undo restores the run’s state only while it is still the one put back', async ({ page }) => {
    await start(page)
    await addAgent(page)
    const ledger = await createPage(page, { title: 'Ledger' })
    const now = Date.now()
    const before = { json: '{"seen":3}', at: now - 2 * DAY, runId: 'r0' }
    const mine = { json: '{"seen":5}', at: now - 60_000, runId: 'r1' }
    await seedRuns(page, [run('r1', now - 120_000, [append('c1', 1, ledger, 'Entry.')], { stateBefore: before })])
    await openAgent(page)
    // the agent's saved state is r1's own
    const setState = (s: AnyState) =>
      page.evaluate(async (s) => {
        const db = await new Promise<IDBDatabase>((res, rej) => {
          const r = indexedDB.open('one-agents')
          r.onsuccess = () => res(r.result)
          r.onerror = () => rej(r.error)
        })
        try {
          await new Promise<void>((res, rej) => {
            const tx = db.transaction('runs', 'readwrite')
            tx.objectStore('runs').put(s, 'state:local:local:ag-ledger')
            tx.oncomplete = () => res()
            tx.onerror = () => rej(tx.error)
          })
        } finally {
          db.close()
        }
      }, s)
    const getState = () =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((res, rej) => {
          const r = indexedDB.open('one-agents')
          r.onsuccess = () => res(r.result)
          r.onerror = () => rej(r.error)
        })
        try {
          return await new Promise<AnyState | null>((res, rej) => {
            const q = db.transaction('runs').objectStore('runs').get('state:local:local:ag-ledger')
            q.onsuccess = () => res(q.result ?? null)
            q.onerror = () => rej(q.error)
          })
        } finally {
          db.close()
        }
      })
    await setState(mine)

    const discard = () =>
      ag(page, async (a) => {
        const r = (await a.loadRuns('ag-ledger'))[0]
        const d = await a.discardRun(r, null, { undo: true })
        ;(window as AnyState).__undo = d.undo
        return d.dropped
      })
    expect(await discard()).toEqual(['c1'])
    expect(await getState()).toMatchObject(before)
    expect((await stored(page, 'r1'))?.steps.map((s: AnyState) => s.label)).toEqual(['Every proposal discarded: the state from before this run applies again.'])
    // Undo: the proposal is open again and the run's own state is back (with the note gone)
    expect(await page.evaluate(() => (window as AnyState).__undo())).toBe(true)
    expect(await getState()).toMatchObject(mine)
    expect(await statuses(page, 'r1')).toEqual({ c1: 'pending' })
    expect((await stored(page, 'r1'))?.steps).toEqual([])

    // discarded again, then a newer state is saved (a later run): Undo brings the proposal back, the newer state stays
    expect(await discard()).toEqual(['c1'])
    const later = { json: '{"seen":9}', at: Date.now(), runId: 'r2' }
    await setState(later)
    expect(await page.evaluate(() => (window as AnyState).__undo())).toBe(true)
    expect(await statuses(page, 'r1')).toEqual({ c1: 'pending' })
    expect(await getState()).toMatchObject(later)
  })
})
