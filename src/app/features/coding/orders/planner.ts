/**
 * Work orders — the planner (spec §2.1–§2.7), B5. `planOrder(rowId, { mode })` turns a request row into a draft plan on
 * this device: ONE structured request (purpose `coding.plan`, completeStructured) — not a custom agent, no tool loop of
 * One's. It runs in this tab under the Web Lock `one-order:<scope>:<row>` (a second press: "plant schon"; ≤ 3 runs per
 * tab). Only the entry points of the allow-list (B4: Status → Planen written as `you`, the command Planen, ↵ Planen,
 * Prüfen lassen) and a press kept for the worker's return (mode 'trigger') call it — through press.ts `callPlanner`,
 * as the press's run (`run`: its Planen write, this run's Status write and the ledger source share it) with the
 * provenance captured at the press (`prov`) — nothing else ever plans.
 *
 *  1. Preconditions (§2.2), in order, before anything is read or sent (preconditions.ts items 1–6 from facts.ts — the
 *     same facts and rules the press checked, read again here; then: AI for this kind of work, the gate's precheck of
 *     the request's sources — a data rule, a key typed into the request, newer rules — and the empty check). Each
 *     failure is an outcome with its reason; the Status stays as it is. The kinds: the row's Pipelines, else the
 *     settings' (facts.ts requestKinds); each kind's project as facts.ts kindProjects names it.
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
import { endRun, noteRun, withWriter, type Writer } from '../../../store/writer'
import { newId } from '../../../lib/ids'
import { docToMarkdown, editAs, liveEditorOf, readableContent } from '../../../editor'
import { flushPageContent, useCloud } from '../../../cloud'
import { propertyValueToText } from '../../../database'
import { t } from '../../../i18n'
import { completeStructured } from '../../ai/client'
import { AIError, aiStatus, precheck, type Prepared, type SourceRef } from '../../ai/core'
import { routed, shapeOf, withShape } from '../../ai/core/shape'
import { offersAI } from '../../ai/setup/AINeedsSetup'
import { rowFactsFor } from '../../ai/rowFacts'
import { onlyServer, readServers, refusedHere } from '../../ai/mcp-servers/config'
import { budgetRefusal } from '../../governor'
import { useUI } from '../../../store/ui'
import { useCoding } from '../state'
import { codingProps, codingReadOnly, readPipeline, stageOfRow, type ResolvedStage } from '../schema'
import { pipelineLine, pipelineNeedsRepo, runsFrom, startStageOf } from '../stages'
import { taskRefPlan } from '../refs'
import { defaultApprovals } from '../state'
import { notifyAway } from '../notify'
import { orderConfigUsable, readOrderConfig } from './config'
import { orderStatusProps } from './status'
import { requestFacts, type KindProject } from './facts'
import { checkPreconditions, wordChars, type PlannerBlock } from './preconditions'
import { plannerPrompt, plannerSystem, repairPrompt, PLAN_SCHEMA, type PlannerDone, type PlannerInput, type PlannerPage, type PlannerPipeline } from './prompt'
import { orderPlanHash, readPlan, type PlanReadCtx, type ResolvedStep } from './plan'
import { serverSkip } from './tools'
import { serverReads } from './serverTools'
import { emptyFold, foldCalls, type CallFold } from './calls'
import { loadOrderRecord, orderScope, patchOrderRecord } from './records'
import { pageShown, requestFp, requestNow, shownFp, textFp } from './fingerprint'
import { loadRowOutside, outsideOf } from './rowWriters'
import { pressProv } from './press'
import { provOutside } from './autoCore'
import { endSignal, patchRun, plannerRun, runSignal, startRun } from './runs'
import { ORDER_LIMITS, type OrderConfig, type OrderDraft, type OrderPlanV1, type OrderProv, type OrderRecord, type OrderServerSkip, type OrderStatusKey, type PlanNote } from './types'
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
  /**
   * the press's run (press.ts callPlanner — the run its Planen write carries): this run's Status write
   * (`order:<row>:<run>#s`), the draft and the ledger source `order:<row>:<run>` share it. Absent: a new run.
   */
  run?: string
  /**
   * "Ab hier neu planen" (chainKeys.ts replanFrom, R on the analysis card): plan again after step `from` of the running
   * chain was done — the planner reads the done steps' results (`<done>`) and plans only what comes after them; the
   * draft stands beside the chain (its parked steps stay held) until ↵ replaces them, or D brings the chain back
   */
  from?: number
  /** O "Ohne Server neu planen" on the plate: this run plans without the picked server (`mcp: false`, nothing noted) */
  noServer?: boolean
  /** Orders B11: fingerprints the press took (press.ts) — kept with the draft for auto mode's "moved since the press" */
  pressFps?: Record<ID, string>
}

