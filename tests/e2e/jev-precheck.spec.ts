/**
 * Jev as Vorprüfer (slice SJ) — a custom agent's proposals pre-checked in the browser, end to end: a mocked Claude agent
 * stages changes, the mocked decisions surface answers (helpers/providers.ts mockOpenRouter: doc shapes, hang / release,
 * errors), and what the run stores, sends, meters and shows is read back. Every "zero" and every "never" has its positive
 * control. Nothing reaches a real host; people, rows and agents are fictional (Nordlicht, Tessera, Mara Lind, Launch plan).
 */
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect, openApp, wsEval, flush } from './fixtures'
import { jevAnswer, mockClaudeScript, mockOpenRouter, seedEndpoints, text, type CapturedRequest, type ClaudeTurn, type DecideStep, type DecideStepFn, type ORMock } from './helpers/providers'
import { ledger } from './helpers/aiFlows'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const OR_KEY = 'sk-or-v1-e2e-openrouter-key-0000000000000000000000000000000000000000'
const JEV = 'typesafe/jev-1.13'
const SNAP = `${JEV}-20260917`
const ON = `openrouter:${SNAP}`
const AGENT = 'ag_jev_nordlicht'
const ALL_SHARED = ['public', 'structure', 'selection', 'page', 'rows', 'files', 'workspace', 'people', 'transcript']
const MEMBER = ['private', 'mail', 'memory', 'mcp']
const TITLES = ['Launch plan', 'Tessera review', 'Nordlicht site']

export interface JevWorld {
  db: string
  note: string
  rows: Record<string, string>
  or: ORMock
  claude: { requests: CapturedRequest[] }
}

/** The last user message of a Claude request holds tool results (the loop's second request → the report). */
const afterTools = (req: CapturedRequest) => {
  const last = (req.body.messages as AnyState[] | undefined)?.at(-1)
  return Array.isArray(last?.content) && last.content.some((b: AnyState) => b.type === 'tool_result')
}

let tu = 0
/** One turn staging an update of each row's Note (+ extra tool calls first, e.g. a read). */
export const stageTurn = (rows: string[], extra: ClaudeTurn['blocks'] = [], usage?: ClaudeTurn['usage']): ClaudeTurn => ({
  blocks: [...extra, ...rows.map((id, i) => ({ type: 'tool_use' as const, id: `toolu_jev_${++tu}`, name: 'update_row', input: { id, properties: { Note: `Checked ${i + 1}` } } }))],
  ...(usage ? { usage } : {}),
})

/** The answer to a decisions body by the row it is about (`by` title → step; default a clear answer). */
export const byTarget =
  (by: Record<string, DecideStep>): DecideStepFn =>
  (req) =>
    by[(req.body as AnyState | null)?.state?.change?.target?.title as string] ?? jevAnswer()

export interface SetupOpts {
  /** decisions answers in order (default: by target — every one clear) */
  decisions?: DecideStepFn[]
  fallback?: DecideStepFn
  /** the workspace's shared classes for OpenRouter (default all) */
  allow?: string[]
  /** this device's member classes for OpenRouter (default all) */
  device?: string[]
  /** the Claude turn that stages (default: an update of every row) */
  turn?: (w: JevWorld) => ClaudeTurn
  /** the report turn's usage */
  reportUsage?: ClaudeTurn['usage']
  clock?: boolean
}

