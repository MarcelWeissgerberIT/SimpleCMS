/**
 * Preflight's pure core: levels, the "new" rule and its chip, MASTER CAUTION's count, the panel's order and cap, the
 * lamp test's timing, the plate mode, the optimistic overlay. No imports beyond types — the Node spec
 * (preflight-engine.spec) tests every function here.
 */
import type { LampId, LampReading } from './registry'
import type { AckEntry, LastCache, Level, LampView, PlateMode, TodayRecord } from './types'

/** acknowledged id hashes kept per lamp */
export const ACK_SET_MAX = 300
/** ids a reading may hand in (the engine hashes them) */
export const IDS_MAX = 2000
/** lamps the plate holds */
export const PANEL_MAX = 16

/** A cap's count: two digits, "99+" above 99. */
export function fmtCount(n: number): string {
  if (n > 99) return '99+'
  return String(Math.max(0, Math.floor(n))).padStart(2, '0')
}

/* ---------------- hashing */

/** FNV-1a, 32 bit. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export const hex8 = (n: number): string => n.toString(16).padStart(8, '0')

/** The hash of one id (what an ack set holds). */
export const hashId = (id: string): string => hex8(fnv1a(id))

/** The sorted, unique hashes of ids. */
export function hashSet(ids: readonly string[]): string[] {
  return [...new Set(ids.map(hashId))].sort()
}

/** A stable hash of an id set — the same whatever the order (FNV over the sorted id hashes). */
export function idsHash(ids: readonly string[]): string {
  return hex8(fnv1a(hashSet(ids.slice(0, IDS_MAX)).join(',')))
}

/* ---------------- levels and "new" */

export interface Thresholds {
  amber: number | null
  red: number | null
}

/**
 * A reading's level: 'off' → grey · nothing counted → dark · a forced level (the source says amber / red) · the red
 * threshold · the amber threshold · else dark (below the amber threshold).
 */
export function levelOf(r: Pick<LampReading, 'state' | 'count' | 'level'> | null | undefined, t: Thresholds): Level {
  if (!r) return 'dark'
  if (r.state === 'off') return 'grey'
  if (!(r.count > 0)) return 'dark'
  if (r.level === 'red' || r.level === 'amber') return r.level
  if (t.red != null && r.count >= t.red) return 'red'
  if (t.amber != null && r.count >= t.amber) return 'amber'
  return 'dark'
}

export const isLit = (level: Level): boolean => level === 'amber' || level === 'red'

/**
 * How many of a reading's ids are new since the acknowledgement. No acknowledgement on this device → all of them
 * (`none`). Past the first 300 ids (what an ack keeps) the count's growth past the acked count stands in.
 */
export function newOf(ids: readonly string[], count: number, ack: AckEntry | undefined): { k: number; none: boolean } {
  if (!ack) return { k: Math.max(0, count), none: true }
  const set = new Set(ack.set)
  let k = 0
  const n = Math.min(ids.length, ACK_SET_MAX)
  for (let i = 0; i < n; i++) if (!set.has(hashId(ids[i]))) k++
  if (count > ACK_SET_MAX) k += Math.max(0, count - Math.max(ack.n, ACK_SET_MAX))
  return { k, none: false }
}

/** The cap's chip: two or more new → "+n", one new or never acknowledged here → "new"; only on a lit lamp. */
export function chipOf(level: Level, k: number, none: boolean): 'plus' | 'new' | null {
  if (!isLit(level) || k <= 0) return null
  if (none) return 'new'
  return k >= 2 ? 'plus' : 'new'
}

/** The acknowledgement of a reading: the count, the hashes of its first 300 ids, their hash, when. */
export function makeAck(ids: readonly string[], count: number, now: number): AckEntry {
  const set = hashSet(ids.slice(0, ACK_SET_MAX))
  return { n: count, set, h: hex8(fnv1a(set.join(','))), at: now }
}

/* ---------------- a lamp's view */

