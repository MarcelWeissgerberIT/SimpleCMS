/**
 * The Schreibschranke (slice SJ, J8): an apply-mode agent run with a Vorprüfer writes the same as without it — or nothing.
 * When Jev holds back any change, or does not answer, the WHOLE run waits (owner decision 1): no change of it is written
 * directly, every one becomes a card, the run and its report say why. Today's per-change holds (a task naming a person,
 * an edit, a send) stay as they are — Jev only ever makes it stricter. A later run of the same agent stays cautious while an
 * earlier change Jev flagged is open (sticky, DJ20). Every "nothing" has its positive control. Mocked hosts only; the
 * people and rows are fictional.
 */
import type { Page } from '@playwright/test'
import { test, expect, wsEval, createPage } from './fixtures'
import { jevAnswer, mockClaudeScript, text, type DecideStep } from './helpers/providers'
import { AGENT, ALL_SHARED, JEV, TITLES, byTarget, byTitle, cards, jevAgent, jevSetup, noteOf, review, runAgent, runOf, stageTurn, storedRuns, toolId, type AnyState, type JevWorld } from './helpers/jev'
import { budget, spend } from './helpers/governor'

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
    expect(wait).toMatchObject({ label: 'Jev made the run wait — 3 changes wait for you (below the write gate or not pre-checked)', state: 'err' })
    // the report is still written — with One's fixed first line under its heading
    const content = await wsEval(page, (s, id) => s.pages[id].content, report)
    const blocks = content.content as AnyState[]
    const head = blocks.findIndex((b) => b.type === 'heading')
    expect(blocks[head + 1]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'Jev made the run wait — 3 changes wait for you.' }] })
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
    expect(labels(r2)).toContain('Jev made the run wait — 1 change waits for you (an earlier change still waits)')
    await review(page, 'discardRun', r1.id, [r1.staged[0].id], { undo: true })
    const r3 = await runOf(page, await runAgent(page))
    expect(r3.status).toBe('ok')
    expect(r3.jev.waited).toBeUndefined()
    expect(await noteOf(page, w, 'Launch plan')).toBe('Checked 1')
    void AGENT
  })
})

test.describe('a run Jev made wait replaces nothing (DJ3: a decision model never supersedes)', () => {
  const titleOf = (req: { body: unknown }) => (req.body as AnyState | null)?.state?.change?.target?.title as string | undefined
  const supersede = (page: Page) => page.evaluate((a) => (window as unknown as { __oneAgents: AnyState }).__oneAgents.supersedeOlder(a), AGENT)

  test('run 1 (Vorschlagen) leaves a clean proposal for Launch plan; run 2 (apply + Schranke) waits on Tessera review → run 1’s proposal stays open', async ({ page }) => {
    let pass = 1
    const w = await jevSetup(page, {
      fallback: (req) => (pass === 2 && titleOf(req) === 'Tessera review' ? jevAnswer({ consistent: 0.5 }) : jevAnswer()),
      turn: (w) => stageTurn(pass === 1 ? [w.rows['Launch plan']] : [w.rows['Launch plan'], w.rows['Tessera review']]),
    })
    await jevAgent(page, { hold: false })
    const r1 = await runOf(page, await runAgent(page))
    expect(byTitle(r1, w, 'Launch plan')).toMatchObject({ status: 'pending', jev: { state: 'ok', mark: false } })
    pass = 2
    await jevAgent(page, { write: 'apply', hold: false, gate: 0.9 })
    const r2 = await runOf(page, await runAgent(page))
    expect(r2).toMatchObject({ status: 'staged', jev: { waited: 'gate' } })
    expect(byTitle(r2, w, 'Launch plan')).toMatchObject({ status: 'pending', jev: { state: 'ok', mark: false } })
    expect(byTitle(r2, w, 'Launch plan').jev.sticky).toBeUndefined()
    // run 1's proposal is still open — the wait replaced nothing, and a later pass leaves it too
    expect(byTitle(await runOf(page, r1.id), w, 'Launch plan').status).toBe('pending')
    await supersede(page)
    expect(byTitle(await runOf(page, r1.id), w, 'Launch plan').status).toBe('pending')
    expect(byTitle(await runOf(page, r2.id), w, 'Launch plan').supersedes).toBeUndefined()
    expect(await noteOf(page, w, 'Launch plan')).toBeNull()
  })

  test('control: an ordinary staged run 2 with the same clean proposal replaces run 1’s', async ({ page }) => {
    let pass = 1
    const w = await jevSetup(page, { turn: (w) => stageTurn(pass === 1 ? [w.rows['Launch plan']] : [w.rows['Launch plan'], w.rows['Tessera review']]) })
    await jevAgent(page, { hold: false })
    const r1 = await runOf(page, await runAgent(page))
    pass = 2
    const r2 = await runOf(page, await runAgent(page))
    expect(r2.status).toBe('staged')
    expect(r2.jev.waited).toBeUndefined()
    await expect.poll(async () => byTitle(await runOf(page, r1.id), w, 'Launch plan').status).toBe('superseded')
  })
})

