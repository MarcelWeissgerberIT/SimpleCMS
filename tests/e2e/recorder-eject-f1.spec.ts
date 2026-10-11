/**
 * Flight recorder — the eject's hard cases in the app (R3, design F1 / F7 / C3): real store actions under seam
 * writers, then the planner and the commit through `__oneRecorder`. The person's fix between two appends of a writer
 * stays while both appends go; a place without its earlier state (a dropped pin) reads partial and is never written; a
 * locked database keeps its schema while its rows go back; a commit held before its settle while another tab boots —
 * the other tab leaves it alone, and finishes it only once the first tab is gone. Test data is fictional (Nordlicht,
 * Tessera, the story: tests/e2e/fixtures/recorder-story.json).
 */
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect, openApp, flush, wsEval } from './fixtures'
import { playStory, rec, startRecorder, storyTime, type Story } from './helpers/recorder'

const story = JSON.parse(readFileSync(new URL('./fixtures/recorder-story.json', import.meta.url), 'utf8')) as Story
const AGENT = `agent:${story.agent.id}`
const RUN = story.expect.run212.key
const window212 = () => ({ lane: AGENT, run: RUN, a: storyTime(story, story.bracket[0]), b: storyTime(story, story.bracket[1]) })

async function bootStory(page: Page): Promise<Record<string, string>> {
  await page.clock.install({ time: storyTime(story, story.setupAt) })
  await openApp(page)
  await startRecorder(page)
  await flush(page)
  await rec(page, 'wipe')
  return playStory(page, story)
}

interface Planned {
  counts: Record<string, number>
  places: Array<{ p: string; pk: string; outcome: string; reason: string | null; back: string[] }>
}

const para = (id: string, text: string) => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] })

