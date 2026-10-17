/**
 * Work orders — the planner (spec §2.1–§2.7), B5. `planOrder(rowId, { mode })` turns a request row into a draft plan on
 * this device: ONE structured request (purpose `coding.plan`, completeStructured) — not a custom agent, no tool loop of
 * One's. It runs in this tab under the Web Lock `one-order:<scope>:<row>` (a second press: "plant schon"; ≤ 3 runs per
 * tab). Only the entry points of the allow-list (B4: Status → Planen written as `you`, the command Planen, ↵ Planen,
 * Prüfen lassen) and a press kept for the worker's return (mode 'trigger') call it — nothing else ever plans.
 *
 *  1. Preconditions (§2.2), in order, before anything is read or sent (preconditions.ts items 1–6, then: AI for this
 *     kind of work, the gate's precheck of the request's sources — a data rule, a key typed into the request, newer
 *     rules — and the empty check). Each failure is an outcome with its reason; the Status stays as it is.
 *  2. Inputs (§2.3), built as values for the route (shape): the row's title, fields and readable text (context marks;
 *     ≤ 40 000 characters, a cut noted), the pages it links (coding/refs.ts rules: ≤ 8, ≤ 20 000 each; by id), the
 *     catalogue (the offered kinds' projects with where a step starts / stops on this device, the worker's repos and
 *     branches, Claude Code's own MCP servers per repo, this device's Approvals). Provenance: the row's and each page's
 *     writer stamps and revision — B4's trigger captures them at the press (`prov`), the rest is read now — kept as the
 *     draft's `prov` and `pins`.
 *  3. The server (§2.4): the one the person picked in the work orders' settings, EXACTLY that server with its READ tools
 *     (onlyServer: setup + forced + allow; its OUT tools stay off) — or none: `mcp: false` (never the 'fixed' default, so
 *     no "All AI calls" server joins). Not taking part is noted ("ohne Server: <Grund>"); the tools left out with theirs.
 *  4. The answer: plan.ts readPlan; refused → ONE repair round (no server, the same request + the problems); still
 *     refused → 'failed' (malformed). Its notes (repo, branch, refs, links, keys) go with the draft.
 *  5. The draft (§2.8): this device's record (records.ts), state 'draft', the hash ↵ confirms (orderPlanHash), the
 *     receipt, the server's part (tools, left out, every call). With steps: Status → "Kette bereit" (writer
 *     `order:<row>:<run>#s`); with only questions / a refusal the Status stays "Planen" (the plate's "Rückfrage").
 * The Regler (§3.6): 'manual' at the line → 'brake' (the plate shows the BrakeSlot; its E / B retry plans again);
 * 'trigger' at the line → 'held' (one info toast, never a key). ⌘. → stopPlanning (runs.ts): 'stopped', nothing written.
 * `answerQuestions(rowId, answers)`: the answers under "Antworten" into the row's body as the person's write, then plan
 * again.
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../../store/store'
import { inTemplate, isEffectivelyTrashed } from '../../../store/selectors'
import type { Database, ID, Page } from '../../../store/types'
import { withWriter, type Writer } from '../../../store/writer'
import { matchMiss } from '../../../store/integrations'
import { newId } from '../../../lib/ids'
import { editAs, liveEditorOf, readableContent } from '../../../editor'
import { flushPageContent, useCloud } from '../../../cloud'
import { propertyValueToText } from '../../../database'
import { t } from '../../../i18n'
import { completeStructured } from '../../ai/client'
import { AIError, aiStatus, precheck, type Prepared, type SourceRef } from '../../ai/core'
import { routed, shapeOf, withShape } from '../../ai/core/shape'
import { offersAI } from '../../ai/setup/AINeedsSetup'
import { rowFactsFor } from '../../ai/rowFacts'
import { onlyServer, outToolsFor, readServers, refusedHere } from '../../ai/mcp-servers/config'
// a dependency-free leaf of the agents area (the Patchbay reads it the same way): the tool-name rules
import { declaredReadOk, isReadTool } from '../../agents/mcpTools'
import { budgetRefusal } from '../../governor'
import { useUI } from '../../../store/ui'
import { codingConnText, workerCaps, workerOnline, workerVerdict } from '..'
import { useCoding } from '../state'
import { codingReadOnly, currentProjectId, KIND_TEMPLATES, kindOfDb, readPipeline, templatePipeline, type ResolvedStage } from '../schema'
import { pipelineLine, runsFrom, startStageOf } from '../stages'
import { chainProjectProblem } from '../chain'
import { workerCan } from '../protocol'
import { taskRefPlan } from '../refs'
import { defaultApprovals } from '../state'
import { notifyAway } from '../notify'
import { scope } from '../local'
import { orderConfigUsable, readOrderConfig, ORDER_KINDS } from './config'
import { orderStatusProps } from './status'
import { hasChainProps } from './props'
import { checkPreconditions, wordChars, type KindProblem, type PlannerBlock } from './preconditions'
import { plannerPrompt, plannerSystem, repairPrompt, PLAN_SCHEMA, type PlannerInput, type PlannerPage, type PlannerPipeline } from './prompt'
import { orderPlanHash, readPlan, type PlanReadCtx, type ResolvedStep } from './plan'
import { pickedTools, serverSkip } from './tools'
import { emptyFold, foldCalls, type CallFold } from './calls'
import { loadOrderRecord, patchOrderRecord } from './records'
import { endSignal, patchRun, plannerRun, runSignal, startRun } from './runs'
import { ORDER_LIMITS, type OrderConfig, type OrderDraft, type OrderKind, type OrderPlanV1, type OrderProv, type OrderServerSkip, type OrderStatusKey, type PlanNote } from './types'
import type { Receipt } from '../../ai/core/meter'
import type { DataClass } from '@/shared/ai/types'

/** How a planner run ended. */
export type PlanOutcome =
  /** a plan with steps: the draft is stored, Status "Kette bereit" */
  | { kind: 'ready'; run: string; steps: number }
  /** no steps — questions or a refusal: the draft holds them, the Status stays "Planen" (chip "Rückfrage") */
  | { kind: 'questions'; run: string }
  /** a precondition failed (nothing read from a server, nothing sent) */
  | { kind: 'blocked'; block: PlannerBlock }
  /** this request plans already (here or in another tab), or this tab runs 3 plans */
  | { kind: 'busy' }
  /** a chain of this request is being created or runs (one open chain per request) */
  | { kind: 'chain' }
  /** the stored draft was edited on the plate: planning again asks first (`replace: true` after the person said yes) */
  | { kind: 'edited' }
  /** a manual run at the Regler's line: the plate asks (BrakeSlot with this error; its E / B retry plans again) */
  | { kind: 'brake'; run: string; error: AIError }
  /** a deferred run ('trigger') at the Regler's line: it stops — one info toast, no key */
  | { kind: 'held'; run: string }
  /** ⌘.: nothing was created */
  | { kind: 'stopped'; run: string }
  /** the request failed, or the answer was unusable after the repair round */
  | { kind: 'failed'; run: string; code: string; problems?: string[] }

