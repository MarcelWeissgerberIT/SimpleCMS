/**
 * Work orders — keys in a plan (spec §2.7 "Secrets"), pure. Key-shaped strings (the gate's key detector,
 * src/shared/ai/keys.ts) in a plan's text never reach a step page:
 *  - `planKeyHits` names every field that holds one — the planner's repair round refuses the plan with them;
 *  - `scrubPlanKeys` replaces what is still there after it with "••••" and counts per step, for the plate's line
 *    ("Step 02: 1 key removed") — and for auto mode, which falls back to "Chain ready" when anything was scrubbed.
 * Fields: the summary, the server context (note + links), and per step its title, goal, criteria and why; the questions
 * and the refusal too (they are shown and go back to the planner with the answers).
 */
import { looksLikeKey, scrubSecrets } from '@/shared/ai/keys'
import type { OrderPlanV1 } from './types'

export type PlanKeyField = 'summary' | 'context' | 'questions' | 'refused' | 'title' | 'goal' | 'criteria' | 'why' | 'delivery'

/** A field holding a key: `step` = the step's number (1 = "01"), null for the plan's own fields. */
export interface PlanKeyHit {
  step: number | null
  field: PlanKeyField
}

const BLANK = '••••'
const blanks = (s: string) => s.split(BLANK).length - 1

/** Every field of the plan that holds a key-shaped string. */
export function planKeyHits(plan: OrderPlanV1): PlanKeyHit[] {
  const hits: PlanKeyHit[] = []
  const check = (step: number | null, field: PlanKeyField, texts: ReadonlyArray<string | null | undefined>) => {
    if (texts.some((t) => looksLikeKey(t))) hits.push({ step, field })
  }
  check(null, 'summary', [plan.summary])
  if (plan.delivery) check(null, 'delivery', [...plan.delivery.requirements.map(r => r.text), ...plan.delivery.acceptance])
  if (plan.context) check(null, 'context', [plan.context.note, ...plan.context.links])
  check(null, 'questions', plan.questions)
  check(null, 'refused', [plan.refused])
  plan.steps.forEach((s, i) => {
    check(i + 1, 'title', [s.title])
    check(i + 1, 'goal', [s.goal])
    check(i + 1, 'criteria', s.criteria)
    check(i + 1, 'why', [s.why])
  })
  return hits
}

/**
 * The plan with every key-shaped string replaced by "••••", and how many went per step (`step` null: the summary,
 * the context, the questions, the refusal). The same plan object when it held none.
 */
export function scrubPlanKeys(plan: OrderPlanV1): { plan: OrderPlanV1; scrubbed: Array<{ step: number | null; count: number }> } {
  const counts = new Map<number | null, number>()
  const scrub = (step: number | null, t: string): string => {
    if (!looksLikeKey(t)) return t
    const out = scrubSecrets(t)
    const n = blanks(out) - blanks(t)
    if (n > 0) counts.set(step, (counts.get(step) ?? 0) + n)
    return out
  }
  if (!planKeyHits(plan).length) return { plan, scrubbed: [] }
  const next: OrderPlanV1 = {
    ...plan,
    ...(plan.delivery ? { delivery: { requirements: plan.delivery.requirements.map(r => ({ ...r, text: scrub(null, r.text) })), acceptance: plan.delivery.acceptance.map(s => scrub(null, s)) } } : {}),
    summary: scrub(null, plan.summary),
    context: plan.context ? { ...plan.context, note: scrub(null, plan.context.note), links: plan.context.links.map((l) => scrub(null, l)) } : null,
    questions: plan.questions.map((q) => scrub(null, q)),
    refused: plan.refused === null ? null : scrub(null, plan.refused),
    steps: plan.steps.map((s, i) => ({
      ...s,
      title: scrub(i + 1, s.title),
      goal: scrub(i + 1, s.goal),
      criteria: s.criteria.map((c) => scrub(i + 1, c)),
      why: scrub(i + 1, s.why),
    })),
  }
  const scrubbed = [...counts.entries()].map(([step, count]) => ({ step, count })).sort((a, b) => (a.step ?? 0) - (b.step ?? 0))
  return { plan: next, scrubbed }
}
