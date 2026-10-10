/**
 * Flight recorder — the journal in the browser (R1a): the digest key, pins in the version store, segments
 * and the identity chain, typing folds, retention / the save-error pause, recovery of a tab that died,
 * purging what the person deleted for good, and what the journal may hold (ids, kinds, times, counts,
 * digests — never page text or values). Writes go through the real store under a story step's writer
 * (the seam); time comes from Playwright's clock. Test data is fictional (Nordlicht, Tessera).
 *
 * Boot starts the recorder; a test's setup is recorded too (as the person's), so `boot()` wipes the tape after it.
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval, flush, gotoPage, editorOf } from './fixtures'
import { F, K, eventsOf, flushRec, nordlichtDb, rec, recEvents, recOps, recPins, recRuns, recSegments, segmentsOf, startRecorder, step } from './helpers/recorder'

const T0 = new Date('2026-10-05T07:00:00+02:00').getTime()
const S = 1000
const MIN = 60 * S
const DAY = 24 * 60 * MIN

/** Open the app at a fixed time; the tape starts empty after `setup` (its writes are wiped from the journal). */
async function boot<T>(page: Page, setup?: () => Promise<T>, at = T0): Promise<T> {
  await page.clock.install({ time: at })
  await openApp(page)
  await startRecorder(page)
  const out = setup ? await setup() : (undefined as T)
  await flush(page)
  await rec(page, 'wipe')
  return out
}

const AGENT = 'nordlicht-spiegel'
const agent = (run: string, change?: string) => ({ kind: 'agent', id: AGENT, run, ...(change ? { change } : {}) })
const you = { kind: 'you', via: 'ui' }
const mcp = { kind: 'mcp', session: 's-tessera', call: 'c1', tool: 'one_update_property' }

/** Date.now() reads exactly `t` from here on (timers keep running). */
async function at(page: Page, t: number) {
  await page.clock.setFixedTime(t)
}

const rowOf = (s: Record<string, any>, id: string) => JSON.parse(JSON.stringify(s.pages[id])) // eslint-disable-line @typescript-eslint/no-explicit-any

