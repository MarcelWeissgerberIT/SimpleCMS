/**
 * Jev as Vorprüfer (slice SJ) — a custom agent's proposals pre-checked in the browser, end to end: a mocked Claude agent
 * stages changes, the mocked decisions surface answers (helpers/providers.ts mockOpenRouter: doc shapes, hang / release,
 * errors), and what the run stores, sends, meters and shows is read back. Every "zero" and every "never" has its positive
 * control. Nothing reaches a real host; people, rows and agents are fictional (Nordlicht, Tessera, Mara Lind, Launch plan).
 */
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect, openApp, wsEval, flush, waitForApp } from './fixtures'
import { jevAnswer } from './helpers/providers'
import { AGENT, ALL_SHARED, JEV, MEMBER, SNAP, TITLES, byTarget, byTitle, cards, decideEntries, jevAgent, jevSetup, noteOf, review, runAgent, runOf, stageTurn, storedRuns, toolId, type AnyState } from './helpers/jev'

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

test.describe('failures, inverted (critique 2)', () => {
  const failures: Array<[string, import('./helpers/providers').DecideStep]> = [
    ['503', { error: '503' }],
    ['403', { error: '403' }],
    ['a missing answer', { malformed: 'missing' }],
    ['no answer in time', { hang: true }],
  ]
  for (const [name, step] of failures)
    for (const hold of [true, false])
      test(`${name}: ${hold ? '"Zurückhalten" → every change held, "not pre-checked"' : 'control — "Nur markieren" → open cards, as without Jev'}`, async ({ page, errors }) => {
        test.setTimeout(90_000)
        errors.allow(/Failed to load resource/)
        await jevSetup(page, { fallback: step })
        await jevAgent(page, { hold })
        const run = await runOf(page, await runAgent(page))
        expect(run.status).toBe('staged')
        const staged = run.staged as AnyState[]
        expect(staged).toHaveLength(3)
        for (const c of staged) {
          expect(c.jev?.state === 'ok').toBe(false)
          expect([c.status, c.jev?.held ?? null]).toEqual(hold ? ['held', 'unchecked'] : ['pending', null])
        }
        expect(run.jev).toMatchObject({ n: 3, checked: 0, held: hold ? 3 : 0 })
      })
})

