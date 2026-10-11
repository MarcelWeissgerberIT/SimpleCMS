/**
 * Per-field trust — the verdict book's shapes (book.ts keeps them in IndexedDB "one-agents"; rules.ts reads them).
 * Types only: pure modules and Node specs import them.
 */
import type { ID } from '../../../store/types'
import type { TrustKey } from '../../../store/autonomy'
import type { DiscardReason } from '../../ai/agent/types'

export type { TrustKey, DiscardReason }

export type VerdictKind = 'accept' | 'edited' | 'discard' | 'undone' | 'spot:ok' | 'spot:wrong'

/** One decision of the person on ONE proposal they saw in full, for one trust key. */
export interface Verdict {
  /** nanoid(10) */
  id: string
  key: TrustKey
  v: VerdictKind
  /** discard; on 'undone' only 'wrong' counts (for lessons) */
  reason?: DiscardReason
  /** a discard without a reason of ONE proposal (D, Del, Preflight D / swipe ←): no segment, counted by the guard */
  single?: true
  at: number
  run: string
  change: string
  row?: ID
  /** the lesson that used it (wrong-ish only) */
  lesson?: string
}

export interface TrustHead {
  v: 1
  /** keys with a shard → last write (ms); ≤ TRUST_LIMITS.keys — the least recently written ungranted key's shard goes */
  keys: Record<TrustKey, number>
  /** newest undone / spot:wrong (never pruned — the 14-day rule) */
  lastRevoke: Record<TrustKey, number>
  /** this device revoked the key at (overlay) */
  revoked: Record<TrustKey, number>
  /** this device's person switched it on (since) */
  granted: Record<TrustKey, number>
  /** direct changes since the grant `since` (sample ordinal) */
  direct: Record<TrustKey, { since: number; n: number }>
  /** last write (orphan sweep) */
  at: number
}

export type LessonState = 'waiting' | 'offer' | 'drafting' | 'ready' | 'failed' | 'nokey' | 'applied' | 'remembered' | 'dismissed'

/** A lesson drafted from three wrong verdicts of one key (S5). */
export interface Lesson {
  id: string
  key: TrustKey
  /** the run the card hangs on (the newest of its verdicts) */
  run: string
  /** exactly 3 Verdict ids */
  verdicts: string[]
  /** display text, clipped to 120 chars each */
  items: Array<{ label: string; row: string; before: string; after: string }>
  at: number
  state: LessonState
  result?: {
    pattern: boolean
    sentence: string
    step: number | null
    finding: string
    shared: { field: string; text: string } | null
    calls: Array<{ server: string; tool: string; arg?: string }>
    tokens: number
    usd: number
    model: string
    capped?: true
    base: string
  }
  error?: string
  applied?: { at: number; rev: [number, number]; line: number; text: string }
  memory?: ID
}

/** An agent's book on this device: the head, the shards loaded so far (by key), its lessons. */
export interface TrustBook {
  head: TrustHead
  entries: Record<TrustKey, Verdict[]>
  lessons: Lesson[]
}

export const emptyHead = (): TrustHead => ({ v: 1, keys: {}, lastRevoke: {}, revoked: {}, granted: {}, direct: {}, at: 0 })
export const emptyBook = (): TrustBook => ({ head: emptyHead(), entries: {}, lessons: [] })
