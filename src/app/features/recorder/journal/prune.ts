/**
 * Retention (30 days) and the budget's pruning: records older than the cut-off leave every store, then
 * the pins of the segments that went and pins whose segment never landed (orphans). Every prune lowers
 * the scope's day sizes (`kv <scope>|d|<day>`) by what it removed — a day that goes takes its size along —
 * so the budget's figure is what the stores hold. `floor` = where the tape begins for a scope.
 */
import { dropPins, listPinIds, loadPinMetas, parsePinId, PIN_GRACE, type Freed } from '../../history/pins'
import type { EjectRecord, JSegment, Scope } from '../model/types'
import { dayKey, HI, openJournal, pad13, pad8, scopeRange, startOfDay, type Bump, type Journal } from './db'

export const RETENTION_MS = 30 * 24 * 3600_000
const DAY = 24 * 3600_000

/** Every scope with a journal on this device (each has a digest key, a lanes record or day sizes). */
export async function scopesOnDevice(j?: Journal): Promise<Scope[]> {
  const jj = j ?? (await openJournal())
  const keys = await jj.keys({ store: 'kv', lo: '', hi: HI })
  const out = new Set<Scope>()
  for (const k of keys) {
    const m = /^(local:[A-Za-z0-9_-]{1,64}|cloud:[A-Za-z0-9_-]{1,64}(?::u:[A-Za-z0-9_-]{1,64})?)\|/.exec(k)
    if (m) out.add(m[1] as Scope)
  }
  return [...out]
}

/** Tabs whose Web Lock is held right now (null: unknown — locks unsupported). */
export async function liveTabs(): Promise<Set<string> | null> {
  try {
    const q = await navigator.locks?.query?.()
    if (!q) return null
    const out = new Set<string>()
    for (const l of [...(q.held ?? []), ...(q.pending ?? [])]) if (l.name?.startsWith('one-recorder-tab:')) out.add(l.name.slice('one-recorder-tab:'.length))
    return out
  } catch {
    return null
  }
}

export interface PruneResult {
  ops: number
  segs: number
  pins: number
}

/** What a prune must leave alone: segments this tab has not written yet (their pins may already be stored). */
export interface PruneOpts {
  memory?: boolean
  /** segment ids still on their way to the journal (waiting, or in a flush right now) */
  keep?: ReadonlySet<string>
  /** sweep orphan pins too (once per prune pass: retention; the budget's day-by-day loop leaves it out) */
  sweep?: boolean
}

/** Lower the day sizes by what a drop freed — only days that are still there (`from`: the first one kept). */
export async function giveBack(j: Journal, scope: Scope, freed: Freed, from = 0): Promise<void> {
  const by = new Map<string, number>()
  for (const f of freed) {
    if (f.at < from || !f.bytes) continue
    const k = dayKey(scope, f.at)
    by.set(k, (by.get(k) ?? 0) + f.bytes)
  }
  if (!by.size) return
  const bump: Bump[] = [...by].map(([key, bytes]) => ({ store: 'kv', key, fn: (cur) => (cur ? { ...cur, k: key, bytes: Math.max(0, Number(cur.bytes ?? 0) - bytes) } : null) }))
  await j.write({ bump })
}

/**
 * Segments whose pins an eject still needs (F29): the places a live (not undone, not aborted) eject took back — a
 * later eject compares them, an Undo after a reload plans from them — and every eject's own segments (`r` eject:…,
 * "eject the eject"). ONE range read of the scope's eject records. Whole days still go with the budget and retention:
 * an eject record pruned with its day leaves the after-plate's Undo off ("no longer on the tape").
 */
export async function protectedSegs(j: Journal, scope: Scope): Promise<Set<string>> {
  const out = new Set<string>()
  const recs = await j.range<EjectRecord>({ store: 'ejects', index: 'at', lo: [scope, 0], hi: [scope, Number.MAX_SAFE_INTEGER] })
  for (const r of recs) if (r.state !== 'aborted' && !r.undone) for (const id of r.segs ?? []) out.add(id)
  return out
}

/** A segment an eject needs (its own, or one a live eject took back). */
const isProtected = (g: JSegment, prot: ReadonlySet<string>) => prot.has(g.id) || !!g.r?.startsWith('eject:')