/** The app with keys for Claude and OpenRouter, Jev as the device's Vorprüfer rule, and a Projects database of three rows. */
export async function jevSetup(page: Page, o: SetupOpts = {}): Promise<JevWorld> {
  if (o.clock) await page.clock.install({ time: new Date('2026-10-12T09:00:00+02:00') })
  const world = {} as JevWorld
  world.or = await mockOpenRouter(page.context(), { decisions: o.decisions ?? [], decisionsFallback: o.fallback ?? byTarget({}) })
  world.claude = await mockClaudeScript(page.context(), [], { fallback: (req) => (afterTools(req) ? text('Checked the Nordlicht rows.', o.reportUsage ? { usage: o.reportUsage } : {}) : (o.turn ?? ((w) => stageTurn(Object.values(w.rows))))(world)) })
  await openApp(page)
  await wsEval(page, (s, a) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', aiKeys: { openrouter: a.key }, ai: { routes: { gate: [{ p: 'openrouter', m: a.jev }] }, allow: { openrouter: a.device } } }), { key: OR_KEY, jev: JEV, device: o.device ?? MEMBER })
  await wsEval(page, (s, allow) => s.setWorkspaceAI({ policy: { providers: { openrouter: { allow } }, restricted: [] } }), o.allow ?? ALL_SHARED)
  await seedEndpoints(page, { [JEV]: [{ tag: 'typesafe', name: 'TypeSafe' }] })
  const made = await wsEval(
    page,
    (s, titles) => {
      const db = s.createDatabase({ title: 'Projects' }) as string
      const note = s.addProperty(db, { type: 'text', name: 'Note' }) as string
      const rows: Record<string, string> = {}
      for (const title of titles) rows[title] = s.createRow(db, { title }) as string
      return { db, note, rows }
    },
    TITLES,
  )
  Object.assign(world, made)
  return world
}

export interface AgentOpts {
  write?: 'stage' | 'apply'
  hold?: boolean
  markBelow?: number
  gate?: number | null
  maxRunUsd?: number
  review?: unknown
}

/** The agent (manual, browser, everything in scope) with a Vorprüfer (review v2). */
export async function jevAgent(page: Page, o: AgentOpts = {}): Promise<void> {
  const review = o.review !== undefined ? o.review : { v: 2, on: ON, pre: { markBelow: o.markBelow ?? 0.7, hold: o.hold ?? true }, ...(o.gate ? { gate: { allowAt: o.gate } } : {}) }
  await wsEval(
    page,
    (s, a) => {
      const now = Date.now()
      s.upsertAgent({ id: a.id, name: 'Nordlicht Pflege', instructions: 'Keep the Note of every Projects row of the Nordlicht launch up to date.', trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: a.write, output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: a.max, enabled: true, createdAt: now, updatedAt: now, ...(a.review ? { review: a.review } : {}) })
    },
    { id: AGENT, write: o.write ?? 'stage', max: o.maxRunUsd ?? 0.5, review },
  )
  await flush(page)
}

const agents = (page: Page) => page.evaluate(() => (window as unknown as { __oneAgents: AnyState }).__oneAgents)
/** Run the agent now (resolves with the run id when it ended). */
export const runAgent = (page: Page, rows?: string[]): Promise<string> => page.evaluate(([id, rows]) => (window as unknown as { __oneAgents: AnyState }).__oneAgents.run(id, rows ? { rows } : {}), [AGENT, rows ?? null] as const)
/** The agent's runs as stored (newest first). */
export const storedRuns = (page: Page): Promise<AnyState[]> => page.evaluate((id) => (window as unknown as { __oneAgents: AnyState }).__oneAgents.loadRuns(id), AGENT)
export const runOf = async (page: Page, id: string): Promise<AnyState> => (await storedRuns(page)).find((r) => r.id === id)!
const noteOf = (page: Page, w: JevWorld, title: string) => wsEval(page, (s, a) => s.pages[a.row]?.properties?.[a.note] ?? null, { row: w.rows[title], note: w.note })
/** The Preflight proposals lamp's card ids (read now). */
const cards = async (page: Page): Promise<string[]> =>
  page.evaluate(async () => {
    const p = (window as unknown as { __onePreflight: AnyState }).__onePreflight
    await p.flush('proposals')
    return (p.readings().proposals?.ids ?? []) as string[]
  })
const decideEntries = async (page: Page) => (await ledger(page)).filter((e) => e.role === 'decide')
const byTitle = (run: AnyState, w: JevWorld, title: string) => (run.staged as AnyState[]).find((c) => c.pageId === w.rows[title])!
void agents

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
        turn: (w) => stageTurn(Object.values(w.rows).filter((id) => id !== w.rows.mail), [{ type: 'tool_use', id: `toolu_jev_read_${++tu}`, name: 'read_page', input: { id: w.rows.mail } }]),
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
