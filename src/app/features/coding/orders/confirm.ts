/**
 * Work orders — confirming a plan (spec §2.9, B6): `startChain(row, hash)` turns the plan the person saw into its chain's
 * pipeline tasks; `undoChain(row)` takes them back as a whole; `finishCreates` / `finishRest` / `discardMade` deal with
 * a creation a closed tab left half done. Lazy (the plate, the seam and the boot pass load it).
 *
 * startChain holds the request's lock (`one-order:<scope>:<row>`, the planner's) and refuses unless this device's record
 * is a draft whose plan, resolved now, has exactly the shown hash — a double ↵ or another tab is a no-op.
 *  Phase 1 — check, write nothing to tasks:
 *   - the request stands in Kette bereit; §2.2 items 1–6 hold here (preconditions.ts over facts.ts); every step's kind
 *     has a usable project;
 *   - the plan's hash again (plan.ts orderPlanHash: the steps, each step's resolved project and pipeline lines, this
 *     device's Approvals) — a mismatch: "Kette geändert, neu anzeigen";
 *   - every step against the shared task checks (draft.ts checkTaskDraft — the worker's repos and branches, locked
 *     projects …), a repo where the step's pipeline needs one, the chain roles possible on every target project
 *     (props.ts chainPropsCheck);
 *   - then the projects a kind still lacks are made (its default template — the lines must stay the ones hashed) and
 *     the roles added (ensureChainProps), under the chain's writer `order:<row>:<run>`. Any failure: a refusal, no task.
 *  Phase 2 — create, all parked:
 *   - the task ids are minted first and the record goes to 'creating' with every step (write-ahead);
 *   - the older chain's steps still parked go to the trash (the plate said so before ↵), the chain keeps them as
 *     `replaced` (an Undo brings them back);
 *   - per step `applyNewTask` with `start: false` under `order:<row>:<run>#c<n>` — its page: the slot (steps ≥ 2), the
 *     request quote, the server's context (first step), goal, criteria, the pages that go along (stepPage.ts); every
 *     block with its id; the Prüfauftrag / Schritt roles in the same createRow; trusted on this device, this device's
 *     Approvals stamped (createTask);
 *   - a throw: every step made so far to the trash under its own `#c<n>`, the older steps back, the record back to its
 *     draft — the Status stays Kette bereit;
 *   - else: 'running', `startAt` = now + 10 s (the Undo window), Status → Läuft (`#s`); chainRun.ts starts step 01 then.
 * undoChain (Z, `you~undo`): all or nothing — refused once a step was taken (started, claimed, running, moved) or
 * changed (its text or title since it was made); else every step to the trash, the older chain back, the request back to
 * Kette bereit with its plan.
 * finishCreates (start of a tab, for a record left 'creating'): completes the chain only while every step made is
 * untouched (its text, title and stage as made, nothing ran), the press was ≤ 10 min ago and each step still to make is
 * exactly what was confirmed (its `sig`); otherwise the record becomes 'interrupted' — the plate offers the two VON HAND
 * keys "Angelegte verwerfen" (discardMade) and "Rest anlegen" (finishRest, §2.2 again).
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../../store/store'
import { flushSave } from '../../../store/persistence'
import { looksLikeKey } from '@/shared/ai/keys'
import { isEffectivelyTrashed } from '../../../store/selectors'
import type { ID } from '../../../store/types'
import { withWriter, type Writer } from '../../../store/writer'
import { newId } from '../../../lib/ids'
import { docToMarkdown, readableBlocks } from '../../../editor'
import { pageFp, quoteTitleOf, requestFp, requestNow, textFp } from './fingerprint'
import { withHalt } from '../chain'
import { currentLang, t } from '../../../i18n'
import { canonicalJson } from '../protocol'
import { codingProps, codingReadOnly, ensurePipelineDb, kindOfDb, readPipeline, stageOfRow } from '../schema'
import { pipelineLine, pipelineNeedsRepo, startStageOf } from '../stages'
import { checkTaskDraft, type DraftIssue, type NewTaskInput } from '../draft'
import { applyNewTask, draftWorld, planNewTask, type NewTaskPlan } from '../terminal'
import { taskBody } from '../tasks'
import { addTrusted, loadTask, taskLocal } from '../local'
import { refPagesOf } from '../refs'
import { defaultApprovals, useCoding } from '../state'
import { checkPreconditions, type KindProblem, type PlannerBlock } from './preconditions'
import { requestFacts, type KindProject } from './facts'
import { orderPlanHash, type ResolvedStep } from './plan'
import { chainPropsCheck, ensureChainProps, type ChainPropsResult } from './props'
import { orderCode, orderStatusKey, writeOrderStatus } from './db'
import { orderConfigUsable, readOrderConfig, orderAgent } from './config'
import { loadOrderRecord, orderRowLock, orderScope, patchOrderRecord } from './records'
import { followRecord, orderWriter, unschedule } from './chainRun'
import { stepBlockIds, stepPage } from './stepPage'
import { stepWords } from './words'
import { taskVersionView } from '../terminal'
import { carried, chainCarriers, chainKeyBlock, claimedElsewhere, heldIds } from './lamp'
import { ORDER_LIMITS, type OrderChain, type OrderChainStep, type OrderDraft, type OrderKind, type OrderRecord } from './types'

const ws = () => useWorkspace.getState()
const asRecord = (r: OrderRecord | null | 'unreadable' | undefined): OrderRecord | null => (r && r !== 'unreadable' ? r : null)

/** A creation left 'creating' is completed without asking only this soon after the press (§2.9). */
export const FINISH_WINDOW_MS = 10 * 60_000