export interface PlanOpts {
  mode: 'manual' | 'trigger'
  /** provenance B4's trigger captured at the press (from the write before the attribution keeper ran) */
  prov?: Record<ID, OrderProv>
  /** the person agreed to drop an edited draft (R → "Deine Änderungen an der Kette verwerfen?") */
  replace?: boolean
  /** answers given to the last draft's questions (answerQuestions) — kept with the new draft */
  answers?: Array<{ q: string; a: string }>
}

const ws = () => useWorkspace.getState()
const PURPOSE = 'coding.plan' as const
const MAX_TOKENS = 16_000
/** a run is noted per request and day when the Regler held it: one toast */
const heldToasts = new Set<string>()
/** requests planning in this tab (a second press of the same request: busy) */
const inflight = new Set<ID>()

/* ------------------------------------------------------------------ the request and its database */

interface Request {
  row: Page
  db: Database
  config: OrderConfig
  statusProp: ID | null
}

function requestOf(rowId: ID): Request | PlannerBlock {
  const s = ws()
  const row = s.pages[rowId]
  if (!row || !row.databaseId || isEffectivelyTrashed(s.pages, rowId) || inTemplate(s.pages, rowId)) return { why: 'gone' }
  const db = s.databases[row.databaseId]
  if (!db || db.system !== 'workorders') return { why: 'gone' }
  const read = readOrderConfig(db)
  if (!orderConfigUsable(read)) return { why: 'config' }
  return { row, db, config: read.config, statusProp: orderStatusProps(db)[0]?.id ?? null }
}

