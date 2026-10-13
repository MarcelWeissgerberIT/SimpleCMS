/**
 * Background work at the red line (Regler § 5.7): it pauses or stops and never waits for a key.
 *  - budgetRefusal(e): the gate refused a request for money (AIError 'budget') — its line and fix, else null;
 *  - the autofill watch's paused rows (paused.ts) under this member's scope: pauseRows · takeRows · pausedRows; resumed on
 *    a new day, a line that moved (onLineChange) or E in the panel (an allowance for the watch's fills of that property,
 *    today: watchSource);
 *  - onLineChange(fn): the workspace's governor, this browser's own line (another tab too) or the day changed.
 */
import { useWorkspace } from '../../store/store'
import { addPaused, readPaused, takePaused, type PausedRow } from './paused'
import { ledgerScope } from './scope'
import { DEVICE_KEY } from './device'
import { dayOf, nextMidnight } from './clock'

/** What a refusal at the line carries (AIError 'budget': its detail = the binding line, its brake fix). */
export interface BudgetRefusal {
  detail: string
  fix: { allow: number | null; need: number; rest: number; band: { low: number; high: number }; binding: string | null; line?: { spent: number; limit: number } } | null
}

/** The gate refused this request for money (nothing was sent) — else null. */
export function budgetRefusal(e: unknown): BudgetRefusal | null {
  if (!e || typeof e !== 'object' || (e as { code?: unknown }).code !== 'budget') return null
  const fixes = (e as { fixes?: unknown }).fixes
  const fix = Array.isArray(fixes) ? fixes.find((f) => f && typeof f === 'object' && (f as { kind?: unknown }).kind === 'brake') : null
  return { detail: String((e as { detail?: unknown }).detail ?? 'day'), fix: (fix as BudgetRefusal['fix']) ?? null }
}

/** The autofill watch's fills of one property today: one source, so E in its panel allows them all (today only). */
export const watchSource = (db: string, prop: string, now = Date.now()): string => `autofill:${db}:${prop}:w${dayOf(now).replace(/-/g, '')}`

const scopeNow = (): string => ledgerScope() ?? ''

/** Rows the watch paused at the line (persisted: a reload keeps them). The number paused now. */
export function pauseRows(rows: ReadonlyArray<Omit<PausedRow, 'at'>>, now = Date.now()): number {
  if (!rows.length) return readPaused(scopeNow()).rows.length
  return addPaused(scopeNow(), rows.map((r) => ({ ...r, at: now }))).rows.length
}

/** Take paused rows out of the list (all, one database, or one property) — the watch fills them again. */
export const takeRows = (match: { db?: string; prop?: string } = {}): PausedRow[] => takePaused(scopeNow(), match)

/** The paused rows (one database / property, or all) and how many went over the cap. */
export function pausedRows(match: { db?: string; prop?: string } = {}): { rows: PausedRow[]; dropped: number } {
  const list = readPaused(scopeNow())
  return { rows: list.rows.filter((r) => (match.db === undefined || r.db === match.db) && (match.prop === undefined || r.prop === match.prop)), dropped: list.dropped }
}

/** Call `fn` when a line may have moved: the workspace's governor, this browser's own line (also in another tab), a new day. */
export function onLineChange(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const unsub = useWorkspace.subscribe((s, p) => {
    if (s.governor !== p.governor || s.settings.ai !== p.settings.ai) fn()
  })
  const onStorage = (e: StorageEvent) => {
    if (e.key === DEVICE_KEY) fn()
  }
  window.addEventListener('storage', onStorage)
  let timer = 0
  const arm = () => {
    timer = window.setTimeout(
      () => {
        fn()
        arm()
      },
      Math.max(1000, nextMidnight(Date.now()) - Date.now() + 500),
    )
  }
  arm()
  return () => {
    unsub()
    window.removeEventListener('storage', onStorage)
    window.clearTimeout(timer)
  }
}
