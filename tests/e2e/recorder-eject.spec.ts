/**
 * Flight recorder — the eject (R3). The planner on the story's run 212 (tests/e2e/fixtures/recorder-story.json):
 * what goes back, what is held and why, new rows to the trash, the option the run removed coming back — read through
 * the seam (`__oneRecorder.planEject`, counts and outcomes only). Test data is fictional (Nordlicht, Tessera).
 */
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect, openApp, flush, wsEval, reloadApp, MOD } from './fixtures'
import { playStory, rec, startRecorder, storyTime, type Story } from './helpers/recorder'
import { setKey, sseMessage } from './helpers/terminal'

const story = JSON.parse(readFileSync(new URL('./fixtures/recorder-story.json', import.meta.url), 'utf8')) as Story
const AGENT = `agent:${story.agent.id}`
const RUN = story.expect.run212.key

async function bootStory(page: Page): Promise<Record<string, string>> {
  await page.clock.install({ time: storyTime(story, story.setupAt) })
  await openApp(page)
  await startRecorder(page)
  await flush(page)
  await rec(page, 'wipe')
  return playStory(page, story)
}

/** A page's version reasons, oldest first (one-history: `idx:<pageId>`). */
async function versionsOf(page: Page, id: string): Promise<string[]> {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('one-history')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    const idx = await new Promise<Array<{ reason?: string }> | undefined>((res) => {
      const t = db.transaction('snapshots').objectStore('snapshots').get(`idx:${id}`)
      t.onsuccess = () => res(t.result as never)
      t.onerror = () => res(undefined)
    })
    db.close()
    return (idx ?? []).map((m) => m.reason ?? '')
  }, id)
}

const window212 = () => ({ lane: AGENT, run: RUN, a: storyTime(story, story.bracket[0]), b: storyTime(story, story.bracket[1]) })

interface PlannedPlace {
  p: string
  pk: string
  outcome: string
  reason: string | null
  back: string[]
  held: Array<{ part: string; reason: string }>
}

