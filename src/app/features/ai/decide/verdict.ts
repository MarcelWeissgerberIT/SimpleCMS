/**
 * A pre-check as One keeps it (`StagedChange.jev`): the pure math (src/shared/ai/decide.ts) and the two ways a check
 * comes about — Jev answered (four numbers, two decimals, the weakest computed) or it did not (the reason a card shows).
 * Numbers only, never text: Jev returns none, and a card's reason is One's fixed label of the weakest question.
 */
import type { DataClass, DecideTurn } from '@/shared/ai/types'
import { JEV_CHECK_KEYS, QSET_VERSION, markOf, readChecks, weakest, type JevCheck, type JevCheckKey, type JevWhy } from '@/shared/ai/decide'

export { gateAllows, markOf, nearOf, sanitizeJevCheck, weakest, type JevCheck, type JevCheckKey, type JevWhy } from '@/shared/ai/decide'

/** Jev's answers to the four questions → a check (null: an answer missing or not a probability — the turn is unusable). */
export function checkOf(turn: DecideTurn, o: { at: number; usd: number | null; markBelow: number }): JevCheck | null {
  const raw: Partial<Record<JevCheckKey, number>> = {}
  for (const k of JEV_CHECK_KEYS) {
    const a = turn.answers[k]
    if (!a || a.type !== 'noul') return null
    raw[k] = a.p
  }
  const checks = readChecks(raw)
  if (!checks) return null
  const w = weakest(checks)
  const c: JevCheck = { v: QSET_VERSION, at: o.at, model: turn.served.model, state: 'ok', checks, low: w.key, p: w.p, usd: o.usd }
  c.mark = markOf(c, o.markBelow)
  return c
}

/** A change Jev did not check: why — 'skipped' when nothing went out for it, 'failed' when a request was answered or cut. */
export function uncheckedOf(why: JevWhy, o: { at: number; sent: boolean; model?: string; cls?: DataClass; usd?: number | null }): JevCheck {
  return { v: QSET_VERSION, at: o.at, model: o.model ?? '', state: o.sent ? 'failed' : 'skipped', why, ...(o.cls ? { cls: o.cls } : {}), ...(o.usd !== undefined ? { usd: o.usd } : {}) }
}

/** Has Jev answered for this change (a check with its numbers)? */
export const answered = (c: JevCheck | null | undefined): boolean => !!c && c.state === 'ok' && !!c.checks