test.describe('the run deadline counts before the send too (§ 3.5: late → the run waits)', () => {
  /** Jev's endpoint list two days old: a check reads it again — and that read is held by the mock */
  const staleEndpoints = (page: Page) => page.evaluate((jev) => (window as unknown as { __oneAI: AnyState }).__oneAI.seedEndpoints({ [jev]: [{ tag: 'typesafe', name: 'TypeSafe' }] }, Date.now() - 2 * 86_400_000), JEV)

  test('the endpoint read hangs past the run’s 20 s: nothing goes out, every check "late", nothing written — the run waits', async ({ page }) => {
    const w = await jevSetup(page, { clock: true, or: { endpointsHang: true } })
    await staleEndpoints(page)
    await jevAgent(page, { write: 'apply', hold: false, gate: 0.9 })
    const done = runAgent(page)
    await expect.poll(() => w.or.endpointsHanging(), { timeout: 20_000 }).toBe(1)
    await page.clock.fastForward(21_000)
    const run = await runOf(page, await done)
    expect(w.or.decisions()).toHaveLength(0)
    expect(run.status).toBe('staged')
    expect(run.jev).toMatchObject({ waited: 'gate', checked: 0 })
    for (const c of run.staged as AnyState[]) expect(c.jev).toMatchObject({ state: 'skipped', why: 'late' })
    expect(await written(page, w)).toEqual(NONE)
    w.or.releaseEndpoints()
  })

  test('control: the same held read answered in time → checked and written', async ({ page }) => {
    const w = await jevSetup(page, { clock: true, or: { endpointsHang: true } })
    await staleEndpoints(page)
    await jevAgent(page, { write: 'apply', hold: false, gate: 0.9 })
    const done = runAgent(page)
    await expect.poll(() => w.or.endpointsHanging(), { timeout: 20_000 }).toBe(1)
    expect(w.or.releaseEndpoints()).toBe(1)
    const run = await runOf(page, await done)
    expect(w.or.decisions()).toHaveLength(3)
    expect(run.status).toBe('ok')
    expect(await written(page, w)).toEqual(ALL)
  })
})

/* ------------------------------------------------------------------ */
/* Jev at the Regler's red line (train 9: Regler G1 phase B × SJ)       */
/* ------------------------------------------------------------------ */

type Gov = { __oneGovernor: AnyState; __oneAI: AnyState }
/** This tab's open reservations (id, usd, source). */
const openRes = (page: Page): Promise<Array<{ id: string; usd: number; source: string }>> => page.evaluate(() => (window as unknown as Gov).__oneGovernor.open())
/** The decisions catalogue read now (the price a check is braked with — and a run's decide reservation at its start). */
const loadDecisions = (page: Page) => page.evaluate(() => (window as unknown as Gov).__oneAI.loadDecisions())
/** A fictional proposal's state and QSET-shaped questions for the decide seam. */
const STATE = { change: { kind: 'update_row', target: { kind: 'row', title: 'Launch plan', database: 'Projects' }, fields: [{ name: 'Note', before: '', after: 'Checked' }] }, agent: { instructions: 'Keep the Note of every Projects row up to date.', write_mode: 'staged' } }
const QS = Object.fromEntries(['asked', 'target', 'consistent', 'clean'].map((k) => [k, { type: 'noul', instructions: `Check ${k} of \`change\`.` }]))

