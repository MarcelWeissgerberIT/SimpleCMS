/**
 * Per-field trust — the earn and revoke rules, pure (a Node spec loads them):
 *  - every verdict gives one meter segment or none (segmentOf); the meter shows the last 20, oldest left;
 *  - FREIGEBBAR (ready) = the last 20 segments applied unchanged / spot ok in a row, nothing undone or spot-wrong in the
 *    last 14 days, at most 2 single discards without a reason inside that run; the switch never flips by itself;
 *  - the row note: the first of 12 rules that applies (noteOf); the meter's aria-label (meterLabel);
 *  - what stays when a key's shard is pruned (pruneKey): "not now" discards never push applied ones out.
 */
import type { Translate } from '@/shared/i18n'
import type { Verdict } from './types'

export const TRUST = { WINDOW: 20, BLOCK_DAYS: 14, EDIT_MIN: 10, SAMPLE: 10, LESSON_WRONGS: 3, UNEXPLAINED: 2, RARE_DAYS: 14 } as const

/** Book limits: entries per key, keys per agent, lessons per agent. */
export const TRUST_LIMITS = { perKey: 40, keys: 120, lessons: 20 } as const

const DAY = 86_400_000

/** accept · spot ok · edited · wrong · undone · empty */
export type Seg = 'g' | 's' | 'e' | 'w' | 'u' | 'x'

export function segmentOf(v: Pick<Verdict, 'v' | 'reason'>): Seg | null {
  switch (v.v) {
    case 'accept':
      return 'g'
    case 'spot:ok':
      return 's'
    case 'edited':
      return 'e'
    case 'discard':
      return v.reason === 'wrong' ? 'w' : null
    case 'undone':
      return 'u'
    case 'spot:wrong':
      return 'w'
  }
  return null
}

const isGreen = (s: Seg) => s === 'g' || s === 's'
/** a discard without a reason of ONE proposal: no segment, counted by the guard */
const isSingle = (v: Verdict) => v.v === 'discard' && !v.reason && v.single === true
const revokes = (v: Verdict) => v.v === 'undone' || v.v === 'spot:wrong'

export interface Readiness {
  /** the last 20 segments, oldest first, left-padded with 'x' */
  segs: Seg[]
  /** g + s among the last 20 */
  green: number
  /** trailing g | s segments (≤ 20) */
  streak: number
  counts: Record<'accept' | 'spot' | 'edited' | 'wrong' | 'undone', number>
  /** single reasonless discards inside the run (after the first of its streak segments) */
  unexplained: number
  /** segments in the book */
  total: number
  /** segments in the last 14 days */
  recent: number
  /** the newest undone / spot:wrong (head.lastRevoke or the book's own), null: none */
  revokedAt: number | null
  /** revokedAt + 14 days while that is in the future */
  earliest: number | null
  ready: boolean
  rare: boolean
}

export function readiness(entries: Verdict[], lastRevoke: number | undefined, now: number): Readiness {
  const list = entries.map((v, i) => ({ v, i })).sort((a, b) => a.v.at - b.v.at || a.i - b.i)
  const segged: Array<{ s: Seg; at: number; pos: number }> = []
  list.forEach(({ v }, pos) => {
    const s = segmentOf(v)
    if (s) segged.push({ s, at: v.at, pos })
  })
  const last = segged.slice(-TRUST.WINDOW)
  const segs: Seg[] = [...Array<Seg>(TRUST.WINDOW - last.length).fill('x'), ...last.map((x) => x.s)]
  let streak = 0
  for (let i = last.length - 1; i >= 0 && isGreen(last[i].s); i--) streak++
  const counts = { accept: 0, spot: 0, edited: 0, wrong: 0, undone: 0 }
  for (const { s } of last) {
    if (s === 'g') counts.accept++
    else if (s === 's') counts.spot++
    else if (s === 'e') counts.edited++
    else if (s === 'w') counts.wrong++
    else if (s === 'u') counts.undone++
  }
  // the run: from its first streak segment (none: after the last segment) to now
  const from = streak > 0 ? last[last.length - streak].pos : last.length ? last[last.length - 1].pos + 1 : 0
  const unexplained = list.slice(from).filter(({ v }) => isSingle(v)).length
  let revokedAt: number | null = typeof lastRevoke === 'number' && Number.isFinite(lastRevoke) ? lastRevoke : null
  for (const { v } of list) if (revokes(v) && (revokedAt === null || v.at > revokedAt)) revokedAt = v.at
  const until = revokedAt === null ? null : revokedAt + TRUST.BLOCK_DAYS * DAY
  const earliest = until !== null && until > now ? until : null
  const total = segged.length
  const recent = segged.filter((x) => now - x.at < TRUST.RARE_DAYS * DAY).length
  return {
    segs,
    green: counts.accept + counts.spot,
    streak,
    counts,
    unexplained,
    total,
    recent,
    revokedAt,
    earliest,
    ready: streak >= TRUST.WINDOW && earliest === null && unexplained <= TRUST.UNEXPLAINED,
    rare: total < TRUST.WINDOW && recent < 3,
  }
}

/**
 * direct: granted and in effect here · idle: granted but not in effect here (revoked on this device, not eligible,
 * waiting for its creator) · ready · review · never (NotDirect: hand / key / type / custom / kind)
 */
export type Lamp = 'direct' | 'idle' | 'ready' | 'review' | 'never'

export function lampOf(r: Readiness, granted: boolean, effective: boolean, eligible: boolean): Lamp {
  if (granted) return effective ? 'direct' : 'idle'
  if (!eligible) return 'never'
  return r.ready ? 'ready' : 'review'
}