/** Remove a scope's records older than `cutoff`, the pins of its segments that went, orphan pins, and the days' sizes. */
export async function pruneScope(scope: Scope, cutoff: number, opts: PruneOpts = {}): Promise<PruneResult> {
  const j = await openJournal()
  const [lo] = scopeRange(scope)
  const res: PruneResult = { ops: 0, segs: 0, pins: 0 }
  res.ops = await j.deleteRange({ store: 'ops', lo, hi: `${scope}|${pad13(cutoff)}` })
  await j.deleteRange({ store: 'events', lo, hi: `${scope}|${pad13(cutoff)}` })
  const old = await j.range<JSegment>({ store: 'segs', index: 'from', lo: [scope, 0], hi: [scope, cutoff - 1] })
  const gone = old.filter((s) => s.to < cutoff)
  if (gone.length) await j.write({ del: gone.map((s) => ({ store: 'segs', key: s.id })) })
  res.segs = gone.length
  const runs = await j.range<{ id: string; to: number }>({ store: 'runs', index: 'from', lo: [scope, 0], hi: [scope, cutoff - 1] })
  const oldRuns = runs.filter((r) => r.to < cutoff)
  if (oldRuns.length) await j.write({ del: oldRuns.map((r) => ({ store: 'runs', key: r.id })) })
  await j.deleteRange({ store: 'minutes', lo, hi: `${scope}|${pad8(Math.floor(cutoff / 60_000) - 1)}` })
  await j.deleteRange({ store: 'quarters', lo, hi: `${scope}|${pad8(Math.floor(cutoff / 900_000) - 1)}` })
  await j.deleteRange({ store: 'checkpoints', lo, hi: `${scope}|${pad13(cutoff)}` })
  await j.deleteRange({ store: 'ejects', index: 'at', lo: [scope, 0], hi: [scope, cutoff - 1] })
  await j.deleteRange({ store: 'kv', lo: `${scope}|gap|`, hi: `${scope}|gap|${pad13(cutoff)}` })
  // the sizes of the days that went entirely (the cut-off's own day keeps its size until it goes too)
  const firstKept = startOfDay(cutoff)
  await j.deleteRange({ store: 'kv', lo: `${scope}|d|`, hi: `${scope}|d|${pad13(firstKept - 1)}` })

  if (!opts.memory) {
    const freed: Freed = []
    // pins of the segments that went
    const pinIds = gone.map((s) => s.before).filter((x): x is string => !!x)
    if (pinIds.length) freed.push(...(await dropPins(scope, pinIds)))
    res.pins += pinIds.length
    if (opts.sweep !== false) {
      const orphans = await orphanPins(j, scope, opts.keep)
      if (orphans.length) freed.push(...(await dropPins(scope, orphans)))
      res.pins += orphans.length
    }
    await giveBack(j, scope, freed, firstKept)
  }
  // the tape begins at the floor
  await j.write({ bump: [{ store: 'kv', key: `${scope}|floor`, fn: (cur) => ({ k: `${scope}|floor`, at: Math.max(Number(cur?.at ?? 0), cutoff) }) }] })
  return res
}

/**
 * Orphans: pins whose segment is not in the journal (its transaction never landed) — never one written in the last
 * minutes (another tab may be between its pins and its segments) nor one of this tab's segments on their way. Keys
 * only: a pin's id names its segment and when it was written (a meta is read only for an id of another form).
 */
async function orphanPins(j: Journal, scope: Scope, keep?: ReadonlySet<string>): Promise<string[]> {
  const ids = await listPinIds(scope)
  if (!ids.length) return []
  const [lo] = scopeRange(scope)
  const segIds = new Set(await j.keys({ store: 'segs', lo, hi: `${scope}|${HI}` }))
  const prot = await protectedSegs(j, scope)
  const young = Date.now() - PIN_GRACE
  const orphan = (seg: string, wt: number) => !segIds.has(seg) && !keep?.has(seg) && !prot.has(seg) && wt < young
  const out: string[] = []
  const other: string[] = []
  for (const id of ids) {
    const p = parsePinId(id)
    if (!p) other.push(id)
    else if (orphan(`${scope}|${p.seg}`, p.wt)) out.push(id)
  }
  if (other.length) for (const [id, m] of await loadPinMetas(scope, other)) if (orphan(m.seg, m.wt ?? m.at)) out.push(id)
  return out
}

/** Retention: everything older than 30 days, in every scope on this device. */
export async function pruneRetention(now: number, opts: PruneOpts = {}): Promise<PruneResult> {
  const total: PruneResult = { ops: 0, segs: 0, pins: 0 }
  for (const s of await scopesOnDevice()) {
    const r = await pruneScope(s, now - RETENTION_MS, opts)
    total.ops += r.ops
    total.segs += r.segs
    total.pins += r.pins
  }
  return total
}