/** The kind names a Pipelines option may carry (EN / DE, the kinds' own words). */
const KIND_WORDS: Record<string, OrderKind> = {
  spec: 'spec',
  ba: 'spec',
  analysis: 'spec',
  analyse: 'spec',
  'business analysis': 'spec',
  'business-analyse': 'spec',
  'business-analysis': 'spec',
  'business analyse': 'spec',
  coding: 'coding',
  code: 'coding',
  qa: 'qa',
  test: 'qa',
  tests: 'qa',
}

/** The row's own Pipelines (a multi-select named "Pipelines", EN = DE): the kinds it names, null: none named. */
function rowKinds(req: Request): OrderKind[] | null {
  const prop = req.db.properties.find((p) => p.type === 'multi_select' && p.name.trim().toLowerCase() === 'pipelines')
  const v = prop ? req.row.properties?.[prop.id] : undefined
  if (!prop || !Array.isArray(v) || !v.length) return null
  const kinds = new Set<OrderKind>()
  for (const id of v) {
    const name = prop.options?.find((o) => o.id === id)?.name.trim().toLowerCase()
    const kind = name ? KIND_WORDS[name] : undefined
    if (kind) kinds.add(kind)
  }
  return kinds.size ? ORDER_KINDS.filter((k) => kinds.has(k)) : null
}

/* ------------------------------------------------------------------ projects */

interface KindProject {
  kind: OrderKind
  id: ID | null
  title: string
  pipeline: ResolvedStage[]
  problem: KindProblem | null
}

/** The default template's stages of a kind (the project confirming a chain would make). */
const templateOf = (kind: OrderKind): ResolvedStage[] => templatePipeline(KIND_TEMPLATES[kind][0]!).map(({ option, stage }, index) => ({ ...stage, name: option.name, color: option.color, index }))

/** Each offered kind's project: the one pinned in the settings, else the one #/coding shows, else one from the template. */
function projectsFor(kinds: readonly OrderKind[], req: Request): KindProject[] {
  const s = ws()
  const caps = workerCaps()
  const capSet = caps ? workerCan(caps) : null
  return kinds.map((kind): KindProject => {
    const pinned = req.config.projects?.[kind]
    if (pinned && (!s.databases[pinned] || kindOfDb(pinned) !== kind || isEffectivelyTrashed(s.pages, pinned)))
      return { kind, id: pinned, title: '', pipeline: [], problem: 'gone' }
    const id = pinned ?? currentProjectId(kind)
    const db = id ? s.databases[id] : undefined
    const pipeline = db ? readPipeline(db) : templateOf(kind)
    const title = id ? s.pages[id]?.title.trim() || t(`features.coding.pipe.${kind}`) : t(`features.coding.pipe.${kind}`)
    const problem = chainProjectProblem({ kind, pipeline, locked: !!db?.locked, hasRoles: id ? hasChainProps(id, req.db.id) : false, repo: true, caps: capSet })
    return { kind, id: id ?? null, title, pipeline, problem }
  })
}

/** Claude Code stages that need a repository (not document stages, not a pipeline that imports its code). */
const needsRepo = (pipeline: readonly ResolvedStage[]): boolean => !pipeline.some((s) => s.kind === 'import') && pipeline.some((s) => s.kind === 'plan' || s.kind === 'implement' || s.kind === 'test' || s.kind === 'git' || s.kind === 'analyze')

