/**
 * Work orders — the person's changes to a plan on the plate (spec §1.5, B8): E edits a step (title, goal, criteria,
 * kind, repo, branch, priority), Entf removes one (Z in the toast puts it back), Alt+↑/↓ moves one, a repo picked in a
 * coding step's station, the "Budget je Kette" field above ↵ Kette starten. Each is a write to this device's record only
 * (never the workspace): the draft's plan as edited, `edited: true` (R then asks "Deine Änderungen an der Kette
 * verwerfen?") and its hash again (the one ↵ confirms — startChain recomputes it the same way).
 *
 * An edited step goes through the planner's own reader (plan.ts readPlan): every bound, the kinds this request may use,
 * a repo the worker announced, a branch the worker names (never the base branch), ≤ 3 coding steps, page references
 * outside the step's refs made plain text (only `refs` reach Claude Code) — and a key-shaped string refuses the edit.
 * Nothing here can add a page that goes along: the refs stay the planner's.
 */
import type { ID } from '../../../store/types'
import { useWorkspace } from '../../../store/store'
import { useCoding } from '../state'
import { defaultApprovals } from '../state'
import { BRANCH_NAME } from '../draft'
import { pipelineLine } from '../stages'
import { readPlan, orderPlanHash, type PlanReadCtx, type ResolvedStep } from './plan'
import { planKeyHits } from './keys'
import { requestFacts } from './facts'
import { BUDGET_RANGE, readOrderConfig, orderAgent } from './config'
import { DELIVERY_LIMITS, remapDependencies } from './delivery'
import { loadOrderRecord, patchOrderRecord } from './records'
import { PLAN_LIMITS, type OrderDraft, type OrderKind, type OrderPlanV1, type OrderRecord, type OrderStepPlan } from './types'

/** What an edit may change of a step (the rest stays the planner's: why, refs). */
export interface StepPatch {
  title?: string
  goal?: string
  criteria?: string[]
  kind?: OrderKind
  repo?: string | null
  branch?: string | null
  priority?: OrderStepPlan['priority']
}

/** Why an edit was refused (the plate words each). */
export type EditRefusal =
  /** no draft to edit here (it was started, discarded or planned again meanwhile) */
  | { why: 'state' }
  | { why: 'titleEmpty' | 'titleLong' | 'goalEmpty' | 'goalLong' | 'criteriaMany' | 'criterionLong' | 'codingMany' | 'kind' | 'repo' | 'branch' | 'branchBase' | 'keys' | 'last' }
  /** the planner's reader refused it for a reason not named above (its English problem) */
  | { why: 'plan'; problem: string }

export type EditOutcome = { ok: true; draft: OrderDraft; before: OrderDraft } | ({ ok: false } & EditRefusal)

const asRecord = (r: OrderRecord | null | 'unreadable' | undefined): OrderRecord | null => (r && r !== 'unreadable' ? r : null)

/** The kinds this request may use now (usable projects), the worker's repos, the refs the plan names. */
function readCtx(rowId: ID, draft: OrderDraft): PlanReadCtx {
  const kinds = requestFacts(rowId).kinds.filter((k) => !k.problem).map((k) => k.kind)
  const c = useCoding.getState()
  return {
    kinds,
    repos: (c.worker?.repos ?? []).map((r) => ({ name: r.name, base: r.baseBranch, branches: r.branches ?? [] })),
    refs: [...new Set(draft.plan.steps.flatMap((s) => s.refs))],
    // a page address typed into an edit becomes "@Title" (a private page's title never: the address is dropped)
    titleOf: (id) => {
      const page = useWorkspace.getState().pages[id]
      return page && !page.private ? page.title.trim() || null : null
    },
    server: draft.source.server,
  }
}

