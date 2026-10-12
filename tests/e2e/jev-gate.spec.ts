/**
 * The Schreibschranke (slice SJ, J8): an apply-mode agent run with a Vorprüfer writes the same as without it — or nothing.
 * When Jev holds back any change, or does not answer, the WHOLE run waits (owner decision 1): no change of it is written
 * directly, every one becomes a card, the run and its report say why. Today's per-change holds (a task naming a person,
 * an edit, a send) stay as they are — Jev only ever makes it stricter. A later run of the same agent stays cautious while an
 * earlier change Jev flagged is open (sticky, DJ20). Every "nothing" has its positive control. Mocked hosts only; the
 * people and rows are fictional.
 */
import type { Page } from '@playwright/test'
import { test, expect, wsEval } from './fixtures'
import { jevAnswer, type DecideStep } from './helpers/providers'
import { AGENT, ALL_SHARED, TITLES, byTarget, byTitle, cards, jevAgent, jevSetup, noteOf, review, runAgent, runOf, stageTurn, toolId, type AnyState, type JevWorld } from './helpers/jev'

const written = async (page: Page, w: JevWorld) => Promise.all(TITLES.map((t) => noteOf(page, w, t)))
const NONE = [null, null, null]
const ALL = ['Checked 1', 'Checked 2', 'Checked 3']
const labels = (run: AnyState) => (run.steps as AnyState[]).map((s) => s.label as string)