function pipelineFor(p: KindProject, approvals: 'all' | 'review' | 'none'): PlannerPipeline {
  const start = startStageOf(p.pipeline, true, true) ?? null
  return {
    kind: p.kind,
    project: p.title,
    isNew: !p.id,
    stages: p.pipeline.map((st) => st.name),
    starts: start?.name ?? null,
    stops: runsFrom(p.pipeline, start, approvals).stop?.name ?? null,
    needsRepo: needsRepo(p.pipeline),
    git: p.pipeline.filter((st) => st.kind === 'git').map((st) => `${st.name} (${st.gitAction ?? 'pr'})`),
  }
}

/* ------------------------------------------------------------------ provenance */

const provOf = (p: Page): OrderProv => ({ createdBy: p.createdBy ?? null, updatedBy: p.updatedBy ?? null, contentOrigin: p.contentOrigin ?? null, contentRev: p.contentRev })

/* ------------------------------------------------------------------ the server */

interface ServerPart {
  /** the server that takes part (its name), null: none */
  name: string | null
  skip: { server: string; why: OrderServerSkip } | null
  tools: string[]
  left: Array<{ tool: string; why: 'notRead' | 'out' | 'untested' }>
  call: { setup: NonNullable<ReturnType<typeof onlyServer>>['setup']; forced: string[]; allow: NonNullable<ReturnType<typeof onlyServer>>['allow'] } | null
}

function serverPart(config: OrderConfig, pre: Prepared): ServerPart {
  const name = config.server?.name ?? null
  if (!name) return { name: null, skip: null, tools: [], left: [], call: null }
  const server = readServers().find((s) => s.name === name) ?? null
  const why = serverSkip({
    server: server ? { name: server.name, enabled: server.enabled, tools: server.tools ?? null, refused: refusedHere(server) } : null,
    mayMcp: pre.allows('mcp'),
    anthropic: pre.provider === 'anthropic',
  })
  if (why || !server) return { name: null, skip: { server: name, why: why ?? 'missing' }, tools: [], left: [], call: null }
  // READ tools only: the matching profiles' declared reads (confirmed by name), else the names that read as reads
  const profiles = ws().integrations ?? []
  const declared = profiles.filter((p) => p.reads?.length && p.match && (p.match.name || p.match.host || p.match.tools?.length) && !matchMiss(p.match, { name: server.name, url: server.url, enabled: true, tools: server.tools })).flatMap((p) => p.reads ?? [])
  const picked = pickedTools(server.tools ?? [], outToolsFor(server), declared.length ? declared : null, { isRead: isReadTool, declaredOk: declaredReadOk })
  if (!picked.reads.length) return { name: null, skip: { server: name, why: 'noReads' }, tools: [], left: picked.left, call: null }
  const call = onlyServer(name, picked.reads)
  if (!call) return { name: null, skip: { server: name, why: 'off' }, tools: [], left: picked.left, call: null }
  return { name, skip: null, tools: picked.reads, left: picked.left, call }
}

/* ------------------------------------------------------------------ inputs */

interface Built {
  input: PlannerInput
  prompt: string
  system: string
  sources: SourceRef[]
  typed: string[]
  pages: PlannerPage[]
  read: { chars: number; pages: number; cut: boolean }
}

