/**
 * Jev as Vorprüfer (slice SJ) — a custom agent's proposals pre-checked in the browser, end to end: a mocked Claude agent
 * stages changes, the mocked decisions surface answers (helpers/providers.ts mockOpenRouter: doc shapes, hang / release,
 * errors), and what the run stores, sends, meters and shows is read back. Every "zero" and every "never" has its positive
 * control. Nothing reaches a real host; people, rows and agents are fictional (Nordlicht, Tessera, Mara Lind, Launch plan).
 */
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect, openApp, wsEval } from './fixtures'
import { jevAnswer } from './helpers/providers'
import { AGENT, ALL_SHARED, JEV, MEMBER, SNAP, TITLES, byTarget, byTitle, cards, decideEntries, jevAgent, jevSetup, noteOf, runAgent, runOf, stageTurn, storedRuns, toolId, type AnyState } from './helpers/jev'

test.describe('the Vorprüfung of a run (J7)', () => {
  test('three proposals → three decisions; each change carries its check (concern · near · clear); one decide entry each in the run’s receipt; the step counts', async ({ page }) => {
    const w = await jevSetup(page, { fallback: byTarget({ 'Launch plan': jevAnswer({ consistent: 0.41 }), 'Tessera review': jevAnswer({ target: 0.74 }) }) })
    await jevAgent(page, { hold: false })
    const id = await runAgent(page)
    const run = await runOf(page, id)
    expect(run.status).toBe('staged')
    // three bodies: the pinned version, the update, the row named by its visible title — never an id
    const posts = w.or.decisions()
    expect(posts).toHaveLength(3)
    for (const p of posts) {
      expect(p.body.model).toBe(JEV)
      expect(p.body.state.change.kind).toBe('update_row')
      expect(Object.keys(p.body.state)).toEqual(['change', 'row', 'trigger', 'agent'])
      const body = JSON.stringify(p.body)
      for (const x of [w.db, w.note, ...Object.values(w.rows), AGENT, id]) expect(body).not.toContain(x)
    }
    expect(posts.map((p) => p.body.state.change.target.title).sort()).toEqual([...TITLES].sort())
    // the checks: numbers only, the weakest named; "Nur markieren" leaves every change pending
    const launch = byTitle(run, w, 'Launch plan')
    expect(launch.status).toBe('pending')
    expect(launch.jev).toMatchObject({ v: 1, state: 'ok', model: SNAP, low: 'consistent', p: 0.41, mark: true })
    expect(byTitle(run, w, 'Tessera review').jev).toMatchObject({ state: 'ok', low: 'target', p: 0.74, mark: false })
    expect(byTitle(run, w, 'Nordlicht site').jev).toMatchObject({ state: 'ok', p: 0.95, mark: false })
    expect(launch.jev.usd).toBeGreaterThan(0)
    // the run's numbers and its step (counts only)
    expect(run.jev).toMatchObject({ n: 3, checked: 3, marked: 1, held: 0, model: SNAP })
    expect(run.steps.map((s: AnyState) => s.label)).toContain('Jev 1.13 pre-checks: 3 pre-checked · 1 with concerns')
    // what the tools returned (update_row names no page): nothing touched beyond the targets' own classes
    expect(Array.isArray(run.touched)).toBe(true)
    // one decide entry per response, the run as its group, in the run's receipt as its own model line
    const entries = await decideEntries(page)
    expect(entries).toHaveLength(3)
    for (const e of entries) expect(e).toMatchObject({ role: 'decide', cls: 'gate', purpose: 'gate.precheck', source: `agent:${AGENT}:${id}`, group: id, served: { p: 'openrouter', model: SNAP } })
    const line = (run.usage.byModel as AnyState[]).find((l) => l.p === 'openrouter')
    expect(line).toMatchObject({ model: SNAP, requests: 3 })
    // the Claude side is unchanged: its own line, two requests
    expect((run.usage.byModel as AnyState[]).find((l) => l.p === 'anthropic')).toMatchObject({ requests: 2 })
  })

  test('"Zurückhalten": the change Jev marked is held (status held · mark); the others stay open', async ({ page }) => {
    const w = await jevSetup(page, { fallback: byTarget({ 'Launch plan': jevAnswer({ consistent: 0.41 }) }) })
    await jevAgent(page, { hold: true })
    const run = await runOf(page, await runAgent(page))
    expect(byTitle(run, w, 'Launch plan')).toMatchObject({ status: 'held', jev: { held: 'mark', mark: true } })
    expect(byTitle(run, w, 'Tessera review').status).toBe('pending')
    expect(run.jev).toMatchObject({ n: 3, checked: 3, marked: 1, held: 1 })
    expect(run.steps.map((s: AnyState) => s.label)).toContain('Jev 1.13 pre-checks: 3 pre-checked · 1 with concerns · 1 held back')
  })

  for (const people of [false, true])
    test(`names: a person on the row reaches Jev ${people ? 'by name where the rule allows names (control)' : 'as "@Person 1" without `people`'}`, async ({ page }) => {
      const w = await jevSetup(page, { allow: people ? ALL_SHARED : ALL_SHARED.filter((c) => c !== 'people') })
      await wsEval(
        page,
        (s, a) => {
          const owner = s.addProperty(a.db, { type: 'person', name: 'Owner' }) as string
          const mara = s.addPerson('Mara Lind') as string
          s.setRowProperty(a.row, owner, [mara])
        },
        { db: w.db, row: w.rows['Launch plan'] },
      )
      await jevAgent(page, { hold: false })
      await runAgent(page)
      const launch = w.or.decisions().find((p) => p.body.state.change.target.title === 'Launch plan')!
      if (people) expect(launch.body.state.row).toMatchObject({ Owner: 'Mara Lind' })
      else {
        expect(JSON.stringify(w.or.decisions().map((p) => p.body))).not.toContain('Mara')
        expect(launch.body.state.row).toMatchObject({ Owner: '@Person 1' })
      }
    })

  test('the stored run stays "running" while Jev has not answered: nothing reviewable, no apply; on release the cards come (positive control: the same cards)', async ({ page }) => {
    const w = await jevSetup(page, { decisions: [{ hang: true }, { hang: true }, { hang: true }] })
    await jevAgent(page, { hold: true })
    const done = runAgent(page)
    await expect.poll(() => w.or.hanging(), { timeout: 20_000 }).toBe(3)
    const [run] = await storedRuns(page)
    expect(run.status).toBe('running')
    // every change stored as a held placeholder ("not pre-checked") while it waits — never a clean card
    expect((run.staged as AnyState[]).map((c) => [c.status, c.jev?.held, c.jev?.why])).toEqual([
      ['held', 'unchecked', 'late'],
      ['held', 'unchecked', 'late'],
      ['held', 'unchecked', 'late'],
    ])
    expect((await cards(page)).filter((c) => c.startsWith(`run:${run.id}#`))).toEqual([])
    // an apply now finds nothing to apply (the run is still running)
    expect(await page.evaluate(async (a) => (window as unknown as { __oneAgents: AnyState }).__oneAgents.applyRun((await (window as unknown as { __oneAgents: AnyState }).__oneAgents.loadRuns(a)).find((r: AnyState) => r.status === 'running')), AGENT)).toBeNull()
    expect(await noteOf(page, w, 'Launch plan')).toBeNull()
    // release → clear answers → the run ends with its cards
    expect(w.or.releaseDecisions()).toBe(3)
    const id = await done
    const after = await runOf(page, id)
    expect(after.status).toBe('staged')
    expect((after.staged as AnyState[]).map((c) => c.status)).toEqual(['pending', 'pending', 'pending'])
    await expect.poll(async () => (await cards(page)).filter((c) => c.startsWith(`run:${id}#`)).length).toBe(3)
  })

  test('apply mode: nothing is written while Jev has not answered; after it, each change exactly once', async ({ page }) => {
    const w = await jevSetup(page, { decisions: [{ hang: true }, { hang: true }, { hang: true }] })
    await jevAgent(page, { write: 'apply', hold: true })
    const done = runAgent(page)
    await expect.poll(() => w.or.hanging(), { timeout: 20_000 }).toBe(3)
    for (const t of TITLES) expect(await noteOf(page, w, t)).toBeNull()
    w.or.releaseDecisions()
    const run = await runOf(page, await done)
    expect(run.status).toBe('ok')
    expect(run.applied).toBe(3)
    expect((run.staged as AnyState[]).every((c) => c.status === 'applied')).toBe(true)
    expect(await noteOf(page, w, 'Launch plan')).toBe('Checked 1')
    // nothing left to apply a second time
    expect(await page.evaluate(async ([a, r]) => (window as unknown as { __oneAgents: AnyState }).__oneAgents.applyRun((await (window as unknown as { __oneAgents: AnyState }).__oneAgents.loadRuns(a)).find((x: AnyState) => x.id === r)), [AGENT, run.id] as const)).toBeNull()
  })
})