test.describe('the Schreibschranke: the whole run writes, or waits (J8)', () => {
  test('control: every check at or above 0,90 → the run writes everything, as without Jev', async ({ page }) => {
    const w = await jevSetup(page)
    await jevAgent(page, { write: 'apply', hold: false, gate: 0.9 })
    const run = await runOf(page, await runAgent(page))
    expect(run.status).toBe('ok')
    expect(run.applied).toBe(3)
    expect(await written(page, w)).toEqual(ALL)
    expect(run.jev.waited).toBeUndefined()
  })

  test('one change at 0,85 → NOTHING is written: every change a card, the run says why, the report’s first line too', async ({ page }) => {
    const w = await jevSetup(page, { fallback: byTarget({ 'Launch plan': jevAnswer({ clean: 0.85 }) }) })
    const report = await wsEval(page, (s) => s.createPage({ title: 'Nordlicht report' }) as string)
    await jevAgent(page, { write: 'apply', hold: false, gate: 0.9, output: report })
    const id = await runAgent(page)
    const run = await runOf(page, id)
    expect(await written(page, w)).toEqual(NONE)
    expect(run.status).toBe('staged')
    expect(run.applied ?? 0).toBe(0)
    expect((run.staged as AnyState[]).map((c) => c.status)).toEqual(['pending', 'pending', 'pending'])
    expect(run.jev).toMatchObject({ waited: 'gate', checked: 3, marked: 0 })
    const wait = (run.steps as AnyState[]).find((s) => s.jev === 'wait')
    expect(wait).toMatchObject({ label: 'Jev stopped the run — 3 changes wait for you (below the write gate or not pre-checked)', state: 'err' })
    // the report is still written — with One's fixed first line under its heading
    const content = await wsEval(page, (s, id) => s.pages[id].content, report)
    const blocks = content.content as AnyState[]
    const head = blocks.findIndex((b) => b.type === 'heading')
    expect(blocks[head + 1]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'Jev stopped 3 changes — they wait for you.' }] })
    expect(labels(run)).toContain('Report written to the report page.')
    // the cards are there to decide
    await expect.poll(async () => (await cards(page)).filter((c) => c.startsWith(`run:${id}#`)).length).toBe(3)
  })

  test('control: the same answers without the Schranke → written as today', async ({ page }) => {
    const w = await jevSetup(page, { fallback: byTarget({ 'Launch plan': jevAnswer({ clean: 0.85 }) }) })
    await jevAgent(page, { write: 'apply', hold: false, gate: null })
    const run = await runOf(page, await runAgent(page))
    expect(run.status).toBe('ok')
    expect(await written(page, w)).toEqual(ALL)
  })

  // every failure row of § 3.5: unchecked → the Schranke makes the run wait
  const failures: Array<[string, DecideStep | 'nokey' | 'noroute' | 'policy']> = [
    ...['400', '401', '402 credits', '402 in-flight budget', '403', '403 moderation', '404 no endpoints', '404 gone', '413', '429', '500', '502', '503', '524', '529'].map((n): [string, DecideStep] => [n, { error: n }]),
    ['a missing answer', { malformed: 'missing' }],
    ['noul 1.4', { malformed: 'noul' }],
    ['another operator', jevAnswer({}, { provider: 'Nordwind' })],
    ['another snapshot', jevAnswer({}, { model: 'typesafe/jev-1.13-20261101' })],
    ['no OpenRouter key', 'nokey'],
    ['no Vorprüfer rule', 'noroute'],
    ['a data rule refusing rows', 'policy'],
  ]
  for (const [name, step] of failures)
    test(`unchecked (${name}) → nothing written, the run waits`, async ({ page, errors }) => {
      errors.allow(/Failed to load resource/)
      const w = await jevSetup(page, { ...(typeof step === 'object' ? { fallback: step } : {}), ...(step === 'policy' ? { allow: ALL_SHARED.filter((c) => c !== 'rows') } : {}), ...(step === 'nokey' ? { orKey: false as const } : {}) })
      if (step === 'noroute') await wsEval(page, (s) => s.updateSettings({ ai: { ...(s.settings.ai ?? {}), routes: {} } }))
      await jevAgent(page, { write: 'apply', hold: false, gate: 0.9 })
      const run = await runOf(page, await runAgent(page))
      expect(await written(page, w)).toEqual(NONE)
      expect(run.status).toBe('staged')
      expect(run.jev.waited).toBe(name === 'another snapshot' ? 'changed' : 'gate')
      expect(run.jev.checked).toBe(0)
      for (const c of run.staged as AnyState[]) expect(c.jev.state === 'ok').toBe(false)
    })

  test('control: "Nur markieren" without the Schranke and the same failure (503) → written as without Jev', async ({ page, errors }) => {
    errors.allow(/Failed to load resource/)
    const w = await jevSetup(page, { fallback: { error: '503' } })
    await jevAgent(page, { write: 'apply', hold: false, gate: null })
    const run = await runOf(page, await runAgent(page))
    expect(run.status).toBe('ok')
    expect(await written(page, w)).toEqual(ALL)
    expect((run.staged as AnyState[]).every((c) => c.jev?.why === 'unavailable')).toBe(true)
  })

  test('control: no Vorprüfer at all → zero decision requests, written as today', async ({ page }) => {
    const w = await jevSetup(page)
    await jevAgent(page, { write: 'apply', review: null })
    const run = await runOf(page, await runAgent(page))
    expect(w.or.decisions()).toHaveLength(0)
    expect(run.status).toBe('ok')
    expect(await written(page, w)).toEqual(ALL)
    expect(run.jev).toBeUndefined()
  })

  test('only stricter: a change that names a person still waits at 0,99 on every question; the rest is written', async ({ page }) => {
    const w = await jevSetup(page, {
      fallback: jevAnswer({ asked: 0.99, target: 0.99, consistent: 0.99, clean: 0.99 }),
      turn: (w) => stageTurn(Object.values(w.rows), [{ type: 'tool_use', id: toolId('append'), name: 'append_to_page', input: { id: w.rows['Launch plan'], markdown: `Owner: [@Mara Lind](one:person/${w.rows.mara})` } }]),
    })
    w.rows.mara = await wsEval(page, (s) => s.addPerson('Mara Lind') as string)
    await jevAgent(page, { write: 'apply', hold: true, gate: 0.9 })
    const run = await runOf(page, await runAgent(page))
    const append = (run.staged as AnyState[]).find((c) => c.kind === 'append')!
    expect(append.status).toBe('pending')
    expect(append.items?.holds).toContain('names')
    expect(append.jev).toMatchObject({ state: 'ok', p: 0.99 })
    expect(await written(page, w)).toEqual(ALL)
    expect(run.status).toBe('staged')
    expect(run.jev.waited).toBeUndefined()
  })
})

test.describe('a hold in apply mode, and the toast of "Nur markieren" (J8)', () => {
  test('"Zurückhalten" without the Schranke: a marked change makes the whole run wait (hold)', async ({ page }) => {
    const w = await jevSetup(page, { fallback: byTarget({ 'Launch plan': jevAnswer({ consistent: 0.41 }) }) })
    await jevAgent(page, { write: 'apply', hold: true, gate: null })
    const run = await runOf(page, await runAgent(page))
    expect(await written(page, w)).toEqual(NONE)
    expect(run.jev.waited).toBe('hold')
    expect(byTitle(run, w, 'Launch plan')).toMatchObject({ status: 'held', jev: { held: 'mark' } })
    expect(byTitle(run, w, 'Tessera review').status).toBe('pending')
  })

  test('control — "Nur markieren": the marked change is written, and the scheduled run’s toast says so', async ({ page }) => {
    const w = await jevSetup(page, { fallback: byTarget({ 'Launch plan': jevAnswer({ consistent: 0.41 }) }) })
    await jevAgent(page, { write: 'apply', hold: false, gate: null })
    const run = await runOf(page, await runAgent(page, { schedule: true }))
    expect(run.status).toBe('ok')
    expect(await written(page, w)).toEqual(ALL)
    expect(byTitle(run, w, 'Launch plan')).toMatchObject({ status: 'applied', jev: { mark: true } })
    await expect(page.locator('.toast').filter({ hasText: '1 of them despite concerns' })).toBeVisible()
  })
})