/* ------------------------------------------------------------------ outcomes */

/** Why a chain did not start (the plate words each; nothing was created). */
export type StartRefusal =
  /** the request's lock is held: a start (or a plan) of it runs — a double ↵, another tab */
  | { why: 'busy' }
  /** no draft to start on this device (started already, discarded, none) */
  | { why: 'state' }
  /** the shown plan is not the plan now (its hash, a project's pipeline, the Approvals): show it again */
  | { why: 'changed' }
  /** the request does not stand in Kette bereit */
  | { why: 'status' }
  /** the plan has no steps */
  | { why: 'empty' }
  /** §2.2 items 1–6 */
  | { why: 'pre'; block: PlannerBlock }
  /** a step's kind has no usable project now */
  | { why: 'kind'; step: number; kind: OrderKind; problem: KindProblem }
  /** a step fails the shared task checks (draft.ts) */
  | { why: 'draft'; step: number; issues: DraftIssue[] }
  /** a step without a repo whose pipeline needs one */
  | { why: 'repo'; step: number }
  /** a step's project cannot take the chain roles (locked, another work-orders database's) */
  | { why: 'props'; step: number; result: Exclude<ChainPropsResult, 'ok' | 'added'> }
  /** creating step n threw — every step made is in the trash again, the plan stands */
  | { why: 'failed'; step: number; error: string }
  /** this device could not keep the record */
  | { why: 'record' }
  /**
   * the request (page = the row) or a page a step takes along changed since the planner read it (its fingerprint): what
   * ↵ would send along is not what was planned — plan again
   */
  | { why: 'source'; page: ID }
  /** the request's text holds a key-shaped string (never quoted into a step) */
  | { why: 'keys' }
  /** a step still to make is no longer exactly what was confirmed (its sig): the rest is not made — discard and plan again */
  | { why: 'unconfirmed'; step: number }

export type StartOutcome = { ok: true; steps: ID[]; startAt: number } | ({ ok: false } & StartRefusal)
export type UndoOutcome = { ok: true } | { ok: false; why: 'busy' | 'state' | 'taken' | 'changed' }
export type FinishOutcome = { ok: true; created: number } | ({ ok: false } & (StartRefusal | { why: 'taken' }))

/* ------------------------------------------------------------------ locks */

const rowLock = orderRowLock
const chainLock = (rowId: ID) => `one-order-chain:${orderScope()}:${rowId}`
/** requests this tab is starting / taking back (without Web Locks: the only guard) */
const inflight = new Set<ID>()

async function withLocks<T>(rowId: ID, fn: () => Promise<T>): Promise<T | 'busy'> {
  if (inflight.has(rowId)) return 'busy'
  inflight.add(rowId)
  try {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
    if (!locks?.request) return await fn()
    return (await locks.request(rowLock(rowId), { ifAvailable: true }, async (lock) => (lock ? locks.request(chainLock(rowId), fn) : 'busy'))) as T | 'busy'
  } finally {
    inflight.delete(rowId)
  }
}

/* ------------------------------------------------------------------ e2e: a fault while creating */

/**
 * DEV / `?e2e` only (the seam sets it): before creating the step at this position (1-based) of a chain, 'throw' — as
 * a create that fails — or 'hold' — the tab stops there for good (a reload finds the record 'creating').
 */
let fault: { at: number; mode: 'throw' | 'hold' } | null = null
export const setCreateFault = (f: { at: number; mode: 'throw' | 'hold' } | null): void => {
  fault = f
}

/* ------------------------------------------------------------------ the steps */

