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