/** The hash of a plan as it resolves on this device now (the same as confirm.ts planHashNow); null: a kind has no project. */
async function hashOf(rowId: ID, plan: OrderPlanV1): Promise<string | null> {
  const kinds = requestFacts(rowId).kinds
  const approvals = defaultApprovals()
  const config = readOrderConfig(useWorkspace.getState().databases[useWorkspace.getState().pages[rowId]?.databaseId ?? ''])
  const resolved: ResolvedStep[] = []
  for (const st of plan.steps) {
    const p = kinds.find((k) => k.kind === st.kind)
    if (!p) return null
    const agent = config.kind === 'ok' ? orderAgent(config.config, st.kind) : undefined
    resolved.push({ ...(agent ? { agent } : {}), project: p.project, park: pipelineLine(p.pipeline, !!st.repo, false, approvals), start: pipelineLine(p.pipeline, !!st.repo, true, approvals) })
  }
  return orderPlanHash(plan, resolved, approvals)
}

/** Check an edited step against the plate's own words first (then the planner's reader decides the rest). */
function checkStep(step: OrderStepPlan, plan: OrderPlanV1, ctx: PlanReadCtx): EditRefusal | null {
  if (!step.title.trim()) return { why: 'titleEmpty' }
  if (step.title.length > PLAN_LIMITS.title) return { why: 'titleLong' }
  if (!step.goal.trim()) return { why: 'goalEmpty' }
  if (step.goal.length > PLAN_LIMITS.goal) return { why: 'goalLong' }
  if (step.criteria.length > PLAN_LIMITS.criteria) return { why: 'criteriaMany' }
  if (step.criteria.some((c) => c.length > PLAN_LIMITS.criterion)) return { why: 'criterionLong' }
  if (!ctx.kinds.includes(step.kind)) return { why: 'kind' }
  if (plan.steps.filter((s) => s.kind === 'coding').length > (plan.delivery ? DELIVERY_LIMITS.codingSteps : PLAN_LIMITS.codingSteps)) return { why: 'codingMany' }
  const repo = step.repo ? ctx.repos.find((r) => r.name === step.repo) : undefined
  if (step.repo && !repo) return { why: 'repo' }
  if (step.branch) {
    if (step.kind !== 'coding' || !BRANCH_NAME.test(step.branch) || step.branch.startsWith('-') || step.branch.includes('..')) return { why: 'branch' }
    if (repo && step.branch === repo.base) return { why: 'branchBase' }
    if (!repo || (repo.branches.length && !repo.branches.includes(step.branch))) return { why: 'branch' }
  }
  if (planKeyHits({ ...plan, steps: [step] }).length) return { why: 'keys' }
  return null
}

/**
 * Write a new plan into the draft (CAS: only the draft `before` — a plan or a start meanwhile wins). The plan goes
 * through the planner's reader; `edited` is set, the hash computed again.
 */
async function writePlan(rowId: ID, before: OrderDraft, plan: OrderPlanV1, extra: Partial<OrderDraft> = {}): Promise<EditOutcome> {
  const ctx = readCtx(rowId, before)
  const read = readPlan(plan, ctx)
  if (!read.ok) return { ok: false, why: 'plan', problem: read.problems[0] ?? '' }
  const hash = await hashOf(rowId, read.plan)
  if (!hash) return { ok: false, why: 'kind' }
  const draft: OrderDraft = { ...before, ...extra, plan: read.plan, edited: true, hash }
  let lost = false
  const out = await patchOrderRecord(rowId, (r) => {
    if (r?.state !== 'draft' || r.draft?.run !== before.run || r.draft.hash !== before.hash) {
      lost = true
      return r
    }
    return { ...r, draft }
  })
  if (lost || !out.ok) return { ok: false, why: 'state' }
  return { ok: true, draft, before }
}

/** The draft as it stands on this device now (null: none to edit). */
async function draftNow(rowId: ID): Promise<OrderDraft | null> {
  const rec = asRecord(await loadOrderRecord(rowId, { fresh: true }))
  return rec?.state === 'draft' && rec.draft?.plan.steps.length ? rec.draft : null
}

