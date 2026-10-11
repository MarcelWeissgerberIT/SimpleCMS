/**
 * Flight recorder — the eject (R3). The planner on the story's run 212 (tests/e2e/fixtures/recorder-story.json):
 * what goes back, what is held and why, new rows to the trash, the option the run removed coming back — read through
 * the seam (`__oneRecorder.planEject`, counts and outcomes only). Test data is fictional (Nordlicht, Tessera).
 */
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect, openApp, flush, wsEval, MOD } from './fixtures'
import { playStory, rec, startRecorder, storyTime, type Story } from './helpers/recorder'
import { setKey } from './helpers/terminal'

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

  test('the plan of 37 places < 300 ms (performance mark; the story at real time: a page clock hides marks)', async ({ page }) => {
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
  })
})
