/**
 * Work orders — the preconditions of a press (spec §2.2 items 1–6, B4), checked in this order before anything is read
 * or sent; the first that fails is a plate line with its fix key, and the Status stays as it is. Items 7 (the AI status
 * of `coding.plan` + precheck with the request's sources) and 8 (the request is not empty) are the planner's (B5,
 * orders/planner.ts) — they need the request's text.
 *
 *  1 Coding is on here (`useCoding.enabled`) ………………………………… 'codingOff'   — the press is kept (want)
 *  2 not a viewer (`codingReadOnly()`) …………………………………………… 'readOnly'
 *  3 this tab has the worker link …………………………………………………… 'elsewhere' (team: another device holds it — no want)
 *                                                                        'offline'   (the link's own reason) — want
 *  4 workerVerdict() === 'ok' ………………………………………………………………… 'outdated' · 'unsafe' — want (plans once an 'ok' one is back)
 *  5 the worker announces ≥ 1 repo or runs doc stages ……………… 'noRepos'
 *  6 ≥ 1 allowed kind has a usable project, live or makeable … 'noProject' (each unusable kind named with its reason)
 *
 * `orderPre(facts)` is pure (a Node spec reads it); `orderPreNow(rowId)` reads the facts from this tab.
 */
import type { ID, OrderKind } from '../../../store/types'
import type { ChainProjectProblem } from '../chain'

export type OrderPreWhy = 'codingOff' | 'readOnly' | 'elsewhere' | 'offline' | 'outdated' | 'unsafe' | 'noRepos' | 'noProject'

/** Failures a press is kept for (the want): it plans once Coding is on and an 'ok' worker is online here (§3.1). */
export const WANT_WHYS: readonly OrderPreWhy[] = ['codingOff', 'offline', 'outdated', 'unsafe']

export interface OrderPreKind {
  kind: OrderKind
  /** the project steps of this kind would go to (null: none yet — one is made at confirm) */
  project: ID | null
  /** why it cannot take chain steps (null: it can) */
  problem: ChainProjectProblem | null
}

export interface OrderPreFacts {
  enabled: boolean
  readOnly: boolean
  /** this tab's link is up (switched on here and connected) */
  online: boolean
  /** team: the member's worker hangs on another device (the relay says so) */
  elsewhere: boolean
  /** the connected worker's verdict (null: offline) */
  verdict: 'ok' | 'outdated' | 'unsafe' | null
  /** repos the worker announced */
  repos: number
  /** it runs doc stages (BA / QA without a repo) */
  docs: boolean
  /** the kinds this request may use (the row's Pipelines, else the config's), with their projects */
  kinds: OrderPreKind[]
}

export type OrderPreResult =
  | { ok: true; usable: OrderKind[]; left: OrderPreKind[] }
  | { ok: false; why: OrderPreWhy; want: boolean; left: OrderPreKind[] }

export function orderPre(f: OrderPreFacts): OrderPreResult {
  const fail = (why: OrderPreWhy, left: OrderPreKind[] = []): OrderPreResult => ({ ok: false, why, want: WANT_WHYS.includes(why), left })
  if (!f.enabled) return fail('codingOff')
  if (f.readOnly) return fail('readOnly')
  if (!f.online) return fail(f.elsewhere ? 'elsewhere' : 'offline')
  if (f.verdict === 'unsafe') return fail('unsafe')
  if (f.verdict !== 'ok') return fail('outdated')
  if (f.repos < 1 && !f.docs) return fail('noRepos')
  const left = f.kinds.filter((k) => k.problem)
  const usable = f.kinds.filter((k) => !k.problem).map((k) => k.kind)
  if (!usable.length) return fail('noProject', left)
  return { ok: true, usable, left }
}