/** Two tabs of one browser: the leader runs the agent, the other takes over when it closes. */
async function interrupted(context: BrowserContext, page: Page, hold: boolean): Promise<AnyState> {
  const w = await jevSetup(page, { decisions: [{ hang: true }, { hang: true }, { hang: true }] })
  await jevAgent(page, { hold })
  // the other tab is open first: the leader closes the moment Jev hangs (well inside a check's 8 s)
  const other = await context.newPage()
  await openApp(other)
  void runAgent(page).catch(() => {})
  await expect.poll(() => w.or.hanging(), { timeout: 20_000 }).toBe(3)
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

const decisionGets = (w: { or: { to(path: string, method?: string): Array<{ url: string }> } }) => w.or.to('/api/v1/models', 'GET').filter((r) => r.url.includes('output_modalities=decisions'))

test.describe('what Jev may see, and what it costs (J7)', () => {
  test('a rule without "Database rows" → zero decision requests, each change says why (control: allowed → three)', async ({ page }) => {
    const w = await jevSetup(page, { allow: ALL_SHARED.filter((c) => c !== 'rows') })
    await jevAgent(page, { hold: true })
    const run = await runOf(page, await runAgent(page))
    expect(w.or.decisions()).toHaveLength(0)
    for (const c of run.staged as AnyState[]) expect(c).toMatchObject({ status: 'held', jev: { state: 'skipped', why: 'policy', cls: 'rows', held: 'unchecked' } })
    expect(run.steps.map((s: AnyState) => s.label)).toContain('Jev 1.13: not pre-checked — Jev may not see "Database rows"')
    expect(await decideEntries(page)).toHaveLength(0)
    // a refused check reads nothing either: no decisions catalogue GET for its price
    expect(decisionGets(w)).toHaveLength(0)
  })

  test('no OpenRouter key on this device: the gate refuses before the price is read — zero catalogue GETs, zero requests (control: the price case below reads one)', async ({ page }) => {
    const w = await jevSetup(page, { orKey: false })
    await jevAgent(page, { hold: true })
    const run = await runOf(page, await runAgent(page))
    expect(decisionGets(w)).toHaveLength(0)
    expect(w.or.decisions()).toHaveLength(0)
    for (const c of run.staged as AnyState[]) expect(c).toMatchObject({ status: 'held', jev: { state: 'skipped', why: 'nokey' } })
  })

  for (const allowMemory of [false, true])
    test(`the memory \`recall\` read counts as touched: ${allowMemory ? 'allowed for OpenRouter → three requests (control)' : 'not allowed → zero requests, "Jev may not see …"'}`, async ({ page }) => {
      const w = await jevSetup(page, {
        device: allowMemory ? MEMBER : MEMBER.filter((c) => c !== 'memory'),
        turn: (w) => stageTurn(Object.values(w.rows), [{ type: 'tool_use', id: toolId('recall'), name: 'recall', input: { query: 'invoices' } }]),
      })
      // the One memory: one procedure the agent's instructions do not match (nothing goes along — only `recall` finds it)
      await wsEval(page, (s) => {
        const db = s.createDatabase({ title: 'One memory' }) as string
        s.updateDatabase(db, { system: 'memory' })
        s.createRow(db, { title: 'Quarterly invoices for Tessera go out on the first Monday.' })
      })
      await jevAgent(page, { hold: true })
      const run = await runOf(page, await runAgent(page))
      // the memory did not go along with the task (no <one_memory> block): only the tool read it
      expect(JSON.stringify(w.claude.requests[0]!.body)).not.toContain('Quarterly invoices for Tessera')
      expect(JSON.stringify(w.claude.requests[1]!.body)).toContain('Quarterly invoices for Tessera')
      expect(run.touched).toContain('memory')
      if (allowMemory) {
        expect(w.or.decisions()).toHaveLength(3)
        for (const c of run.staged as AnyState[]) expect(c.jev.state).toBe('ok')
      } else {
        expect(w.or.decisions()).toHaveLength(0)
        for (const c of run.staged as AnyState[]) expect(c).toMatchObject({ status: 'held', jev: { why: 'policy', cls: 'memory' } })
      }
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

/* ------------------------------------------------------------------ */
/* J9 — held cards in Preflight and the run review; Vertrauen            */
/* ------------------------------------------------------------------ */

const pf = <R>(page: Page, fn: string, ...args: unknown[]): Promise<R> => page.evaluate(([fn, args]) => (window as unknown as { __onePreflight: AnyState }).__onePreflight[fn as string](...(args as unknown[])), [fn, args] as const) as Promise<R>
const pfCard = (page: Page) => page.locator('.pf-q article.pf-card[data-current]')
const statusOf = async (page: Page, runId: string, title: string, w: AnyState) => byTitle(await runOf(page, runId), w as never, title).status as string
const verdicts = (page: Page): Promise<AnyState[]> =>
  page.evaluate(async (a) => {
    const book = await (window as unknown as { __oneAgentTrust: AnyState }).__oneAgentTrust.book(a)
    return Object.values(book.entries as Record<string, AnyState[]>).flat()
  }, AGENT)

/** A run of the agent with "Zurückhalten": Launch plan held (0,41), the other two clean (0,95). */
async function heldRun(page: Page) {
  await page.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
  const w = await jevSetup(page, { fallback: byTarget({ 'Launch plan': jevAnswer({ consistent: 0.41 }) }) })
  await jevAgent(page, { hold: true })
  const id = await runAgent(page)
  const run = await runOf(page, id)
  const card = (title: string) => `run:${id}#${byTitle(run, w, title).id}`
  return { w, id, run, card }
}

test.describe('a held proposal: VON HAND, never in bulk, applied only alone (J9)', () => {
  test('Preflight: the held card is VON HAND and out of ⇧A; its A asks first and ↵ applies it alone; Z puts it back held (control: a clean card is in bulk)', async ({ page }) => {
    const { w, id, card } = await heldRun(page)
    const held = card('Launch plan')
    // the card and its A key say VON HAND; never part of a bulk apply (control: a clean card)
    expect(await pf(page, 'keysOf', 'proposals', held)).toMatchObject({ hand: ['held'], bulk: false, actions: expect.arrayContaining([{ key: 'a', hand: ['held'] }]) })
    expect(await pf(page, 'keysOf', 'proposals', card('Tessera review'))).toMatchObject({ hand: [], bulk: true, actions: expect.arrayContaining([{ key: 'a', hand: [] }]) })
    await page.evaluate(() => (window.location.hash = '#/'))
    await expect.poll(async () => (await cards(page)).filter((c) => c.startsWith(`run:${id}#`)).length).toBe(3)
    await page.locator('.pf-cap[data-lamp="proposals"]').focus()
    await page.keyboard.press('Enter')
    await expect(pfCard(page)).toBeFocused()
    // the clean cards come first: shown in full, then ⇧A
    const clean = [card('Tessera review'), card('Nordlicht site')]
    await expect(pfCard(page)).toHaveAttribute('data-id', clean[0]!)
    await expect.poll(async () => Object.keys((await page.evaluate(() => (window as unknown as { __onePreflight: AnyState }).__onePreflight.stores.queue.getState().viewed)) as AnyState)).toContain(clean[0])
    await page.keyboard.press('j')
    await expect(pfCard(page)).toHaveAttribute('data-id', clean[1]!)
    await expect.poll(async () => Object.keys((await page.evaluate(() => (window as unknown as { __onePreflight: AnyState }).__onePreflight.stores.queue.getState().viewed)) as AnyState)).toContain(clean[1])
    // both seen in full: ⇧A applies them at once — the held card stays (by hand)
    await page.keyboard.press('Shift+A')
    await expect.poll(() => statusOf(page, id, 'Tessera review', w)).toBe('applied')
    await expect.poll(() => statusOf(page, id, 'Nordlicht site', w)).toBe('applied')
    expect(await statusOf(page, id, 'Launch plan', w)).toBe('held')
    expect(await noteOf(page, w, 'Launch plan')).toBeNull()
    // the held card: its A opens the confirm row; ↵ on its key applies it — alone
    await expect(pfCard(page)).toHaveAttribute('data-id', held, { timeout: 10_000 })
    await expect(pfCard(page)).not.toHaveAttribute('aria-busy', 'true')
    await expect(pfCard(page).locator('.pf-card__head .pf-hand')).toBeVisible()
    await page.keyboard.press('a')
    await expect(page.getByTestId('pf-confirm')).toContainText('the pre-check holds it back')
    await expect(page.getByTestId('pf-confirm-key')).toBeFocused()
    expect(await statusOf(page, id, 'Launch plan', w)).toBe('held')
    await page.keyboard.press('Enter')
    await expect.poll(() => statusOf(page, id, 'Launch plan', w)).toBe('applied')
    expect(await noteOf(page, w, 'Launch plan')).toBe('Checked 1')
    // its Undo puts it back held — never an open card a bulk apply would take
    await page.keyboard.press('z')
    await expect.poll(() => statusOf(page, id, 'Launch plan', w)).toBe('held')
    expect(await noteOf(page, w, 'Launch plan')).toBeNull()
  })

  test('the run review: "Apply all (except 1 held back)" leaves it; several ids apply only the open ones; alone only with `single`; Undo → held', async ({ page }) => {
    const { w, id, run } = await heldRun(page)
    const held = byTitle(run, w, 'Launch plan').id as string
    const tessera = byTitle(run, w, 'Tessera review').id as string
    // several ids, one of them held: only the open one is applied
    const res = await review<AnyState | null>(page, 'applyRun', id, [tessera, held])
    expect(res?.applied).toEqual([tessera])
    expect(await statusOf(page, id, 'Launch plan', w)).toBe('held')
    // one id without `single` (a bulk caller): nothing
    expect(await review(page, 'applyRun', id, [held])).toBeNull()
    // the review's own key: "Apply all (except 1 held back)" — the held row stays, with its own key
    await page.evaluate((a) => (window.location.hash = `#/agents/${a}`), AGENT)
    const all = page.getByTestId('agx-apply-all').first()
    await expect(all).toHaveText('Apply all (except 1 held back)')
    await all.click()
    await expect.poll(() => statusOf(page, id, 'Nordlicht site', w)).toBe('applied')
    expect(await statusOf(page, id, 'Launch plan', w)).toBe('held')
    const row = page.locator(`li.agent-change[data-change="${held}"]`)
    await expect(row.getByTestId('agx-held')).toHaveText('HELD BACK')
    await row.getByRole('button', { name: /^Apply alone/ }).click()
    await expect.poll(() => statusOf(page, id, 'Launch plan', w)).toBe('applied')
    expect(await noteOf(page, w, 'Launch plan')).toBe('Checked 1')
    // its row's Undo: back to held
    await row.getByRole('button', { name: /^Undo/ }).click()
    await expect.poll(() => statusOf(page, id, 'Launch plan', w)).toBe('held')
    expect(await noteOf(page, w, 'Launch plan')).toBeNull()
    // discarded like any open one; its discard's Undo brings it back held
    const out = await review<AnyState>(page, 'discardRun', id, [held], { undo: true, row: true })
    expect(out.dropped).toEqual([held])
    expect(await statusOf(page, id, 'Launch plan', w)).toBe('discarded')
    await page.evaluate(([r, c]) => (window as unknown as { __oneAgents: AnyState }).__oneAgents.undoDiscard(r, c), [id, held] as const)
    await expect.poll(() => statusOf(page, id, 'Launch plan', w)).toBe('held')
  })
})

test.describe('Vertrauen and the card’s revision (J9)', () => {
  test('a run with Jev writes no verdict; ONE decision on a held card shown in full writes one, with jev "held" (control: a clear card’s says "clear")', async ({ page }) => {
    const before = async () => (await verdicts(page)).length
    const { w, id, run } = await heldRun(page)
    // the run and its checks: the book is as it was (no verdict without the person's decision)
    expect(await before()).toBe(0)
    const held = byTitle(run, w, 'Launch plan').id as string
    const tessera = byTitle(run, w, 'Tessera review').id as string
    await review(page, 'applyRun', id, [held], { row: true, judged: true, single: true })
    await expect.poll(async () => (await verdicts(page)).length).toBe(1)
    expect((await verdicts(page))[0]).toMatchObject({ v: 'accept', run: id, change: held, jev: 'held' })
    await review(page, 'applyRun', id, [tessera], { row: true, judged: true, single: true })
    await expect.poll(async () => (await verdicts(page)).length).toBe(2)
    expect((await verdicts(page)).find((v) => v.change === tessera)).toMatchObject({ v: 'accept', jev: 'clear' })
    // a bulk apply never writes one
    await review(page, 'applyRun', id)
    expect(await verdicts(page)).toHaveLength(2)
  })

  test('the card’s revision ignores Jev’s numbers and the held ↔ pending flip (control: the content itself changes it)', async ({ page }) => {
    const { id, run } = await heldRun(page)
    const c = (run.staged as AnyState[]).find((x) => x.status === 'held')!
    const rev = () => pf<string | null>(page, 'rev', 'proposals', `run:${id}#${c.id}`)
    const r0 = await rev()
    expect(r0).toBeTruthy()
    // the same change without its check, and pending: the same revision
    await page.evaluate(
      async ([a, r, cid]) => {
        const s = (window as unknown as { __oneAgents: AnyState }).__oneAgents
        const runNow = (await s.loadRuns(a)).find((x: AnyState) => x.id === r)
        await s.putRun({ ...runNow, staged: runNow.staged.map((x: AnyState) => (x.id === cid ? { ...x, status: 'pending', jev: { ...x.jev, p: 0.99, mark: false, held: undefined } } : x)) })
      },
      [AGENT, id, c.id] as const,
    )
    expect(await rev()).toBe(r0)
    // control: its content changes → another revision
    await page.evaluate(
      async ([a, r, cid]) => {
        const s = (window as unknown as { __oneAgents: AnyState }).__oneAgents
        const runNow = (await s.loadRuns(a)).find((x: AnyState) => x.id === r)
        await s.putRun({ ...runNow, staged: runNow.staged.map((x: AnyState) => (x.id === cid ? { ...x, props: x.props.map((p: AnyState) => ({ ...p, after: 'Checked 9' })) } : x)) })
      },
      [AGENT, id, c.id] as const,
    )
    expect(await rev()).not.toBe(r0)
  })
})

test.describe('the health lamps of a Vorprüfer (J9)', () => {
  const seedRun = (page: Page, id: string, at: number, jev: AnyState) =>
    page.evaluate(
      ([a, id, at, jev]) => (window as unknown as { __oneAgents: AnyState }).__oneAgents.putRun({ id, agentId: a, runner: 'browser', trigger: { type: 'manual' }, startedAt: at, endedAt: at + 1000, status: 'staged', summary: '', steps: [], staged: [], jev }),
      [AGENT, id, at, jev] as const,
    )
  const missed = (page: Page) =>
    page.evaluate(async () => {
      const p = (window as unknown as { __onePreflight: AnyState }).__onePreflight
      await p.flush('missed')
      return (p.readings().missed?.ids ?? []) as string[]
    })

  test('three runs in a row without a usable check → "pre-check failing"; one checked run ends it (control)', async ({ page }) => {
    await jevSetup(page)
    await jevAgent(page, { hold: true })
    const now = Date.now()
    for (let i = 0; i < 2; i++) await seedRun(page, `r${i}`, now - (5 - i) * 60_000, { n: 2, checked: 0, marked: 0, held: 2, usd: 0, failed: 'unavailable' })
    expect((await missed(page)).filter((x) => x.startsWith('jevfail:'))).toEqual([])
    await seedRun(page, 'r2', now - 60_000, { n: 2, checked: 0, marked: 0, held: 2, usd: 0, failed: 'unavailable' })
    await expect.poll(async () => (await missed(page)).filter((x) => x.startsWith('jevfail:'))).toEqual([`jevfail:${AGENT}@r2`])
    // the tab's cooldown lights it at once
    await seedRun(page, 'r3', now - 30_000, { n: 1, checked: 0, marked: 0, held: 1, usd: 0, failed: 'cooldown' })
    await expect.poll(async () => (await missed(page)).filter((x) => x.startsWith('jevfail:'))).toEqual([`jevfail:${AGENT}@r3`])
    // control: a run Jev answered ends the streak
    await seedRun(page, 'r4', now - 10_000, { n: 1, checked: 1, marked: 0, held: 0, usd: 0.00004 })
    await expect.poll(async () => (await missed(page)).filter((x) => x.startsWith('jevfail:'))).toEqual([])
  })

  test('another Jev snapshot answered than the one confirmed → "new version" (control: the confirmed one → none)', async ({ page }) => {
    await jevSetup(page)
    await jevAgent(page, { hold: true })
    await seedRun(page, 'r1', Date.now() - 60_000, { n: 1, checked: 0, marked: 0, held: 1, usd: 0, failed: 'changed', changedTo: `${JEV}-20261101` })
    await expect.poll(async () => (await missed(page)).filter((x) => x.startsWith('jevnew:'))).toEqual([`jevnew:${AGENT}@${JEV}-20261101`])
    await seedRun(page, 'r2', Date.now() - 10_000, { n: 1, checked: 1, marked: 0, held: 0, usd: 0, changedTo: SNAP })
    await expect.poll(async () => (await missed(page)).filter((x) => x.startsWith('jevnew:'))).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* J10 — the card's Jev line, the run's step and cost line              */
/* ------------------------------------------------------------------ */

test.describe('the Jev line on a card (J10)', () => {
  test('the run review: concern (amber cap, meter, "below 0.70"), near (neutral, its value), clear (dim, no number); 4 checks ▾; the step and the cost line name Jev', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
    const w = await jevSetup(page, { fallback: byTarget({ 'Launch plan': jevAnswer({ consistent: 0.41 }), 'Tessera review': jevAnswer({ target: 0.74 }) }) })
    await jevAgent(page, { hold: false })
    const id = await runAgent(page)
    const run = await runOf(page, id)
    await page.evaluate((a) => (window.location.hash = `#/agents/${a}`), AGENT)
    const row = (title: string) => page.locator(`li.agent-change[data-change="${byTitle(run, w, title).id}"]`)
    const launch = row('Launch plan').getByTestId('jev-line')
    await expect(launch).toHaveAttribute('data-state', 'marked')
    await expect(launch.getByTestId('jev-cap')).toHaveText('CONCERN · JEV')
    await expect(launch.getByRole('meter')).toHaveAttribute('aria-valuetext', '0.41 — below the threshold 0.70: Agrees with the record?')
    await expect(launch).toContainText('"Agrees with the record?"')
    await expect(launch).toContainText('below 0.70')
    await expect(row('Launch plan')).toHaveAttribute('data-jev', 'marked')
    const tessera = row('Tessera review').getByTestId('jev-line')
    await expect(tessera).toHaveAttribute('data-state', 'near')
    await expect(tessera).toContainText('Jev: close to the threshold — "Right page or row?" 0.74')
    await expect(tessera.getByTestId('jev-cap')).toHaveCount(0)
    const site = row('Nordlicht site').getByTestId('jev-line')
    await expect(site).toHaveAttribute('data-state', 'clear')
    await expect(site).toContainText('Jev: none of the 4 questions below 0.70')
    // clear: no number in front of it — no meter, no 0.95
    await expect(site.getByRole('meter')).toHaveCount(0)
    await expect(site).not.toContainText('0.95')
    await expect(row('Nordlicht site')).not.toHaveAttribute('data-jev', /.+/)
    // "4 checks ▾": the four questions with their values
    const more = site.getByTestId('jev-more')
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    await more.click()
    await expect(more).toHaveAttribute('aria-expanded', 'true')
    await expect(site.locator('.jev-checks__row')).toHaveCount(4)
    await expect(site.locator('.jev-checks')).toContainText('Free of foreign orders?')
    // the step (counts only) and the cost line: Jev's own line, input only, the output free
    await expect(page.locator('.agx-step[data-jev="check"]').first()).toContainText('Jev 1.13 pre-checks: 3 pre-checked · 1 with concerns')
    const cost = page.locator('[data-testid="agx-run-model"][data-model^="openrouter:"]').first()
    await expect(cost).toContainText('Jev 1.13 · pre-check')
    await expect(cost).toContainText('free')
    // concerns first (per device): the marked row leads; off again → the run's order
    await page.getByTestId('agx-sort-jev').first().click()
    await expect(page.locator('ol.agx-changes > li.agent-change').first()).toHaveAttribute('data-change', byTitle(run, w, 'Launch plan').id)
    expect(await page.evaluate(() => localStorage.getItem('one.agents.sortJev'))).toBe('1')
  })

  test('held: the run review’s head carries HELD BACK (the line only the reason); Preflight’s card its own cap; Nur markieren + no answer → "not pre-checked" (dim); a run that read mail → the foreign-text line', async ({ page }) => {
    const { w, id, run } = await heldRun(page)
    await page.evaluate((a) => (window.location.hash = `#/agents/${a}`), AGENT)
    const held = page.locator(`li.agent-change[data-change="${byTitle(run, w, 'Launch plan').id}"]`)
    await expect(held).toHaveAttribute('data-jev', 'held')
    await expect(held.getByTestId('agx-held')).toHaveText('HELD BACK')
    const line = held.getByTestId('jev-line')
    await expect(line).toHaveAttribute('data-state', 'held')
    await expect(line).toContainText('Pre-check holds it back — apply one by one')
    await expect(line.getByTestId('jev-cap')).toHaveCount(0)
    await expect(line.getByRole('meter')).toBeVisible()
    // Preflight: the held card names it itself
    await page.evaluate(() => (window.location.hash = '#/'))
    await expect.poll(async () => (await cards(page)).filter((c) => c.startsWith(`run:${id}#`)).length).toBe(3)
    await page.locator('.pf-cap[data-lamp="proposals"]').focus()
    await page.keyboard.press('Enter')
    await expect(pfCard(page)).toBeFocused()
    await expect(pfCard(page).getByTestId('jev-line')).toBeVisible()
    for (let i = 0; i < 3 && (await pfCard(page).getAttribute('data-id')) !== `run:${id}#${byTitle(run, w, 'Launch plan').id}`; i++) await page.keyboard.press('j')
    await expect(pfCard(page).getByTestId('jev-line').getByTestId('jev-cap')).toHaveText('HELD BACK')
    // a run that read mail: every answered card says high values are no guarantee
    await page.evaluate(
      async ([a, r]) => {
        const s = (window as unknown as { __oneAgents: AnyState }).__oneAgents
        const runNow = (await s.loadRuns(a)).find((x: AnyState) => x.id === r)
        await s.putRun({ ...runNow, touched: ['rows', 'mail'] })
      },
      [AGENT, id] as const,
    )
    await page.evaluate((a) => (window.location.hash = `#/agents/${a}`), AGENT)
    await expect(page.locator('.jev-line__foreign').first()).toHaveText('Jev reads text from outside too — high values are no guarantee')
  })

  test('"Nur markieren", sticky: no CONCERN cap for what Jev did not flag — its own line (clear, or "not pre-checked" and why) beside "an earlier change here is still waiting" (control: run 1’s marked card has the cap)', async ({ page, errors }) => {
    errors.allow(/Failed to load resource/)
    await page.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
    let pass = 1
    const w = await jevSetup(page, {
      fallback: (req) => (pass === 1 ? jevAnswer({ consistent: 0.41 }) : (req.body as AnyState | null)?.state?.change?.target?.title === 'Tessera review' ? { error: '503' } : jevAnswer()),
      turn: (w) => stageTurn([w.rows['Launch plan'], w.rows['Tessera review']]),
    })
    await jevAgent(page, { hold: false })
    const r1 = await runOf(page, await runAgent(page))
    pass = 2
    const r2 = await runOf(page, await runAgent(page))
    expect(byTitle(r2, w, 'Launch plan')).toMatchObject({ status: 'pending', jev: { state: 'ok', sticky: true, mark: false } })
    expect(byTitle(r2, w, 'Tessera review')).toMatchObject({ status: 'pending', jev: { why: 'unavailable', sticky: true } })
    await page.evaluate((a) => (window.location.hash = `#/agents/${a}`), AGENT)
    const line = (run: AnyState, title: string) => page.locator(`#agx-run-${run.id} li.agent-change[data-change="${byTitle(run, w, title).id}"]`).getByTestId('jev-line')
    const clean = line(r2, 'Launch plan')
    await expect(clean).toHaveAttribute('data-state', 'clear')
    await expect(clean).toHaveAttribute('data-sticky', 'true')
    await expect(clean.getByTestId('jev-cap')).toHaveCount(0)
    await expect(clean.getByTestId('jev-sticky')).toHaveText('An earlier change here is still waiting')
    const unchecked = line(r2, 'Tessera review')
    await expect(unchecked).toHaveAttribute('data-state', 'skipped')
    await expect(unchecked).toContainText('Jev: not pre-checked — Jev cannot be reached')
    await expect(unchecked.getByTestId('jev-sticky')).toBeVisible()
    await expect(unchecked.getByTestId('jev-cap')).toHaveCount(0)
    // control: what Jev did flag carries the cap
    await expect(line(r1, 'Launch plan').getByTestId('jev-cap')).toHaveText('CONCERN · JEV')
  })

  test('held row at 390 px in German, standard size and XL: ZURÜCKGEHALTEN, "Einzeln übernehmen" and "Verwerfen" stay inside the card', async ({ page }) => {
    const { w, run } = await heldRun(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await flush(page)
    await page.setViewportSize({ width: 390, height: 844 })
    for (const scale of ['1', '4']) {
      await page.evaluate((x) => localStorage.setItem('one.textScale', x), scale)
      await page.reload()
      await waitForApp(page)
      await page.evaluate((a) => (window.location.hash = `#/agents/${a}`), AGENT)
      const held = page.locator(`li.agent-change[data-change="${byTitle(run, w, 'Launch plan').id}"]`)
      await expect(held.getByTestId('agx-held')).toHaveText('ZURÜCKGEHALTEN')
      await expect(held.getByRole('button', { name: /^Verwerfen/ })).toBeVisible()
      const g = await held.evaluate((li) => {
        const card = li.getBoundingClientRect()
        const keys = [...li.querySelectorAll('.agent-change__actions > *')].map((e) => e.getBoundingClientRect().right)
        return { right: card.right, max: Math.max(...keys), vw: window.innerWidth, doc: document.documentElement.scrollWidth }
      })
      expect(g.max, `scale ${scale}`).toBeLessThanOrEqual(g.right + 0.5)
      expect(g.max, `scale ${scale}`).toBeLessThanOrEqual(g.vw)
      expect(g.doc, `scale ${scale}`).toBeLessThanOrEqual(g.vw)
    }
  })

  test('the amber lamp of a run-wait step is amber in the production build (two classes over the .led primitive)', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
    await jevSetup(page, { fallback: byTarget({ 'Launch plan': jevAnswer({ clean: 0.85 }) }) })
    await jevAgent(page, { write: 'apply', hold: false, gate: 0.9 })
    await runAgent(page)
    await page.evaluate((a) => (window.location.hash = `#/agents/${a}`), AGENT)
    const led = page.locator('.agx-step[data-jev="wait"] .led').first()
    await expect(led).toBeVisible()
    const c = await led.evaluate((el) => {
      const probe = document.createElement('span')
      probe.style.background = 'var(--lamp-amber)'
      document.body.appendChild(probe)
      const want = getComputedStyle(probe).backgroundColor
      const off = document.createElement('span')
      off.style.background = 'var(--led-off)'
      document.body.appendChild(off)
      const offColour = getComputedStyle(off).backgroundColor
      probe.remove()
      off.remove()
      return { got: getComputedStyle(el).backgroundColor, want, off: offColour }
    })
    expect(c.got).toBe(c.want)
    expect(c.got).not.toBe(c.off)
  })

  test('Nur markieren and Jev not answering: the card says "not pre-checked" and why, dim, without a cap', async ({ page, errors }) => {
    errors.allow(/Failed to load resource/)
    await page.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
    const w = await jevSetup(page, { fallback: { error: '503' } })
    await jevAgent(page, { hold: false })
    const run = await runOf(page, await runAgent(page))
    await page.evaluate((a) => (window.location.hash = `#/agents/${a}`), AGENT)
    const line = page.locator(`li.agent-change[data-change="${byTitle(run, w, 'Launch plan').id}"]`).getByTestId('jev-line')
    await expect(line).toHaveAttribute('data-state', 'skipped')
    await expect(line).toContainText('Jev: not pre-checked — Jev cannot be reached')
    await expect(line.getByTestId('jev-cap')).toHaveCount(0)
    // the run's step: amber, not an error
    await expect(page.locator('.agx-step[data-jev="wait"]').first()).toContainText('not pre-checked')
  })
})