test.describe('flight recorder — the eject, hard cases', () => {
  test('F1 page: the writer appends at 07:31 and 07:34, the person fixes the first block at 07:32 — both appends go, the fix stays', async ({ page }) => {
    test.setTimeout(120_000)
    await page.clock.install({ time: storyTime(story, '07:00:00') })
    await openApp(page)
    await startRecorder(page)
    const you = { kind: 'you', via: 'ui' }
    const agent = (change: string) => ({ kind: 'agent', id: 'tessera-helfer', run: 'r7', change })
    const step = async (time: string, writer: Record<string, unknown>, calls: unknown[][], extra: Record<string, unknown> = {}) => {
      await page.clock.setFixedTime(storyTime(story, time))
      return rec<unknown[]>(page, 'step', { writer, calls, ...extra })
    }
    const [plan] = (await step('07:00:00', you, [['createPage', { title: 'Launch plan', content: { type: 'doc', content: [para('b1', 'Ziel: Nordlicht im Oktober'), para('b2', 'Termine stehen')] } }]])) as string[]
    await step('07:31:00', agent('c1'), [['setContent', plan, { type: 'doc', content: [para('b1', 'Ziel: Nordlicht im Oktober'), para('b2', 'Termine stehen'), para('a1', 'Tessera prüft die Zahlen')] }, 'ai']], { note: { seq: 7 } })
    await step('07:32:00', you, [['setContent', plan, { type: 'doc', content: [para('b1', 'Ziel: Nordlicht Mitte Oktober'), para('b2', 'Termine stehen'), para('a1', 'Tessera prüft die Zahlen')] }, 'ui']])
    await step('07:34:00', agent('c2'), [['setContent', plan, { type: 'doc', content: [para('b1', 'Ziel: Nordlicht Mitte Oktober'), para('b2', 'Termine stehen'), para('a1', 'Tessera prüft die Zahlen'), para('a2', 'Mara Lind übernimmt die Abnahme')] }, 'ai']], { end: true })
    await page.clock.setFixedTime(storyTime(story, '07:40:00'))
    await rec(page, 'settle')
    const sel = { lane: 'agent:tessera-helfer', run: 'agent:tessera-helfer:r7', a: storyTime(story, '07:30:00'), b: storyTime(story, '07:35:00') }
    const r = await rec<Planned>(page, 'planEject', sel)
    expect(r.counts).toMatchObject({ all: 1, back: 1 })
    const e = await rec<{ state: string }>(page, 'eject', sel)
    expect(e.state).toBe('done')
    const blocks = await wsEval(page, (s, id) => s.pages[id].content.content.map((b: { attrs: { id: string }; content: Array<{ text: string }> }) => `${b.attrs.id}:${b.content[0].text}`), plan)
    expect(blocks).toEqual(['b1:Ziel: Nordlicht Mitte Oktober', 'b2:Termine stehen'])
    expect(await rec(page, 'unknowns')).toEqual([])
  })

  test('a place without its earlier state (the pin dropped) reads partial and is not written; the rest goes back', async ({ page }) => {
    test.setTimeout(150_000)
    const ids = await bootStory(page)
    const row = `p:${ids['NL-1402']}`
    const seg = (await rec<Array<{ id: string; p: string; w: string }>>(page, 'segments')).find((g) => g.p === row && g.w.startsWith(AGENT))!
    expect(seg).toBeTruthy()
    await rec(page, 'dropPin', seg.id)
    const r = await rec<Planned>(page, 'planEject', window212())
    expect(r.places.find((x) => x.p === row)).toMatchObject({ outcome: 'partial' })
    expect(r.counts).toMatchObject({ back: story.expect.eject.back - 1, partial: 1 })
    const before = await wsEval(page, (s, id) => s.pages[id].properties['story-stage'], ids['NL-1402'])
    const e = await rec<{ state: string }>(page, 'eject', window212())
    expect(e.state).toBe('done')
    expect(await wsEval(page, (s, id) => s.pages[id].properties['story-stage'], ids['NL-1402'])).toBe(before)
    // another row of the run went back
    const r2 = await rec<Planned>(page, 'planEject', window212())
    expect(r2.counts.back).toBe(0)
  })

  test('a locked database: its schema stays (held, locked), its rows go back', async ({ page }) => {
    test.setTimeout(150_000)
    const ids = await bootStory(page)
    await rec(page, 'step', { writer: { kind: 'you', via: 'ui' }, calls: [['updateDatabase', story.database.id, { locked: true }]] })
    await rec(page, 'settle')
    const r = await rec<Planned>(page, 'planEject', window212())
    const schema = r.places.find((x) => x.pk === 'schema')!
    expect(schema.outcome).toBe('held')
    expect(['locked', 'changed']).toContain(schema.reason)
    expect(r.places.find((x) => x.p === `p:${ids['NL-1402']}`)?.outcome).toBe('back')
    const e = await rec<{ state: string }>(page, 'eject', window212())
    expect(e.state).toBe('done')
    // "Ready" stays out of the locked schema; NL-1402's Stage cannot take an option the database no longer has: it is
    // not restored (the row's other parts would go back), never written as a dangling value
    const opts = await wsEval(page, (s, db) => s.databases[db].properties.find((p: { id: string }) => p.id === 'story-stage').options.map((o: { id: string }) => o.id), story.database.id)
    expect(opts).not.toContain(story.expect.eject.optionBack.id)
    expect(await wsEval(page, (s, db) => s.databases[db].locked, story.database.id)).toBe(true)
    expect(await wsEval(page, (s, id) => s.pages[id].properties['story-stage'], ids['NL-1402'])).not.toBe(story.expect.eject.optionBack.id)
  })

  test('schema through MCP: an option removed (one_update_property) and a view deleted (one_delete_view) come back when their calls are ejected', async ({ page }) => {
    test.setTimeout(120_000)
    await page.clock.install({ time: storyTime(story, '07:00:00') })
    await openApp(page)
    await startRecorder(page)
    const you = { kind: 'you', via: 'ui' }
    const f = await wsEval(page, () => {
      const s = (window as unknown as { __one: { workspace: { getState: () => Record<string, (...a: unknown[]) => unknown> & { databases: Record<string, { views: Array<{ id: string; name: string }> }> } } } }).__one.workspace.getState()
      const db = s.createDatabase({ title: 'Tessera Abgleich' }) as string
      const stage = s.addProperty(db, { type: 'select', name: 'Stufe', options: [{ id: 'o-offen', name: 'Offen', color: 'gray' }, { id: 'o-ready', name: 'Ready', color: 'blue' }, { id: 'o-fertig', name: 'Fertig', color: 'green' }] }) as string
      s.addView(db, { type: 'board', name: 'Tafel', groupBy: stage })
      const views = (window as unknown as { __one: { workspace: { getState: () => { databases: Record<string, { views: Array<{ id: string; name: string }> }> } } } }).__one.workspace.getState().databases[db].views
      return { db, stage, view: views.find((v) => v.name === 'Tafel')!.id, views: views.map((v) => v.id) }
    })
    expect(f.view).toBeTruthy()
    void you
    await rec(page, 'settle')
    const mcp = (call: string, tool: string) => ({ kind: 'mcp', session: 'tessera-s9', call, tool })
    await page.clock.setFixedTime(storyTime(story, '07:31:00'))
    const opts = await wsEval(page, (s, a) => s.databases[a.db].properties.find((p: { id: string }) => p.id === a.stage).options.filter((o: { id: string }) => o.id !== 'o-ready'), f)
    await rec(page, 'step', { writer: mcp('m1', 'one_update_property'), calls: [['updateProperty', f.db, f.stage, { options: opts }]], note: { tool: 'one_update_property', client: 'tessera-desk' }, end: true })
    await page.clock.setFixedTime(storyTime(story, '07:32:00'))
    await rec(page, 'step', { writer: mcp('m2', 'one_delete_view'), calls: [['deleteView', f.db, f.view]], note: { tool: 'one_delete_view', client: 'tessera-desk' }, end: true })
    await page.clock.setFixedTime(storyTime(story, '07:40:00'))
    await rec(page, 'settle')
    const optionIds = () => wsEval(page, (s, a) => s.databases[a.db].properties.find((p: { id: string }) => p.id === a.stage).options.map((o: { id: string }) => o.id), f)
    const viewIds = () => wsEval(page, (s, db) => s.databases[db].views.map((v: { id: string }) => v.id), f.db)
    expect(await optionIds()).toEqual(['o-offen', 'o-fertig'])
    expect(await viewIds()).not.toContain(f.view)
    const runs = (await rec<Array<{ key: string; l: string; from: number; to: number }>>(page, 'runs')).filter((r) => r.key.startsWith('mcp:'))
    expect(runs).toHaveLength(2)
    // eject the view's deletion first, then the option's removal: each comes back at its place
    for (const r of [...runs].sort((a, b) => b.from - a.from)) {
      const e = await rec<{ state: string; counts: { back: number } }>(page, 'eject', { lane: r.l, run: r.key, a: r.from - 1000, b: r.to + 1000 })
      expect(e, r.key).toMatchObject({ state: 'done' })
      expect(e.counts.back).toBeGreaterThan(0)
    }
    expect(await viewIds()).toEqual(f.views)
    expect(await optionIds()).toEqual(['o-offen', 'o-ready', 'o-fertig'])
    expect(await rec(page, 'unknowns')).toEqual([])
  })

  test('MCP tidy: the story\'s three one_trash calls and the one_move_page are ejected — the pages come out of the trash, the moved page goes back', async ({ page }) => {
    test.setTimeout(150_000)
    await bootStory(page)
    const runs = (await rec<Array<{ key: string; l: string; from: number; to: number }>>(page, 'runs')).filter((r) => r.key.startsWith('mcp:tessera-s1:'))
    expect(runs.length).toBe(4)
    const lane = runs[0].l
    const parentBefore = await wsEval(page, (s) => s.pages['story-term-2'].parentId)
    expect(await wsEval(page, (s) => ['story-old-1', 'story-old-2', 'story-old-3'].map((id) => !!s.pages[id].trashed))).toEqual([true, true, true])
    const sel = { lane, a: Math.min(...runs.map((r) => r.from)) - 1000, b: Math.max(...runs.map((r) => r.to)) + 1000 }
    const e = await rec<{ state: string; counts: { back: number } }>(page, 'eject', sel)
    expect(e).toMatchObject({ state: 'done', counts: { back: 4 } })
    expect(await wsEval(page, (s) => ['story-old-1', 'story-old-2', 'story-old-3'].map((id) => !!s.pages[id].trashed))).toEqual([false, false, false])
    expect(await wsEval(page, (s) => s.pages['story-term-2'].parentId)).not.toBe(parentBefore)
    expect(await rec(page, 'unknowns')).toEqual([])
  })

  test('F7: a follow-up stamp (the attribution keeper) on an ejected row between the eject and its Undo does not block the Undo', async ({ page }) => {
    test.setTimeout(150_000)
    const ids = await bootStory(page)
    const r = await rec<{ id: string; state: string }>(page, 'eject', window212())
    expect(r.state).toBe('done')
    await rec(page, 'step', { writer: { kind: 'system', why: 'stamp' }, calls: [['updatePage', ids['NL-1402'], { updatedBy: 'agent:nordlicht-spiegel' }]] })
    await rec(page, 'settle')
    expect(await rec(page, 'undoEject', r.id)).toMatchObject({ ok: true, back: story.expect.eject.back, kept: 0 })
    expect(await rec(page, 'unknowns')).toEqual([])
  })

  test('crash race (C3): a commit held before its settle — a second tab booting leaves it committing; released → done; with the first tab closed, the second tab\'s next boot finishes it', async ({ page, context }) => {
    test.setTimeout(240_000)
    await bootStory(page)
    const state = async (p: Page, id: string) => (await rec<Array<{ id: string; state: string }>>(p, 'ejects')).find((x) => x.id === id)?.state
    const startHeld = async (p: Page) => {
      await p.evaluate(() => {
        const r = (window as unknown as { __oneRecorder: { ejectHook: string | null } }).__oneRecorder
        r.ejectHook = 'beforeSettle'
      })
      await p.evaluate((sel) => {
        const w = window as unknown as { __oneRecorder: { eject: (s: unknown) => Promise<unknown> }; __ejectRun?: Promise<unknown> }
        w.__ejectRun = w.__oneRecorder.eject(sel)
      }, window212())
      await expect.poll(() => p.evaluate(() => (window as unknown as { __oneRecorder: { ejectWaiting: () => boolean } }).__oneRecorder.ejectWaiting()), { timeout: 30_000 }).toBe(true)
      const recs = await rec<Array<{ id: string; state: string }>>(p, 'ejects')
      return recs.find((x) => x.state === 'committing')!.id
    }
    // 1: tab A holds the commit; tab B boots and finishes nothing of A's
    const id1 = await startHeld(page)
    await flush(page)
    const b = await context.newPage()
    await b.clock.install({ time: storyTime(story, story.now) })
    await openApp(b)
    await startRecorder(b)
    await rec(b, 'recovered')
    await rec(b, 'finishEjects')
    expect(await state(b, id1)).toBe('committing')
    await page.evaluate(() => (window as unknown as { __oneRecorder: { releaseEject: () => void } }).__oneRecorder.releaseEject())
    await page.evaluate(() => (window as unknown as { __ejectRun?: Promise<unknown> }).__ejectRun)
    await expect.poll(() => state(page, id1)).toBe('done')
    // 2: undone, then held again — and tab A closes while it waits: B's next boot finishes it
    await page.evaluate(() => ((window as unknown as { __oneRecorder: { ejectHook: string | null } }).__oneRecorder.ejectHook = null))
    expect(await rec(page, 'undoEject', id1)).toMatchObject({ ok: true })
    const id2 = await startHeld(page)
    await flush(page)
    await page.close()
    await b.reload()
    await b.waitForFunction(() => !!(window as unknown as { __oneRecorder?: unknown }).__oneRecorder)
    await startRecorder(b)
    await rec(b, 'recovered')
    await expect.poll(() => state(b, id2), { timeout: 30_000 }).toBe('done')
    const run = await b.evaluate(async (a) => ((await (window as unknown as { __oneAgents: { loadRuns: (id: string) => Promise<Array<{ id: string; staged: Array<Record<string, unknown>> }>> } }).__oneAgents.loadRuns(a)) ?? []).find((x) => x.id === 'r212'), story.agent.id)
    expect(run!.staged.filter((c) => c.status === 'discarded' && c.ejected).length).toBe(story.expect.eject.agent.ejected)
  })
})
