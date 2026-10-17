/**
 * Work orders — what must hold before the planner reads or sends anything (spec §2.2 items 1–6, in that order), pure
 * (a Node spec reads it; planner.ts gathers the facts, the plate (B4 / B8) shows the first failure with its fix key).
 * Items 7 (AI set up, the data-rule precheck of the request's sources) and 8 (the request is not empty) need the gate
 * and the request's text — planner.ts checks them right after these, still before anything goes out.
 *  1. Coding is on here · 2. not a viewer · 3. this tab has the worker link (another device holds it: 'elsewhere';
 *     otherwise the link's own reason, codingConnText) · 4. the worker is current ('outdated' / 'unsafe') · 5. it serves
 *     a repository or runs document stages · 6. at least one offered kind has a usable project — live or one confirming
 *     the chain would make (coding/chain.ts chainProjectProblem); the kinds that are not are named.
 */
import type { ChainProjectProblem } from '../chain'
import type { OrderKind } from './types'

/** Why a kind is not offered to the planner (its project's problem, or no project to pin: 'gone'). */
export type KindProblem = ChainProjectProblem | 'gone'

/** Why planning cannot start (items 1–6), or — from planner.ts — items 7 / 8 and the request itself. */
export type PlannerBlock =
  | { why: 'codingOff' }
  | { why: 'readOnly' }
  | { why: 'elsewhere' }
  | { why: 'offline'; text: string }
  | { why: 'outdated' }
  | { why: 'unsafe' }
  | { why: 'noRepos' }
  | { why: 'noProject'; unusable: ReadonlyArray<{ kind: OrderKind; problem: KindProblem }> }
  /** the work orders' config cannot be acted on (a later build's, or a Status option missing) */
  | { why: 'config' }
  /** no request row (gone, trashed, or not in a work-orders database) */
  | { why: 'gone' }
  /** the request page is locked (answers cannot be written into it) */
  | { why: 'locked' }
  /** item 7: no AI for this kind of work on this device (AINeedsSetup) */
  | { why: 'ai'; reason: string }
  /** item 7: the gate refused the request's sources (a data rule, a key typed into it, newer rules …) */
  | { why: 'refused'; code: string; error: unknown }
  /** item 8 */
  | { why: 'empty' }

export interface PlannerFacts {
  /** useCoding.enabled */
  enabled: boolean
  /** codingReadOnly() */
  readOnly: boolean
  /** workerOnline() */
  online: boolean
  /** the member's worker hangs at another device (cloud relay: refused 'other-device', or online there, not here) */
  elsewhere: boolean
  /** the link's own reason ('' while connected or off) — codingConnText() */
  connText: string
  /** workerVerdict() */
  verdict: 'ok' | 'outdated' | 'unsafe' | null
  /** repositories the worker announced */
  repos: number
  /** it runs document stages (workerCan) */
  docs: boolean
  /** each offered kind (config ∩ the row's Pipelines) with its project's problem (null: usable) */
  kinds: ReadonlyArray<{ kind: OrderKind; problem: KindProblem | null }>
}

export type PreconditionResult = { ok: true; usable: OrderKind[]; unusable: Array<{ kind: OrderKind; problem: KindProblem }> } | { ok: false; block: PlannerBlock }

/** Items 1–6 in order: the first that fails, else the kinds the planner may use (and the ones it may not, named). */
export function checkPreconditions(f: PlannerFacts): PreconditionResult {
  if (!f.enabled) return { ok: false, block: { why: 'codingOff' } }
  if (f.readOnly) return { ok: false, block: { why: 'readOnly' } }
  if (!f.online) return { ok: false, block: f.elsewhere ? { why: 'elsewhere' } : { why: 'offline', text: f.connText } }
  if (f.verdict === 'unsafe') return { ok: false, block: { why: 'unsafe' } }
  if (f.verdict !== 'ok') return { ok: false, block: { why: 'outdated' } }
  if (f.repos < 1 && !f.docs) return { ok: false, block: { why: 'noRepos' } }
  const usable = f.kinds.filter((k) => k.problem === null).map((k) => k.kind)
  const unusable = f.kinds.flatMap((k) => (k.problem === null ? [] : [{ kind: k.kind, problem: k.problem }]))
  if (!usable.length) return { ok: false, block: { why: 'noProject', unusable } }
  return { ok: true, usable, unusable }
}

/** Letters and digits in a text — item 8 counts these ("characters of words", not spaces or punctuation). */
export function wordChars(text: string): number {
  let n = 0
  for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) n += m[0].length
  return n
}
