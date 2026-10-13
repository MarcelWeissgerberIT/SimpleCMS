/**
 * Jev as Vorprüfer (slice SJ) — the browser specs' common ground: a mocked Claude agent that stages one update per row of a
 * fictional Projects database (Launch plan, Tessera review, Nordlicht site), the mocked decisions surface
 * (helpers/providers.ts mockOpenRouter), Jev as this device's Vorprüfer rule, the agent with its review v2, and readers for
 * the stored runs, the Preflight cards and the ledger. Nothing reaches a real host.
 */
import type { Page } from '@playwright/test'
import { openApp, wsEval, flush } from '../fixtures'
import { jevAnswer, mockClaudeScript, mockOpenRouter, seedEndpoints, text, type CapturedRequest, type ClaudeTurn, type DecideStep, type DecideStepFn, type ORMock, type ORMockOpts } from './providers'
import { ledger } from './aiFlows'

export type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export const OR_KEY = 'sk-or-v1-e2e-openrouter-key-0000000000000000000000000000000000000000'
export const JEV = 'typesafe/jev-1.13'
export const SNAP = `${JEV}-20260917`
export const ON = `openrouter:${SNAP}`
export const AGENT = 'ag_jev_nordlicht'
export const ALL_SHARED = ['public', 'structure', 'selection', 'page', 'rows', 'files', 'workspace', 'people', 'transcript']
export const MEMBER = ['private', 'mail', 'memory', 'mcp']
export const TITLES = ['Launch plan', 'Tessera review', 'Nordlicht site']

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
/** a fresh tool-use id */
export const toolId = (what = 'x') => `toolu_jev_${what}_${++tu}`
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
  /** false: no OpenRouter key on this device */
  orKey?: false
  clock?: boolean
  /** more of the OpenRouter mock (the decisions catalogue's answer, held endpoint reads …) */
  or?: Omit<ORMockOpts, 'decisions' | 'decisionsFallback'>
}

/** The app with keys for Claude and OpenRouter, Jev as the device's Vorprüfer rule, and a Projects database of three rows. */
export async function jevSetup(page: Page, o: SetupOpts = {}): Promise<JevWorld> {
  if (o.clock) await page.clock.install({ time: new Date('2026-10-12T09:00:00+02:00') })
  const world = {} as JevWorld
  world.or = await mockOpenRouter(page.context(), { ...(o.or ?? {}), decisions: o.decisions ?? [], decisionsFallback: o.fallback ?? byTarget({}) })
  world.claude = await mockClaudeScript(page.context(), [], { fallback: (req) => (afterTools(req) ? text('Checked the Nordlicht rows.', o.reportUsage ? { usage: o.reportUsage } : {}) : (o.turn ?? ((w) => stageTurn(Object.values(w.rows))))(world)) })
  await openApp(page)
  await wsEval(page, (s, a) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', ...(a.key ? { aiKeys: { openrouter: a.key } } : {}), ai: { routes: { gate: [{ p: 'openrouter', m: a.jev }] }, allow: { openrouter: a.device } } }), { key: o.orKey === false ? null : OR_KEY, jev: JEV, device: o.device ?? MEMBER })
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
  /** the report page (appended after every run) */
  output?: string
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
      s.upsertAgent({ id: a.id, name: 'Nordlicht Pflege', instructions: 'Keep the Note of every Projects row of the Nordlicht launch up to date.', trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: a.write, output: a.output ? { pageId: a.output, mode: 'append' } : null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: a.max, enabled: true, createdAt: now, updatedAt: now, ...(a.review ? { review: a.review } : {}) })
    },
    { id: AGENT, write: o.write ?? 'stage', max: o.maxRunUsd ?? 0.5, review, output: o.output ?? null },
  )
  await flush(page)
}

/** Run the agent now (resolves with the run id when it ended). */
export const runAgent = (page: Page, o: { rows?: string[]; schedule?: boolean } = {}): Promise<string> => page.evaluate(([id, o]) => (window as unknown as { __oneAgents: AnyState }).__oneAgents.run(id, o), [AGENT, o] as const)
/** The agent's runs as stored (newest first). */
export const storedRuns = (page: Page): Promise<AnyState[]> => page.evaluate((id) => (window as unknown as { __oneAgents: AnyState }).__oneAgents.loadRuns(id), AGENT)
export const runOf = async (page: Page, id: string): Promise<AnyState> => (await storedRuns(page)).find((r) => r.id === id)!
export const noteOf = (page: Page, w: JevWorld, title: string) => wsEval(page, (s, a) => s.pages[a.row]?.properties?.[a.note] ?? null, { row: w.rows[title], note: w.note })
/** The Preflight proposals lamp's card ids (read now). */
export const cards = async (page: Page): Promise<string[]> =>
  page.evaluate(async () => {
    const p = (window as unknown as { __onePreflight: AnyState }).__onePreflight
    await p.flush('proposals')
    return (p.readings().proposals?.ids ?? []) as string[]
  })
export const decideEntries = async (page: Page) => (await ledger(page)).filter((e) => e.role === 'decide')
export const byTitle = (run: AnyState, w: JevWorld, title: string) => (run.staged as AnyState[]).find((c) => c.pageId === w.rows[title])!


/** Act on a run as the review does (seam: features/agents/review.ts). */
export const review = <R>(page: Page, fn: string, runId: string, ...args: unknown[]): Promise<R> =>
  page.evaluate(
    async ([fn, a, r, args]) => {
      const s = (window as unknown as { __oneAgents: AnyState }).__oneAgents
      const run = (await s.loadRuns(a)).find((x: AnyState) => x.id === r)
      return s[fn](run, ...(args as unknown[]))
    },
    [fn, AGENT, runId, args] as const,
  ) as Promise<R>