/** The request, its pages and the catalogue as request text for the route (shape). */
function build(req: Request, kinds: KindProject[], pre: Prepared, server: string | null, approvals: 'all' | 'review' | 'none'): Built {
  const shape = shapeOf(pre)
  return withShape(shape, () => {
    const row = req.row
    const own = readableContent(row.id).markdown
    const cut = own.length > ORDER_LIMITS.requestChars ? { shown: ORDER_LIMITS.requestChars, total: own.length } : null
    const text = cut ? own.slice(0, ORDER_LIMITS.requestChars) : own
    const fields = rowFactsFor(req.db, row, { shape, visible: pre.visible }, req.statusProp)
    const plan = taskRefPlan(row.id)
    const pages: PlannerPage[] = plan.refs
      .filter((r) => pre.visible(r.id))
      .slice(0, ORDER_LIMITS.linkedPages)
      .map((r) => ({ id: r.id, title: r.title, markdown: r.markdown.slice(0, ORDER_LIMITS.linkedChars), ...(r.via ? { via: r.via.title } : {}) }))
    const left = plan.left.filter((l) => !l.outside && l.why !== 'private').map((l) => l.title)
    const c = useCoding.getState()
    const repos = (c.worker?.repos ?? []).map((r) => ({ name: r.name, base: r.baseBranch, branches: (r.branches ?? []).filter((b) => b !== r.baseBranch).slice(0, 20), claudeMcp: (r.mcp ?? []).slice(0, 12) }))
    const input: PlannerInput = {
      request: { title: row.title.trim(), fields, text, cut },
      pages,
      left: left.slice(0, 20),
      pipelines: kinds.map((k) => pipelineFor(k, approvals)),
      repos,
      approvals,
      server,
    }
    const prompt = plannerPrompt(input)
    const system = plannerSystem({ kinds: kinds.map((k) => k.kind), server })
    return {
      input,
      prompt,
      system,
      sources: [{ row: row.id }, ...pages.map((p): SourceRef => ({ page: p.id }))],
      typed: [row.title, text],
      pages,
      read: { chars: text.length, pages: pages.length, cut: !!cut },
    }
  })
}

/* ------------------------------------------------------------------ the Status */

const statusKeyOf = (req: Request, value: unknown): OrderStatusKey | null => {
  for (const [k, id] of Object.entries(req.config.status)) if (id === value) return k as OrderStatusKey
  return null
}

/** Status → Kette bereit (the order writer `#s`) — only from Entwurf / Planen (or none): never over a running chain. */
function statusToReady(rowId: ID, run: string): void {
  const req = requestOf(rowId)
  if ('why' in req || !req.statusProp) return
  const now = statusKeyOf(req, req.row.properties?.[req.statusProp])
  if (now !== null && now !== 'draft' && now !== 'plan') return
  const writer: Writer = { kind: 'order', row: rowId, run, change: 's' }
  withWriter(writer, () => ws().setRowProperty(rowId, req.statusProp!, req.config.status.ready))
}

/** The request's id as people read it ("PA-12"), else its title. */
function orderLabel(req: Request): string {
  const prop = req.db.properties.find((p) => p.type === 'unique_id')
  const id = prop ? propertyValueToText(req.db, prop, req.row).trim() : ''
  return id || req.row.title.trim() || t('common.untitled')
}

/* ------------------------------------------------------------------ the run */

const lockName = (rowId: ID) => `one-order:${scope()}:${rowId}`

async function withRowLock<T>(rowId: ID, fn: () => Promise<T>): Promise<T | 'busy'> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!locks?.request) return fn()
  return (await locks.request(lockName(rowId), { ifAvailable: true }, async (lock) => (lock ? fn() : 'busy'))) as T | 'busy'
}

/** Plan a request (see the head of this file). Never throws. */
export async function planOrder(rowId: ID, opts: PlanOpts): Promise<PlanOutcome> {
  if (inflight.has(rowId) || inflight.size >= ORDER_LIMITS.runsPerTab) return { kind: 'busy' }
  inflight.add(rowId)
  try {
    const out = await withRowLock(rowId, () => planLocked(rowId, opts))
    return out === 'busy' ? { kind: 'busy' } : out
  } finally {
    inflight.delete(rowId)
  }
}

async function planLocked(rowId: ID, opts: PlanOpts): Promise<PlanOutcome> {
  const run = newId()
  startRun(rowId, run, opts.mode)
  // ⌘. stops the run from its first moment (nothing is created either way)
  const signal = runSignal(rowId, run)
  try {
    return await planRun(rowId, run, opts, signal)
  } finally {
    endSignal(rowId, run)
  }
}