export interface LampMeta {
  id: LampId
  order: number
  legend: string
  short: string
  rule: string
  thresholds: Thresholds
  flash: boolean
  master: boolean
  hasQueue: boolean
  hasOpen: boolean
  hasFix: boolean
}

/** What the plate shows of a lamp, from its reading and this device's acknowledgement. */
export function buildView(m: LampMeta, r: LampReading, ack: AckEntry | undefined, ms: number, at: number): LampView {
  const level = levelOf(r, m.thresholds)
  const { k, none } = isLit(level) ? newOf(r.ids, r.count, ack) : { k: 0, none: false }
  const chip = chipOf(level, k, none)
  return {
    id: m.id,
    order: m.order,
    legend: m.legend,
    short: m.short,
    second: r.second ?? '',
    rule: m.rule,
    level,
    count: r.state === 'off' ? 0 : Math.max(0, r.count),
    idsHash: idsHash(r.ids),
    ...(r.state === 'off' && r.why ? { why: r.why } : {}),
    isNew: chip !== null,
    newCount: chip ? k : 0,
    chip,
    flash: m.flash,
    master: m.master,
    hasQueue: m.hasQueue,
    ms,
    at,
    amber: m.thresholds.amber,
    red: m.thresholds.red,
    ...(r.level ? { forced: r.level } : {}),
    ...(r.parts ? { parts: r.parts } : {}),
    ...(r.notCards ? { notCards: r.notCards } : {}),
    hasOpen: m.hasOpen,
    hasFix: m.hasFix,
  }
}

/** Two views alike (the store is set only when a view differs; when and how long the read took do not count). */
export function sameView(a: LampView, b: LampView): boolean {
  const ka = Object.keys(a) as Array<keyof LampView>
  if (ka.length !== Object.keys(b).length) return false
  for (const k of ka) {
    if (k === 'ms' || k === 'at') continue
    if (k === 'parts') {
      if (JSON.stringify(a.parts ?? null) !== JSON.stringify(b.parts ?? null)) return false
    } else if (a[k] !== b[k]) return false
  }
  return true
}

/** Lamps that count for MASTER CAUTION now: new and with "counts for Master Caution" on. */
export function mcCount(views: readonly Pick<LampView, 'isNew' | 'master'>[]): number {
  let n = 0
  for (const v of views) if (v.isNew && v.master) n++
  return n
}

/* ---------------- the panel */

/**
 * Which lamps the plate shows, in order: fitted and not hidden on this device, by `order` (a lamp with `after` right
 * behind that lamp, else at the end), at most 16 — the rest is the overflow (listed in the rule card).
 */
export function panelLamps(lamps: ReadonlyArray<{ id: LampId; order: number; after?: LampId }>, opts: { hidden?: ReadonlySet<LampId>; max?: number } = {}): { shown: LampId[]; overflow: LampId[] } {
  const max = opts.max ?? PANEL_MAX
  const live = lamps.filter((l) => !opts.hidden?.has(l.id))
  const byOrder = [...live].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const placed: LampId[] = byOrder.filter((l) => !l.after).map((l) => l.id)
  // a lamp with `after` sits right behind its anchor (behind earlier lamps with the same anchor); unknown → the end
  const anchorOf = new Map<LampId, LampId>()
  for (const l of byOrder) {
    if (!l.after) continue
    let at = placed.indexOf(l.after)
    if (at < 0) {
      placed.push(l.id)
      continue
    }
    at++
    while (at < placed.length && anchorOf.get(placed[at]) === l.after) at++
    placed.splice(at, 0, l.id)
    anchorOf.set(l.id, l.after)
  }
  return { shown: placed.slice(0, max), overflow: placed.slice(max) }
}

/* ---------------- the lamp test */

/** all caps on (ms) */
export const TEST_ON_MS = 120
/** each relit cap's fade (ms, --dur-1) */
export const TEST_FADE_MS = 90

