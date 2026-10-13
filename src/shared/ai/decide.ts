/**
 * Decision models (slice SJ): what One keeps of a pre-check — Jev's answers to the four questions about one staged change,
 * numbers only, never text — and the pure math every surface reads: the weakest check, a mark, the "close to the
 * threshold" band, the write gate, and a compare suggestion mapped back through its shuffle. A decision model only ever
 * adds caution: nothing here applies, discards or decides for the person.
 */
import type { DataClass, DecideTurn } from './types.ts'
import { DATA_CLASSES } from './policy.ts'
import { JEV_NEAR } from './jev.ts'

/** The four questions of QSET v1 (features/ai/decide/questions.ts holds their wording). */
export type JevCheckKey = 'asked' | 'target' | 'consistent' | 'clean'
export const JEV_CHECK_KEYS: readonly JevCheckKey[] = ['asked', 'target', 'consistent', 'clean']

/** Why a change was not pre-checked (or not trusted). 'endpoint': no operator serves Jev under the workspace's rule. */
export type JevWhy = 'policy' | 'nokey' | 'noroute' | 'off' | 'reload' | 'budget' | 'price' | 'context' | 'timeout' | 'late' | 'unavailable' | 'cooldown' | 'empty' | 'upstream' | 'changed' | 'endpoint' | 'error'
export const JEV_WHYS: readonly JevWhy[] = ['policy', 'nokey', 'noroute', 'off', 'reload', 'budget', 'price', 'context', 'timeout', 'late', 'unavailable', 'cooldown', 'empty', 'upstream', 'changed', 'endpoint', 'error']

/** The question set's version: a wording change bumps it (a hash test holds the wording). */
export const QSET_VERSION = 1

/** A pre-check of one staged change (`StagedChange.jev`, run records per device — never synced). */
export interface JevCheck {
  /** the question set it answered */
  v: 1
  at: number
  /** the served (dated) snapshot ('' when nothing was sent) */
  model: string
  state: 'ok' | 'skipped' | 'failed'
  why?: JevWhy
  /** the class a data rule refused ('policy') */
  cls?: DataClass
  /** the four probabilities, two decimals (state 'ok' only) */
  checks?: Record<JevCheckKey, number>
  /** the weakest check and its value */
  low?: JevCheckKey
  p?: number
  mark?: boolean
  /** why the change is status 'held' (mark · unchecked · an earlier change here still waits) */
  held?: 'mark' | 'unchecked' | 'sticky'
  /** an earlier change of the same agent to the same target still waits (DJ20) — "Nur markieren" marks it only */
  sticky?: boolean
  /** what the request cost (null: no price) */
  usd?: number | null
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** A probability as One keeps it: two decimals (Jev's repeats move by hundredths — more digits claim a precision it lacks). */
export const round2 = (p: number): number => Math.round(p * 100) / 100
const prob = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? round2(v) : null)
/** Compared in hundredths (0.7 + 0.08 is 0.7799999… in floating point). */
const pct = (p: number): number => Math.round(p * 100)

/** The four checks of a stored or answered set (null: one is missing or not a probability). */
export function readChecks(v: unknown): Record<JevCheckKey, number> | null {
  if (!isObj(v)) return null
  const out = {} as Record<JevCheckKey, number>
  for (const k of JEV_CHECK_KEYS) {
    const p = prob(v[k])
    if (p === null) return null
    out[k] = p
  }
  return out
}

/** The weakest of the four checks (ties: the first in question order). */
export function weakest(c: Record<JevCheckKey, number>): { key: JevCheckKey; p: number } {
  let key: JevCheckKey = JEV_CHECK_KEYS[0]!
  for (const k of JEV_CHECK_KEYS) if (c[k] < c[key]) key = k
  return { key, p: c[key] }
}

/**
 * A stored check as this build reads it (null: not one — a corrupt or newer check is never read as a clear one). An 'ok'
 * check needs all four numbers; its weakest is computed again from them, never taken from the record.
 */
export function sanitizeJevCheck(v: unknown): JevCheck | null {
  if (!isObj(v) || v.v !== QSET_VERSION) return null
  if (v.state !== 'ok' && v.state !== 'skipped' && v.state !== 'failed') return null
  if (typeof v.at !== 'number' || !Number.isFinite(v.at) || v.at < 0) return null
  if (typeof v.model !== 'string' || v.model.length > 200) return null
  const out: JevCheck = { v: 1, at: v.at, model: v.model, state: v.state }
  if (typeof v.why === 'string' && (JEV_WHYS as readonly string[]).includes(v.why)) out.why = v.why as JevWhy
  if (typeof v.cls === 'string' && (DATA_CLASSES as readonly string[]).includes(v.cls)) out.cls = v.cls as DataClass
  if (v.state === 'ok') {
    const checks = readChecks(v.checks)
    if (!checks) return null
    const w = weakest(checks)
    out.checks = checks
    out.low = w.key
    out.p = w.p
    if (typeof v.mark === 'boolean') out.mark = v.mark
  }
  if (v.held === 'mark' || v.held === 'unchecked' || v.held === 'sticky') out.held = v.held
  if (v.sticky === true) out.sticky = true
  if (v.usd === null) out.usd = null
  else if (typeof v.usd === 'number' && Number.isFinite(v.usd) && v.usd >= 0) out.usd = v.usd
  return out
}

const lowOf = (c: JevCheck): number | null => (c.state === 'ok' && c.checks ? weakest(c.checks).p : null)

/** Marked: answered, and the weakest check below the threshold. */
export function markOf(c: JevCheck | null | undefined, markBelow: number): boolean {
  const p = c ? lowOf(c) : null
  return p !== null && pct(p) < pct(markBelow)
}

/** Close to the threshold: answered, the weakest check at or above it but within JEV_NEAR of it (a neutral line). */
export function nearOf(c: JevCheck | null | undefined, markBelow: number): boolean {
  const p = c ? lowOf(c) : null
  return p !== null && pct(p) >= pct(markBelow) && pct(p) < pct(markBelow + JEV_NEAR)
}

/** The write gate lets a change through only when Jev answered and every check is at or above `allowAt`. */
export function gateAllows(c: JevCheck | null | undefined, allowAt: number): boolean {
  if (!c || c.state !== 'ok' || !c.checks) return false
  return JEV_CHECK_KEYS.every((k) => pct(c.checks![k]) >= pct(allowAt))
}

/**
 * A compare suggestion (`best` choice over the shuffled positions '1' … 'n') mapped back: `order[i]` = the answer shown at
 * position i + 1. null: no usable `best` answer. `p` = its confidence (else its probability) — the caller decides what is
 * enough to show (S6: below 0,5 no tag).
 */
export function suggestionOf(turn: DecideTurn, order: readonly number[]): { n: number; p: number } | null {
  const a = turn.answers.best
  if (!a || a.type !== 'choice') return null
  const i = Number(a.choice) - 1
  if (!Number.isInteger(i) || i < 0 || i >= order.length) return null
  const n = order[i]
  if (typeof n !== 'number') return null
  const p = a.confidence ?? a.probs[a.choice] ?? 0
  return { n, p: round2(p) }
}