/**
 * The budget: whole oldest days across every scope — at most `days`, never today's. Resolves with the days removed
 * (0: nothing older than today is left).
 */
export async function pruneOldestDays(days: number, opts: PruneOpts = {}): Promise<number> {
  const j = await openJournal()
  let oldest = Infinity
  const scopes = await scopesOnDevice(j)
  for (const s of scopes) {
    const [lo, hi] = scopeRange(s)
    const first = await j.range<{ at: number }>({ store: 'ops', lo, hi, limit: 1 })
    if (first[0]) oldest = Math.min(oldest, first[0].at)
    // a segment can be older than every op left of its scope (a stretch across days)
    const seg = await j.range<{ from: number }>({ store: 'segs', index: 'from', lo: [s, 0], hi: [s, Number.MAX_SAFE_INTEGER], limit: 1 })
    if (seg[0]) oldest = Math.min(oldest, seg[0].from)
  }
  if (!Number.isFinite(oldest)) return 0
  const today = startOfDay(Date.now())
  const first = startOfDay(oldest)
  if (first >= today) return 0
  // the budget gives back days, not the present: the cut-off stops at today's midnight
  const cutoff = Math.min(first + days * DAY, today)
  // (orphans are swept by the retention pass — not once per day the budget gives back)
  for (const s of scopes) await pruneScope(s, cutoff, { ...opts, sweep: false })
  return Math.max(1, Math.round((cutoff - first) / DAY))
}

/** Drop the pins of some segments (never one of this tab's on their way): they read partial from now on. */
async function dropSegmentPins(j: Journal, scope: Scope, segs: JSegment[], keep?: ReadonlySet<string>): Promise<number> {
  const prot = await protectedSegs(j, scope)
  const withPins = segs.filter((g) => g.before && !keep?.has(g.id) && !isProtected(g, prot))
  if (!withPins.length) return 0
  const freed = await dropPins(
    scope,
    withPins.map((g) => g.before!),
  )
  await j.write({ put: { segs: withPins.map((g) => ({ ...g, before: null })) } })
  await giveBack(j, scope, freed)
  return withPins.length
}

/** The budget's first step: the pins of the person's segments older than 7 days (their segments read partial) — never one an eject needs. */
export async function pruneHumanPins(now: number, opts: PruneOpts = {}): Promise<number> {
  if (opts.memory) return 0
  const j = await openJournal()
  let n = 0
  for (const s of await scopesOnDevice(j)) n += await dropSegmentPins(j, s, await j.range<JSegment>({ store: 'segs', index: 'lane', lo: [s, 'you', 0], hi: [s, 'you', now - 7 * DAY] }), opts.keep)
  return n
}

/**
 * The workspace could not save and no older day is left to give back: today's pins go, oldest first — `share` of
 * them (their segments read partial; the records stay), never one an eject needs. Resolves with the pins dropped.
 */
export async function pruneTodayPins(now: number, opts: PruneOpts = {}, share = 0.5): Promise<number> {
  if (opts.memory) return 0
  const j = await openJournal()
  const segs: JSegment[] = []
  for (const s of await scopesOnDevice(j)) {
    const prot = await protectedSegs(j, s)
    segs.push(...(await j.range<JSegment>({ store: 'segs', index: 'from', lo: [s, startOfDay(now)], hi: [s, now] })).filter((g) => g.before && !opts.keep?.has(g.id) && !isProtected(g, prot)))
  }
  if (!segs.length) return 0
  segs.sort((a, b) => a.from - b.from)
  const take = segs.slice(0, Math.max(1, Math.ceil(segs.length * share)))
  const by = new Map<Scope, JSegment[]>()
  for (const g of take) by.set(g.s, [...(by.get(g.s) ?? []), g])
  let n = 0
  for (const [s, list] of by) n += await dropSegmentPins(j, s, list)
  return n
}

/** The device's journal size: Σ of every scope's day sizes (the records and pins they hold). */
export async function journalBytes(j?: Journal): Promise<number> {
  const jj = j ?? (await openJournal())
  const recs = await jj.range<{ k: string; bytes?: number }>({ store: 'kv', lo: '', hi: HI })
  let n = 0
  for (const r of recs) if (r.k.includes('|d|')) n += Number(r.bytes ?? 0)
  return n
}