/**
 * The lamp test for n lit caps: every cap on for 120 ms, then the lit ones come back `stagger` ms apart, each fading
 * in 90 ms — `end` ≤ 260 ms (INSTRUMENT's motion budget) for any n.
 */
export function testSchedule(n: number): { on: number; stagger: number; fade: number; end: number; relitAt: (i: number) => number } {
  const lit = Math.max(0, Math.floor(n))
  const stagger = lit > 1 ? Math.min(20, 50 / (lit - 1)) : 0
  const end = TEST_ON_MS + stagger * Math.max(0, lit - 1) + TEST_FADE_MS
  return { on: TEST_ON_MS, stagger, fade: TEST_FADE_MS, end, relitAt: (i: number) => TEST_ON_MS + i * stagger }
}

/* ---------------- the plate mode */

export interface ModeInput {
  on: boolean
  ready: boolean
  /** lamps lit now */
  lit: number
  /** lamps new now */
  newIds: readonly LampId[]
  /** a lamp's queue is open in this tab */
  queueOpen: boolean
  /** unfolded in this tab (chevron, ⌘K, MASTER CAUTION with nothing new, an unfold effect) */
  unfolded: boolean
  /** today's record (a record of another day reads as { day, base: [] }) */
  today: TodayRecord
  /** the lit lamps when last counted (before `ready`) */
  last: LastCache | null
}

export interface ModeEffect {
  shown?: true
  base?: LampId[]
  unfold?: true
}

/**
 * Full plate or strip (§5.6): before the first count the cached last count decides; nothing lit → strip; the day's
 * first render with lamps lit → full (and remembered); unfolded or a queue open → full; a lamp new that was not new at
 * the last fold / day start → full (it unfolds); else the strip. Acknowledging only shrinks `newIds`: it never unfolds.
 */
export function planMode(i: ModeInput): { mode: PlateMode; effect: ModeEffect | null } {
  if (!i.on) return { mode: 'off', effect: null }
  if (!i.ready) {
    const lastLit = !!i.last && i.last.lamps.some(([, l]) => isLit(l))
    return { mode: lastLit && !i.today.shown ? 'full' : 'strip', effect: null }
  }
  if (i.lit === 0) return { mode: 'strip', effect: null }
  if (!i.today.shown) return { mode: 'full', effect: { shown: true, base: [...i.newIds], unfold: true } }
  if (i.queueOpen || i.unfolded) return { mode: 'full', effect: null }
  const base = new Set(i.today.base)
  const fresh = i.newIds.filter((id) => !base.has(id))
  if (fresh.length) return { mode: 'full', effect: { unfold: true, base: [...i.today.base, ...fresh] } }
  return { mode: 'strip', effect: null }
}

/* ---------------- the optimistic overlay (a card acted on clicks its lamp down in the same frame) */

/**
 * The views with what the queue just did applied: ids an action runs on (or just finished) leave their lamp's count,
 * ids an Undo just brought back join it — until the next reading agrees. `has(lamp, id)`: the id is in the lamp's
 * last reading.
 */
export function overlay(
  views: readonly LampView[],
  pending: ReadonlyArray<{ lamp: LampId; id: string }>,
  undone: ReadonlyArray<{ lamp: LampId; id: string }>,
  has: (lamp: LampId, id: string) => boolean,
): LampView[] {
  if (!pending.length && !undone.length) return views as LampView[]
  return views.map((v) => {
    if (v.level === 'grey') return v
    let d = 0
    for (const p of pending) if (p.lamp === v.id && has(v.id, p.id)) d--
    for (const u of undone) if (u.lamp === v.id && !has(v.id, u.id)) d++
    if (!d) return v
    const count = Math.max(0, v.count + d)
    const level = levelOf({ state: 'ok', count, level: v.forced }, { amber: v.amber, red: v.red })
    return { ...v, count, level, ...(isLit(level) ? {} : { isNew: false, newCount: 0, chip: null }) }
  })
}