async function sha256(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const titleOf = quoteTitleOf
const live = (id: ID) => {
  const s = ws()
  const p = s.pages[id]
  return !!p && !p.trashed && !isEffectivelyTrashed(s.pages, id)
}

interface BuiltStep {
  /** the step as the record keeps it */
  chain: OrderChainStep
  /** what applyNewTask creates */
  plan: NewTaskPlan
}

const stepInput = (step: OrderDraft['plan']['steps'][number], projectId: ID | null): NewTaskInput => ({
  kind: step.kind,
  projectId,
  title: step.title,
  goal: step.goal,
  criteria: step.criteria,
  repo: step.repo,
  branch: step.branch,
  priority: step.priority,
  then: [],
  start: false,
})

/**
 * One step of a plan as it is created: its task (planNewTask — the shared checks again, against `project` as it is now),
 * its page (stepPage.ts) and its record entry with the `sig` of what is created.
 */
async function buildStep(
  rowId: ID,
  draft: OrderDraft,
  i: number,
  o: { n: number; after: number | null; id: ID; project: ID; run: string; approvals: 'all' | 'review' | 'none'; request: readonly JSONContent[] },
): Promise<{ ok: true; step: BuiltStep } | { ok: false; refusal: StartRefusal }> {
  const step = draft.plan.steps[i]!
  const input = stepInput(step, o.project)
  const { issues } = checkTaskDraft(input, draftWorld())
  if (issues.length) return { ok: false, refusal: { why: 'draft', step: o.n, issues } }
  let planned: NewTaskPlan
  try {
    planned = planNewTask(input)
  } catch (e) {
    return { ok: false, refusal: { why: 'failed', step: o.n, error: e instanceof Error ? e.message : String(e) } }
  }
  const refs = step.refs.filter(live).slice(0, ORDER_LIMITS.linkedPages)
  const page = stepPage({
    taskId: o.id,
    after: o.after,
    code: orderCode(rowId) ?? (ws().pages[rowId]?.title.trim() || t('common.untitled')),
    request: o.request,
    context: (i === 0 || draft.plan.delivery) && draft.source.server && draft.plan.context ? draft.plan.context : null,
    ...(draft.plan.delivery ? { delivery: draft.plan.delivery, covers: step.covers, needs: (step.needs ?? []).map(n => ({ n: o.n - i + n - 1, title: draft.plan.steps[n - 1]!.title })) } : {}),
    refs: refs.map((id) => ({ id, label: ws().pages[id]?.private ? '' : titleOf(id) })),
    titleOf,
    words: stepWords(t, currentLang()),
  })
  const body = taskBody({ goal: '', goalDoc: planned.goalDoc, criteria: planned.criteria, lead: page.lead, extra: page.extra })
  const text = docToMarkdown({ type: 'doc', content: body }).trim()
  const config = readOrderConfig(ws().databases[ws().pages[rowId]?.databaseId ?? ''])
  const agent = config.kind === 'ok' ? orderAgent(config.config, step.kind) : undefined
  const plan: NewTaskPlan = { ...planned, ...(agent ? { agent } : {}), then: [], start: false, id: o.id, order: { rowId, step: o.n, run: o.run }, lead: page.lead, extra: page.extra, refs: refPagesOf(body), text }
  const pipeline = readPipeline(ws().databases[o.project])
  const sig = await sha256(canonicalJson([step.kind, o.project, planned.title, planned.repo, planned.branch, planned.priority, text, ...(agent ? [agent] : [])]))
  return {
    ok: true,
    step: {
      plan,
      chain: {
        n: o.n,
        ...(draft.plan.delivery ? { delivery: { requirements: draft.plan.delivery.requirements.filter(r => step.covers?.includes(r.id)), acceptance: draft.plan.delivery.acceptance } } : {}),
        ...(step.needs ? { needs: step.needs.map(n => o.n - i + n - 1) } : {}),
        id: o.id,
        kind: step.kind,
        project: o.project,
        line: pipelineLine(pipeline, !!planned.repo, true, o.approvals),
        approvals: o.approvals,
        // pinned at the planner's read (startChain checked the pages still are exactly that); '' = unknown — asks
        refs: Object.fromEntries(refs.map((id) => [id, draft.source.fps?.[id] ?? ''])),
        basisBlock: page.basisBlock,
        own: page.own,
        title: planned.title,
        sig,
      },
    },
  }
}

/** The steps of an older chain of the request still waiting in their park stage (they go to the trash at the start). */
export function olderParked(rec: OrderRecord | null): Array<{ n: number; id: ID }> {
  const chain = rec?.chain
  if (!chain) return []
  const s = ws()
  const skipped = new Set(chain.skipped ?? [])
  const busy = new Set(useCoding.getState().busy.map((b) => b.taskId))
  return chain.steps
    .filter((st) => chain.advanced?.[st.n] === undefined && !skipped.has(st.n) && live(st.id) && !busy.has(st.id))
    .filter((st) => {
      const page = s.pages[st.id]!
      const db = page.databaseId ? s.databases[page.databaseId] : undefined
      if (!db) return false
      const pipeline = readPipeline(db)
      const props = codingProps(db)
      const repo = props.repo ? page.properties[props.repo] : null
      return stageOfRow(pipeline, props, page)?.id === startStageOf(pipeline, !!repo, false)?.id
    })
    .map((st) => ({ n: st.n, id: st.id }))
}

/** Is a made step untouched since it was created (its text, title and stage as made; nothing ran, nobody claimed it)? */
async function untouched(step: OrderChainStep, planTitle: string): Promise<'ok' | 'taken' | 'changed'> {
  const s = ws()
  const page = s.pages[step.id]!
  const db = page.databaseId ? s.databases[page.databaseId] : undefined
  if (!db || !kindOfDb(db.id)) return 'changed'
  await loadTask(step.id)
  const local = taskLocal(step.id)
  const props = codingProps(db)
  const claimed = props.worker ? String(page.properties[props.worker] ?? '').trim() : ''
  if (useCoding.getState().busy.some((b) => b.taskId === step.id) || local.state !== 'idle' || claimed) return 'taken'
  const pipeline = readPipeline(db)
  const repo = props.repo ? page.properties[props.repo] : null
  if (stageOfRow(pipeline, props, page)?.id !== startStageOf(pipeline, !!repo, false)?.id) return 'changed'
  if (page.contentRev !== (step.rev ?? 0) || page.title !== (step.title ?? planTitle)) return 'changed'
  return 'ok'
}

/* ------------------------------------------------------------------ creating */

/** Create the built steps in order (phase 2); a throw or the e2e fault ends it — `made` = the ids created so far. */
async function createSteps(rowId: ID, run: string, steps: BuiltStep[], offset = 0): Promise<{ ok: true } | { ok: false; step: number; error: string }> {
  for (let k = 0; k < steps.length; k++) {
    const b = steps[k]!
    try {
      if (fault && fault.at === offset + k + 1) {
        if (fault.mode === 'hold') await new Promise<never>(() => {})
        throw new Error('e2e fault')
      }
      const out = await applyNewTask(b.plan, orderWriter(rowId, run, `c${b.chain.n}`))
      if (out.id !== b.chain.id) throw new Error('id')
      const page = ws().pages[out.id]
      await patchOrderRecord(rowId, (r) =>
        r?.chain?.run === run && (r.state === 'creating' || r.state === 'interrupted')
          ? { ...r, chain: { ...r.chain, made: { ...(r.chain.made ?? {}), [b.chain.n]: out.id }, steps: r.chain.steps.map((st) => (st.n === b.chain.n ? { ...st, rev: page?.contentRev ?? 0, title: page?.title ?? b.plan.title } : st)) } }
          : r,
      )
    } catch (e) {
      return { ok: false, step: b.chain.n, error: e instanceof Error ? e.message : String(e) }
    }
  }
  return { ok: true }
}

/**
 * The chain runs: 'running', the 10 s count from now, Status → Läuft (`#s`); this tab follows the count. Unless the
 * request was halted meanwhile — Status Angehalten (by anyone), moved away from Kette bereit by hand, trashed, or a halt
 * the trigger recorded while the steps were being made: then the record goes 'halted' (sticky; ↵ Fortsetzen) and the
 * Status stays as it is. This tab's save is flushed first, so another open tab holds the new steps before the record
 * tells it the chain runs.
 */
async function toRunning(rowId: ID, run: string): Promise<{ ok: boolean; startAt: number; rec: OrderRecord | null }> {
  await Promise.race([flushSave().catch(() => undefined), new Promise((r) => setTimeout(r, 2000))])
  const status = orderStatusKey(rowId)
  const stop = !live(rowId) ? ('trashed' as const) : status !== 'ready' && status !== 'running' ? ('status' as const) : null
  const startAt = Date.now() + ORDER_LIMITS.startDelayMs
  const done = await patchOrderRecord(rowId, (r) => {
    if (r?.chain?.run !== run || (r.state !== 'creating' && r.state !== 'interrupted')) return r
    const { made: _made, ...chain } = r.chain
    if (chain.halted || stop) return { ...r, state: 'halted', chain: withHalt({ ...chain, startAt }, { why: stop ?? 'status', by: 'order' }, Date.now()) }
    return { ...r, state: 'running', chain: { ...chain, startAt } }
  })
  if (!done.ok || (done.rec?.state !== 'running' && done.rec?.state !== 'halted') || done.rec.chain?.run !== run) return { ok: false, startAt, rec: done.rec }
  if (done.rec.state === 'running') writeOrderStatus(rowId, 'running', orderWriter(rowId, run, 's'))
  followRecord(rowId, done.rec)
  return { ok: true, startAt, rec: done.rec }
}

/** The record back to its draft (the older chain as it was, none when there was none). */
const backToDraft = (r: OrderRecord, older: OrderChain | undefined): OrderRecord => {
  const { chain: _c, ...rest } = r
  return { ...rest, state: 'draft', ...(older ? { chain: older } : {}) }
}

/** Every step of `run` made so far to the trash (each under its own `#c<n>`), the older chain's steps back. */
function rollback(rowId: ID, run: string, steps: readonly OrderChainStep[], restore: readonly ID[]): void {
  for (const st of steps) if (ws().pages[st.id] && !ws().pages[st.id]!.trashed) withWriter(orderWriter(rowId, run, `c${st.n}`), () => ws().trashPage(st.id))
  if (restore.length) withWriter(orderWriter(rowId, run), () => restore.forEach((id) => ws().restorePage(id)))
}

/* ------------------------------------------------------------------ the hash ↵ confirms */

/** Each step's project and pipeline lines as they resolve on this device now (the planner's ResolvedStep). */
function resolveSteps(draft: OrderDraft, kp: readonly KindProject[], approvals: 'all' | 'review' | 'none', config?: import('./types').OrderConfig): ResolvedStep[] {
  return draft.plan.steps.map((st, i) => { const agent = config ? orderAgent(config, st.kind) : undefined; return { ...(agent ? { agent } : {}), ...(config?.qaRepairs && st.kind === 'qa' ? { repair: { attempts: config.qaRepairs, agent: orderAgent(config, 'coding') ?? 'claude' } } : {}), project: kp[i]!.project, park: pipelineLine(kp[i]!.pipeline, !!st.repo, false, approvals), start: pipelineLine(kp[i]!.pipeline, !!st.repo, true, approvals) } })
}

/**
 * The hash of the plan as it resolves on this device NOW (plan.ts orderPlanHash — what the plate shows and ↵ confirms):
 * equal to the draft's own while nothing moved since it was planned; a project made, a pipeline or the Approvals changed
 * since: another one (the plate shows the plan again). Null: a step's kind has no project here now.
 */
export async function planHashNow(rowId: ID, draft: OrderDraft): Promise<string | null> {
  const kinds = requestFacts(rowId).kinds
  const kp: KindProject[] = []
  for (const st of draft.plan.steps) {
    const p = kinds.find((k) => k.kind === st.kind)
    if (!p) return null
    kp.push(p)
  }
  const approvals = defaultApprovals()
  const config = readOrderConfig(ws().databases[ws().pages[rowId]?.databaseId ?? ''])
  return orderPlanHash(draft.plan, resolveSteps(draft, kp, approvals, config.kind === 'ok' ? config.config : undefined), approvals)
}

/* ------------------------------------------------------------------ startChain */

/**
 * ↵ Kette starten (VON HAND): see the head of this file. `hash`: the plan's hash as the plate rendered it (planHashNow —
 * the draft's own unless something moved since it was planned).
 */
export async function startChain(rowId: ID, hash: string): Promise<StartOutcome> {
  const out = await withLocks(rowId, () => startLocked(rowId, hash))
  return out === 'busy' ? { ok: false, why: 'busy' } : out
}

async function startLocked(rowId: ID, hash: string): Promise<StartOutcome> {
  const fail = (r: StartRefusal): StartOutcome => ({ ok: false, ...r })
  const rec = asRecord(await loadOrderRecord(rowId, { fresh: true }))
  if (!rec || rec.state !== 'draft' || !rec.draft) return fail({ why: 'state' })
  const draft = rec.draft
  if (!draft.plan.steps.length) return fail({ why: 'empty' })

  // phase 1 — the request, §2.2, every step's project
  const s = ws()
  const row = s.pages[rowId]
  const ordersDb = row?.databaseId ?? null
  const read = readOrderConfig(ordersDb ? s.databases[ordersDb] : undefined)
  if (!row || !ordersDb || !live(rowId) || read.kind !== 'ok' || !orderConfigUsable(read)) return fail({ why: 'state' })
  if (orderStatusKey(rowId) !== 'ready') return fail({ why: 'status' })
  const facts = requestFacts(rowId)
  const pre = checkPreconditions(facts)
  if (!pre.ok) return fail({ why: 'pre', block: pre.block })
  const steps = draft.plan.steps
  const kp: KindProject[] = []
  for (let i = 0; i < steps.length; i++) {
    const p = facts.kinds.find((k) => k.kind === steps[i]!.kind)
    if (!p || p.problem) return fail({ why: 'kind', step: i + 1, kind: steps[i]!.kind, problem: p?.problem ?? 'gone' })
    kp.push(p)
    if (draft.plan.delivery && steps[i]!.kind === 'coding' && p.pipeline.some(st => st.kind === 'git' && st.gitAction === 'merge')) return fail({ why: 'failed', step: i + 1, error: t('features.coding.order.plan.mergeBeforeQa') })
  }
  // the plan as the plate showed it: the same hash over the steps, projects, lines and this device's Approvals now
  const approvals = defaultApprovals()
  const resolved = resolveSteps(draft, kp, approvals, read.config)
  if ((await orderPlanHash(draft.plan, resolved, approvals)) !== hash) return fail({ why: 'changed' })
  // what every step quotes and takes along must be exactly what the planner read (fingerprints, never the tab-local
  // contentRev): a request an agent, the bridge or the sync added to since — or a linked page that moved — is planned
  // again first; the text read here is the one quoted (no second read below)
  const request = requestNow(rowId)
  if (looksLikeKey(request.text) || looksLikeKey(row.title)) return fail({ why: 'keys' })
  const fps = draft.source.fps ?? {}
  if (!fps[rowId] || (await requestFp(request)) !== fps[rowId]) return fail({ why: 'source', page: rowId })
  for (const id of new Set(steps.flatMap((st) => st.refs.filter(live)))) if (!fps[id] || (await pageFp(ws().pages[id])) !== fps[id]) return fail({ why: 'source', page: id })

  // every step against the shared checks and its project's needs (projects not made yet: their template)
  const world = draftWorld()
  for (let i = 0; i < steps.length; i++) {
    const { issues } = checkTaskDraft(stepInput(steps[i]!, kp[i]!.project), world)
    if (issues.length) return fail({ why: 'draft', step: i + 1, issues })
    if (!steps[i]!.repo && steps[i]!.kind !== 'coding' && pipelineNeedsRepo(kp[i]!.pipeline)) return fail({ why: 'repo', step: i + 1 })
    const project = kp[i]!.project
    if (project) {
      const props = chainPropsCheck(project, ordersDb)
      if (props === 'locked' || props === 'other' || props === 'gone') return fail({ why: 'props', step: i + 1, result: props })
    }
  }
  if (codingReadOnly()) return fail({ why: 'pre', block: { why: 'readOnly' } })

  // phase 1 — the writes before any task: the projects a kind lacks, the chain roles (the chain's writer)
  const run = newId()
  const setup = orderWriter(rowId, run)
  const projects = new Map<OrderKind, ID>()
  for (let i = 0; i < steps.length; i++) {
    const kind = steps[i]!.kind
    if (projects.has(kind)) continue
    let id = kp[i]!.project
    if (!id) {
      try {
        id = withWriter(setup, () => ensurePipelineDb(kind))
      } catch {
        return fail({ why: 'pre', block: { why: 'readOnly' } })
      }
      // the project made from the kind's template: the lines hashed must hold for it
      const pipeline = readPipeline(ws().databases[id])
      for (let j = 0; j < steps.length; j++)
        if (steps[j]!.kind === kind && (pipelineLine(pipeline, !!steps[j]!.repo, false, approvals) !== resolved[j]!.park || pipelineLine(pipeline, !!steps[j]!.repo, true, approvals) !== resolved[j]!.start)) return fail({ why: 'changed' })
    }
    const props = ensureChainProps(id, ordersDb, setup)
    if (props !== 'ok' && props !== 'added') return fail({ why: 'props', step: i + 1, result: props })
    projects.set(kind, id)
  }

  // the steps: ids minted, numbers after the older chain's, each built and checked again
  const older = rec.chain
  const base = older ? Math.max(...older.steps.map((st) => st.n)) : 0
  // planned again from a done step of the older chain ("Ab hier neu planen"): that step's result is the first step's
  // Grundlage (its slot "Wartet auf Schritt 01") — only while that chain still waits before its next step
  const from = draft.from && older && older.run === draft.from.run ? older.steps.find((st) => st.n === draft.from!.n) : undefined
  if (draft.from && !from) return fail({ why: 'state' })
  const built: BuiltStep[] = []
  for (let i = 0; i < steps.length; i++) {
    const n = base + i + 1
    const b = await buildStep(rowId, draft, i, { n, after: i ? n - 1 : (from?.n ?? null), id: newId(), project: projects.get(steps[i]!.kind)!, run, approvals, request: request.blocks })
    if (!b.ok) return fail(b.refusal)
    built.push(b.step)
  }
  const trash = olderParked(rec).map((x) => x.id)
  const now = Date.now()
  const chain: OrderChain = {
    run,
    confirmedAt: now,
    startAt: now + ORDER_LIMITS.startDelayMs,
    steps: built.map((b) => b.chain),
    doneBy: {},
    halted: null,
    checkpoint: read.config.checkpoint,
    ...(read.config.qaRepairs ? { repair: { attempts: read.config.qaRepairs, agent: orderAgent(read.config, 'coding') ?? 'claude' } } : {}),
    // the budget set on the plate for this chain (null: none), else the work orders' settings
    ...(draft.budget !== undefined ? (draft.budget !== null ? { budgetUsd: draft.budget } : {}) : read.config.budgetUsd !== undefined ? { budgetUsd: read.config.budgetUsd } : {}),
    ...(older ? { replaced: { chain: older, trashed: trash } } : {}),
    ...(from ? { basis: { n: from.n, id: from.id, kind: from.kind, title: titleOf(from.id), drop: [...(from.basisBlock ? [from.basisBlock] : []), ...(from.own ?? [])] } } : {}),
  }

  // phase 2 — write-ahead, then create (all parked)
  let lost = false
  const ahead = await patchOrderRecord(rowId, (r) => {
    // the draft read above, unchanged (a plan or an edit meanwhile: nothing is created)
    if (!r || r.state !== 'draft' || r.draft?.run !== draft.run || r.draft.hash !== draft.hash) {
      lost = true
      return r
    }
    return { ...r, state: 'creating', draft: { ...r.draft, hash }, chain }
  })
  if (lost) return fail({ why: 'state' })
  if (!ahead.ok) return fail({ why: 'record' })
  if (trash.length) withWriter(setup, () => trash.forEach((id) => ws().trashPage(id)))
  const made = await createSteps(rowId, run, built)
  if (!made.ok) {
    rollback(rowId, run, chain.steps, trash)
    await patchOrderRecord(rowId, (r) => (r?.chain?.run === run ? backToDraft(r, older) : r))
    return fail({ why: 'failed', step: made.step, error: made.error })
  }
  const running = await toRunning(rowId, run)
  if (!running.ok) return fail({ why: 'record' })
  return { ok: true, steps: built.map((b) => b.chain.id), startAt: running.startAt }
}

/* ------------------------------------------------------------------ undoChain */

/** Z (`you~undo`) — all or nothing (see the head of this file). */
export async function undoChain(rowId: ID): Promise<UndoOutcome> {
  const out = await withLocks(rowId, () => undoLocked(rowId))
  return out === 'busy' ? { ok: false, why: 'busy' } : out
}

async function undoLocked(rowId: ID): Promise<UndoOutcome> {
  const rec = asRecord(await loadOrderRecord(rowId, { fresh: true }))
  const chain = rec?.chain
  if (!rec || rec.state !== 'running' || !chain) return { ok: false, why: 'state' }
  if (Object.keys(chain.advanced ?? {}).length || chain.adopted !== undefined) return { ok: false, why: 'taken' }
  const titles = new Map((rec.draft?.plan.steps ?? []).map((st, i) => [chain.steps[i]?.id, st.title.replace(/\s+/g, ' ').trim()]))
  for (const step of chain.steps) {
    if (!live(step.id)) continue
    const state = await untouched(step, titles.get(step.id) ?? '')
    if (state !== 'ok') return { ok: false, why: state }
  }
  unschedule(rowId)
  const undo: Writer = { kind: 'you', via: 'undo' }
  withWriter(undo, () => {
    for (const step of chain.steps) if (live(step.id)) ws().trashPage(step.id)
    for (const id of chain.replaced?.trashed ?? []) ws().restorePage(id)
  })
  await patchOrderRecord(rowId, (r) => (r?.chain?.run === chain.run && r.state === 'running' ? backToDraft(r, chain.replaced?.chain) : r))
  writeOrderStatus(rowId, 'ready', undo)
  return { ok: true }
}

/** May the running chain still be taken back as a whole (Z)? 'taken' / 'changed' once not. */
export async function undoable(rowId: ID): Promise<'ok' | 'taken' | 'changed' | 'state'> {
  const rec = asRecord(await loadOrderRecord(rowId))
  const chain = rec?.chain
  if (!rec || rec.state !== 'running' || !chain) return 'state'
  if (Object.keys(chain.advanced ?? {}).length || chain.adopted !== undefined) return 'taken'
  for (const step of chain.steps) {
    if (!live(step.id)) continue
    const state = await untouched(step, step.title ?? '')
    if (state !== 'ok') return state
  }
  return 'ok'
}

/* ------------------------------------------------------------------ a creation left half done */

/** The steps of a 'creating' / 'interrupted' chain not made yet (in order), with what they need to be built. */
function missingSteps(chain: OrderChain): Array<{ i: number; step: OrderChainStep }> {
  const sorted = [...chain.steps].sort((a, b) => a.n - b.n)
  return sorted.flatMap((step, i) => (ws().pages[step.id] ? [] : [{ i, step }]))
}

/** Build the steps still to make exactly as the record holds them (ids, numbers, projects). */
async function rebuild(rowId: ID, rec: OrderRecord, chain: OrderChain): Promise<{ ok: true; steps: BuiltStep[] } | { ok: false; refusal: StartRefusal }> {
  const draft = rec.draft
  if (!draft || draft.plan.steps.length !== chain.steps.length) return { ok: false, refusal: { why: 'state' } }
  const sorted = [...chain.steps].sort((a, b) => a.n - b.n)
  const out: BuiltStep[] = []
  for (const { i, step } of missingSteps(chain)) {
    if (!ws().databases[step.project] || kindOfDb(step.project) !== step.kind) return { ok: false, refusal: { why: 'kind', step: step.n, kind: step.kind, problem: 'gone' } }
    const b = await buildStep(rowId, draft, i, { n: step.n, after: i ? sorted[i - 1]!.n : (chain.basis?.n ?? null), id: step.id, project: step.project, run: chain.run, approvals: step.approvals, request: readableBlocks(rowId) })
    if (!b.ok) return b
    // the record's entry stays as confirmed; the task is built again
    out.push({ plan: b.step.plan, chain: { ...step, sig: b.step.chain.sig } })
  }
  return { ok: true, steps: out }
}

/** At start: every record of `rows` left 'creating' by a closed tab — completed, or 'interrupted' (see the head). */
export async function finishCreates(rows: readonly ID[]): Promise<void> {
  for (const rowId of rows) {
    await withLocks(rowId, async () => {
      const rec = asRecord(await loadOrderRecord(rowId, { fresh: true }))
      const chain = rec?.chain
      if (!rec || rec.state !== 'creating' || !chain) return
      const interrupt = async () => {
        await patchOrderRecord(rowId, (r) => (r?.state === 'creating' && r.chain?.run === chain.run ? { ...r, state: 'interrupted' } : r))
      }
      if (codingReadOnly() || Date.now() - chain.confirmedAt > FINISH_WINDOW_MS) return interrupt()
      const titles = rec.draft?.plan.steps ?? []
      const sorted = [...chain.steps].sort((a, b) => a.n - b.n)
      for (let i = 0; i < sorted.length; i++) {
        const step = sorted[i]!
        if (!ws().pages[step.id]) continue
        if (!live(step.id) || (await untouched(step, titles[i]?.title.replace(/\s+/g, ' ').trim() ?? '')) !== 'ok') return interrupt()
      }
      const built = await rebuild(rowId, rec, chain)
      if (!built.ok) return interrupt()
      // each step still to make must be exactly what was confirmed (its sig built again)
      const confirmed = new Map(chain.steps.map((st) => [st.id, st.sig]))
      if (built.steps.some((b) => !b.chain.sig || confirmed.get(b.chain.id) !== b.chain.sig)) return interrupt()
      const made = await createSteps(rowId, chain.run, built.steps, chain.steps.length - built.steps.length)
      if (!made.ok) return interrupt()
      await toRunning(rowId, chain.run)
    })
  }
}

/** "Rest anlegen" (VON HAND): an interrupted chain's missing steps made now (§2.2 again), then it runs. */
export async function finishRest(rowId: ID): Promise<FinishOutcome> {
  const out = await withLocks(rowId, async (): Promise<FinishOutcome> => {
    const rec = asRecord(await loadOrderRecord(rowId, { fresh: true }))
    const chain = rec?.chain
    if (!rec || rec.state !== 'interrupted' || !chain) return { ok: false, why: 'state' }
    const pre = checkPreconditions(requestFacts(rowId))
    if (!pre.ok) return { ok: false, why: 'pre', block: pre.block }
    const built = await rebuild(rowId, rec, chain)
    if (!built.ok) return { ok: false, ...built.refusal }
    // each step still to make must be exactly what was confirmed (its sig) — the request or a page moved since: not made
    const confirmed = new Map(chain.steps.map((st) => [st.id, st.sig]))
    const off = built.steps.find((b) => !b.chain.sig || confirmed.get(b.chain.id) !== b.chain.sig)
    if (off) return { ok: false, why: 'unconfirmed', step: off.chain.n }
    const made = await createSteps(rowId, chain.run, built.steps, chain.steps.length - built.steps.length)
    if (!made.ok) return { ok: false, why: 'failed', step: made.step, error: made.error }
    const running = await toRunning(rowId, chain.run)
    return running.ok ? { ok: true, created: built.steps.length } : { ok: false, why: 'record' }
  })
  return out === 'busy' ? { ok: false, why: 'busy' } : out
}

/** "Angelegte verwerfen" (VON HAND): the steps an interrupted chain made go to the trash; the plan stands again. */
export async function discardMade(rowId: ID): Promise<FinishOutcome> {
  const out = await withLocks(rowId, async (): Promise<FinishOutcome> => {
    const rec = asRecord(await loadOrderRecord(rowId, { fresh: true }))
    const chain = rec?.chain
    if (!rec || rec.state !== 'interrupted' || !chain) return { ok: false, why: 'state' }
    const busy = new Set(useCoding.getState().busy.map((b) => b.taskId))
    if (chain.steps.some((st) => busy.has(st.id))) return { ok: false, why: 'taken' }
    const you: Writer = { kind: 'you', via: 'ui' }
    let trashed = 0
    withWriter(you, () => {
      for (const st of chain.steps)
        if (live(st.id)) {
          ws().trashPage(st.id)
          trashed++
        }
      for (const id of chain.replaced?.trashed ?? []) ws().restorePage(id)
    })
    await patchOrderRecord(rowId, (r) => (r?.chain?.run === chain.run && r.state === 'interrupted' ? backToDraft(r, chain.replaced?.chain) : r))
    return { ok: true, created: -trashed }
  })
  return out === 'busy' ? { ok: false, why: 'busy' } : out
}

/* ------------------------------------------------------------------ Kette bestätigen (a chain made elsewhere) */

export type ConfirmChainOutcome =
  | { ok: true; steps: number }
  | {
      ok: false
      /** busy: the request's lock is held · state: this device holds a chain of it, or it does not stand in Läuft ·
       *  changed: a step is not (exactly) the version the card rendered, or the steps are not the ones it listed — nothing
       *  was trusted, shown again · numbers: the Schritt numbers are missing or doubled · the chain guard's reasons */
      why: 'busy' | 'state' | 'changed' | 'numbers' | 'record' | 'readOnly' | 'elsewhere' | 'outdated' | 'unsafe' | 'steered'
    }

/** A chain of at most this many steps can be taken over (the record reader's bound). */
const ADOPT_MAX = 24

/**
 * Preflight's "Kette bestätigen" (VON HAND; spec §3.4 / §3.10): a request in Läuft whose chain this device holds no record
 * of — the worker moved to this device, or the workspace came back from a backup — gets this device's record, built
 * from exactly the steps the card listed (their Prüfauftrag relation; their Schritt numbers ordered them, the person saw
 * each step in full). All or nothing: every step must still be exactly the version the card rendered (its hash) — any
 * other one, a step more or less: nothing is trusted, nothing is written ('changed', the card shows them again). Then each
 * version is trusted on this device, the record says which tasks are the chain (its pipeline lines and this device's
 * Approvals now, the pages each takes along pinned at their fingerprints), steps already under way count as started and
 * done ones as passed by this press; the engine goes on from there (step 01 at once when it still waits). Z never takes
 * such a chain back (`adopted`). The writer of everything after is the chain's own (`order:<row>:<run>`).
 */
export async function confirmChainVersions(rowId: ID, shown: ReadonlyArray<{ id: ID; hash: string }>): Promise<ConfirmChainOutcome> {
  const block = chainKeyBlock()
  if (block) return { ok: false, why: block }
  const out = await withLocks(rowId, async (): Promise<ConfirmChainOutcome> => {
    const rec = asRecord(await loadOrderRecord(rowId, { fresh: true }))
    if (carried(rec) || orderStatusKey(rowId) !== 'running' || !live(rowId)) return { ok: false, why: 'state' }
    const carriers = chainCarriers(rowId, heldIds(rec))
    if (!carriers.length || carriers.length !== shown.length || carriers.some((c, i) => c.id !== shown[i]!.id)) return { ok: false, why: 'changed' }
    const ns = carriers.map((c) => c.n)
    if (carriers.length > ADOPT_MAX || ns.some((n) => n === null) || new Set(ns).size !== ns.length) return { ok: false, why: 'numbers' }
    // Fix 2: a step another worker has claimed — that device steers the chain; this one never takes it over
    if (claimedElsewhere(carriers.map((c) => c.id))) return { ok: false, why: 'steered' }
    // every version exactly as the card rendered it — checked for all before any is trusted
    const views = []
    for (let i = 0; i < carriers.length; i++) {
      const view = await taskVersionView(carriers[i]!.id)
      if (!view || view.hash !== shown[i]!.hash) return { ok: false, why: 'changed' }
      views.push(view)
    }
    for (const v of views) await addTrusted(v.hash)
    const s = ws()
    const row = s.pages[rowId]!
    const read = readOrderConfig(row.databaseId ? s.databases[row.databaseId] : undefined)
    const approvals = defaultApprovals()
    const now = Date.now()
    const advanced: Record<number, number> = {}
    const doneBy: OrderChain['doneBy'] = {}
    const steps: OrderChainStep[] = []
    for (let i = 0; i < carriers.length; i++) {
      const c = carriers[i]!
      const page = s.pages[c.id]!
      const db = s.databases[c.project]!
      const props = codingProps(db)
      const pipeline = readPipeline(db)
      const repo = props.repo ? page.properties[props.repo] : null
      const stage = stageOfRow(pipeline, props, page)
      const n = c.n!
      // under way (out of its park stage) counts as started; done as passed by this press — never as "saw the next step"
      // (`sawNext`): the card's view of each version is not read to its end here, so a checkpoint after it asks once
      if (stage && stage.id !== startStageOf(pipeline, !!repo, false)?.id) advanced[n] = now
      if (stage?.kind === 'done') doneBy[n] = { kind: 'you', via: 'preflight', at: now }
      const ids = stepBlockIds(c.id)
      const refs: Record<ID, string> = {}
      for (const r of views[i]!.refs) refs[r.id] = await pageFp(ws().pages[r.id])
      steps.push({
        n,
        id: c.id,
        kind: c.kind,
        project: c.project,
        line: pipelineLine(pipeline, !!repo, true, approvals),
        approvals,
        refs,
        basisBlock: i > 0 ? ids.slot : null,
        own: [...(i > 0 ? [ids.slot] : []), ids.request, ids.context, ids.refs],
        title: page.title,
        rev: page.contentRev,
      })
    }
    const chain: OrderChain = {
      run: newId(),
      confirmedAt: now,
      startAt: now,
      steps,
      doneBy,
      halted: null,
      checkpoint: read.kind === 'ok' ? read.config.checkpoint : true,
      ...(read.kind === 'ok' && read.config.budgetUsd !== undefined ? { budgetUsd: read.config.budgetUsd } : {}),
      ...(Object.keys(advanced).length ? { advanced, moved: { ...advanced } } : {}),
      adopted: now,
    }
    let lost = false
    const wrote = await patchOrderRecord(rowId, (r) => {
      if (carried(r)) {
        lost = true
        return r
      }
      return { v: 1, state: 'running', chain }
    })
    if (lost) return { ok: false, why: 'state' }
    if (!wrote.ok || wrote.rec?.state !== 'running') return { ok: false, why: 'record' }
    followRecord(rowId, wrote.rec)
    return { ok: true, steps: steps.length }
  })
  return out === 'busy' ? { ok: false, why: 'busy' } : out
}
