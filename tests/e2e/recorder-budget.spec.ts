/**
 * Flight recorder — the journal's room and its before-images (R1a review): the budget counts what the stores hold
 * (a re-written record counts only what it grew by, a body kept once counts once, every prune gives back what it
 * removed), a pause for room checks again only after its back-off and never deletes days it cannot make room with,
 * a failed save gives room back on a young tape too (today's pins, oldest first), a team copy's failed write pauses
 * like a failed save, paused typing keeps one digest job per event, a database deleted for good loses its schema and
 * view pins, a pin's body is the exact content (block ids included), a row's pin reads with the database before the
 * write, a run that writes after its end stays one stretch, bookkeeping never breaks a segment, the orphan sweep
 * spares a pin written in the last minutes, and a tab left normally is marked clean. Fictional data (Nordlicht,
 * Tessera, Mara Lind).
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval, flush } from './fixtures'
import { F, eventsOf, flushRec, nordlichtDb, rec, recOps, recPins, recRuns, recSegments, segmentsOf, startRecorder, step } from './helpers/recorder'

const T0 = new Date('2026-10-05T10:00:00+02:00').getTime()
const S = 1000
const MIN = 60 * S
const DAY = 24 * 60 * MIN

type AnyRec = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function boot<T>(page: Page, setup?: () => Promise<T>, at = T0): Promise<T> {
  await page.clock.install({ time: at })
  await openApp(page)
  await startRecorder(page)
  // the clock jumps days here: the seed's repeating templates would make their pages on the tape
  await page.evaluate(() => (window as unknown as { __oneRecurring?: { stop: () => void } }).__oneRecurring?.stop())
  const out = setup ? await setup() : (undefined as T)
  await flush(page)
  await rec(page, 'wipe')
  return out
}

const AGENT = 'nordlicht-spiegel'
const agent = (run: string) => ({ kind: 'agent', id: AGENT, run })
const you = { kind: 'you', via: 'ui' }
const at = (page: Page, t: number) => page.clock.setFixedTime(t)
const bytes = (page: Page) => rec<{ counted: number; held: number }>(page, 'bytes')
const para = (text: string, id?: string) => ({ type: 'paragraph', ...(id ? { attrs: { id } } : {}), content: [{ type: 'text', text }] })

test.describe('flight recorder — room and before-images', () => {
  test('the budget counts what the stores hold: re-written records and kept bodies once, prunes give it back', async ({ page }) => {
    const n = await boot(page, async () => ({ db: await nordlichtDb(page), doc: await wsEval(page, (s) => s.createPage({ title: 'Tessera Notizen' }) as string) }))
    // 60 typing updates inside one fold, a flush after each: one op, one event, one segment re-written 60 times
    for (let i = 0; i < 60; i++) {
      await at(page, T0 + i * 400)
      await step(page, you, [['updatePage', n.doc, { title: `Tessera Notizen ${i}` }]])
      await flushRec(page)
    }
    let b = await bytes(page)
    expect(b.held).toBeGreaterThan(0)
    expect(b.counted, JSON.stringify(b)).toBeLessThan(b.held * 1.5 + 2048)
    // 200 agent writes on four rows (bodies unchanged: one body per row)
    for (let i = 0; i < 200; i++) {
      await at(page, T0 + MIN + i * S)
      await step(page, agent(`r${Math.floor(i / 20)}`), [['setRowProperty', n.db.rows[i % 4], n.db.est, i]], i % 20 === 19 ? { end: true } : {})
      if (i % 25 === 24) await flushRec(page)
    }
    await rec(page, 'settle')
    b = await bytes(page)
    expect(b.counted, JSON.stringify(b)).toBeGreaterThan(b.held * 0.7)
    expect(b.counted, JSON.stringify(b)).toBeLessThan(b.held * 1.3 + 4096)
    // a month later everything goes: so does its size (nothing grows a counter the prune cannot lower)
    await at(page, T0 + 31 * DAY)
    await rec(page, 'prune', T0 + 31 * DAY)
    b = await bytes(page)
    expect(b.held).toBe(0)
    expect(b.counted).toBe(0)
  })

  test('short of free room the tape cannot make: paused without deleting a day, checked again only after the back-off', async ({ page }) => {
    const n = await boot(page, () => nordlichtDb(page), T0 - 3 * DAY)
    await step(page, agent('alt'), [['setRowProperty', n.rows[0], n.est, 101]], { end: true })
    await flushRec(page)
    await at(page, T0)
    await step(page, agent('neu'), [['setRowProperty', n.rows[1], n.est, 102]], { end: true })
    await flushRec(page)
    const opsNow = await recOps(page)
    expect(opsNow.length, JSON.stringify(opsNow.map((o) => [o.w, o.at, o.p1]))).toBe(2)
    // 1 GB quota, 900 MB used by the workspace's own files: 200 MB headroom wanted, a few KB of tape can't make it
    const r = await rec(page, 'budgetCheck', { quota: 1e9, usage: 9e8 })
    expect(r).toEqual({ allowed: false, paused: 'room' })
    expect((await recOps(page)).length).toBe(2)
    // paused: what comes waits; the next checks within 10 min neither write nor prune
    await step(page, agent('wartet'), [['setRowProperty', n.rows[2], n.est, 103]], { end: true })
    await flushRec(page)
    expect((await recOps(page)).map((o) => o.r)).not.toContain(`agent:${AGENT}:wartet`)
    expect(await rec(page, 'budgetCheck', { quota: 1e9, usage: 9e8 })).toEqual({ allowed: false, paused: 'room' })
    expect((await recOps(page)).length).toBe(2)
    // after the back-off a check with room again resumes, and what waited is written
    await at(page, T0 + 11 * MIN)
    expect(await rec(page, 'budgetCheck', { quota: 1e10, usage: 1e8 })).toEqual({ allowed: true, paused: null })
    await flushRec(page)
    expect((await recOps(page)).map((o) => o.r)).toContain(`agent:${AGENT}:wartet`)
  })

  test('a failed save gives room back on a young tape: yesterday first, then today’s pins oldest first', async ({ page }) => {
    const n = await boot(page, () => nordlichtDb(page), T0 - DAY)
    await step(page, agent('gestern'), [['setRowProperty', n.rows[0], n.est, 101]], { end: true })
    await flushRec(page)
    await at(page, T0)
    for (let i = 0; i < 4; i++) {
      await at(page, T0 + i * MIN)
      await step(page, agent(`heute${i}`), [['setRowProperty', n.rows[i], n.est, 10 + i]], { end: true })
    }
    await flushRec(page)
    expect((await recPins(page)).metas.length).toBe(5)
    // a failure room would not cure (a clone error): paused, nothing given back
    await rec(page, 'saveStatus', 'error', { name: 'DataCloneError', message: 'could not clone' })
    expect(await rec(page, 'paused')).toBe('save')
    await page.waitForTimeout(300)
    expect((await recOps(page)).length, JSON.stringify((await recOps(page)).map((o) => [o.w, o.at]))).toBe(5)
    expect((await recOps(page)).map((o) => o.r).sort(), 'the tape before').toEqual([`agent:${AGENT}:gestern`, ...[0, 1, 2, 3].map((i) => `agent:${AGENT}:heute${i}`)])
    // out of room: yesterday goes (the budget never prunes today's records)
    await rec(page, 'saveStatus', 'error', { name: 'QuotaExceededError', message: 'full' })
    await expect.poll(async () => (await recOps(page)).map((o) => o.r).sort()).toEqual([0, 1, 2, 3].map((i) => `agent:${AGENT}:heute${i}`))
    // still failing: today's pins go, the oldest half first — their segments read partial, the records stay
    await rec(page, 'saveStatus', 'error', { name: 'QuotaExceededError', message: 'full' })
    await expect.poll(async () => (await recPins(page)).metas.length).toBe(2)
    const segs = (await recSegments(page)).filter((s) => s.r?.startsWith(`agent:${AGENT}:heute`)).sort((a, b) => a.from - b.from)
    expect(segs.map((s) => !!s.before)).toEqual([false, false, true, true])
    expect((await recOps(page)).length).toBe(4)
    // the next good save: recording goes on
    await rec(page, 'saveStatus', 'saved')
    expect(await rec(page, 'paused')).toBeNull()
  })

  test('a team copy’s write that failed for lack of room pauses the journal; it tries again after a minute', async ({ page }) => {
    const n = await boot(page, () => nordlichtDb(page))
    await rec(page, 'copyFailed', 'QuotaExceededError')
    expect(await rec(page, 'paused')).toBe('save')
    await step(page, agent('team'), [['setRowProperty', n.rows[0], n.est, 7]], { end: true })
    await flushRec(page)
    expect(await recOps(page)).toEqual([])
    await at(page, T0 + 5 * MIN)
    await flushRec(page)
    expect((await recOps(page)).map((o) => o.r)).toEqual([`agent:${AGENT}:team`])
    expect(await rec(page, 'paused')).toBeNull()
  })

  test('paused, typing keeps one digest job per event — never a copy of the page per keystroke', async ({ page }) => {
    const id = await boot(page, () => wsEval(page, (s) => s.createPage({ title: 'Tessera Protokoll', content: { type: 'doc', content: Array.from({ length: 200 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `Nordlicht Zeile ${i}` }] })) } }) as string))
    await rec(page, 'saveStatus', 'error', { name: 'DataCloneError' })
    for (let i = 0; i < 80; i++) {
      await at(page, T0 + i * 200)
      await step(page, you, [['setContent', id, { type: 'doc', content: [para(`Mara Lind tippt ${i}`), ...Array.from({ length: 199 }, (_, k) => para(`Nordlicht Zeile ${k + 1}`))] }, 'e2e']])
      if (i % 10 === 9) await flushRec(page)
    }
    await flushRec(page)
    const w = await rec<{ waiting: number; jobs: number }>(page, 'waitingDetail')
    // one op, one event, one segment (+ its pin) wait; their digests: one for the event, one for the segment's start
    expect(w.jobs).toBeLessThanOrEqual(3)
    await rec(page, 'saveStatus', 'saved')
    await flushRec(page)
    const ops = (await recOps(page)).filter((o) => o.p1 === `p:${id}`)
    expect(ops).toHaveLength(1)
    expect(ops[0].ops).toBe(80)
  })

  test('a database deleted for good loses its schema and view pins; no new pin is taken for the delete', async ({ page }) => {
    const n = await boot(page, () => nordlichtDb(page))
    const viewId = await wsEval(page, (s, db) => s.databases[db].views[0].id as string, n.db)
    await step(page, agent('schema'), [
      ['updateProperty', n.db, n.est, { name: 'Schätzung (h)' }],
      ['updateView', n.db, viewId, { name: 'Tessera-Ansicht' }],
    ], { end: true })
    await flushRec(page)
    const ofDb = (m: { id: string }) => m.id.startsWith(`s:${n.db}|`) || m.id.startsWith(`v:${n.db}/`)
    expect((await recPins(page)).metas.filter(ofDb).length).toBeGreaterThanOrEqual(2)
    await at(page, T0 + MIN)
    await step(page, you, [['trashPage', n.db]])
    await at(page, T0 + 2 * MIN)
    await step(page, you, [['deletePagePermanently', n.db]])
    await rec(page, 'settle')
    await expect.poll(async () => (await recPins(page)).metas.filter(ofDb).length).toBe(0)
    await expect.poll(async () => (await recPins(page)).metas.filter((m) => m.meta.kind === 'schema').length).toBe(0)
    const segs = (await recSegments(page)).filter((s) => s.p === `s:${n.db}` || s.p.startsWith(`v:${n.db}/`))
    expect(segs.length).toBeGreaterThanOrEqual(3)
    await expect.poll(async () => (await recSegments(page)).filter((s) => s.p === `s:${n.db}` || s.p.startsWith(`v:${n.db}/`)).every((s) => s.f & F.PURGED && !s.before)).toBe(true)
  })

  test('a pin’s body is the exact content: block ids an editor added in between are in the next pin', async ({ page }) => {
    const id = await boot(page, () => wsEval(page, (s) => s.createPage({ title: 'Tessera Import', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nordlicht ohne Ids' }] }] } }) as string))
    await step(page, agent('eins'), [['updatePage', id, { title: 'Tessera Import 1' }]], { end: true })
    // an editor opens the page and gives its blocks ids (the same content for contentKey: no event)
    const withIds = { type: 'doc', content: [para('Nordlicht ohne Ids', 'blk-tessera-1')] }
    await at(page, T0 + MIN)
    await step(page, { kind: 'editor', id: 'ed-e2e' }, [['setContent', id, withIds, 'ed-e2e']])
    await at(page, T0 + 2 * MIN)
    await step(page, agent('zwei'), [['updatePage', id, { title: 'Tessera Import 2' }]], { end: true })
    await rec(page, 'settle')
    const segs = (await segmentsOf(page, `p:${id}`)).filter((s) => s.l === `agent:${AGENT}`)
    expect(segs).toHaveLength(2)
    const first = await rec(page, 'pinBody', segs[0].before)
    const second = await rec(page, 'pinBody', segs[1].before)
    expect(first.content.content[0].attrs?.id ?? null).toBeNull()
    expect(second.content).toEqual(await wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.pages[id].content)), id))
    expect(second.content.content[0].attrs.id).toBe('blk-tessera-1')
  })

  test('a row’s pin reads with the database before the write: a property added meanwhile and its value stay', async ({ page }) => {
    const n = await boot(page, () => nordlichtDb(page))
    const row = n.rows[0]
    // the agent adds "Priorität" (its schema stretch begins with the database without it)
    const [prio] = await step<string[]>(page, agent('c1'), [['addProperty', n.db, { name: 'Priorität', type: 'text' }]])
    // the person fills it in
    await at(page, T0 + 10 * S)
    await step(page, you, [['setRowProperty', row, prio, 'Tessera hoch']])
    // the same agent run writes the row
    await at(page, T0 + 20 * S)
    await step(page, agent('c1'), [['setRowProperty', row, n.est, 13]], { end: true })
    await rec(page, 'settle')
    const seg = (await segmentsOf(page, `p:${row}`)).find((s) => s.l === `agent:${AGENT}`)!
    const body = await rec(page, 'pinBody', seg.before)
    expect(body.props.values[prio]).toBe('Tessera hoch')
    expect(body.props.defs.map((d: { name: string }) => d.name)).toContain('Priorität')
  })

  test('a run that writes after its end stays one stretch per place, and ends again; noteRun takes it up again', async ({ page }) => {
    const n = await boot(page, () => nordlichtDb(page))
    await step(page, agent('r1'), [['setRowProperty', n.rows[0], n.est, 1]], { note: { seq: 1 }, end: true })
    await flushRec(page)
    // two writes on one row after the end, no noteRun (a late part of the run): one segment
    await at(page, T0 + MIN)
    await step(page, agent('r1'), [
      ['setRowProperty', n.rows[1], n.est, 2],
      ['updatePage', n.rows[1], { title: 'NL-1399 Tessera' }],
    ])
    await rec(page, 'settle')
    expect((await segmentsOf(page, `p:${n.rows[1]}`)).filter((s) => s.r === `agent:${AGENT}:r1`)).toHaveLength(1)
    expect(await rec(page, 'open')).toEqual([])
    let run = (await recRuns(page)).find((r) => r.key === `agent:${AGENT}:r1`)!
    expect(run.ended).toBeGreaterThanOrEqual(T0 + MIN)
    // a review applying the run's proposals later: noteRun, writes, endRun — again one stretch per place
    await at(page, T0 + 5 * MIN)
    await step(page, agent('r1'), [
      ['setRowProperty', n.rows[2], n.est, 3],
      ['updatePage', n.rows[2], { title: 'NL-1400 Tessera' }],
      ['setRowProperty', n.rows[2], n.stage, n.done],
    ], { note: true, end: true })
    await rec(page, 'settle')
    expect((await segmentsOf(page, `p:${n.rows[2]}`)).filter((s) => s.r === `agent:${AGENT}:r1`)).toHaveLength(1)
    run = (await recRuns(page)).find((r) => r.key === `agent:${AGENT}:r1`)!
    expect(run.ended).toBe(T0 + 5 * MIN)
  })

  test('bookkeeping on a place someone writes (a heartbeat, a back-link) never breaks the segment', async ({ page }) => {
    const n = await boot(page, () => nordlichtDb(page))
    const row = n.rows[0]
    await step(page, agent('lauf'), [['setRowProperty', row, n.est, 5]], { note: { seq: 1 } })
    await at(page, T0 + 10 * S)
    await step(page, { kind: 'system', why: 'bookkeeping' }, [['setRowProperty', row, n.note, 'Herzschlag 10:00']])
    await at(page, T0 + 20 * S)
    await step(page, agent('lauf'), [['setRowProperty', row, n.stage, n.done]], { end: true })
    // another system write (a tab's replay) does close it: the next segment starts with GAP
    await at(page, T0 + 30 * S)
    await step(page, agent('zwei'), [['setRowProperty', row, n.est, 6]], { note: { seq: 2 } })
    await step(page, { kind: 'system', why: 'tab' }, [['setRowProperty', row, n.note, 'aus einem anderen Tab']])
    await at(page, T0 + 40 * S)
    await step(page, agent('zwei'), [['setRowProperty', row, n.est, 7]], { end: true })
    await rec(page, 'settle')
    const segs = await segmentsOf(page, `p:${row}`)
    expect(segs.map((s) => [s.r, !!(s.f & F.GAP)])).toEqual([
      [`agent:${AGENT}:lauf`, false],
      [`agent:${AGENT}:zwei`, false],
      [`agent:${AGENT}:zwei`, true],
    ])
    expect(segs[1].bh).toBe(segs[0].left.h)
    expect(await rec(page, 'unknowns')).toEqual([])
  })

  test('the orphan sweep spares a pin written in the last minutes', async ({ page }) => {
    const n = await boot(page, () => nordlichtDb(page))
    await step(page, agent('waise'), [['setRowProperty', n.rows[0], n.est, 9]], { end: true })
    await rec(page, 'settle')
    const seg = (await segmentsOf(page, `p:${n.rows[0]}`)).find((s) => s.r === `agent:${AGENT}:waise`)!
    expect(seg.before).toBeTruthy()
    // its segment record is not in the journal (another tab between its pins and its segments; a flush that failed)
    await page.evaluate(async (id) => {
      const db: IDBDatabase = await new Promise((r) => {
        const o = indexedDB.open('one-recorder')
        o.onsuccess = () => r(o.result)
      })
      await new Promise<void>((r) => {
        const t = db.transaction('segs', 'readwrite')
        t.objectStore('segs').delete(id)
        t.oncomplete = () => r()
      })
      db.close()
    }, seg.id)
    await at(page, T0 + 5 * MIN)
    await rec(page, 'prune', T0 + 5 * MIN)
    expect((await recPins(page)).metas.map((m) => m.id)).toContain(seg.before)
    await at(page, T0 + 11 * MIN)
    await rec(page, 'prune', T0 + 11 * MIN)
    expect((await recPins(page)).metas.map((m) => m.id)).not.toContain(seg.before)
  })

  test('memory mode: a page deleted for good loses the before-images this tab kept of it', async ({ page }) => {
    // no IndexedDB for the journal (a private window): the journal and its pins live in this tab
    await page.addInitScript(() => {
      const open = IDBFactory.prototype.open
      IDBFactory.prototype.open = function (name: string, version?: number) {
        if (name === 'one-recorder') throw new DOMException('no storage', 'InvalidStateError')
        return open.call(this, name, version)
      }
    })
    const id = await boot(page, () => wsEval(page, (s) => s.createPage({ title: 'Tessera Privat', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Mara Lind, Lindenweg 12' }] }] } }) as string))
    expect(await rec(page, 'mode')).toBe('memory')
    await step(page, agent('privat'), [['updatePage', id, { title: 'Tessera Privat 2' }]], { end: true })
    await rec(page, 'settle')
    const seg = (await segmentsOf(page, `p:${id}`)).find((s) => s.r === `agent:${AGENT}:privat`)!
    expect(seg.before).toBeTruthy()
    expect(JSON.stringify(await rec(page, 'pinBody', seg.before))).toContain('Lindenweg 12')
    await at(page, T0 + MIN)
    await step(page, you, [['trashPage', id]])
    await at(page, T0 + 2 * MIN)
    await step(page, you, [['deletePagePermanently', id]])
    await rec(page, 'settle')
    await expect.poll(() => rec(page, 'pinBody', seg.before)).toBeNull()
  })

  test('a tab left normally after a write is marked clean: no lost tail at the next start', async ({ page, context, errors }) => {
    await page.clock.install({ time: T0 })
    await openApp(page)
    await startRecorder(page)
    const id = await wsEval(page, (s) => s.createPage({ title: 'Tessera Abschied' }) as string)
    await flush(page)
    await flushRec(page)
    await step(page, you, [['updatePage', id, { title: 'Tessera Abschied 2' }]])
    // the write is in the journal (the 500 ms flush) — only its segment is still open when the tab goes
    await expect.poll(async () => (await eventsOf(page, `p:${id}`)).length).toBe(2)
    const tab = await rec<string>(page, 'tab')
    await page.close({ runBeforeUnload: true })
    const p2 = await context.newPage()
    errors.watch(p2)
    await openApp(p2)
    await startRecorder(p2)
    await rec(p2, 'recovered')
    const tails = (await rec<AnyRec[]>(p2, 'lostTails')).filter((t) => t.tab === tab)
    expect(tails).toEqual([])
    const seg = (await segmentsOf(p2, `p:${id}`)).at(-1)!
    expect(seg.o).toBeUndefined()
    expect(seg.left?.h).toBeTruthy()
  })
})