test.describe('flight recorder journal', () => {
  test('records a writer: op, event, segment with its pin, run with meta', async ({ page }) => {
    const n = await boot(page, () => nordlichtDb(page))
    const before = await wsEval(page, rowOf, n.rows[0])
    await at(page, T0 + 5 * MIN)
    await step(page, agent('r212'), [['setRowProperty', n.rows[0], n.stage, n.done]], { note: { seq: 212 } })
    await step(page, agent('r212'), [['setRowProperty', n.rows[1], n.est, 8]], { end: true })
    await flushRec(page)
    const ops = (await recOps(page)).filter((o) => o.r === `agent:${AGENT}:r212`)
    expect(ops).toHaveLength(2)
    expect(ops[0]).toMatchObject({ l: `agent:${AGENT}`, w: `agent:${AGENT}:r212`, n: 1, kinds: K.PROPS, ops: 1 })
    const seg = (await segmentsOf(page, `p:${n.rows[0]}`)).at(-1)!
    expect(seg).toMatchObject({ sk: `agent:${AGENT}:r212`, r: `agent:${AGENT}:r212`, n: 1 })
    // endRun closed it: left and touched are known
    expect(seg.o).toBeUndefined()
    expect(seg.before).toBeTruthy()
    expect(seg.touched).toEqual([`p:${n.stage}`])
    expect(seg.left.h).toHaveLength(12)
    expect(Object.keys(seg.left.parts)).toContain(`p:${n.stage}`)
    expect(seg.bh).toHaveLength(12)
    const ev = (await eventsOf(page, `p:${n.rows[0]}`)).at(-1)!
    expect(ev).toMatchObject({ kinds: K.PROPS, pc: 1, g: seg.id, lh: seg.left.h })
    // the pin is the row exactly as it was before the agent's first write
    const pin = (await recPins(page)).metas.find((m) => m.id === seg.before)!
    expect(pin.meta.kind).toBe('page')
    expect(pin.meta.page.properties).toEqual(before.properties)
    expect(pin.meta.page.title).toBe('NL-1398')
    expect(pin.meta.defs.map((d: { name: string }) => d.name)).toEqual(expect.arrayContaining(['Stage', 'Schätzung', 'Notiz']))
    // as a version body: exactly the row before (what History's diff and restore planning read)
    const body = await rec(page, 'pinBody', seg.before)
    expect(body).toMatchObject({ title: before.title, icon: before.icon, content: before.content })
    const values = Object.fromEntries(Object.entries(before.properties).filter(([, v]) => v !== null && v !== '' && v !== false && !(Array.isArray(v) && !v.length)))
    expect(body.props.values).toEqual(values)
    expect(body.props.databaseId).toBe(n.db)
    const run = (await recRuns(page)).find((r) => r.key === `agent:${AGENT}:r212`)!
    expect(run).toMatchObject({ kind: 'agent', ref: 'r212', ops: 2, meta: { seq: 212 }, places: { rows: 2, newRows: 0 } })
    expect(run.ended).toBeTruthy()
    // histograms and lane totals
    const kv = await rec(page, 'kv')
    expect(kv.find((r: { k: string }) => r.k === 'local:local|lanes').lanes[`agent:${AGENT}`].total).toBe(2)
    // nothing fell back to a guess; the hot path never diffed the page map (history's diff was shared)
    expect(await rec(page, 'unknowns')).toEqual([])
    const stats = await rec(page, 'stats')
    // (hot-path timings belong to the perf spec: page.clock fakes performance.now here)
    expect(stats.hot.n).toBeGreaterThan(0)
    expect(stats.idleDiffScans).toBe(0)
  })

  test('digest key: non-extractable, per scope, one key when two tabs make it at once', async ({ page, context, errors }) => {
    await boot(page)
    const key = await rec(page, 'key')
    expect(key).toEqual({ type: 'secret', extractable: false, algorithm: 'HMAC', usages: ['sign'], exportRejects: true })
    const a = await rec<string>(page, 'digest', 'Tessera', 'local:local')
    const b = await rec<string>(page, 'digest', 'Tessera', 'cloud:tessera01')
    expect(a).toHaveLength(12)
    expect(a).not.toBe(b)
    expect(await rec<string>(page, 'digest', 'Tessera', 'local:local')).toBe(a)
    // a second tab, then both make a fresh scope's key at the same moment
    const p2 = await context.newPage()
    errors.watch(p2)
    await p2.clock.install({ time: T0 })
    await openApp(p2)
    await startRecorder(p2)
    const fresh = 'cloud:race-scope-7'
    const [d1, d2] = await Promise.all([rec<string>(page, 'digest', 'Lindenweg', fresh), rec<string>(p2, 'digest', 'Lindenweg', fresh)])
    expect(d1).toBe(d2)
    const keys = ((await rec(page, 'kv', fresh)) as Array<{ k: string }>).filter((r) => r.k === `${fresh}|hmac`)
    expect(keys).toHaveLength(1)
  })

  test('pins: one body per page and content, a scope drop keeps the others, never listed as versions', async ({ page }) => {
    const n = await boot(page, () => nordlichtDb(page))
    const row = n.rows[2]
    await step(page, you, [['setContent', row, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nordlicht Übergabe' }] }] }, 'e2e']])
    await flushRec(page)
    // two runs that change only properties: two pins, ONE body
    await at(page, T0 + MIN)
    await step(page, agent('r1'), [['setRowProperty', row, n.est, 11]], { end: true })
    await at(page, T0 + 2 * MIN)
    await step(page, agent('r2'), [['setRowProperty', row, n.est, 12]], { end: true })
    await flushRec(page)
    const segs = (await segmentsOf(page, `p:${row}`)).filter((s) => s.l === `agent:${AGENT}`)
    expect(segs).toHaveLength(2)
    const pins = await recPins(page)
    const mine = pins.metas.filter((m) => segs.some((s) => s.before === m.id))
    expect(mine).toHaveLength(2)
    expect(mine[0].meta.body).toBeTruthy()
    expect(mine[0].meta.body).toBe(mine[1].meta.body)
    const bodies = pins.bodies.filter((b) => b.key === `${row}|${mine[0].meta.body}`)
    expect(bodies).toHaveLength(1)
    expect(JSON.stringify(bodies[0].content)).toContain('Nordlicht Übergabe')
    // the version store's own lists never name a pin
    const idx = await page.evaluate(async (row) => {
      const open = indexedDB.open('one-history')
      const db: IDBDatabase = await new Promise((r) => (open.onsuccess = () => r(open.result)))
      const t = db.transaction('snapshots', 'readonly').objectStore('snapshots')
      const keys: string[] = await new Promise((r) => {
        const q = t.getAllKeys()
        q.onsuccess = () => r(q.result.map(String))
      })
      const list = await new Promise<unknown>((r) => {
        const q = t.get(`idx:${row}`)
        q.onsuccess = () => r(q.result ?? [])
      })
      db.close()
      return { keys, list }
    }, row)
    expect(idx.keys.filter((k) => k.startsWith('pin:')).length).toBeGreaterThanOrEqual(3)
    expect(JSON.stringify(idx.list)).not.toContain('pin:')
    // a scope drop (a team copy's wipe) removes only that scope's records and pins
    const local = (await recPins(page, 'local:local')).metas.length
    await rec(page, 'wipe', 'cloud:tessera01')
    expect((await recPins(page, 'local:local')).metas.length).toBe(local)
    expect((await recOps(page)).length).toBeGreaterThan(0)
    await rec(page, 'wipe', 'local:local')
    expect((await recPins(page, 'local:local')).metas.length).toBe(0)
    expect(await recOps(page)).toEqual([])
  })

  test('pins are exact: a deleted property and a removed option stay readable in every row pin', async ({ page }) => {
    const n = await boot(page, () => nordlichtDb(page))
    const rows = await wsEval(page, (s, ids: string[]) => ids.map((id) => JSON.parse(JSON.stringify(s.pages[id]))), n.rows)
    // an agent deletes "Notiz": every row is a place of that Vorgang, every row's pin holds its value and def
    await at(page, T0 + MIN)
    await step(page, agent('r7'), [['deleteProperty', n.db, n.note]], { note: { seq: 7 } })
    await rec(page, 'settle', `agent:${AGENT}:r7`)
    const op = (await recOps(page)).find((o) => o.r === `agent:${AGENT}:r7`)!
    // every row, the schema, and the views that showed the property
    const places = (await recEvents(page)).filter((e) => e.v === op.v).map((e) => e.p)
    expect(places.filter((p) => p.startsWith('p:')).sort()).toEqual(rows.map((r) => `p:${r.id}`).sort())
    expect(places).toContain(`s:${n.db}`)
    expect(op.n).toBe(places.length)
    expect(op.kinds & K.PROPS).toBeTruthy()
    expect(op.kinds & K.SCHEMA).toBeTruthy()
    expect(op.kinds & K.VIEW).toBeTruthy()
    const pins = await recPins(page)
    for (const r of rows) {
      const seg = (await segmentsOf(page, `p:${r.id}`)).find((s) => s.r === `agent:${AGENT}:r7`)!
      const pin = pins.metas.find((m) => m.id === seg.before)!.meta
      expect(pin.page.properties[n.note]).toBe(r.properties[n.note])
      expect(pin.defs.find((d: { id: string }) => d.id === n.note)).toMatchObject({ name: 'Notiz', type: 'text' })
      expect(seg.touched).toEqual([`p:${n.note}`])
    }
    const schemaSeg = (await segmentsOf(page, `s:${n.db}`)).find((s) => s.r === `agent:${AGENT}:r7`)!
    const schemaPin = pins.metas.find((m) => m.id === schemaSeg.before)!.meta
    expect(schemaPin.kind).toBe('schema')
    expect(schemaPin.db.properties.map((p: { id: string }) => p.id)).toContain(n.note)
    const ev = (await eventsOf(page, `s:${n.db}`)).at(-1)!
    expect(ev.x).toEqual([{ part: 'prop-', prop: { id: n.note, name: 'Notiz', type: 'text' } }])

    // MCP removes the option "Ready", then clears the rows that had it, row by row
    await at(page, T0 + 2 * MIN)
    const stage = await wsEval(page, (s, a) => JSON.parse(JSON.stringify(s.databases[a.db].properties.find((p: { id: string }) => p.id === a.stage))), { db: n.db, stage: n.stage })
    await step(page, mcp, [['updateProperty', n.db, n.stage, { options: stage.options.filter((o: { id: string }) => o.id !== n.ready) }]], { note: { tool: 'one_update_property', client: 'tessera-desk' } })
    const readyRows = rows.filter((r) => r.properties[n.stage] === n.ready).map((r) => r.id)
    expect(readyRows.length).toBeGreaterThan(0)
    for (const id of readyRows) await step(page, mcp, [['setRowProperty', id, n.stage, null]])
    await rec(page, 'settle', 'mcp:s-tessera:c1')
    const pins2 = await recPins(page)
    for (const id of readyRows) {
      const seg = (await segmentsOf(page, `p:${id}`)).find((s) => s.r === 'mcp:s-tessera:c1')!
      expect(seg.l).toBe('mcp:tessera-desk')
      const pin = pins2.metas.find((m) => m.id === seg.before)!.meta
      expect(pin.page.properties[n.stage]).toBe(n.ready)
      expect(pin.defs.find((d: { id: string }) => d.id === n.stage).options.map((o: { name: string }) => o.name)).toContain('Ready')
    }
    const optEv = (await eventsOf(page, `s:${n.db}`)).at(-1)!
    expect(optEv.x).toEqual([{ part: 'opt-', prop: { id: n.stage, name: 'Stage', type: 'select' }, opt: { id: n.ready, name: 'Ready' } }])
  })

  test('segments: writers alternating on a row, touched parts, each starts where the last one left', async ({ page }) => {
    const n = await boot(page, () => nordlichtDb(page))
    const row = n.rows[0]
    await at(page, T0 + MIN)
    await step(page, agent('r3'), [['setRowProperty', row, n.est, 5]], { note: { seq: 3 } })
    await at(page, T0 + MIN + 10 * S)
    await step(page, you, [['updatePage', row, { title: 'NL-1398 Tessera' }]])
    await at(page, T0 + MIN + 20 * S)
    await step(page, agent('r3'), [['setRowProperty', row, n.stage, n.done]], { end: true })
    await rec(page, 'settle')
    const segs = await segmentsOf(page, `p:${row}`)
    expect(segs.map((s) => s.l)).toEqual([`agent:${AGENT}`, 'you', `agent:${AGENT}`])
    expect(segs.map((s) => s.touched)).toEqual([[`p:${n.est}`], ['t'], [`p:${n.stage}`]])
    expect(segs[1].bh).toBe(segs[0].left.h)
    expect(segs[2].bh).toBe(segs[1].left.h)
    expect(segs.every((s) => !(s.f & F.GAP))).toBe(true)
  })

  test('the person: a title edit and body typing in the page = one segment', async ({ page }) => {
    // body typing reaches the store as the editor's flush, under the editor's own frame (editor:<id> → lane you)
    const id = await boot(page, () => wsEval(page, (s) => s.createPage({ title: 'Tessera Notizen' }) as string))
    await gotoPage(page, id)
    const title = page.locator('#main .pv-title')
    await title.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' 2026')
    await expect(title).toHaveValue('Tessera Notizen 2026')
    await editorOf(page).click()
    await page.keyboard.type('Nordlicht startet heute')
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].plain, id)).toContain('Nordlicht startet heute')
    await rec(page, 'settle')
    const segs = await segmentsOf(page, `p:${id}`)
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({ sk: 'you', l: 'you' })
    const evs = await eventsOf(page, `p:${id}`)
    expect(evs).toHaveLength(1)
    expect(evs[0].kinds).toBe(K.TITLE | K.CONTENT)
    expect(evs[0].ops).toBeGreaterThan(2)
    expect(evs[0].wa).toBe(3)
    expect(segs[0].touched).toEqual(expect.arrayContaining(['t']))
    expect(await rec(page, 'unknowns')).toEqual([])
  })

  test('typing folds: 2 min = 4 events in one segment; a machine write in between splits it', async ({ page }) => {
    const id = await boot(page, () => wsEval(page, (s) => s.createPage({ title: 'Tessera Tagesplan' }) as string))
    const editor = { kind: 'editor', id: 'ed-tessera' }
    const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'b1' }, content: [{ type: 'text', text }] }] })
    let words = 'Nordlicht'
    for (let i = 0; i < 24; i++) {
      await at(page, T0 + i * 5 * S)
      words += ` w${i}`
      await step(page, editor, [['setContent', id, doc(words), 'editor:ed-tessera']])
    }
    await rec(page, 'settle')
    const segs = await segmentsOf(page, `p:${id}`)
    expect(segs).toHaveLength(1)
    const evs = await eventsOf(page, `p:${id}`)
    expect(evs.map((e) => e.at - T0)).toEqual([0, 30 * S, 60 * S, 90 * S])
    expect(evs.map((e) => e.ops)).toEqual([6, 6, 6, 6])
    expect(evs[0].t2 - T0).toBe(25 * S)
    const ops = (await recOps(page)).filter((o) => o.p1 === `p:${id}`)
    expect(ops).toHaveLength(4)
    expect(ops.map((o) => o.ops)).toEqual([6, 6, 6, 6])

    // a machine write in between: the person's segment ends, the agent's is its own, typing starts a new one
    const T1 = T0 + 10 * MIN
    for (let i = 0; i < 6; i++) {
      await at(page, T1 + i * 5 * S)
      words += ` x${i}`
      await step(page, editor, [['setContent', id, doc(words), 'editor:ed-tessera']])
    }
    await at(page, T1 + 31 * S)
    await step(page, agent('r9'), [['updatePage', id, { icon: { type: 'emoji', value: '🧭' } }]], { end: true })
    for (let i = 0; i < 4; i++) {
      await at(page, T1 + 35 * S + i * 5 * S)
      words += ` y${i}`
      await step(page, editor, [['setContent', id, doc(words), 'editor:ed-tessera']])
    }
    await rec(page, 'settle')
    const after = (await segmentsOf(page, `p:${id}`)).filter((s) => s.from >= T1)
    expect(after.map((s) => s.l)).toEqual(['you', `agent:${AGENT}`, 'you'])
    expect(after.map((s) => s.n)).toEqual([1, 1, 1])
    expect(after[1].touched).toEqual(['i'])
  })

  test('identity chain: another tab writing between two agent writes closes the segment, the next one has GAP', async ({ page, context, errors }) => {
    const n = await boot(page, () => nordlichtDb(page))
    const row = n.rows[1]
    await step(page, agent('r4'), [['setRowProperty', row, n.est, 21]], { note: { seq: 4 } })
    await flushRec(page)
    await flush(page)
    // a second tab (same device): the person edits the row there
    const p2 = await context.newPage()
    errors.watch(p2)
    await openApp(p2)
    await startRecorder(p2)
    await step(p2, you, [['setRowProperty', row, n.note, 'Lindenweg 12']])
    await flush(p2)
    await flushRec(p2)
    // the first tab replays it (system:tab) …
    await expect.poll(() => wsEval(page, (s, a) => s.pages[a.row].properties[a.note], { row, note: n.note })).toBe('Lindenweg 12')
    // … then the agent writes again
    await step(page, agent('r4'), [['setRowProperty', row, n.est, 22]], { end: true })
    await rec(page, 'settle')
    const tab = await rec<string>(page, 'tab')
    const segs = (await segmentsOf(page, `p:${row}`)).filter((s) => s.tab === tab)
    expect(segs).toHaveLength(2)
    expect(segs[0].touched).toEqual([`p:${n.est}`])
    expect(segs[0].f & F.GAP).toBe(0)
    expect(segs[1].f & F.GAP).toBe(F.GAP)
    // the other tab journaled its own write — its segment ends when the agent's write arrives there
    await flush(page)
    await expect.poll(() => wsEval(p2, (s, a) => s.pages[a.row].properties[a.est], { row, est: n.est })).toBe(22)
    await rec(p2, 'settle')
    const tab2 = await rec<string>(p2, 'tab')
    const theirs = (await segmentsOf(p2, `p:${row}`)).filter((s) => s.tab === tab2)
    expect(theirs).toHaveLength(1)
    expect(theirs[0]).toMatchObject({ l: 'you', touched: [`p:${n.note}`], bh: segs[0].left.h })
    expect(theirs[0].o).toBeUndefined()
    expect(segs[1].bh).toBe(theirs[0].left.h)
  })

  test('retention: 31 days later prune removes the old records and their pins and sets the floor', async ({ page }) => {
    const n = await boot(page, () => nordlichtDb(page))
    await step(page, agent('r5'), [['setRowProperty', n.rows[0], n.est, 31]], { note: { seq: 5 }, end: true })
    await flushRec(page)
    expect((await recOps(page)).length).toBe(1)
    expect((await recPins(page)).metas.length).toBe(1)
    // a month later: one new write, then the prune
    await at(page, T0 + 31 * DAY)
    await step(page, agent('r6'), [['setRowProperty', n.rows[1], n.est, 32]], { note: { seq: 6 }, end: true })
    await flushRec(page)
    await rec(page, 'prune', T0 + 31 * DAY)
    expect((await recOps(page)).map((o) => o.r)).toEqual([`agent:${AGENT}:r6`])
    expect((await recEvents(page)).map((e) => e.r)).toEqual([`agent:${AGENT}:r6`])
    expect((await recSegments(page)).map((s) => s.r)).toEqual([`agent:${AGENT}:r6`])
    expect((await recRuns(page)).map((r) => r.key)).toEqual([`agent:${AGENT}:r6`])
    const pins = await recPins(page)
    expect(pins.metas.map((m) => m.id.split('|')[0])).toEqual([`p:${n.rows[1]}`])
    const floor = ((await rec(page, 'kv')) as Array<{ k: string; at: number }>).find((r) => r.k === 'local:local|floor')!
    expect(floor.at).toBe(T0 + 31 * DAY - 30 * DAY)
  })

  test('the workspace always wins: a failed save pauses the journal until the next good save', async ({ page }) => {
    const n = await boot(page, () => nordlichtDb(page))
    await rec(page, 'saveStatus', 'error')
    expect(await rec(page, 'paused')).toBe('save')
    await step(page, agent('r8'), [['setRowProperty', n.rows[0], n.est, 40]], { end: true })
    await flushRec(page)
    expect(await recOps(page)).toEqual([])
    await rec(page, 'saveStatus', 'saved')
    expect(await rec(page, 'paused')).toBeNull()
    await flushRec(page)
    expect((await recOps(page)).map((o) => o.r)).toEqual([`agent:${AGENT}:r8`])
  })

  test('recovery: a tab that died leaves its segments closed — left only when exact — and a lost tail', async ({ page, context, errors }) => {
    const n = await boot(page, () => nordlichtDb(page))
    const [same, changed] = [n.rows[0], n.rows[1]]
    await step(page, agent('r10'), [['setRowProperty', same, n.est, 51]], { note: { seq: 10 } })
    await step(page, agent('r10'), [['setRowProperty', changed, n.est, 52]])
    await flushRec(page)
    const deadTab = await rec<string>(page, 'tab')
    expect((await rec(page, 'open')).length).toBe(2)
    // the tab dies (no page hide); then a write nobody records changes one of the rows
    await rec(page, 'crash')
    await wsEval(page, (s, a) => s.setRowProperty(a.row, a.est, 99), { row: changed, est: n.est })
    await flush(page)
    await page.close()

    const p2 = await context.newPage()
    errors.watch(p2)
    await openApp(p2)
    await startRecorder(p2)
    const res = await rec(p2, 'recovered')
    expect(res).toMatchObject({ closed: 2, exact: 1, partial: 1, tails: 1 })
    const exact = (await segmentsOf(p2, `p:${same}`)).find((s) => s.tab === deadTab)!
    expect(exact.o).toBeUndefined()
    expect(exact.left.h).toBe(exact.lastLh)
    expect(exact.touched).toEqual([`p:${n.est}`])
    const partial = (await segmentsOf(p2, `p:${changed}`)).find((s) => s.tab === deadTab)!
    expect(partial.o).toBeUndefined()
    expect(partial.left).toBeNull()
    expect(partial.touched).toBe('*')
    const tails = await rec(p2, 'lostTails')
    expect(tails).toHaveLength(1)
    expect(tails[0].tab).toBe(deadTab)
  })

  test('delete forever by the person: the place loses its pins, its segments are PURGED', async ({ page }) => {
    const id = await boot(page, () => wsEval(page, (s) => s.createPage({ title: 'Tessera Entwurf' }) as string))
    await step(page, agent('r11'), [['updatePage', id, { title: 'Tessera Entwurf 2' }]], { note: { seq: 11 }, end: true })
    await flushRec(page)
    expect((await recPins(page)).metas.filter((m) => m.id.startsWith(`p:${id}|`))).toHaveLength(1)
    await at(page, T0 + MIN)
    await step(page, you, [['trashPage', id]])
    await at(page, T0 + 2 * MIN)
    await step(page, you, [['deletePagePermanently', id]])
    await rec(page, 'settle')
    await expect.poll(async () => (await recPins(page)).metas.filter((m) => m.id.startsWith(`p:${id}|`)).length).toBe(0)
    const segs = await segmentsOf(page, `p:${id}`)
    expect(segs.length).toBeGreaterThanOrEqual(2)
    await expect.poll(async () => (await segmentsOf(page, `p:${id}`)).every((s) => s.f & F.PURGED)).toBe(true)
    const gone = (await eventsOf(page, `p:${id}`)).at(-1)!
    expect(gone.kinds & K.DELETE).toBeTruthy()
    expect(gone.f & F.GONE).toBeTruthy()
  })

  test('privacy: the journal holds no page text and no values; option / view names only in schema deltas', async ({ page }) => {
    const n = await boot(page, () => nordlichtDb(page))
    const page2 = await step<string[]>(page, you, [['createPage', { title: 'Platzhalter' }]])
    await step(page, agent('r12'), [
      ['setContent', page2[0], { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nordlicht-Geheimwert-7' }] }] }, 'ai'],
      ['updatePage', page2[0], { title: 'Tessera Quartalsplan' }],
      ['setRowProperty', n.rows[0], n.est, 98765.4321],
      ['setRowProperty', n.rows[0], n.note, 'Lindenweg 12'],
    ], { note: { seq: 12 } })
    const stage = await wsEval(page, (s, a) => JSON.parse(JSON.stringify(s.databases[a.db].properties.find((p: { id: string }) => p.id === a.stage))), { db: n.db, stage: n.stage })
    await step(page, agent('r12'), [
      ['updateProperty', n.db, n.stage, { options: [...stage.options, { id: 'o-tessera', name: 'Tessera-Option', color: 'red' }] }],
      ['addView', n.db, { type: 'table', name: 'Tessera-Ansicht' }],
    ], { end: true })
    await rec(page, 'settle')
    const dump = await rec<Record<string, Array<Record<string, unknown>>>>(page, 'rawDump')
    expect(dump.events.length).toBeGreaterThan(5)
    const all = JSON.stringify(dump)
    for (const secret of ['Nordlicht-Geheimwert-7', 'Tessera Quartalsplan', '98765.4321', 'Lindenweg 12', 'Nordlicht Handoff', 'NL-1398', 'Platzhalter'])
      expect(all, secret).not.toContain(secret)
    // names of options and views: only inside `x` of schema / view events
    for (const name of ['Tessera-Option', 'Tessera-Ansicht']) {
      let seen = 0
      for (const [store, recs] of Object.entries(dump))
        for (const r of recs) {
          if (!JSON.stringify(r).includes(name)) continue
          seen++
          expect(store, name).toBe('events')
          expect((r.kinds as number) & (K.SCHEMA | K.VIEW), name).toBeTruthy()
          const { x, ...rest } = r
          expect(JSON.stringify(rest)).not.toContain(name)
          expect(JSON.stringify(x)).toContain(name)
        }
      expect(seen, name).toBe(1)
    }
    // kv: ids, numbers, the key and lane ids only
    for (const r of dump.kv) expect(JSON.stringify(r)).not.toMatch(/Tessera|Lindenweg|Platzhalter/)
    // the pins in the version store DO hold what was there before (that is their job)
    const pins = JSON.stringify(await recPins(page))
    expect(pins).toContain('Platzhalter')
    expect(pins).toContain('Nordlicht 0')
  })
})