test.describe('sticky: an earlier change Jev flagged keeps the agent cautious (DJ20)', () => {
  test('staged: run 2’s clean change to the held row is held “sticky”, its change elsewhere is not; once run 1’s card is decided, run 3 is clean', async ({ page }) => {
    let pass = 1
    const w = await jevSetup(page, {
      fallback: (req) => (pass === 1 && (req.body as AnyState)?.state?.change?.target?.title === 'Launch plan' ? jevAnswer({ consistent: 0.41 }) : jevAnswer()),
      turn: (w) => stageTurn(pass === 1 ? [w.rows['Launch plan']] : [w.rows['Launch plan'], w.rows['Tessera review']]),
    })
    await jevAgent(page, { hold: true })
    const r1 = await runOf(page, await runAgent(page))
    expect(byTitle(r1, w, 'Launch plan')).toMatchObject({ status: 'held', jev: { held: 'mark' } })
    pass = 2
    const r2 = await runOf(page, await runAgent(page))
    expect(byTitle(r2, w, 'Launch plan')).toMatchObject({ status: 'held', jev: { held: 'sticky', sticky: true, state: 'ok', p: 0.95 } })
    // control: a change to another row is not sticky
    expect(byTitle(r2, w, 'Tessera review')).toMatchObject({ status: 'pending' })
    expect(byTitle(r2, w, 'Tessera review').jev.sticky).toBeUndefined()
    // the person decides run 1's card (a held one is discarded like any open one) → run 3's change to the row is checked
    // on its own again (run 2's sticky hold passes nothing on)
    const out = await review<AnyState>(page, 'discardRun', r1.id, [byTitle(r1, w, 'Launch plan').id], { undo: true })
    expect(out.dropped).toHaveLength(1)
    const r3 = await runOf(page, await runAgent(page))
    expect(byTitle(r3, w, 'Launch plan')).toMatchObject({ status: 'pending' })
    expect(byTitle(r3, w, 'Launch plan').jev.sticky).toBeUndefined()
  })

  test('"Nur markieren": the sticky change is marked only (pending, jev.sticky)', async ({ page }) => {
    let pass = 1
    const w = await jevSetup(page, {
      fallback: () => (pass === 1 ? jevAnswer({ consistent: 0.41 }) : jevAnswer()),
      turn: (w) => stageTurn([w.rows['Launch plan']]),
    })
    await jevAgent(page, { hold: false })
    const r1 = await runOf(page, await runAgent(page))
    expect(byTitle(r1, w, 'Launch plan')).toMatchObject({ status: 'pending', jev: { mark: true } })
    pass = 2
    const r2 = await runOf(page, await runAgent(page))
    expect(byTitle(r2, w, 'Launch plan')).toMatchObject({ status: 'pending', jev: { sticky: true, mark: false } })
    // a marked or sticky proposal neither replaces nor is replaced (supersede): both stay cards
    expect(byTitle(await runOf(page, r1.id), w, 'Launch plan').status).toBe('pending')
  })

  test('apply + Schranke: run 1 waits (0,41), run 2 (0,95) still waits while run 1’s card is open; discarded → run 3 writes', async ({ page }) => {
    let pass = 1
    const w = await jevSetup(page, {
      fallback: () => (pass === 1 ? jevAnswer({ consistent: 0.41 }) : jevAnswer()),
      turn: (w) => stageTurn([w.rows['Launch plan']]),
    })
    await jevAgent(page, { write: 'apply', hold: false, gate: 0.9 })
    const r1 = await runOf(page, await runAgent(page))
    expect(r1.jev.waited).toBe('gate')
    pass = 2
    const r2 = await runOf(page, await runAgent(page))
    expect(r2.jev).toMatchObject({ waited: 'sticky', checked: 1, marked: 0 })
    expect(await noteOf(page, w, 'Launch plan')).toBeNull()
    expect(labels(r2)).toContain('Jev stopped the run — 1 change waits for you (an earlier change still waits)')
    await review(page, 'discardRun', r1.id, [r1.staged[0].id], { undo: true })
    const r3 = await runOf(page, await runAgent(page))
    expect(r3.status).toBe('ok')
    expect(r3.jev.waited).toBeUndefined()
    expect(await noteOf(page, w, 'Launch plan')).toBe('Checked 1')
    void AGENT
  })
})