const ws = () => useWorkspace.getState()
const RUN_RE = /^[A-Za-z0-9_-]{1,64}$/
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

/* ------------------------------------------------------------------ projects */

/** Claude Code stages that need a repository (not document stages, not a pipeline that imports its code). */
const needsRepo = pipelineNeedsRepo

function pipelineFor(p: KindProject, approvals: 'all' | 'review' | 'none'): PlannerPipeline {
  const start = startStageOf(p.pipeline, true, true) ?? null
  return {
    kind: p.kind,
    project: p.title,
    isNew: !p.project,
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
  const picked = serverReads(server)
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

/**
 * "Ab hier neu planen": the done steps of the running chain up to step `n` (each with its result as Markdown — its own
 * chain blocks left out, ≤ 20 000 characters in all) — null unless the chain runs, step `n` is done and the step after
 * it has not started.
 */
function doneSteps(rec: OrderRecord, n: number): { run: string; steps: PlannerDone[] } | null {
  const chain = rec.chain
  if (rec.state !== 'running' || !chain || chain.halted) return null
  const steps = [...chain.steps].sort((a, b) => a.n - b.n)
  const at = steps.findIndex((st) => st.n === n)
  if (at < 0) return null
  const next = steps.slice(at + 1).find((st) => !(chain.skipped ?? []).includes(st.n))
  if (!next || chain.advanced?.[next.n] !== undefined) return null
  const s = ws()
  const out: PlannerDone[] = []
  let left = ORDER_LIMITS.basisChars
  for (const st of steps.slice(0, at + 1)) {
    if ((chain.skipped ?? []).includes(st.n)) continue
    const page = s.pages[st.id]
    const db = page?.databaseId ? s.databases[page.databaseId] : undefined
    // step `n` itself must be done; an earlier step that is not (trashed, gone …) is left out
    const stage = page && db ? stageOfRow(readPipeline(db), codingProps(db), page) : null
    if (!page || stage?.kind !== 'done') {
      if (st.n === n) return null
      continue
    }
    const drop = new Set([...(st.basisBlock ? [st.basisBlock] : []), ...(st.own ?? [])])
    const blocks = ((page.content?.content ?? []) as JSONContent[]).filter((b) => !(typeof b.attrs?.id === 'string' && drop.has(b.attrs.id)))
    const markdown = docToMarkdown({ type: 'doc', content: blocks }).slice(0, Math.max(0, left))
    left -= markdown.length
    out.push({ id: st.id, n: st.n, kind: st.kind, title: page.title.trim(), markdown })
  }
  return out.length ? { run: chain.run, steps: out } : null
}

/** The request, its pages and the catalogue as request text for the route (shape). */
function build(req: Request, kinds: KindProject[], pre: Prepared, server: string | null, approvals: 'all' | 'review' | 'none', done: readonly PlannerDone[] = []): Built {
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
      ...(done.length ? { done } : {}),
    }
    const prompt = plannerPrompt(input)
    const system = plannerSystem({ kinds: kinds.map((k) => k.kind), server, done: done.length > 0 })
    return {
      input,
      prompt,
      system,
      sources: [{ row: row.id }, ...pages.map((p): SourceRef => ({ page: p.id })), ...done.map((d): SourceRef => ({ page: d.id }))],
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

/**
 * Status → Kette bereit (the order writer `#s`) — only from Entwurf / Planen (or none): never over a running chain;
 * `replan`: a plan made again from a done step of the running chain — from Läuft too.
 */
function statusToReady(rowId: ID, run: string, replan = false): void {
  const req = requestOf(rowId)
  if ('why' in req || !req.statusProp) return
  const now = statusKeyOf(req, req.row.properties?.[req.statusProp])
  if (now !== null && now !== 'draft' && now !== 'plan' && !(replan && now === 'running')) return
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

const lockName = (rowId: ID) => `one-order:${orderScope()}:${rowId}`

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
  // the press's run (press.ts callPlanner: its Planen write carries it), else a new one (answers, the e2e seam)
  const run = opts.run && RUN_RE.test(opts.run) ? opts.run : newId()
  startRun(rowId, run, opts.mode)
  // ⌘. stops the run from its first moment (nothing is created either way)
  const signal = runSignal(rowId, run)
  // Orders B10: the one run bus — the Patchbay's planner module blinks while it plans (writer `order:<row>:<run>`)
  const busWriter: Writer = { kind: 'order', row: rowId, run }
  noteRun(busWriter)
  try {
    return await planRun(rowId, run, opts, signal)
  } finally {
    endSignal(rowId, run)
    endRun(busWriter)
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
  const rec = await loadOrderRecord(rowId, { fresh: true })
  if (rec === 'unreadable') return end({ kind: 'blocked', block: { why: 'config' } })
  // planning again from a done step of the running chain (its next step not started yet): the done steps go along
  const done = opts.from !== undefined && rec ? doneSteps(rec, opts.from) : null
  if (opts.from !== undefined && !done) return end({ kind: 'chain' })
  if (!done && rec && (rec.state === 'running' || rec.state === 'creating' || rec.state === 'interrupted')) return end({ kind: 'chain' })
  if (rec?.state === 'draft' && rec.draft?.edited && !opts.replace) return end({ kind: 'edited' })

  // §2.2 items 1–6 — the same facts and rules as the press (facts.ts, preconditions.ts): checked again here, as the
  // worker, the projects or the settings may have moved since (a kept press plans up to 24 h later)
  const facts = requestFacts(rowId)
  const projects = facts.kinds
  const pre6 = checkPreconditions(facts)
  if (!pre6.ok) return end({ kind: 'blocked', block: pre6.block })
  const usable = projects.filter((p) => pre6.usable.includes(p.kind))
  const c = useCoding.getState()

  // item 7: AI for this kind of work, and the gate's precheck of what the request carries (nothing is read for it yet)
  const status = aiStatus(PURPOSE)
  if (!offersAI(status)) return end({ kind: 'blocked', block: { why: 'ai', reason: status.reason ?? 'no_key' } })
  const source = `order:${rowId}:${run}`
  const runCtx = { mode: opts.mode, source }
  const ids = [...taskRefPlan(rowId).refs.map((r) => r.id), ...(done?.steps ?? []).map((d) => d.id)]
  const sources: SourceRef[] = [{ row: rowId }, ...ids.map((id): SourceRef => ({ page: id }))]
  let pre: Prepared
  try {
    pre = precheck({ purpose: PURPOSE, sources, typed: [req.row.title, readableContent(rowId).plain], carries: ['page'], run: runCtx, size: { promptChars: 8000, maxTokens: MAX_TOKENS } })
  } catch (e) {
    return end({ kind: 'blocked', block: { why: 'refused', code: e instanceof AIError ? e.code : 'unknown', error: e } })
  }

  // the server (decided before the text: the system prompt names it)
  const server: ServerPart = opts.noServer ? { name: null, skip: null, tools: [], left: [], call: null } : serverPart(req.config, pre)
  patchRun(rowId, run, { phase: 'reading', server: server.name, skip: server.skip, tools: server.tools, left: server.left })
  const approvals = defaultApprovals()
  const built = build(req, usable, pre, server.name, approvals, done?.steps ?? [])
  patchRun(rowId, run, { read: built.read })
  // item 8: the request plus its pages hold ≥ 40 characters of words
  const words = wordChars([built.input.request.title, built.input.request.text, ...built.pages.map((p) => p.markdown)].join('\n'))
  if (words < ORDER_LIMITS.minWords) return end({ kind: 'blocked', block: { why: 'empty' } })

  // provenance: what B4's trigger captured at the press, else now
  const s = ws()
  const prov: Record<ID, OrderProv> = {}
  for (const id of [rowId, ...built.pages.map((p) => p.id)]) {
    let p = opts.prov?.[id] ?? (s.pages[id] ? provOf(s.pages[id]!) : null)
    // Fix 2: the request's title / fields written by someone other than the person (rowWriters.ts) — also for a plan made
    // from no press (the answers to its questions)
    if (p && id === rowId && !p.outside) {
      const outside = outsideOf(await loadRowOutside(rowId), s.pages[rowId])
      if (outside) p = { ...p, outside }
    }
    if (p) prov[id] = p
  }
  const pins: Record<ID, number> = Object.fromEntries(Object.entries(prov).map(([id, p]) => [id, p.contentRev]))
  // fingerprints of what the planner reads — the request as every step quotes it, each linked page (fingerprint.ts):
  // ↵ Kette starten refuses when one moved since (never the tab-local contentRev); the chain pins its pages at these
  const readNow = { request: requestNow(rowId), pages: built.pages.map((p) => [p.id, s.pages[p.id] ? pageShown(s.pages[p.id]) : null] as const) }
  const fps: Record<ID, string> = { [rowId]: await requestFp(readNow.request) }
  for (const [id, shown] of readNow.pages) if (shown) fps[id] = await shownFp(shown)

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
    const src = { prov, pins, fps, server: took ? server.name : null, tools: took ? server.tools : [], left: server.left, calls: seen.fold.calls, ...(skip ? { skip } : {}) }
    return end(await writeDraft(rowId, run, req, read.plan, read.notes, usable, approvals, src, opts, done ? { n: opts.from!, run: done.run } : undefined))
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
  from?: { n: number; run: string },
): Promise<PlanOutcome> {
  const resolved: ResolvedStep[] = plan.steps.map((step) => {
    const p = projects.find((x) => x.kind === step.kind)!
    return { project: p.project, park: pipelineLine(p.pipeline, !!step.repo, false, approvals), start: pipelineLine(p.pipeline, !!step.repo, true, approvals) }
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
    ...(from ? { from } : {}),
    ...(opts.pressFps && Object.keys(opts.pressFps).length ? { pressFps: opts.pressFps } : {}),
  }
  let blocked = false
  const wrote = await patchOrderRecord(rowId, (rec) => {
    // planned again from a done step: only while that chain still waits before its next step (it stays beside the draft)
    if (from) {
      if (!rec || !doneStepsStill(rec, from)) {
        blocked = true
        return rec
      }
      return { ...rec, state: 'draft', draft }
    }
    // a chain started meanwhile (another tab): the plan is not written over it
    if (rec && (rec.state === 'running' || rec.state === 'creating' || rec.state === 'interrupted')) {
      blocked = true
      return rec
    }
    // planned here: a kept press is spent, a request from another device answered (Orders B12)
    const { want: _want, asked: _asked, ...rest } = rec ?? { v: 1 as const, state: 'draft' as const }
    // a follow-up plan over a halted or finished chain: that state is kept with the draft (D brings it back as it was)
    const over = rec?.chain && (rec.state === 'halted' || rec.state === 'done') ? rec.state : rec?.state === 'draft' ? rec.draft?.over : undefined
    return { ...rest, v: 1, state: 'draft', draft: over ? { ...draft, over } : draft }
  })
  if (blocked) return { kind: 'chain' }
  if (!wrote.ok) return { kind: 'failed', run, code: 'record' }
  if (!plan.steps.length) return { kind: 'questions', run }
  statusToReady(rowId, run, !!from)
  notifyAway(rowId, t('features.coding.order.planner.notify.ready', { id: orderLabel(req) }))
  return { kind: 'ready', run, steps: plan.steps.length }
}

/** The chain a replan was made from still runs and still waits before the step after `from.n`. */
function doneStepsStill(rec: OrderRecord, from: { n: number; run: string }): boolean {
  const chain = rec.chain
  if (rec.state !== 'running' || !chain || chain.run !== from.run || chain.halted) return false
  const steps = [...chain.steps].sort((a, b) => a.n - b.n)
  const at = steps.findIndex((st) => st.n === from.n)
  const next = at < 0 ? undefined : steps.slice(at + 1).find((st) => !(chain.skipped ?? []).includes(st.n))
  return !!next && chain.advanced?.[next.n] === undefined
}

/* ------------------------------------------------------------------ answers */

/**
 * The provenance a plan after the answers takes: what was captured before the answers were written, an earlier draft's
 * outside writer kept per page (an earlier answers round wrote 'answers' over it), the row's revision as it is after the
 * answers (the pins match the stored body).
 */
export function answersProv(rowId: ID, captured: Record<ID, OrderProv>, before: Record<ID, OrderProv> | undefined, rowRev: number | undefined): Record<ID, OrderProv> {
  const out: Record<ID, OrderProv> = {}
  for (const [id, p] of Object.entries(captured)) {
    const was = before?.[id]
    out[id] = was && provOutside(was) && !provOutside(p) ? { ...was, contentRev: p.contentRev } : p
  }
  if (out[rowId] && rowRev !== undefined) out[rowId] = { ...out[rowId]!, contentRev: rowRev }
  return out
}

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
  // the provenance before the answers are written (as a press captures it): the answers are the person's, the body
  // above them is not made the person's by them — an earlier draft's outside origin stays (fail closed)
  const captured = pressProv(ws().pages, rowId).prov
  const before = rec?.state === 'draft' ? rec.draft?.source.prov : undefined
  const editor = liveEditorOf(rowId)
  if (editor && !editor.isDestroyed && editor.isEditable) editAs(editor, YOU, () => editor.chain().insertContentAt(editor.state.doc.content.size, blocks).run())
  else {
    if (useCloud.getState().active.kind === 'cloud') flushPageContent(rowId)
    const page = ws().pages[rowId]
    if (!page) return { kind: 'blocked', block: { why: 'gone' } }
    const content = (page.content?.content ?? []) as JSONContent[]
    withWriter(YOU, () => ws().setContent(rowId, { type: 'doc', content: [...content, ...blocks] }, 'answers'))
  }
  const out = await planOrder(rowId, { mode: 'manual', replace: true, answers: given, prov: answersProv(rowId, captured, before, ws().pages[rowId]?.contentRev) })
  // Orders B11: the answers go on with the press — with this device's consent, a finished plan starts as after a press
  if (out.kind === 'ready') await import('./autoStart').then((m) => m.autoAfterPlan(rowId, out.run)).catch(() => null)
  return out
}