/** Two tabs of one browser: the leader runs the agent, the other takes over when it closes. */
async function interrupted(context: BrowserContext, page: Page, hold: boolean): Promise<AnyState> {
  const w = await jevSetup(page, { decisions: [{ hang: true }, { hang: true }, { hang: true }] })
  await jevAgent(page, { hold })
  void runAgent(page).catch(() => {})
  await expect.poll(() => w.or.hanging(), { timeout: 20_000 }).toBe(3)
  const other = await context.newPage()
  await openApp(other)
  await page.close({ runBeforeUnload: false })
  // the other tab leads now: its sweep marks the run interrupted (never resumes a check)
  await expect.poll(async () => (await storedRuns(other))[0]?.status, { timeout: 20_000 }).toBe('error')
  return (await storedRuns(other))[0]!
}

test.describe('an interrupted run (J7)', () => {
  test('"Zurückhalten": the tab closes while Jev hangs → the next tab’s sweep leaves held cards, "not pre-checked"', async ({ context, page }) => {
    const run = await interrupted(context, page, true)
    expect((run.staged as AnyState[]).map((c) => [c.status, c.jev?.held, c.jev?.why])).toEqual([
      ['held', 'unchecked', 'late'],
      ['held', 'unchecked', 'late'],
      ['held', 'unchecked', 'late'],
    ])
  })

  test('control — "Nur markieren": the same run leaves pending cards, as without Jev', async ({ context, page }) => {
    const run = await interrupted(context, page, false)
    expect((run.staged as AnyState[]).map((c) => c.status)).toEqual(['pending', 'pending', 'pending'])
    expect((run.staged as AnyState[]).some((c) => c.jev)).toBe(false)
  })
})

