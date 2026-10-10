/**
 * Retention (30 days) and the budget's pruning: records older than the cut-off leave every store, then
 * the pins of the segments that went, pins whose segment never landed (orphans), and the counters of
 * tabs that are gone fold into the scope's base. `floor` = where the tape begins for a scope.
 */
import { dropPins, listPinMetas } from '../../history/pins'
import type { JSegment, Scope } from '../model/types'
import { HI, openJournal, pad13, pad8, scopeRange, type Journal } from './db'

export const RETENTION_MS = 30 * 24 * 3600_000
const DAY = 24 * 3600_000
/** a pin younger than this may still wait for its segment's transaction */
const ORPHAN_GRACE = 10 * 60_000

/** Every scope with a journal on this device (each has a digest key, a lanes record or counters). */
export async function scopesOnDevice(j?: Journal): Promise<Scope[]> {
  const jj = j ?? (await openJournal())
  const keys = await jj.keys({ store: 'kv', lo: '', hi: HI })
  const out = new Set<Scope>()
  for (const k of keys) {
    const m = /^(local:local|cloud:[A-Za-z0-9_-]{1,64})\|/.exec(k)
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

const startOfDay = (t: number) => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export interface PruneResult {
  ops: number
  segs: number
  pins: number
}

/** Remove a scope's records older than `cutoff`, the pins of its segments that went, orphan pins; fold dead tabs' counters. */
export async function pruneScope(scope: Scope, cutoff: number, ownTab: string, memory = false): Promise<PruneResult> {
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

  if (!memory) {
    // pins of the segments that went
    const pinIds = gone.map((s) => s.before).filter((x): x is string => !!x)
    if (pinIds.length) await dropPins(scope, pinIds)
    res.pins += pinIds.length
    // orphans: a pin whose segment is not in the journal (its transaction never landed)
    const metas = await listPinMetas(scope)
    if (metas.size) {
      const segIds = new Set(await j.keys({ store: 'segs', lo, hi: `${scope}|${HI}` }))
      const orphans = [...metas].filter(([, m]) => !segIds.has(m.seg) && m.at < Date.now() - ORPHAN_GRACE).map(([id]) => id)
      if (orphans.length) await dropPins(scope, orphans)
      res.pins += orphans.length
    }
  }

  // counters of tabs that are gone → the base
  const live = await liveTabs()
  if (live) {
    const counters = await j.range<{ k: string; ops?: number; bytes?: number }>({ store: 'kv', lo: `${scope}|n|`, hi: `${scope}|n|${HI}` })
    const dead = counters.filter((c) => {
      const tab = c.k.slice(`${scope}|n|`.length)
      return tab !== 'base' && tab !== ownTab && !live.has(tab)
    })
    if (dead.length) {
      const ops = dead.reduce((n, c) => n + Number(c.ops ?? 0), 0)
      const bytes = dead.reduce((n, c) => n + Number(c.bytes ?? 0), 0)
      await j.write({
        bump: [{ store: 'kv', key: `${scope}|n|base`, fn: (cur) => ({ k: `${scope}|n|base`, ops: Number(cur?.ops ?? 0) + ops, bytes: Number(cur?.bytes ?? 0) + bytes }) }],
        del: dead.map((c) => ({ store: 'kv', key: c.k })),
      })
    }
  }
  // what pruning removed shrinks the base's byte count (approximately: by share of Vorgänge)
  if (res.ops) {
    await j.write({
      bump: [
        {
          store: 'kv',
          key: `${scope}|n|base`,
          fn: (cur) => {
            const bytes = Number(cur?.bytes ?? 0)
            const ops = Number(cur?.ops ?? 0)
            const per = ops > 0 ? bytes / ops : 0
            return { k: `${scope}|n|base`, ops: Math.max(0, ops - res.ops), bytes: Math.max(0, Math.round(bytes - per * res.ops)) }
          },
        },
      ],
    })
  }
  // the tape begins at the floor
  await j.write({ bump: [{ store: 'kv', key: `${scope}|floor`, fn: (cur) => ({ k: `${scope}|floor`, at: Math.max(Number(cur?.at ?? 0), cutoff) }) }] })
  return res
}

/** Retention: everything older than 30 days, in every scope on this device. */
export async function pruneRetention(now: number, ownTab: string, memory = false): Promise<PruneResult> {
  const total: PruneResult = { ops: 0, segs: 0, pins: 0 }
  for (const s of await scopesOnDevice()) {
    const r = await pruneScope(s, now - RETENTION_MS, ownTab, memory)
    total.ops += r.ops
    total.segs += r.segs
    total.pins += r.pins
  }
  return total
}

/** The budget: whole oldest days across every scope. Resolves with the days removed (0: nothing left to prune). */
export async function pruneOldestDays(days: number, ownTab: string, memory = false): Promise<number> {
  const j = await openJournal()
  let oldest = Infinity
  const scopes = await scopesOnDevice(j)
  for (const s of scopes) {
    const [lo, hi] = scopeRange(s)
    const first = await j.range<{ at: number }>({ store: 'ops', lo, hi, limit: 1 })
    if (first[0]) oldest = Math.min(oldest, first[0].at)
  }
  if (!Number.isFinite(oldest)) return 0
  const cutoff = startOfDay(oldest) + days * DAY
  // never today's records: the budget gives back days, not the present
  if (cutoff > startOfDay(Date.now())) return 0
  for (const s of scopes) await pruneScope(s, cutoff, ownTab, memory)
  return days
}

/** The budget's first step: the pins of the person's segments older than 7 days (their segments read partial). */
export async function pruneHumanPins(now: number): Promise<number> {
  const j = await openJournal()
  let n = 0
  for (const s of await scopesOnDevice(j)) {
    const segs = await j.range<JSegment>({ store: 'segs', index: 'lane', lo: [s, 'you', 0], hi: [s, 'you', now - 7 * DAY] })
    const withPins = segs.filter((g) => g.before)
    if (!withPins.length) continue
    await dropPins(
      s,
      withPins.map((g) => g.before!),
    )
    await j.write({ put: { segs: withPins.map((g) => ({ ...g, before: null })) } })
    n += withPins.length
  }
  return n
}
