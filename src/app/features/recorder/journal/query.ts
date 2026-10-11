/**
 * The deck's reads: ops of the visible span (one range on the primary key), the runs they belong to, the 24 h
 * strip's quarters, the 24 STD lanes' minute histogram, the known lanes, a window's events (for its meters), the
 * tape's size and where it begins. Read-only; each read is one range (no cursor walks).
 */
import type { JEvent, JHist, JOp, JRun, JSegment, LaneKey, Scope } from '../model/types'
import { HI, openJournal, pad13, pad8, scopeRange } from './db'

/** A typing fold starts up to this much before the ops it represents. */
const FOLD_MS = 30_000
const DAY = 24 * 3600_000

/** Ops with from ≤ at ≤ to (a fold that began just before `from` included). */
export async function opsInSpan(scope: Scope, from: number, to: number): Promise<JOp[]> {
  const j = await openJournal()
  return j.range<JOp>({ store: 'ops', lo: `${scope}|${pad13(from - FOLD_MS)}`, hi: `${scope}|${pad13(to)}|${HI}` })
}

/** Runs that began in [from − 1 day, to] (a run's flag can sit before the span it reaches into). */
export async function runsInSpan(scope: Scope, from: number, to: number): Promise<Record<string, JRun>> {
  const j = await openJournal()
  const out: Record<string, JRun> = {}
  for (const r of await j.range<JRun>({ store: 'runs', index: 'from', lo: [scope, from - DAY], hi: [scope, to] })) out[r.key] = r
  return out
}

/** One run's record. */
export async function runOf(scope: Scope, key: string): Promise<JRun | undefined> {
  const j = await openJournal()
  return j.get<JRun>('runs', `${scope}|${key}`)
}

/** Vorgänge per quarter (quarter index → count) in [q0, q1). `hidden` lanes are left out. */
export async function quarterCounts(scope: Scope, q0: number, q1: number, hidden?: Set<LaneKey>): Promise<Map<number, number>> {
  const j = await openJournal()
  const out = new Map<number, number>()
  for (const h of await j.range<JHist>({ store: 'quarters', lo: `${scope}|${pad8(q0)}`, hi: `${scope}|${pad8(q1 - 1)}` })) {
    let n = 0
    for (const [l, c] of Object.entries(h.lanes)) if (!hidden?.has(l)) n += c
    if (n) out.set(h.m, n)
  }
  return out
}

/** The minute histogram of [from, to] (24 STD draws its lanes from it). */
export async function minutesInSpan(scope: Scope, from: number, to: number): Promise<JHist[]> {
  const j = await openJournal()
  return j.range<JHist>({ store: 'minutes', lo: `${scope}|${pad8(Math.floor(from / 60_000))}`, hi: `${scope}|${pad8(Math.floor(to / 60_000))}` })
}

/** Every lane this scope ever recorded: its last write and its total. */
export async function laneList(scope: Scope): Promise<Record<LaneKey, { last: number; total: number }>> {
  const j = await openJournal()
  const rec = await j.get<{ lanes?: Record<LaneKey, { last: number; total: number }> }>('kv', `${scope}|lanes`)
  return rec?.lanes ?? {}
}

/** Whose events: a lane, or one run. */
export type WhoRead = { lane: LaneKey } | { run: string }

/** The events of a window [a, b) of a lane or a run (the plate's meters). */
export async function eventsOf(scope: Scope, who: WhoRead, a: number, b: number): Promise<JEvent[]> {
  const j = await openJournal()
  if ('run' in who) return (await j.range<JEvent>({ store: 'events', index: 'run', lo: [scope, who.run], hi: [scope, who.run] })).filter((e) => e.at >= a && e.at < b)
  return j.range<JEvent>({ store: 'events', index: 'lane', lo: [scope, who.lane, a], hi: [scope, who.lane, b - 1] })
}

/** The segments of a lane or a run that began in [a − 1 day, b). */
export async function segmentsOf(scope: Scope, who: WhoRead, a: number, b: number): Promise<JSegment[]> {
  const j = await openJournal()
  const list = 'run' in who ? await j.range<JSegment>({ store: 'segs', index: 'run', lo: [scope, who.run], hi: [scope, who.run] }) : await j.range<JSegment>({ store: 'segs', index: 'lane', lo: [scope, who.lane, a - DAY], hi: [scope, who.lane, b - 1] })
  return list.filter((s) => s.from < b && s.to >= a)
}

export interface TapeInfo {
  /** Vorgänge on this device (the scope's day sizes) */
  ops: number
  /** bytes the journal and its pins hold for the scope */
  bytes: number
  /** the first day with records (local midnight), null: none */
  first: number | null
  /** where the tape begins after a prune (null: never pruned) */
  floor: number | null
}

/** The scope's size and age, from its bookkeeping (kv), never from the records themselves. */
export async function tapeInfo(scope: Scope): Promise<TapeInfo> {
  const j = await openJournal()
  const [lo, hi] = scopeRange(scope)
  let ops = 0
  let bytes = 0
  let first: number | null = null
  let floor: number | null = null
  for (const r of await j.range<{ k: string; ops?: number; bytes?: number; at?: number }>({ store: 'kv', lo, hi })) {
    const rest = r.k.slice(scope.length + 1)
    if (rest.startsWith('d|')) {
      ops += Number(r.ops ?? 0)
      bytes += Number(r.bytes ?? 0)
      const day = Number(rest.slice(2))
      if (Number.isFinite(day) && (r.ops ?? 0) > 0 && (first === null || day < first)) first = day
    } else if (rest === 'floor' && typeof r.at === 'number') floor = r.at
  }
  return { ops, bytes, first, floor }
}

/** Every scope's bytes on this device (the budget's figure — Workspace → Data shows the device-wide size). */
export async function deviceBytes(): Promise<number> {
  const j = await openJournal()
  let n = 0
  for (const r of await j.range<{ k: string; bytes?: number }>({ store: 'kv', lo: '', hi: HI })) if (r.k.includes('|d|')) n += Number(r.bytes ?? 0)
  return n
}