test.describe('what Jev may see, and what it costs (J7)', () => {
  test('a rule without "Database rows" → zero decision requests, each change says why (control: allowed → three)', async ({ page }) => {
    const w = await jevSetup(page, { allow: ALL_SHARED.filter((c) => c !== 'rows') })
    await jevAgent(page, { hold: true })
    const run = await runOf(page, await runAgent(page))
    expect(w.or.decisions()).toHaveLength(0)
    for (const c of run.staged as AnyState[]) expect(c).toMatchObject({ status: 'held', jev: { state: 'skipped', why: 'policy', cls: 'rows', held: 'unchecked' } })
    expect(run.steps.map((s: AnyState) => s.label)).toContain('Jev 1.13: not pre-checked — Jev may not see "Database rows"')
    expect(await decideEntries(page)).toHaveLength(0)
  })

  for (const allowMail of [false, true])
    test(`a member class the run touched (mail) needs this device’s allow: ${allowMail ? 'allowed → three requests (control)' : 'none → zero requests'}`, async ({ page }) => {
      const w = await jevSetup(page, {
        device: allowMail ? MEMBER : MEMBER.filter((c) => c !== 'mail'),
        turn: (w) => stageTurn(Object.values(w.rows).filter((id) => id !== w.rows.mail), [{ type: 'tool_use', id: toolId('read'), name: 'read_page', input: { id: w.rows.mail } }]),
      })
      const mail = await wsEval(page, (s) => {
        const mails = s.createDatabase({ title: 'Mails' }) as string
        s.updateSettings({ mail: { ...(s.settings.mail ?? {}), databaseId: mails } })
        return s.createRow(mails, { title: 'Offer from Tessera' }) as string
      })
      w.rows.mail = mail
      await jevAgent(page, { hold: true })
      const run = await runOf(page, await runAgent(page))
      expect(run.touched).toContain('mail')
      const checked = run.staged as AnyState[]
      expect(checked).toHaveLength(3)
      if (allowMail) {
        expect(w.or.decisions()).toHaveLength(3)
        for (const c of checked) expect(c.jev.state).toBe('ok')
      } else {
        expect(w.or.decisions()).toHaveLength(0)
        for (const c of checked) expect(c).toMatchObject({ status: 'held', jev: { why: 'policy', cls: 'mail' } })
      }
    })

  // Claude's two responses cost $0.00998 (Opus 5.5: 1000 in + 200 out, then 490 in + 1 out): $0.00002 left of $0.01
  for (const max of [0.01, 0.02])
    test(`the checks’ band against what the run may still spend: ${max === 0.01 ? 'above it → zero requests, "budget reached"' : 'a cent more → three requests (control)'}`, async ({ page }) => {
      const w = await jevSetup(page, { turn: (w) => stageTurn(Object.values(w.rows), [], { input: 1000, output: 200 }), reportUsage: { input: 490, output: 1 } })
      await jevAgent(page, { hold: true, maxRunUsd: max })
      const run = await runOf(page, await runAgent(page))
      expect(run.status).toBe('staged')
      if (max === 0.01) {
        expect(w.or.decisions()).toHaveLength(0)
        for (const c of run.staged as AnyState[]) expect(c).toMatchObject({ status: 'held', jev: { why: 'budget', state: 'skipped' } })
      } else expect(w.or.decisions()).toHaveLength(3)
    })

  test('the price: no row on this device → exactly one decisions GET for three checks; three days later the row is kept (no GET)', async ({ page }) => {
    const w = await jevSetup(page, { clock: true })
    await jevAgent(page, { hold: true })
    await runAgent(page)
    const gets = () => w.or.to('/api/v1/models', 'GET').filter((r) => r.url.includes('output_modalities=decisions'))
    expect(gets()).toHaveLength(1)
    expect(w.or.decisions()).toHaveLength(3)
    await page.clock.fastForward(72 * 3_600_000)
    const run = await runOf(page, await runAgent(page))
    expect(gets()).toHaveLength(1)
    expect(w.or.decisions()).toHaveLength(6)
    expect(run.jev).toMatchObject({ checked: 3 })
  })
})