async function planRun(rowId: ID, run: string, opts: PlanOpts, signal: AbortSignal): Promise<PlanOutcome> {
  const end = (outcome: PlanOutcome): PlanOutcome => {
    patchRun(rowId, run, { phase: 'done', outcome })
    return outcome
  }
  // the request
  const req = requestOf(rowId)
  if ('why' in req) return end({ kind: 'blocked', block: req })
  // one open chain per request; an edited draft asks first
  const rec = await loadOrderRecord(rowId)
  if (rec === 'unreadable') return end({ kind: 'blocked', block: { why: 'config' } })
  if (rec && (rec.state === 'running' || rec.state === 'creating' || rec.state === 'interrupted')) return end({ kind: 'chain' })
  if (rec?.state === 'draft' && rec.draft?.edited && !opts.replace) return end({ kind: 'edited' })

  // §2.2 items 1–6
  const offered = (() => {
    const row = rowKinds(req)
    return req.config.kinds.filter((k) => !row || row.includes(k))
  })()
  const projects = projectsFor(offered, req)
  const c = useCoding.getState()
  const pre6 = checkPreconditions({
    enabled: c.enabled,
    readOnly: codingReadOnly(),
    online: workerOnline(c),
    elsewhere: c.refused === 'other-device' || (!!c.relay?.online && c.conn !== 'connected'),
    connText: codingConnText(),
    verdict: workerVerdict(c),
    repos: c.worker?.repos.length ?? 0,
    docs: !!workerCaps(c) && workerCan(workerCaps(c)!).has('doc'),
    kinds: projects.map((p) => ({ kind: p.kind, problem: p.problem })),
  })
  if (!pre6.ok) return end({ kind: 'blocked', block: pre6.block })
  const usable = projects.filter((p) => pre6.usable.includes(p.kind))

  // item 7: AI for this kind of work, and the gate's precheck of what the request carries (nothing is read for it yet)
  const status = aiStatus(PURPOSE)
  if (!offersAI(status)) return end({ kind: 'blocked', block: { why: 'ai', reason: status.reason ?? 'no_key' } })
  const source = `order:${rowId}:${run}`
  const runCtx = { mode: opts.mode, source }
  const ids = taskRefPlan(rowId).refs.map((r) => r.id)
  const sources: SourceRef[] = [{ row: rowId }, ...ids.map((id): SourceRef => ({ page: id }))]
  let pre: Prepared
  try {
    pre = precheck({ purpose: PURPOSE, sources, typed: [req.row.title, readableContent(rowId).plain], carries: ['page'], run: runCtx, size: { promptChars: 8000, maxTokens: MAX_TOKENS } })
  } catch (e) {
    return end({ kind: 'blocked', block: { why: 'refused', code: e instanceof AIError ? e.code : 'unknown', error: e } })
  }

  // the server (decided before the text: the system prompt names it)
  const server = serverPart(req.config, pre)
  patchRun(rowId, run, { phase: 'reading', server: server.name, skip: server.skip, tools: server.tools, left: server.left })
  const approvals = defaultApprovals()
  const built = build(req, usable, pre, server.name, approvals)
  patchRun(rowId, run, { read: built.read })
  // item 8: the request plus its pages hold ≥ 40 characters of words
  const words = wordChars([built.input.request.title, built.input.request.text, ...built.pages.map((p) => p.markdown)].join('\n'))
  if (words < ORDER_LIMITS.minWords) return end({ kind: 'blocked', block: { why: 'empty' } })

  // provenance: what B4's trigger captured at the press, else now
  const s = ws()
  const prov: Record<ID, OrderProv> = {}
  for (const id of [rowId, ...built.pages.map((p) => p.id)]) {
    const p = opts.prov?.[id] ?? (s.pages[id] ? provOf(s.pages[id]!) : null)
    if (p) prov[id] = p
  }
  const pins: Record<ID, number> = Object.fromEntries(Object.entries(prov).map(([id, p]) => [id, p.contentRev]))

  // the request (and at most one repair round)
  if (signal.aborted) return end({ kind: 'stopped', run })
  const seen: { fold: CallFold; attached: string[] | null } = { fold: emptyFold(), attached: null }
  const carries: DataClass[] = ['page']
  const common = {
    purpose: PURPOSE,
    sources: built.sources,
    typed: built.typed,
    system: built.system,
    schema: PLAN_SCHEMA,
    maxTokens: MAX_TOKENS,
    signal,
    carries,
    run: runCtx,
    ledgerSource: source,
    onRun: (receipt: Receipt) => patchRun(rowId, run, { receipt }),
    ...routed(pre),
  }
  const ctx: PlanReadCtx = {
    kinds: usable.map((p) => p.kind),
    repos: (c.worker?.repos ?? []).map((r) => ({ name: r.name, base: r.baseBranch, branches: r.branches ?? [] })),
    refs: built.pages.map((p) => p.id),
    titleOf: (id) => ws().pages[id]?.title.trim() || null,
    server: server.name,
  }
  try {
    patchRun(rowId, run, { phase: 'asking' })
    const raw = await completeStructured({
      ...common,
      prompt: built.prompt,
      ...(server.call ? { setup: server.call.setup, forced: server.call.forced, allow: server.call.allow } : { mcp: false as const }),
      onMcpActivity: (a) => {
        if (!server.name) return
        seen.attached = [...a.attached]
        seen.fold = foldCalls(seen.fold, a.blocks, server.name)
        patchRun(rowId, run, { calls: seen.fold.calls })
      },
    })
    // the picked server could not join after all (no token in this browser): said, the plan stands without it
    const took = !!server.name && !!seen.attached?.includes(server.name)
    const skip = server.skip ?? (server.name && !took ? { server: server.name, why: 'token' as const } : null)
    if (server.name && !took) patchRun(rowId, run, { server: null, skip })
    let read = readPlan(raw, { ...ctx, server: took ? server.name : null })
    if (!read.ok) {
      patchRun(rowId, run, { phase: 'repair' })
      const again = await completeStructured({ ...common, prompt: repairPrompt(built.prompt, raw, read.problems), mcp: false })
      read = readPlan(again, { ...ctx, server: took ? server.name : null }, { scrub: true })
      if (!read.ok) return end({ kind: 'failed', run, code: 'malformed', problems: read.problems })
    }
    patchRun(rowId, run, { phase: 'writing', notes: read.notes })
    const src = { prov, pins, server: took ? server.name : null, tools: took ? server.tools : [], left: server.left, calls: seen.fold.calls, ...(skip ? { skip } : {}) }
    return end(await writeDraft(rowId, run, req, read.plan, read.notes, usable, approvals, src, opts))
  } catch (e) {
    if (e instanceof AIError && e.code === 'aborted') return end({ kind: 'stopped', run })
    if (budgetRefusal(e) && e instanceof AIError) {
      if (opts.mode === 'manual') return end({ kind: 'brake', run, error: e })
      noteHeld(req, rowId)
      return end({ kind: 'held', run })
    }
    return end({ kind: 'failed', run, code: e instanceof AIError ? e.code : 'unknown' })
  }
}