test.describe('Jev at the Regler’s red line (train 9)', () => {
  test('the money phase: a check of a run whose decide reservation covers it passes the day line at rest 0 — the reservation shrinks by its band; without one it is refused before sending, with no key to press', async ({ page }) => {
    const w = await jevSetup(page)
    await loadDecisions(page)
    await budget(page, { v: 1, day: 1 })
    // the run's decide reservation, counted against the day before its own steps spent the rest
    const rid = (await page.evaluate(() => (window as unknown as Gov).__oneGovernor.reserve(0.01, 'agent:ag_line:run_line'))) as string
    await spend(page, 0.99)
    await page.evaluate(() => (window as unknown as Gov).__oneGovernor.load())
    const ask = (decide?: string) => page.evaluate((d) => (window as unknown as Gov).__oneAI.decide({ sources: [{ all: true }], carries: ['rows'], state: d.state, questions: d.qs, source: 'agent:ag_line:run_line', group: 'run_line', mode: 'scheduled', ...(d.decide ? { decide: d.decide } : {}) }), { decide, state: STATE, qs: QS })
    expect(await ask()).toMatchObject({ ok: false, code: 'budget', why: 'budget' })
    expect(w.or.decisions()).toHaveLength(0)
    // a reservation that is gone (settled) covers nothing
    const spare = (await page.evaluate(() => (window as unknown as Gov).__oneGovernor.reserve(0.01, 'agent:ag_line:run_spare'))) as string
    await page.evaluate((id) => (window as unknown as Gov).__oneGovernor.settle(id), spare)
    expect(await ask(spare)).toMatchObject({ ok: false, code: 'budget' })
    expect(w.or.decisions()).toHaveLength(0)
    // positive control: covered by the run's reservation → sent, and the reservation holds what is left
    const ok = await ask(rid)
    expect(ok).toMatchObject({ ok: true })
    expect(ok.reserved).toBeGreaterThan(0)
    expect(w.or.decisions()).toHaveLength(1)
    const left = (await openRes(page)).find((r) => r.id === rid)!
    expect(left.usd).toBeCloseTo(0.01 - (ok.reserved as number), 12)
  })

  for (const line of [true, false])
    test(line ? 'the decide reservation: with a line set a run holds its checks’ band from its start, each check takes its own out of it, nothing is left open at the end' : 'control: no line → no decide reservation (the checks’ own only, while they wait)', async ({ page }) => {
      const w = await jevSetup(page, { decisions: [{ hang: true }, { hang: true }, { hang: true }] })
      await loadDecisions(page)
      if (line) await budget(page, { v: 1, day: 5 })
      await jevAgent(page, { hold: true })
      const done = runAgent(page)
      await expect.poll(() => w.or.hanging(), { timeout: 20_000 }).toBe(3)
      const [run] = await storedRuns(page)
      const mine = (await openRes(page)).filter((r) => r.source === `agent:${AGENT}:${run!.id}`).sort((a, b) => b.usd - a.usd)
      if (line) {
        // the decide reservation beside the three checks' own: it held 50 checks of a typical size — far above one
        expect(mine).toHaveLength(4)
        expect(mine[0]!.usd).toBeGreaterThan(20 * mine[1]!.usd)
      } else expect(mine).toHaveLength(3)
      expect(w.or.releaseDecisions()).toBe(3)
      await done
      expect(await openRes(page)).toEqual([])
    })

  test('a check the line refuses is not sent: an apply-mode run with "Nur markieren" waits as a whole — nothing written, the run and its report say why, naming the budget (never "Jev made …")', async ({ page }) => {
    // Jev at a fictional 0,01 $ per token: one check costs more than the rest of a 1 $ day — the run's own steps fit
    const w = await jevSetup(page, { or: { decisionsPrice: '0.01' } })
    const report = await createPage(page, { title: 'Nordlicht report' })
    await budget(page, { v: 1, day: 1 })
    await jevAgent(page, { write: 'apply', hold: false, gate: null, output: report })
    const run = await runOf(page, await runAgent(page))
    expect(w.or.decisions()).toHaveLength(0)
    expect(await written(page, w)).toEqual(NONE)
    expect(run.status).toBe('staged')
    expect(run.jev).toMatchObject({ waited: 'line', checked: 0, failed: 'budget' })
    for (const c of run.staged as AnyState[]) expect([c.status, c.jev.state, c.jev.why]).toEqual(['pending', 'skipped', 'budget'])
    expect(labels(run)).toContain('The run waits — a pre-check did not fit under the budget’s red line; 3 changes wait for you')
    expect(labels(run).some((l) => l.startsWith('Jev made'))).toBe(false)
    const reportText = await wsEval(page, (s, id) => JSON.stringify(s.pages[id]?.content ?? null), report)
    expect(reportText).toContain('The run waits — a pre-check did not fit under the budget’s red line; 3 changes wait for you.')
    expect(reportText).not.toContain('Jev made')
    expect(await openRes(page)).toEqual([])
  })

  test('no price for the checks while a line is set is no red line: "price", not "line" — "Nur markieren" writes as without a budget (control above: the line refuses → the run waits)', async ({ page, errors }) => {
    errors.allow(/Failed to load resource/)
    // the decisions catalogue cannot be read (and this device holds no copy): no price for Jev
    const w = await jevSetup(page, { or: { decisionsCatalogue: 503 } })
    await budget(page, { v: 1, day: 5 })
    expect(await page.evaluate((d) => (window as unknown as Gov).__oneAI.decide({ sources: [{ all: true }], carries: ['rows'], state: d.state, questions: d.qs, source: 'agent:ag_price:run_price', mode: 'manual' }), { state: STATE, qs: QS })).toMatchObject({ ok: false, code: 'budget', detail: 'noprice', why: 'price' })
    await jevAgent(page, { write: 'apply', hold: false, gate: null })
    const run = await runOf(page, await runAgent(page))
    expect(w.or.decisions()).toHaveLength(0)
    expect(run.jev).toMatchObject({ checked: 0, failed: 'price' })
    expect(run.jev.waited).toBeUndefined()
    for (const c of run.staged as AnyState[]) expect([c.jev.state, c.jev.why]).toEqual(['skipped', 'price'])
    expect(run.status).toBe('ok')
    expect(await written(page, w)).toEqual(ALL)
  })

  test('control: the same 1 $ day at Jev’s own price → three checks go out, the run writes as without Jev', async ({ page }) => {
    const w = await jevSetup(page)
    await budget(page, { v: 1, day: 1 })
    await jevAgent(page, { write: 'apply', hold: false, gate: null })
    const run = await runOf(page, await runAgent(page))
    expect(w.or.decisions()).toHaveLength(3)
    expect(run.status).toBe('ok')
    expect(run.jev.waited).toBeUndefined()
    expect(await written(page, w)).toEqual(ALL)
  })

  /** Claude stages the three updates (a small step), then a large step with a tool call the next band cannot follow on a
   *  0,21 $ rest (≈ 0,19 $ spent) — registered after jevSetup's mock, so it answers first */
  const twoSteps = async (page: Page, w: JevWorld) =>
    mockClaudeScript(page.context(), [
      stageTurn(Object.values(w.rows), [], { input: 500, output: 100 }),
      { blocks: [{ type: 'tool_use', id: toolId('search'), name: 'search_pages', input: { query: 'Nordlicht' } }], usage: { input: 2000, output: 9000 } },
      text('Checked the Nordlicht rows.'),
    ])

  test('a run the Regler stopped at the line gets no checks: its proposals wait unchecked ("budget"), held back with Zurückhalten — never written; nothing reserved is left', async ({ page }) => {
    const w = await jevSetup(page)
    const claude = await twoSteps(page, w)
    await loadDecisions(page)
    await jevAgent(page, { write: 'apply', hold: true, gate: null })
    await budget(page, { v: 1, day: 1 })
    await spend(page, 0.79)
    await page.evaluate(() => (window as unknown as Gov).__oneGovernor.load())
    const run = await runOf(page, await runAgent(page))
    expect(claude.requests).toHaveLength(2)
    expect(run).toMatchObject({ status: 'held', held: { kind: 'stopped', binding: 'day' } })
    expect(w.or.decisions()).toHaveLength(0)
    expect(run.jev).toMatchObject({ n: 3, checked: 0, held: 3, failed: 'budget' })
    for (const c of run.staged as AnyState[]) expect([c.status, c.jev.why, c.jev.held]).toEqual(['held', 'budget', 'unchecked'])
    expect(labels(run)).toContain('Jev 1.13: not pre-checked — budget reached')
    expect(await written(page, w)).toEqual(NONE)
    expect(await openRes(page)).toEqual([])
  })

  test('control: a day that holds the same run → it goes to its end, its three checks go out, it writes', async ({ page }) => {
    const w = await jevSetup(page)
    const claude = await twoSteps(page, w)
    await loadDecisions(page)
    await jevAgent(page, { write: 'apply', hold: true, gate: null })
    await budget(page, { v: 1, day: 10 })
    const run = await runOf(page, await runAgent(page))
    expect(claude.requests).toHaveLength(3)
    expect(w.or.decisions()).toHaveLength(3)
    expect(run.status).toBe('ok')
    expect(await written(page, w)).toEqual(ALL)
    expect(await openRes(page)).toEqual([])
  })

  /* the train 9 merge review */

  test('six checks with a line: each is prepared (its band reserved) right before it goes out — never more than three of a run’s checks hold a reservation, beside its decide reservation; nothing is left open', async ({ page }) => {
    const w = await jevSetup(page, { decisions: Array.from({ length: 6 }, () => ({ hang: true })) })
    Object.assign(w.rows, await wsEval(page, (s, a) => Object.fromEntries(a.titles.map((t) => [t, s.createRow(a.db, { title: t }) as string])), { db: w.db, titles: ['Orbit notes', 'Harbor map', 'Quiet hours'] }))
    await loadDecisions(page)
    await budget(page, { v: 1, day: 5 })
    await jevAgent(page, { hold: true })
    const done = runAgent(page)
    await expect.poll(() => w.or.hanging(), { timeout: 20_000 }).toBe(3)
    const [run] = await storedRuns(page)
    const mine = async () => (await openRes(page)).filter((r) => r.source === `agent:${AGENT}:${run!.id}`)
    // three checks in flight + the decide reservation (all six reserved at once before: 7)
    expect(await mine()).toHaveLength(4)
    expect(w.or.releaseDecisions()).toBe(3)
    await expect.poll(() => w.or.hanging(), { timeout: 20_000 }).toBe(3)
    expect(await mine()).toHaveLength(4)
    expect(w.or.releaseDecisions()).toBe(3)
    const ended = await runOf(page, await done)
    expect(w.or.decisions()).toHaveLength(6)
    expect(ended.jev).toMatchObject({ n: 6, checked: 6 })
    expect(await openRes(page)).toEqual([])
  })

  for (const line of [true, false])
    test(line ? 'with a line set the tab’s book never drops an open reservation at 200 — a request still in flight keeps its band (the room is never shown larger than it is)' : 'control: without a line the book keeps its 200 (bookkeeping only — nothing is judged against it)', async ({ page }) => {
      await jevSetup(page)
      if (line) await budget(page, { v: 1, day: 1 })
      const big = (await page.evaluate(() => (window as unknown as Gov).__oneGovernor.reserve(0.55, 'terminal:conv1:task1'))) as string
      const small = (await page.evaluate(() => Array.from({ length: 210 }, () => (window as unknown as Gov).__oneGovernor.reserve(0.00006, 'agent:ag_many:run_many') as string))) as string[]
      const list = await openRes(page)
      expect(list.some((r) => r.id === big)).toBe(line)
      expect(list).toHaveLength(line ? 211 : 200)
      await page.evaluate((ids) => ids.forEach((id) => (window as unknown as Gov).__oneGovernor.settle(id)), [big, ...small])
      expect(await openRes(page)).toEqual([])
    })

  test('a run the Regler held with "Zurückhalten", then a clean run on the same rows: no caution passed on (held back for money is no finding) — its proposals replace the held-back ones, as the run’s HeldLine says', async ({ page }) => {
    const w = await jevSetup(page)
    const claude = await mockClaudeScript(page.context(), [
      stageTurn(Object.values(w.rows), [], { input: 500, output: 100 }),
      { blocks: [{ type: 'tool_use', id: toolId('search'), name: 'search_pages', input: { query: 'Nordlicht' } }], usage: { input: 2000, output: 9000 } },
      stageTurn(Object.values(w.rows), [], { input: 500, output: 100 }),
      text('Checked the Nordlicht rows.'),
    ])
    await loadDecisions(page)
    await jevAgent(page, { write: 'stage', hold: true, gate: null })
    await budget(page, { v: 1, day: 1 })
    await spend(page, 0.79)
    await page.evaluate(() => (window as unknown as Gov).__oneGovernor.load())
    const r1 = await runOf(page, await runAgent(page))
    expect(r1).toMatchObject({ status: 'held', held: { kind: 'stopped' } })
    for (const c of r1.staged as AnyState[]) expect([c.status, c.jev.why, c.jev.held]).toEqual(['held', 'budget', 'unchecked'])
    // the next day has room: the same rows again, every check clear
    await budget(page, { v: 1, day: 10 })
    const r2 = await runOf(page, await runAgent(page))
    expect(claude.requests).toHaveLength(4)
    expect(w.or.decisions()).toHaveLength(3)
    expect(r2.status).toBe('staged')
    for (const c of r2.staged as AnyState[]) {
      expect(c.status).toBe('pending')
      expect(c.jev.sticky).toBeUndefined()
    }
    await expect.poll(async () => ((await runOf(page, r1.id)).staged as AnyState[]).map((c) => c.status)).toEqual(['superseded', 'superseded', 'superseded'])
  })

  test('the start check counts the checks’ band: a rest that covers the first step but not its pre-checks asks at a manual start (+1 $ makes it fit) and holds a background one (control: the same agent without a Vorprüfer starts)', async ({ page }) => {
    type RunSeam = { __oneAgentRun: { startCheck: (id: string, manual?: boolean) => Promise<AnyState> } }
    const check = (manual: boolean) => page.evaluate(([id, m]) => (window as unknown as RunSeam).__oneAgentRun.startCheck(id, m), [AGENT, manual] as const)
    // Jev at a fictional 0,000007 $ per token: 50 checks ≈ 0,5 $ (more than the room left, less than +1 $)
    await jevSetup(page, { or: { decisionsPrice: '0.000007' } })
    await loadDecisions(page)
    // the first step alone, measured: a rest far below it (the agent's own budget per run well above it all)
    await jevAgent(page, { review: null, maxRunUsd: 5 })
    await budget(page, { v: 1, day: 50 })
    await spend(page, 49.99)
    await page.evaluate(() => (window as unknown as Gov).__oneGovernor.load())
    const alone = await check(true)
    expect(alone).toMatchObject({ start: false })
    expect(alone.ask).toBeTruthy()
    expect(alone.checks).toBeUndefined()
    const first = alone.ask.first.high as number
    // a rest 0,2 $ above the first step
    await budget(page, { v: 1, day: 100 })
    await spend(page, Math.round((100 - 49.99 - first - 0.2) * 1e6) / 1e6)
    await page.evaluate(() => (window as unknown as Gov).__oneGovernor.load())
    // control: without a Vorprüfer it starts
    expect(await check(true)).toMatchObject({ start: true })
    // with one: its 50 checks belong to the first step — the dialog asks (+1 $ makes it fit), a background start is held
    await jevAgent(page, { hold: true, maxRunUsd: 5 })
    const ask = await check(true)
    expect(ask).toMatchObject({ start: false, ask: { allow: 1 } })
    expect(ask.checks).toBeGreaterThan(0.2)
    expect(ask.ask.first.high).toBeCloseTo(first + ask.checks, 6)
    expect(await check(false)).toMatchObject({ start: false, hold: 'day' })
    expect(await openRes(page)).toEqual([])
  })
})