/** Working defaults are part of the exact plan that will be confirmed, not a separate hidden prompt. */
export async function editAssumptions(rowId: ID, assumptions: string[]): Promise<EditOutcome> {
  const before = await draftNow(rowId)
  if (!before) return { ok: false, why: 'state' }
  return writePlan(rowId, before, { ...before.plan, assumptions })
}

/** E: step `index` (0-based) changed as the person typed it. */
export async function editStep(rowId: ID, index: number, patch: StepPatch): Promise<EditOutcome> {
  const before = await draftNow(rowId)
  const old = before?.plan.steps[index]
  if (!before || !old) return { ok: false, why: 'state' }
  const step: OrderStepPlan = {
    ...old,
    ...(patch.title !== undefined ? { title: patch.title.replace(/\s+/g, ' ').trim() } : {}),
    ...(patch.goal !== undefined ? { goal: patch.goal.trim() } : {}),
    ...(patch.criteria !== undefined ? { criteria: patch.criteria.map((c) => c.trim()).filter(Boolean) } : {}),
    ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
    ...(patch.repo !== undefined ? { repo: patch.repo || null } : {}),
    ...(patch.branch !== undefined ? { branch: patch.branch?.trim() || null } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
  }
  // a branch belongs to a coding step only
  if (step.kind !== 'coding') step.branch = null
  const plan: OrderPlanV1 = { ...before.plan, steps: before.plan.steps.map((s, i) => (i === index ? step : s)) }
  const why = checkStep(step, plan, readCtx(rowId, before))
  if (why) return { ok: false, ...why }
  return writePlan(rowId, before, plan)
}

/** Entf: step `index` leaves the plan (never the last one — D discards the whole chain). */
export async function removeStep(rowId: ID, index: number): Promise<EditOutcome> {
  const before = await draftNow(rowId)
  if (!before || !before.plan.steps[index]) return { ok: false, why: 'state' }
  if (before.plan.steps.length < 2) return { ok: false, why: 'last' }
  const steps = before.plan.steps.filter((_s, i) => i !== index)
  return writePlan(rowId, before, { ...before.plan, steps: remapDependencies(before.plan.steps, steps) })
}

/** Alt+↑ / Alt+↓: step `index` one place earlier (-1) or later (+1). */
export async function moveStep(rowId: ID, index: number, by: -1 | 1): Promise<EditOutcome> {
  const before = await draftNow(rowId)
  const to = index + by
  if (!before || !before.plan.steps[index] || to < 0 || to >= before.plan.steps.length) return { ok: false, why: 'state' }
  const steps = [...before.plan.steps]
  const [moved] = steps.splice(index, 1)
  steps.splice(to, 0, moved!)
  return writePlan(rowId, before, { ...before.plan, steps: remapDependencies(before.plan.steps, steps) })
}

/**
 * Z after Entf (or any edit's Undo): the draft back to `prev` — only while the draft is still the one the edit wrote
 * (`after`); a newer plan or a start is never overwritten. False: nothing to put back.
 */
export async function restoreDraft(rowId: ID, prev: OrderDraft, after: OrderDraft): Promise<boolean> {
  let done = false
  await patchOrderRecord(rowId, (r) => {
    if (r?.state !== 'draft' || r.draft?.run !== after.run || r.draft.hash !== after.hash) return r
    done = true
    return { ...r, draft: { ...prev, ...(r.draft.budget !== undefined ? { budget: r.draft.budget } : {}) } }
  })
  return done
}

/**
 * "Budget je Kette" for the chain this draft starts (the field above ↵ — empty by default; null = none for this chain).
 * Within the settings' range; the plan itself is unchanged (it is no edit: R does not ask for it).
 */
export async function setDraftBudget(rowId: ID, usd: number | null): Promise<boolean> {
  const value = usd === null || !Number.isFinite(usd) ? null : Math.min(BUDGET_RANGE[1], Math.max(BUDGET_RANGE[0], usd))
  const out = await patchOrderRecord(rowId, (r) => (r?.state === 'draft' && r.draft ? { ...r, draft: { ...r.draft, budget: value } } : r))
  return out.ok && out.rec?.state === 'draft'
}