/** A deferred run held at the Regler's line: one info toast per request and day (background — never over a dialog). */
function noteHeld(req: Request, rowId: ID): void {
  const key = `${rowId}|${new Date().toDateString()}`
  if (heldToasts.has(key)) return
  heldToasts.add(key)
  useUI.getState().toast({ message: t('features.coding.order.planner.held', { id: orderLabel(req) }), kind: 'info', background: true })
}

/** The draft into this device's record, the Status to "Kette bereit" (steps) — see the head of this file. */
async function writeDraft(
  rowId: ID,
  run: string,
  req: Request,
  plan: OrderPlanV1,
  notes: PlanNote[],
  projects: KindProject[],
  approvals: 'all' | 'review' | 'none',
  src: Omit<OrderDraft['source'], 'rev'>,
  opts: PlanOpts,
): Promise<PlanOutcome> {
  const resolved: ResolvedStep[] = plan.steps.map((step) => {
    const p = projects.find((x) => x.kind === step.kind)!
    return { project: p.id, park: pipelineLine(p.pipeline, !!step.repo, false, approvals), start: pipelineLine(p.pipeline, !!step.repo, true, approvals) }
  })
  const hash = await orderPlanHash(plan, resolved, approvals)
  const draft: OrderDraft = {
    plan,
    hash,
    at: Date.now(),
    run,
    receipt: plannerRun(rowId)?.receipt ?? null,
    edited: false,
    source: { ...src, rev: src.prov[rowId]?.contentRev ?? req.row.contentRev },
    ...(opts.answers?.length ? { answers: opts.answers } : {}),
    ...(notes.length ? { notes } : {}),
  }
  let blocked = false
  const wrote = await patchOrderRecord(rowId, (rec) => {
    // a chain started meanwhile (another tab): the plan is not written over it
    if (rec && (rec.state === 'running' || rec.state === 'creating' || rec.state === 'interrupted')) {
      blocked = true
      return rec
    }
    const { want: _want, ...rest } = rec ?? { v: 1 as const, state: 'draft' as const }
    return { ...rest, v: 1, state: 'draft', draft }
  })
  if (blocked) return { kind: 'chain' }
  if (!wrote.ok) return { kind: 'failed', run, code: 'record' }
  if (!plan.steps.length) return { kind: 'questions', run }
  statusToReady(rowId, run)
  notifyAway(rowId, t('features.coding.order.planner.notify.ready', { id: orderLabel(req) }))
  return { kind: 'ready', run, steps: plan.steps.length }
}

