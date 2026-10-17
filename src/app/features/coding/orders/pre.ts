/**
 * Work orders — the preconditions of a press (spec §2.2 items 1–6) as the entry points act on them. The rules are ONE
 * set, preconditions.ts checkPreconditions (the planner checks the same ones again, in the same order, from the same
 * facts — facts.ts requestFacts); this adds what a press does with the first that fails: a plate line with its fix
 * key, the Status stays as it is — and for some the press is KEPT (the record's `want`). Items 7 (the AI status of
 * `coding.plan` + the gate's precheck of the request's sources) and 8 (the request is not empty) are the planner's
 * (orders/planner.ts) — they need the request's text.
 *
 *  1 Coding is on here (`useCoding.enabled`) ………………………………… 'codingOff'   — the press is kept (want)
 *  2 not a viewer (`codingReadOnly()`) …………………………………………… 'readOnly'
 *  3 this tab has the worker link …………………………………………………… 'elsewhere' (team: another device holds it — no want)
 *                                                                        'offline'   (the link's own reason) — want
 *  4 workerVerdict() === 'ok' ………………………………………………………………… 'outdated' · 'unsafe' — want (plans once an 'ok' one is back)
 *  5 the worker announces ≥ 1 repo or runs doc stages ……………… 'noRepos'
 *  6 ≥ 1 allowed kind has a usable project, live or makeable … 'noProject' (each unusable kind named with its reason)
 *
 * `orderPre(facts)` is pure (a Node spec reads it); press.ts `orderPreNow(rowId)` reads the facts from this tab.
 */
import type { ID, OrderKind } from '../../../store/types'
import { checkPreconditions, type KindProblem, type PlannerFacts } from './preconditions'

export type OrderPreWhy = 'codingOff' | 'readOnly' | 'elsewhere' | 'offline' | 'outdated' | 'unsafe' | 'noRepos' | 'noProject'

/** Failures a press is kept for (the want): it plans once Coding is on and an 'ok' worker is online here (§3.1). */
export const WANT_WHYS: readonly OrderPreWhy[] = ['codingOff', 'offline', 'outdated', 'unsafe']

export interface OrderPreKind {
  kind: OrderKind
  /** the project steps of this kind would go to (null: none yet — one is made at confirm) */
  project: ID | null
  /** why it cannot take chain steps (null: it can) */
  problem: KindProblem | null
}

/** The facts of items 1–6 (preconditions.ts PlannerFacts; `connText`, the link's own reason, only for its words). */
export type OrderPreFacts = Omit<PlannerFacts, 'kinds' | 'connText'> & { connText?: string; kinds: OrderPreKind[] }

export type OrderPreResult =
  | { ok: true; usable: OrderKind[]; left: OrderPreKind[] }
  | { ok: false; why: OrderPreWhy; want: boolean; left: OrderPreKind[] }

export function orderPre(f: OrderPreFacts): OrderPreResult {
  const r = checkPreconditions({ ...f, connText: f.connText ?? '' })
  const left = f.kinds.filter((k) => k.problem)
  if (r.ok) return { ok: true, usable: r.usable, left }
  // checkPreconditions fails only on items 1–6 — the planner's own reasons (7, 8, the request) are never its
  const why = r.block.why as OrderPreWhy
  return { ok: false, why, want: WANT_WHYS.includes(why), left: why === 'noProject' ? left : [] }
}