export interface NoteInput {
  r: Readiness
  granted: boolean
  effective: boolean
  /** verdicts of the key on this device */
  entries: number
  /** granted: since when */
  since?: number | null
  /** granted and in effect: spot checks still open */
  spotOpen?: number
  /** granted, not in effect here: why (already in words) */
  why?: string
  /** this device took the key back at (head.revoked) */
  revokedAt?: number | null
  /** the wrong verdicts behind a lesson of this key waiting / drafting / ready (0 / null: none) */
  lesson?: number | null
  now: number
  fmt: { date: (ms: number) => string; time: (ms: number) => string }
}

export interface Note {
  key: string
  vars: Record<string, string | number>
}

const N = 'features.agents.trust.note'
const plural = (key: string, n: number) => `${key}.${n === 1 ? 'one' : 'other'}`

/** The row note: the first rule that applies (§3.4 of the design, in that order). */
export function noteOf(x: NoteInput): Note {
  const { r, now, fmt } = x
  const more = Math.max(0, TRUST.WINDOW - r.streak)
  if (x.granted && x.entries === 0) return { key: `${N}.otherDevice`, vars: {} }
  if (x.granted && x.effective) {
    const date = x.since ? fmt.date(x.since) : ''
    const n = x.spotOpen ?? 0
    return n > 0 ? { key: plural(`${N}.directSpot`, n), vars: { date, n } } : { key: `${N}.direct`, vars: { date } }
  }
  if (x.granted) return { key: `${N}.idle`, vars: { why: x.why ?? '' } }
  if (x.revokedAt && now - x.revokedAt < TRUST.BLOCK_DAYS * DAY) return { key: `${N}.revoked`, vars: { time: fmt.time(x.revokedAt), date: fmt.date(x.revokedAt + TRUST.BLOCK_DAYS * DAY) } }
  if (x.lesson && x.lesson > 0) return { key: `${N}.lesson`, vars: { n: x.lesson } }
  if (r.ready) return { key: `${N}.ready`, vars: { streak: r.streak } }
  if (r.earliest !== null && r.revokedAt !== null) return { key: plural(`${N}.earliest`, more), vars: { date: fmt.date(r.revokedAt), k: more, until: fmt.date(r.earliest) } }
  if (r.unexplained > TRUST.UNEXPLAINED) return { key: `${N}.unexplained`, vars: { n: r.unexplained } }
  if (r.rare) return { key: plural(`${N}.rare`, r.total), vars: { total: r.total } }
  if (r.counts.edited >= 5) return { key: `${N}.edited`, vars: {} }
  if (r.counts.wrong + r.counts.edited > 0) return { key: `${N}.counts`, vars: { w: r.counts.wrong, e: r.counts.edited } }
  return { key: plural(`${N}.more`, more), vars: { k: more } }
}

/** The meter's aria-label: "Last 20 verdicts: 15 applied, 4 edited, 1 wrong" (zero counts left out). */
export function meterLabel(r: Readiness, t: Translate): string {
  const M = 'features.agents.trust.meter'
  const c = r.counts
  const parts: string[] = []
  const add = (key: string, n: number) => {
    if (n > 0) parts.push(t(plural(`${M}.${key}`, n), { n }))
  }
  add('accept', c.accept)
  add('spot', c.spot)
  add('edited', c.edited)
  add('wrong', c.wrong)
  add('undone', c.undone)
  if (!parts.length) return t(`${M}.none`)
  add('empty', r.segs.filter((s) => s === 'x').length)
  return t(`${M}.label`, { list: parts.join(', ') })
}

/** A verdict that says the agent was wrong (lessons): a discard as wrong, a wrong spot check, an Undo for being wrong. */
export function isWrongish(v: Pick<Verdict, 'v' | 'reason'>): boolean {
  return (v.v === 'discard' && v.reason === 'wrong') || v.v === 'spot:wrong' || (v.v === 'undone' && v.reason === 'wrong')
}

/** Every 10th direct change of a key since its grant is a spot check. */
export const sampleDue = (n: number): boolean => Number.isInteger(n) && n > 0 && n % TRUST.SAMPLE === 0

/**
 * What a key's shard keeps (oldest first, ≤ TRUST_LIMITS.perKey): the newest 20 entries that give a segment; the
 * single reasonless discards newer than the oldest of those (≤ 20 — more than 2 block already); then, while there is
 * room, older segments (newest first), then the newest of the rest (discards as not now / duplicate / done, older
 * singles). "Not now" never pushes an applied entry out.
 */
export function pruneKey(list: Verdict[]): Verdict[] {
  const order = list.map((v, i) => ({ v, i })).sort((a, b) => a.v.at - b.v.at || a.i - b.i)
  const keep = new Set<number>()
  const segged = order.filter(({ v }) => segmentOf(v) !== null)
  const kept = segged.slice(-TRUST.WINDOW)
  for (const x of kept) keep.add(x.i)
  const oldest = kept.length ? kept[0].v.at : -Infinity
  const singles = order.filter(({ v }) => isSingle(v) && v.at >= oldest).slice(-TRUST.WINDOW)
  for (const x of singles) keep.add(x.i)
  // room left: older segments first, then the newest of the entries without one
  for (const rest of [segged, order.filter(({ v }) => segmentOf(v) === null)]) {
    const room = TRUST_LIMITS.perKey - keep.size
    if (room > 0) for (const x of rest.filter((x) => !keep.has(x.i)).slice(-room)) keep.add(x.i)
  }
  return order.filter((x) => keep.has(x.i)).map((x) => x.v)
}