/* ------------------------------------------------------------------ answers */

const YOU: Writer = { kind: 'you', via: 'ui' }

/**
 * The person's answers to the planner's questions: written under "Antworten" at the end of the request's body (the
 * person's write — through the open editor when there is one), then the request is planned again ('manual'). Empty
 * answers are left out; none at all: nothing written, nothing planned (null).
 */
export async function answerQuestions(rowId: ID, answers: ReadonlyArray<{ q: string; a: string }>): Promise<PlanOutcome | null> {
  const given = answers.map((x) => ({ q: x.q.replace(/\s+/g, ' ').trim().slice(0, 300), a: x.a.trim().slice(0, 2000) })).filter((x) => x.q && x.a)
  if (!given.length) return null
  const req = requestOf(rowId)
  if ('why' in req) return { kind: 'blocked', block: req }
  // nothing written where planning could not follow: a viewer, a locked request, a chain that runs
  if (codingReadOnly()) return { kind: 'blocked', block: { why: 'readOnly' } }
  if (req.row.settings?.locked) return { kind: 'blocked', block: { why: 'locked' } }
  const rec = await loadOrderRecord(rowId)
  if (rec === 'unreadable') return { kind: 'blocked', block: { why: 'config' } }
  if (rec && (rec.state === 'running' || rec.state === 'creating' || rec.state === 'interrupted')) return { kind: 'chain' }
  const text = (s: string): JSONContent => ({ type: 'text', text: s })
  const blocks: JSONContent[] = [
    { type: 'heading', attrs: { level: 3 }, content: [text(t('features.coding.order.planner.answers'))] },
    ...given.flatMap((x): JSONContent[] => [
      { type: 'paragraph', content: [{ type: 'text', text: x.q, marks: [{ type: 'bold' }] }] },
      ...x.a.split(/\n+/).map((line): JSONContent => ({ type: 'paragraph', ...(line.trim() ? { content: [text(line.trim())] } : {}) })),
    ]),
  ]
  const editor = liveEditorOf(rowId)
  if (editor && !editor.isDestroyed && editor.isEditable) editAs(editor, YOU, () => editor.chain().insertContentAt(editor.state.doc.content.size, blocks).run())
  else {
    if (useCloud.getState().active.kind === 'cloud') flushPageContent(rowId)
    const page = ws().pages[rowId]
    if (!page) return { kind: 'blocked', block: { why: 'gone' } }
    const content = (page.content?.content ?? []) as JSONContent[]
    withWriter(YOU, () => ws().setContent(rowId, { type: 'doc', content: [...content, ...blocks] }, 'answers'))
  }
  return planOrder(rowId, { mode: 'manual', replace: true, answers: given })
}