test.describe('flight recorder — the eject', () => {
  test('planEject (seam): run 212 → 35 / 37 back, NL-1408 + NL-1415 held, NL-1432–1434 to the trash, "Ready" comes back', async ({ page }) => {
    test.setTimeout(120_000)
    const ids = await bootStory(page)
    const r = await rec<{ counts: Record<string, number>; places: PlannedPlace[]; heldBy: unknown[] }>(page, 'planEject', window212())
    const e = story.expect.eject
    expect(r.counts).toMatchObject({ all: e.all, back: e.back, held: e.held.length, partial: 0, already: 0 })
    // rows the run created have their ids from the store (by title)
    const titled = await wsEval(page, (s, titles) => Object.fromEntries(titles.map((t) => [t, Object.values(s.pages).find((x) => x.title === t)?.id ?? ''])), e.trash)
    const by = (ref: string) => r.places.find((x) => x.p === `p:${ids[ref] ?? titled[ref]}`)!
    for (const ref of e.held) expect(by(ref), ref).toMatchObject({ outcome: 'held', reason: 'changed' })
    for (const ref of e.trash) expect(by(ref)?.outcome, ref).toBe('trash')
    expect(r.heldBy).toEqual(['you'])
    // the schema: the removed option back (with its order)
    const schema = r.places.find((x) => x.pk === 'schema')!
    expect(schema.outcome).toBe('back')
    expect(schema.back).toContain(`o:${e.optionBack.prop}/${e.optionBack.id}`)
    // the report page: its title and the appended paragraphs go, block by block
    const report = r.places.find((x) => x.pk === 'page')!
    expect(report).toMatchObject({ outcome: 'back' })
    expect(report.back).toEqual(expect.arrayContaining(['t', 'c']))
    // planning wrote nothing a writer frame did not name
    expect(await rec(page, 'unknowns')).toEqual([])
  })

  test('commit + Undo (seam): ONE eject update, versions, board 7 · 7 · 5 · 3 · 12, Ready back at index 1, new rows in the trash, AgentRun settled; the Undo in ONE update', async ({ page }) => {
    test.setTimeout(150_000)
    const ids = await bootStory(page)
    const e = story.expect.eject
    const DB = story.database.id
    const board = () => wsEval(page, (s, db) => {
      const stage = s.databases[db].properties.find((p: { id: string }) => p.id === 'story-stage')
      const rows = Object.values(s.pages).filter((p: { databaseId?: string; trashed?: boolean }) => p.databaseId === db && !p.trashed) as Array<{ properties: Record<string, unknown> }>
      return { options: stage.options.map((o: { id: string }) => o.id), counts: stage.options.map((o: { id: string }) => rows.filter((r) => r.properties['story-stage'] === o.id).length) }
    }, DB)
    const reportBefore = await wsEval(page, (s) => ({ title: s.pages['story-report'].title, blocks: s.pages['story-report'].content.content.length }))
    expect(reportBefore.blocks).toBe(5)
    await rec(page, 'spy', true)
    const r = await rec<{ id: string; state: string; counts: Record<string, number>; agent: { runIds: string[] } | null }>(page, 'eject', window212())
    const updates = await rec<Array<{ w: string | null; kind: string | null }>>(page, 'spy', false)
    expect(r.state).toBe('done')
    expect(r.counts).toMatchObject({ back: e.back, all: e.all, held: e.held.length })
    // exactly ONE store update under the eject's writer; every update of the flow is the eject's or an editor's / a follow-up's
    expect(updates.filter((u) => u.kind === 'eject')).toHaveLength(1)
    for (const u of updates) expect(['eject', 'editor', 'synced', 'kit', 'system'], JSON.stringify(u)).toContain(u.kind)
    // the board as mock-3 shows it, "Ready" back at its index
    const b = await board()
    expect(b.options.indexOf(e.optionBack.id)).toBe(e.optionBack.index)
    expect(b.counts).toEqual(e.board)
    // the new rows in the trash (not deleted), the report page's title and appended blocks gone, `rh` kept
    for (const t of e.trash) expect(await wsEval(page, (s, t) => (Object.values(s.pages).find((p: { title: string }) => p.title === t) as { trashed?: boolean } | undefined)?.trashed, t), t).toBe(true)
    const report = await wsEval(page, (s) => ({ title: s.pages['story-report'].title, ids: s.pages['story-report'].content.content.map((b: { attrs?: { id?: string } }) => b.attrs?.id ?? null) }))
    expect(report.title).toBe('Nordlicht-Spiegel · Bericht')
    expect(report.ids).toEqual(['rh'])
    // held rows keep the person's values
    for (const ref of e.held) expect(await wsEval(page, (s, id) => s.pages[id].updatedAt > 0, ids[ref])).toBe(true)
    // every written page has a "Vor dem Auswurf" version
    for (const id of ['story-report', ids['NL-1402']]) expect((await versionsOf(page, id)).filter((v) => v === 'eject'), id).toHaveLength(1)
    // the AgentRun: 49 ejected, c11 / c18 held
    const run = await page.evaluate(async (a) => ((await (window as unknown as { __oneAgents: { loadRuns: (id: string) => Promise<Array<{ id: string; staged: Array<Record<string, unknown>>; applied: number }>> } }).__oneAgents.loadRuns(a)) ?? []).find((x) => x.id === 'r212'), story.agent.id)
    expect(run!.staged.filter((c) => c.status === 'discarded' && c.ejected).length).toBe(e.agent.ejected)
    for (const id of e.agent.held) expect(run!.staged.find((c) => c.id === id), id).toMatchObject({ status: 'applied', held: expect.objectContaining({ id: r.id }) })
    // the Undo: ONE update under you~undo:<eject>, the board as before, the run's statuses back
    await rec(page, 'spy', true)
    const u = await rec<{ ok: boolean; back: number; kept: number }>(page, 'undoEject', r.id)
    const undoUpdates = await rec<Array<{ w: string | null; kind: string | null }>>(page, 'spy', false)
    expect(u).toMatchObject({ ok: true, back: e.back, kept: 0 })
    expect(undoUpdates.filter((x) => x.w === `you~undo:${r.id}`)).toHaveLength(1)
    expect((await board()).counts).not.toEqual(e.board)
    expect(await wsEval(page, (s) => s.pages['story-report'].content.content.length)).toBe(5)
    const after = await page.evaluate(async (a) => ((await (window as unknown as { __oneAgents: { loadRuns: (id: string) => Promise<Array<{ id: string; staged: Array<Record<string, unknown>>; applied: number }>> } }).__oneAgents.loadRuns(a)) ?? []).find((x) => x.id === 'r212'), story.agent.id)
    expect(after!.staged.filter((c) => c.status === 'applied').length).toBe(51)
    expect(after!.staged.some((c) => c.ejected || c.held)).toBe(false)
    expect(await rec(page, 'unknowns')).toEqual([])
  })

  test('after a reload the Undo goes through the planner (you~undo:<eject>); ejecting again is refused as already done', async ({ page }) => {
    test.setTimeout(150_000)
    await bootStory(page)
    const r = await rec<{ id: string; state: string }>(page, 'eject', window212())
    expect(r.state).toBe('done')
    const boardOf = () => wsEval(page, (s) => Object.values(s.pages).filter((p: { databaseId?: string; trashed?: boolean }) => p.databaseId === 'story-nordlicht' && !p.trashed).length)
    const ejected = await boardOf()
    // the same window again: every place already ejected → nothing goes back
    const again = await rec<{ counts: Record<string, number> }>(page, 'planEject', window212())
    expect(again.counts).toMatchObject({ back: 0, already: story.expect.eject.back })
    await reloadApp(page)
    await startRecorder(page)
    await rec(page, 'spy', true)
    const u = await rec<{ ok?: boolean; back?: number; refused?: unknown }>(page, 'undoEject', r.id)
    const updates = await rec<Array<{ w: string | null; kind: string | null }>>(page, 'spy', false)
    expect(u).toMatchObject({ ok: true, back: story.expect.eject.back })
    expect(updates.filter((x) => x.w === `you~undo:${r.id}`)).toHaveLength(1)
    expect(await boardOf()).toBe(ejected + story.expect.eject.trash.length)
    expect(await wsEval(page, (s) => s.pages['story-report'].content.content.length)).toBe(5)
    const recs = await rec<Array<{ id: string; undone?: number }>>(page, 'ejects')
    expect(recs.find((x) => x.id === r.id)?.undone).toBeGreaterThan(0)
    // the run's review is back too
    const run = await page.evaluate(async (a) => ((await (window as unknown as { __oneAgents: { loadRuns: (id: string) => Promise<Array<{ id: string; staged: Array<Record<string, unknown>> }>> } }).__oneAgents.loadRuns(a)) ?? []).find((x) => x.id === 'r212'), story.agent.id)
    expect(run!.staged.filter((c) => c.status === 'applied').length).toBe(51)
    expect(await rec(page, 'unknowns')).toEqual([])
  })

  test('prune (E19): the budget’s pin steps keep the pins a live eject needs — its own segments and the places it took back; the Undo after a reload still plans from them', async ({ page }) => {
    test.setTimeout(150_000)
    await bootStory(page)
    const r = await rec<{ id: string; state: string }>(page, 'eject', window212())
    expect(r.state).toBe('done')
    await flush(page)
    // pin ids end in `<seg>.<wt>`: the segments whose pins are on the device
    const segsWithPins = async () => new Set((await rec<{ metas: Array<{ id: string }> }>(page, 'pins')).metas.map((m) => {
      const last = m.id.slice(m.id.lastIndexOf('|') + 1)
      return last.slice(0, last.lastIndexOf('.'))
    }))
    const recs = await rec<Array<{ id: string; segs: string[] }>>(page, 'ejects')
    const needed = new Set(recs.find((x) => x.id === r.id)!.segs)
    const own = (await rec<Array<{ id: string; r?: string }>>(page, 'segments')).filter((g) => g.r?.startsWith('eject:')).map((g) => g.id)
    expect(needed.size).toBeGreaterThan(0)
    expect(own.length).toBeGreaterThan(0)
    const before = await segsWithPins()
    // every pin of today, as when the workspace could not save — but none an eject needs
    await rec(page, 'prunePins', 'today')
    const after = await segsWithPins()
    for (const id of [...needed, ...own]) if (before.has(id)) expect(after.has(id), id).toBe(true)
    // the others went
    expect([...before].filter((id) => !needed.has(id) && !own.includes(id)).some((id) => !after.has(id))).toBe(true)
    await reloadApp(page)
    await startRecorder(page)
    const u = await rec<{ ok?: boolean; back?: number; kept?: number }>(page, 'undoEject', r.id)
    expect(u).toMatchObject({ ok: true, back: story.expect.eject.back, kept: 0 })
    expect(await wsEval(page, (s) => s.pages['story-report'].content.content.length)).toBe(5)
    expect(await rec(page, 'unknowns')).toEqual([])
  })

  test('write-ahead: a commit that dies after its store update is finished by the next boot from its targets', async ({ page, context }) => {
    test.setTimeout(150_000)
    await bootStory(page)
    await page.evaluate(() => ((window as unknown as { __oneRecorder: { ejectHook: string } }).__oneRecorder.ejectHook = 'afterWrite'))
    const r = await rec<{ id: string; state: string }>(page, 'eject', window212())
    expect(r.state).toBe('committing')
    await flush(page)
    await page.close()
    const b = await context.newPage()
    await b.clock.install({ time: storyTime(story, story.now) })
    await openApp(b)
    await startRecorder(b)
    await rec(b, 'recovered')
    await expect.poll(async () => (await rec<Array<{ id: string; state: string }>>(b, 'ejects')).find((x) => x.id === r.id)?.state, { timeout: 20_000 }).toBe('done')
    const run = await b.evaluate(async (a) => ((await (window as unknown as { __oneAgents: { loadRuns: (id: string) => Promise<Array<{ id: string; staged: Array<Record<string, unknown>> }>> } }).__oneAgents.loadRuns(a)) ?? []).find((x) => x.id === 'r212'), story.agent.id)
    expect(run!.staged.filter((c) => c.status === 'discarded' && c.ejected).length).toBe(story.expect.eject.agent.ejected)
  })

  test('agents (E9): settleEjected under the run lock — ejected → discarded + ejected, held stay applied + held, dependents and pending (never one opened in Preflight) discarded, superseded untouched; unsettle gives them back', async ({ page }) => {
    await openApp(page)
    const A = story.agent.id
    await wsEval(page, (s, a) => s.upsertAgent({ id: a.id, name: a.name, instructions: 'Spiegelt den Nordlicht-Abgleich.', trigger: { type: 'manual' }, scope: { everything: false, pages: [], databases: [] }, write: 'apply', mcpServers: [], runner: 'browser', maxRunUsd: 1, enabled: false, createdBy: null, updatedBy: null, createdAt: 1, updatedAt: 1 }), story.agent)
    await page.evaluate((id) => (window.location.hash = `#/agents/${id}`), A)
    await page.waitForFunction(() => !!(window as unknown as { __oneAgents?: unknown }).__oneAgents)
    const ch = (id: string, n: number, status: string, x: Record<string, unknown> = {}) => ({ id, n, kind: 'update_row', status, pageId: `p-${id}`, databaseId: 'story-nordlicht', ...x })
    type Agents = Record<string, (...a: unknown[]) => Promise<{ run?: { staged: Array<Record<string, unknown>>; applied: number }; discarded?: string[] } & Record<string, unknown>>>
    const call = (fn: string, ...args: unknown[]) => page.evaluate(({ fn, args }) => (window as unknown as { __oneAgents: Agents }).__oneAgents[fn](...args), { fn, args })
    const seed = (runId: string) =>
      call('putRun', { id: runId, agentId: A, runner: 'browser', seq: 212, trigger: { type: 'manual' }, startedAt: 1000, endedAt: 2000, status: 'ok', summary: '', steps: [], applied: 3, staged: [ch('c1', 1, 'applied'), ch('c2', 2, 'applied'), ch('c3', 3, 'pending', { dependsOn: 'c1' }), ch('c4', 4, 'pending'), ch('c5', 5, 'pending'), ch('c6', 6, 'superseded'), ch('c7', 7, 'applied')] })
    const statusOf = (run: { staged: Array<Record<string, unknown>> }) => Object.fromEntries(run.staged.map((c) => [c.id as string, [c.status, c.ejected ? 'E' : '', c.held ? 'H' : ''].join('')]))
    await seed('r-e9')
    const r = await call('settleEjected', A, 'r-e9', { ejected: ['c1', 'c7'], held: [{ id: 'c2', by: 'you', at: 5 }], ejectId: 'ej1', at: 9, discardPending: true, openedIds: ['c5'] })
    expect(statusOf(r.run!)).toEqual({ c1: 'discardedE', c2: 'appliedH', c3: 'discarded', c4: 'discarded', c5: 'pending', c6: 'superseded', c7: 'discardedE' })
    expect(r.run!.applied).toBe(1)
    expect([...r.discarded!].sort()).toEqual(['c3', 'c4'])
    expect(r.run!.staged.find((c) => c.id === 'c1')!.ejected).toEqual({ id: 'ej1', at: 9 })
    // the Undo: the ejected changes applied again, the discarded ones open again, the held marker gone
    const u = (await call('unsettleEjected', A, 'r-e9', 'ej1', ['c1', 'c7'], ['c3', 'c4'])) as unknown as { staged: Array<Record<string, unknown>>; applied: number }
    expect(statusOf(u)).toEqual({ c1: 'applied', c2: 'applied', c3: 'pending', c4: 'pending', c5: 'pending', c6: 'superseded', c7: 'applied' })
    expect(u.applied).toBe(3)
    // Preflight cannot tell yet which cards were opened: no pending proposal is discarded
    await seed('r-e9b')
    const unknown = await call('settleEjected', A, 'r-e9b', { ejected: ['c1'], held: [], ejectId: 'ej2', at: 9, discardPending: true, openedIds: null })
    expect(statusOf(unknown.run!)).toMatchObject({ c3: 'discarded', c4: 'pending', c5: 'pending' })
    // the run's tags in its history
    await expect(page.locator('[data-testid="agx-ejected"]').first()).toBeVisible()
  })

  test('terminal (E10): an ejected batch change is discarded + ejected, never restored; a settled batch\'s Undo writes nothing; unejectBatch gives it back', async ({ page }) => {
    await openApp(page)
    await setKey(page)
    const pageId = await wsEval(page, (s) => s.createPage({ title: 'Tessera Plan', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Erste Zeile.' }] }] } }))
    await page.keyboard.press(`${MOD}+j`)
    await page.waitForFunction(() => !!(window as unknown as { __oneTerm?: unknown }).__oneTerm)
    type Term = Record<string, (...a: unknown[]) => unknown> & { state: { getState: () => { changes: Array<Record<string, unknown>> }; setState: (fn: (s: { changes: unknown[] }) => unknown) => void } }
    const term = <R>(fn: (t: Term, arg: string) => R, arg = '') => page.evaluate(({ src, arg }) => new Function('t', 'arg', `return (${src})(t, arg)`)((window as unknown as { __oneTerm: Term }).__oneTerm, arg), { src: fn.toString(), arg }) as Promise<Awaited<R>>
    const statuses = () => term((t) => t.state.getState().changes.map((c) => `${c.id}:${c.status}${c.ejected ? '+E' : ''}`))
    await term((t, id) => t.state.setState((s) => ({ changes: [...s.changes, { id: 'chg-1', n: 1, kind: 'append', status: 'pending', pageId: id, markdown: 'Zweite Zeile.' }] })), pageId)
    await term((t) => t.applyStaged(undefined, { quiet: true }))
    expect(await statuses()).toEqual(['chg-1:applied'])
    const runId = (await term((t) => (t.batchIds() as string[])[0]))!
    expect(await term((t) => t.terminalBusy())).toBe(false)
    // the eject marks the batch's change settled and takes it out of the review
    await rec(page, 'markSettled', `terminal:${runId}`, ['chg-1'], 'ej1')
    await term((t, id) => t.ejectBatch(id, ['chg-1'], [], { id: 'ej1', at: 9 }), runId)
    expect(await statuses()).toEqual(['chg-1:discarded+E'])
    await term((t) => t.restoreStaged('chg-1'))
    expect(await term((t) => t.undiscardStaged(['chg-1']))).toEqual([])
    expect(await statuses()).toEqual(['chg-1:discarded+E'])
    // the batch's old Undo (a toast, Preflight's card) writes nothing: every change of it is settled
    const before = await wsEval(page, (s, id) => s.pages[id].contentRev, pageId)
    const undone = await term((t, id) => t.undoStagedBatch(t.batch(id), { quiet: true }), runId)
    expect(undone).toEqual({ kept: ['chg-1'], final: [] })
    expect(await wsEval(page, (s, id) => s.pages[id].contentRev, pageId)).toBe(before)
    // the eject's Undo: applied again
    await rec(page, 'unmarkSettled', `terminal:${runId}`, ['chg-1'], 'ej1')
    await term((t, id) => t.unejectBatch(id, 'ej1', ['chg-1']), runId)
    expect(await statuses()).toEqual(['chg-1:applied'])
  })

  test('apply.ts (E11): a batch\'s Undo keeps the closure of a settled change and reverts the others', async ({ page }) => {
    await openApp(page)
    await setKey(page)
    const para = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
    const [a, b] = await wsEval(page, (s, docs) => [s.createPage({ title: 'Nordlicht Notizen', content: docs[0] }), s.createPage({ title: 'Tessera Notizen', content: docs[1] })], [para('Nordlicht.'), para('Tessera.')])
    await page.keyboard.press(`${MOD}+j`)
    await page.waitForFunction(() => !!(window as unknown as { __oneTerm?: unknown }).__oneTerm)
    type Term = Record<string, (...a: unknown[]) => unknown> & { state: { setState: (fn: (s: { changes: unknown[] }) => unknown) => void } }
    const term = <R>(fn: (t: Term, arg: string[]) => R, arg: string[] = []) => page.evaluate(({ src, arg }) => new Function('t', 'arg', `return (${src})(t, arg)`)((window as unknown as { __oneTerm: Term }).__oneTerm, arg), { src: fn.toString(), arg }) as Promise<Awaited<R>>
    await term((t, ids) => t.state.setState((s) => ({ changes: [...s.changes, { id: 'chg-a', n: 1, kind: 'append', status: 'pending', pageId: ids[0], markdown: 'Mara Lind ergänzt.' }, { id: 'chg-b', n: 2, kind: 'append', status: 'pending', pageId: ids[1], markdown: 'Launch plan ergänzt.' }] })), [a, b])
    await term((t) => t.applyStaged(undefined, { quiet: true }))
    const runId = (await term((t) => (t.batchIds() as string[])[0]))!
    const text = (id: string) => wsEval(page, (s, id) => s.pages[id].plain, id)
    expect(await text(a)).toContain('Mara Lind')
    expect(await text(b)).toContain('Launch plan')
    await rec(page, 'markSettled', `terminal:${runId}`, ['chg-a'], 'ej1')
    const undone = await term((t, ids) => t.undoStagedBatch(t.batch(ids[0]), { quiet: true }), [runId])
    expect(undone).toEqual({ kept: ['chg-a'], final: [] })
    expect(await text(a)).toContain('Mara Lind')
    expect(await text(b)).not.toContain('Launch plan')
    await rec(page, 'unmarkSettled', `terminal:${runId}`, ['chg-a'], 'ej1')
  })

  test('scripts (E11): a settled run reads undone, its old Undo writes nothing; unsettle keeps it without an Undo', async ({ page }) => {
    await openApp(page)
    const { dbId, rowId } = await wsEval(page, (s) => {
      const dbId = s.createDatabase({ title: 'Nordlicht Aufgaben', parentId: null, properties: [{ id: 'p_name', name: 'Name', type: 'title' }, { id: 'p_prio', name: 'Priorität', type: 'select', options: [{ id: 'o_high', name: 'Hoch', color: 'red' }, { id: 'o_low', name: 'Niedrig', color: 'gray' }] }] })
      return { dbId, rowId: s.createRow(dbId, { title: 'Launch plan', properties: { p_prio: 'o_low' } }) }
    })
    const id = await wsEval(page, (s, dbId) => {
      const now = Date.now()
      s.upsertScript({ id: 'sc-nordlicht', name: 'Hochstufen', code: `for t in db(@[Nordlicht Aufgaben](p:${dbId})) {\n  t.set(Priorität: "Hoch")\n}\n`, kind: 'script', createdAt: now, updatedAt: now })
      return 'sc-nordlicht'
    }, dbId)
    type Runs = Record<string, (...a: unknown[]) => Promise<unknown>>
    const call = <R>(fn: string, ...args: unknown[]) => page.evaluate(({ fn, args }) => (window as unknown as { __oneScriptRuns: Runs }).__oneScriptRuns[fn](...args), { fn, args }) as Promise<R>
    const prio = () => wsEval(page, (s, id) => s.pages[id].properties.p_prio, rowId)
    const run = await call<{ id: string; undone?: boolean }>('run', id)
    expect(await prio()).toBe('o_high')
    expect(await call('canUndo', id, run.id)).toBe(true)
    expect(await call('settle', id, run.id)).toBe(true)
    const stored = (await call<Array<{ id: string; undone?: boolean; undo: unknown }>>('runs', id)).find((r) => r.id === run.id)!
    expect(stored).toMatchObject({ undone: true, undo: null })
    expect(await call('canUndo', id, run.id)).toBe(false)
    // the toast's Undo closes over the run as it was: refused, nothing written
    expect(await call('undo', run)).toBe(false)
    expect(await prio()).toBe('o_high')
    await call('unsettle', id, run.id)
    expect((await call<Array<{ id: string; undone?: boolean }>>('runs', id)).find((r) => r.id === run.id)!.undone).toBe(false)
    expect(await call('canUndo', id, run.id)).toBe(false)
  })

  test('MCP (E11): a settled call reads undone without its Undo; busy while a call of the session runs; unsettle gives the state back', async ({ page }) => {
    await openApp(page)
    type Mcp = Record<string, (...a: unknown[]) => unknown>
    const call = <R>(fn: string, ...args: unknown[]) => page.evaluate(({ fn, args }) => (window as unknown as { __oneMcp: Mcp }).__oneMcp[fn](...args), { fn, args }) as Promise<R>
    const act = (id: string, session: string, state: string) => ({ id, at: 1, session, tool: 'one_update_row', write: true, target: 'Launch plan', state })
    await call('seedActivity', act('c1:k1', 's1', 'ok'), true)
    await call('seedActivity', act('c2:k2', 's1', 'ok'), true)
    await call('seedActivity', act('c1:k3', 's2', 'ok'), true)
    expect(await call('busy', 's1')).toBe(false)
    expect(await call('settle', 's1', 'c1', 'ej1')).toBe(true)
    const list = () => call<Array<{ id: string; session: string; state: string; undoable: boolean }>>('activity')
    const of = async (id: string, session: string) => (await list()).find((a) => a.id === id && a.session === session)!
    expect(await of('c1:k1', 's1')).toMatchObject({ state: 'undone', undoable: false })
    expect(await of('c2:k2', 's1')).toMatchObject({ state: 'ok', undoable: true })
    expect(await of('c1:k3', 's2')).toMatchObject({ state: 'ok', undoable: true })
    expect(await call('settle', 's1', 'c9', 'ej1')).toBe(false)
    await call('unsettle', 's1', 'c1', 'ej1')
    expect(await of('c1:k1', 's1')).toMatchObject({ state: 'ok', undoable: false })
    expect(await call('undos')).toBe(0)
    await call('seedActivity', act('c3:k4', 's1', 'wait'), false)
    expect(await call('busy', 's1')).toBe(true)
    expect(await call('busy', 's2')).toBe(false)
  })

  test('the UI (German): EJECT · 35 / 37 under its cover, the dialog, ↵ guarded, the eject, toast with Mod+Z, the after-plate, bracket--out on the agent lane and the eject on lane undo; a hand window over it reads "Schon ausgeworfen 08:05"', async ({ page }) => {
    test.setTimeout(180_000)
    const ids = await bootStory(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const DB = story.database.id
    await page.evaluate((id) => (window.location.hash = `#/p/${id}`), DB)
    await page.locator('#main .db-tabs [role="tab"]', { hasText: 'Board' }).click()
    await page.keyboard.press('Control+Alt+z')
    const deck = page.locator('section.deck')
    await page.locator(`.lane[data-lane="${AGENT}"] .flag`).first().click()
    // the key counts from the reading; the cover lies over it, the key beneath is inert
    const key = deck.locator('.eject__key')
    await expect(key.locator('small')).toHaveText('· 35 / 37')
    await expect(key).toHaveAttribute('inert', '')
    const cover = deck.locator('.eject__cover')
    await expect(cover).toHaveAccessibleName('Deckel von Auswerfen öffnen')
    await cover.click()
    await expect(key).toBeFocused()
    await expect(key).not.toHaveAttribute('inert', '')
    // the key opens the dialog; ↵ at once confirms nothing: an Enter in the frame the dialog appears is swallowed (the
    // guard prevents it), one after 300 ms is not (deterministic under any load: no real key reaches the button here)
    await page.evaluate(() => {
      const w = window as unknown as { __guard: boolean[] }
      w.__guard = []
      const mo = new MutationObserver(() => {
        const el = document.querySelector('.modal.rec-eject .rec-ej')
        if (!el) return
        mo.disconnect()
        const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
        el.dispatchEvent(ev)
        w.__guard.push(ev.defaultPrevented)
      })
      mo.observe(document.body, { childList: true, subtree: true })
    })
    await page.keyboard.press('Enter')
    const dialog = page.locator('.modal.rec-eject')
    await expect(dialog).toBeVisible()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __guard: boolean[] }).__guard)).toEqual([true])
    await expect(dialog.locator('.rec-title')).toHaveText('52 Vorgänge von Agent · Nordlicht-Spiegel auswerfen?')
    await expect(dialog.locator('.plan__n')).toHaveText(['01', '02', '03', '04', '05'])
    await expect(dialog.locator('.plan__label')).toHaveText([/^Schema/, /^Seite/, /^Zeilen/, /^Neue Zeilen/, /^Gehalten/])
    await expect(dialog.locator('.plan__act')).toHaveText(['zurück', 'zurück', 'zurück', 'Papierkorb', 'bleibt'])
    await expect(dialog.locator('.pi--held')).toHaveCount(2)
    expect(await rec<unknown[]>(page, 'ejects')).toEqual([])
    const confirm = dialog.locator('.btn--eject')
    await expect(confirm).toHaveText(/^35 Stellen zurücknehmen\s*↵$/)
    await page.waitForTimeout(350)
    const late = await dialog.locator('.rec-ej').evaluate((el) => {
      const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      el.dispatchEvent(ev)
      return ev.defaultPrevented
    })
    expect(late).toBe(false)
    await confirm.click()
    await expect(dialog).toHaveCount(0)
    // the toast: glyph, "35 Stellen von … zurück · 2 gehalten", Undo with its keycap, "Gehaltene zeigen"
    const toast = page.locator('.toast[data-glyph="eject"]')
    await expect(toast.locator('.toast__msg')).toContainText('35 Stellen von Agent · Nordlicht-Spiegel zurück')
    await expect(toast.locator('.toast__s')).toContainText('2 gehalten')
    await expect(toast.locator('.toast__kbd')).toHaveText('Ctrl+Z')
    await expect(toast.getByRole('button', { name: 'Gehaltene zeigen' })).toBeVisible()
    // the after-plate (focus on its Undo key), the hatched bracket, the eject's write on lane undo
    const out = deck.locator('.win--out')
    await expect(out.locator('.win__t--out')).toHaveText('Ausgeworfen 08:05')
    await expect(out.locator('.outlist li').first()).toContainText('35 von 37 zurückgenommen')
    await expect(out.locator('.outlist__held')).toContainText('NL-1408 (du) · NL-1415 (du)')
    await expect(out.locator('.outlist__version')).toContainText('„Vor dem Auswurf“')
    await expect(out.locator('.dbtn--undo')).toBeFocused()
    await expect(deck.locator(`.lane[data-lane="${AGENT}"] .bracket--out`)).toHaveCount(1)
    await expect(deck.locator('.trk[data-lane="undo"] .trk__c')).not.toHaveText('00')
    // board marks: "Ready" back as a column, the held cards tagged
    await expect(page.locator('#main .back-tag')).toHaveCount(1)
    await expect(page.locator(`#main [data-held]:not(i)`)).toHaveCount(2)
    const counts = () => wsEval(page, (s, db) => Object.values(s.pages).filter((p: { databaseId?: string; trashed?: boolean }) => p.databaseId === db && !p.trashed).length, DB)
    const ejected = await counts()
    // Mod+Z belongs to a field with focus in it, and Mod+Shift+Z is redo: neither undoes the eject
    await page.evaluate(() => {
      const i = document.createElement('input')
      i.id = 'rec-probe'
      document.body.append(i)
      i.focus()
    })
    await page.keyboard.press('Control+z')
    await page.evaluate(() => document.getElementById('rec-probe')?.remove())
    await out.locator('.dbtn--undo').focus()
    await page.keyboard.press('Control+Shift+z')
    await page.waitForTimeout(300)
    expect(await counts()).toBe(ejected)
    await expect(toast).toHaveCount(1)
    // Mod+Z while the toast shows: the Undo
    await page.keyboard.press('Control+z')
    await expect(page.locator('.toast', { hasText: 'Auswurf zurückgenommen' })).toBeVisible()
    await expect.poll(counts).toBe(ejected + story.expect.eject.trash.length)
    await expect(out).toHaveCount(0)
    expect((await rec<Array<{ undone?: number }>>(page, 'ejects'))[0].undone).toBeGreaterThan(0)

    // eject again through the seam, then a hand window over the same stretch of the agent's track
    const again = await rec<{ id: string; state: string }>(page, 'eject', window212())
    expect(again.state).toBe('done')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(deck).toHaveCount(0)
    await page.keyboard.press('Control+Alt+z')
    const lane = deck.locator(`.lane[data-lane="${AGENT}"]`)
    await lane.focus()
    for (let i = 0; i < 36; i++) await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('[')
    for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight')
    await page.keyboard.press(']')
    await expect(deck.locator('.eject__off')).toHaveText('Schon ausgeworfen 08:05')
    await expect(deck.locator('.eject__key')).toBeDisabled()
    await expect(deck.locator('.eject__cover')).toHaveCount(0)
    expect(ids['NL-1408']).toBeTruthy()
    expect(await rec(page, 'unknowns')).toEqual([])
  })

  test('re-plan (Δ26): a row of the plan changed while the dialog is open → nothing written, the new plan shown, the second confirm writes; refusals: an eject: run (C34), the Undo after a workspace switch (C24)', async ({ page }) => {
    test.setTimeout(180_000)
    const ids = await bootStory(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await page.keyboard.press('Control+Alt+z')
    const deck = page.locator('section.deck')
    await page.locator(`.lane[data-lane="${AGENT}"] .flag`).first().click()
    await expect(deck.locator('.eject__key small')).toHaveText('· 35 / 37')
    await deck.locator('.eject__cover').click()
    await deck.locator('.eject__key').click()
    const dialog = page.locator('.modal.rec-eject')
    const confirm = dialog.locator('.btn--eject')
    await expect(confirm).toHaveText(/^35 Stellen zurücknehmen/)
    // the person changes NL-1402 while the dialog is open
    await rec(page, 'step', { writer: { kind: 'you', via: 'ui' }, calls: [['updatePage', ids['NL-1402'], { title: 'NL-1402 (geprüft)' }]] })
    await rec(page, 'flush')
    await confirm.click()
    await expect(dialog.locator('[data-replanned]')).toHaveText('Seit dem Öffnen hat sich etwas geändert — der Plan ist neu gerechnet. Bitte noch einmal bestätigen.')
    await expect(confirm).toHaveText(/^34 Stellen zurücknehmen/)
    // nothing was written: the row keeps its title, no eject is done
    expect(await wsEval(page, (s, id) => s.pages[id].title, ids['NL-1402'])).toBe('NL-1402 (geprüft)')
    expect((await rec<Array<{ state: string }>>(page, 'ejects')).filter((e) => e.state === 'done')).toEqual([])
    await expect(dialog.locator('.pi--held')).toHaveCount(3)
    await confirm.click()
    await expect(dialog).toHaveCount(0)
    const done = (await rec<Array<{ id: string; state: string; counts: { back: number } }>>(page, 'ejects')).filter((e) => e.state === 'done')
    expect(done.map((e) => e.counts.back)).toEqual([34])
    expect(await wsEval(page, (s, id) => s.pages[id].title, ids['NL-1402'])).toBe('NL-1402 (geprüft)')
    // an eject is never ejected: its own run is refused, before any plan
    const raw = await rec<{ refused?: { key: string } }>(page, 'ejectRaw', { lane: 'undo', run: `eject:${done[0].id}`, a: storyTime(story, story.now) - 60_000, b: storyTime(story, story.now) + 600_000 })
    expect(raw.refused?.key).toBe('ejectRun')
    // another workspace loaded in this tab (a new epoch): the Undo refuses, nothing written
    await page.evaluate(() => {
      const w = (window as unknown as { __one: { workspace: { getState: () => Record<string, unknown> & { hydrate: (ws: unknown) => void } } } }).__one.workspace
      const s = w.getState()
      const ws: Record<string, unknown> = {}
      for (const k of ['version', 'name', 'pages', 'databases', 'people', 'settings', 'recent', 'functions', 'agents', 'scripts', 'kit', 'integrations']) if (k in s) ws[k] = s[k]
      s.hydrate({ ...ws, epoch: 'e2e-another-workspace' })
    })
    const u = await rec<{ refused?: { key: string } }>(page, 'undoEject', done[0].id)
    expect(u.refused?.key).toBe('workspaceChanged')
    expect(await rec(page, 'unknowns')).toEqual([])
  })

  test('triggers (C16, C22): an automation and a row-triggered agent fire on a plain write — never on an eject, its Undo, or its Undo after a reload', async ({ page, context }) => {
    test.setTimeout(240_000)
    const T0 = storyTime(story, '07:00:00')
    await page.clock.install({ time: T0 })
    let claude = 0
    await context.route('https://api.anthropic.com/**', async (route) => {
      const req = route.request()
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      if (req.method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [], has_more: false }) })
      claude++
      await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sseMessage([{ type: 'text', text: 'Tessera geprüft. Nichts zu tun.' }]) }).catch(() => undefined)
    })
    await openApp(page)
    await startRecorder(page)
    await setKey(page)
    const f = await wsEval(page, () => {
      const s = (window as unknown as { __one: { workspace: { getState: () => Record<string, (...a: unknown[]) => unknown> } } }).__one.workspace.getState()
      const db = s.createDatabase({ title: 'Tessera Aufgaben' }) as string
      const stage = s.addProperty(db, { type: 'select', name: 'Stufe', options: [{ id: 'o-offen', name: 'Offen', color: 'gray' }, { id: 'o-fertig', name: 'Fertig', color: 'green' }] }) as string
      s.updateDatabase(db, { automations: [{ id: 'au-tessera', name: 'Stufe gemeldet', enabled: true, trigger: { type: 'property_changed', propertyId: stage }, actions: [{ type: 'notify', message: 'Stufe geändert' }] }] })
      const r1 = s.createRow(db, { title: 'Tessera Karte', properties: { [stage]: 'o-offen' } }) as string
      const r2 = s.createRow(db, { title: 'Tessera Abgleich', properties: { [stage]: 'o-offen' } }) as string
      const now = Date.now()
      s.upsertAgent({ id: 'ag-tessera', name: 'Tessera Wächter', instructions: 'Sieh dir die geänderte Zeile an und berichte.', trigger: { type: 'row_changed', databaseId: db, propertyId: stage }, scope: { everything: true, pages: [], databases: [] }, write: 'none', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdAt: now, updatedAt: now })
      return { db, stage, r1, r2 }
    })
    await flush(page)
    const autoRuns = () => wsEval(page, (s, db) => s.databases[db].automations?.[0]?.lastRunAt ?? null, f.db)
    const agentRuns = async () => (await page.evaluate(async () => (await (window as unknown as { __oneAgents: { loadRuns: (id: string) => Promise<unknown[]> } }).__oneAgents.loadRuns('ag-tessera')) ?? [])).length
    const setStage = (row: string, opt: string) => wsEval(page, (s, a) => s.setRowProperty(a.row, a.stage, a.opt), { row, stage: f.stage, opt })
    // past the agent's one-minute gap and the automation's coalescing
    const pass = async () => {
      await page.clock.fastForward(65_000)
      await page.waitForTimeout(400)
      await page.clock.fastForward(5_000)
      await page.waitForTimeout(400)
    }

    // positive control: a plain write fires both
    await page.clock.fastForward(60_000)
    await setStage(f.r1, 'o-fertig')
    await pass()
    await expect.poll(autoRuns).not.toBeNull()
    await expect.poll(agentRuns, { timeout: 20_000 }).toBe(1)
    // the window to eject: the person's change of the second row (it fires both too)
    await pass()
    const a = await page.evaluate(() => Date.now())
    await setStage(f.r2, 'o-fertig')
    await pass()
    await expect.poll(agentRuns, { timeout: 20_000 }).toBe(2)
    await pass()
    const b = await page.evaluate(() => Date.now())
    await rec(page, 'settle')
    const auto0 = await autoRuns()
    const claude0 = claude

    // the eject: the row goes back, nothing fires
    const r = await rec<{ id: string; state: string; counts: { back: number } }>(page, 'eject', { lane: 'you', a, b })
    expect(r.state).toBe('done')
    expect(r.counts.back).toBe(1)
    expect(await wsEval(page, (s, a) => s.pages[a.r2].properties[a.stage], f)).toBe('o-offen')
    await pass()
    await pass()
    expect(await autoRuns()).toBe(auto0)
    expect(await agentRuns()).toBe(2)
    // its Undo (the toast's way): the row forward again, nothing fires
    expect(await rec(page, 'undoEject', r.id)).toMatchObject({ ok: true })
    expect(await wsEval(page, (s, a) => s.pages[a.r2].properties[a.stage], f)).toBe('o-fertig')
    await pass()
    await pass()
    expect(await autoRuns()).toBe(auto0)
    expect(await agentRuns()).toBe(2)
    // eject again, reload, the Undo through the planner: nothing fires either
    const r2 = await rec<{ id: string; state: string }>(page, 'eject', { lane: 'you', a, b })
    expect(r2.state).toBe('done')
    await pass()
    await flush(page)
    await reloadApp(page)
    await startRecorder(page)
    expect(await rec(page, 'undoEject', r2.id)).toMatchObject({ ok: true })
    expect(await wsEval(page, (s, a) => s.pages[a.r2].properties[a.stage], f)).toBe('o-fertig')
    await pass()
    await pass()
    expect(await autoRuns()).toBe(auto0)
    expect(await agentRuns()).toBe(2)
    expect(claude).toBe(claude0)
    expect(await rec(page, 'unknowns')).toEqual([])
  })

  test('390: no cover, the key opens a bottom sheet; a place on the second sheet has no eject key ("‹ Plan" back); one 42 px primary key; the after-plate\'s Undo', async ({ page }) => {
    test.setTimeout(150_000)
    await page.setViewportSize({ width: 390, height: 844 })
    await bootStory(page)
    await page.keyboard.press('Control+Alt+z')
    const deck = page.locator('section.deck')
    await page.locator(`.lane[data-lane="${AGENT}"] .flag`).first().click()
    await expect(deck.locator('.eject__cover')).toHaveCount(0)
    const key = deck.locator('.eject__key')
    await expect(key.locator('small')).toHaveText('· 35 / 37')
    await key.click()
    const dialog = page.locator('.modal.rec-eject:not(.rec-sheet2)')
    await expect(dialog.locator('.plan .pi').first()).toBeVisible()
    await page.waitForTimeout(500)
    const box = (await dialog.boundingBox())!
    expect(Math.round(box.width)).toBe(390)
    expect(Math.round(box.y + box.height)).toBe(844)
    await expect(dialog.locator('.rec-prev')).toHaveCount(0)
    const primary = dialog.locator('.btn--primary')
    await expect(primary).toHaveCount(1)
    expect(Math.round((await primary.boundingBox())!.height)).toBeGreaterThanOrEqual(42)
    await dialog.locator('.pi', { hasText: 'NL-1408' }).first().click()
    const sheet = page.locator('.modal.rec-sheet2')
    await expect(sheet).toBeVisible()
    await expect(sheet.locator('.prev__h')).toHaveText('NL-1408')
    await expect(sheet.locator('.btn--eject')).toHaveCount(0)
    await page.waitForTimeout(500)
    await sheet.locator('.rec-bar__back').click()
    await expect(sheet).toHaveCount(0)
    await page.waitForTimeout(400)
    await primary.click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.toast[data-glyph="eject"]')).toBeVisible()
    // the after-plate's wide Undo key takes it back
    const undo = deck.locator('.win--out .dbtn--undo')
    await expect(undo).toBeVisible()
    await undo.click()
    await expect(page.locator('.toast', { hasText: /Eject undone|Auswurf zurückgenommen/ })).toBeVisible()
    expect((await rec<Array<{ undone?: number }>>(page, 'ejects'))[0].undone).toBeGreaterThan(0)
  })

  test('the plan of 37 places < 300 ms, the eject\'s store update and its Undo < 16 ms (performance marks; the story at real time: a page clock hides marks)', async ({ page }) => {
    test.setTimeout(150_000)
    const realTime = new Proxy(page, { get: (p, k) => (k === 'clock' ? { setFixedTime: async () => undefined } : typeof (p as never)[k] === 'function' ? ((p as never)[k] as (...a: unknown[]) => unknown).bind(p) : (p as never)[k]) })
    await openApp(page)
    await startRecorder(page)
    await flush(page)
    await rec(page, 'wipe')
    await playStory(realTime, story)
    const now = await page.evaluate(() => Date.now())
    const sel = { lane: AGENT, run: RUN, a: now - 3600_000, b: now + 60_000 }
    // twice: the first read warms the digest key and the pin store
    for (let i = 0; i < 2; i++) expect((await rec<{ counts: { all: number } }>(page, 'planEject', sel)).counts.all).toBe(story.expect.eject.all)
    const ms = await page.evaluate(() => performance.getEntriesByName('rec-plan').map((e) => e.duration))
    expect(ms.length).toBe(2)
    expect(Math.min(...ms)).toBeLessThan(300)
    // the eject's ONE store update and its Undo's, each < 16 ms (the store's own subscribers included)
    const r = await rec<{ id: string; state: string }>(page, 'eject', sel)
    expect(r.state).toBe('done')
    expect(await rec(page, 'undoEject', r.id)).toMatchObject({ ok: true })
    const [write] = await page.evaluate(() => performance.getEntriesByName('rec-eject').map((e) => e.duration))
    const [undo] = await page.evaluate(() => performance.getEntriesByName('rec-eject-undo').map((e) => e.duration))
    console.log(`[recorder] eject store update ${write.toFixed(1)} ms · undo ${undo.toFixed(1)} ms`)
    expect(write).toBeLessThan(16)
    expect(undo).toBeLessThan(16)
  })
})
