/**
 * The fuse list's rows (plan §3.5, §1.21, §6 U15) — pure, cached per model: the open fuses in F-order (a lapsed
 * allowance counts as open), then the allowed ones, then the grey rows nothing counts — the parts unknown here and the
 * paths that are almost open (a near miss: one condition closes them; ≤ 12 shown, the rest behind "+n more").
 *
 * The selected row is one place for the plate (FuseArea), the glyph's leader (Rack → Wires) and F: the row the person
 * picked (store.ts `fuse`: a glyph, the FUSE cell, `?f=`, F, a tab, a module selected on a path) while it is still in
 * the list, else the first row.
 *
 * B10: the closed plates of this visit (a key 1 / 2 pressed here and not taken back — `withClosed`) join after the fuses,
 * before the grey rows; one whose path is open again (taken back elsewhere, opened again by another change) goes.
 */
import type { KeyDone } from '../keys'
import type { FuseState, Model, NearMiss, UnknownPart } from '../types'
import { fuseNo } from './words'

/** Near misses shown before "+n more" (§1.21). */
export const NEAR_SHOWN = 12

export type FuseRow =
  | { kind: 'fuse'; key: string; fuse: FuseState; state: 'open' | 'lapsed' | 'allowed' }
  | { kind: 'unknown'; key: string; part: UnknownPart }
  | { kind: 'near'; key: string; near: NearMiss }
  | { kind: 'closed'; key: string; done: KeyDone }

export interface FuseRows {
  rows: FuseRow[]
  byKey: Map<string, FuseRow>
  /** near misses past NEAR_SHOWN (in the list only once "+n more" was pressed) */
  hiddenNear: number
}

const cache = new WeakMap<Model, FuseRows>()

/** Every row of the fuse list in list order (near misses all included; the list shows NEAR_SHOWN until unfolded). */
export function fuseRowsOf(model: Model): FuseRows {
  const had = cache.get(model)
  if (had) return had
  const fuses = [...(model.fuses as FuseState[])].sort((a, b) => fuseNo(a.label) - fuseNo(b.label))
  const rows: FuseRow[] = []
  for (const f of fuses) if (f.allowed?.state !== 'allowed') rows.push({ kind: 'fuse', key: f.key, fuse: f, state: f.allowed?.state === 'lapsed' ? 'lapsed' : 'open' })
  for (const f of fuses) if (f.allowed?.state === 'allowed') rows.push({ kind: 'fuse', key: f.key, fuse: f, state: 'allowed' })
  for (const u of model.unknown) rows.push({ kind: 'unknown', key: `u:${u.key}`, part: u })
  const seen = new Set<string>()
  for (const n of model.nearMisses) {
    // one row per path (a path closed on this device and closed by a gate is still one path)
    if (seen.has(n.key)) continue
    seen.add(n.key)
    rows.push({ kind: 'near', key: `n:${n.key}`, near: n })
  }
  const out: FuseRows = { rows, byKey: new Map(rows.map((r) => [r.key, r])), hiddenNear: Math.max(0, seen.size - NEAR_SHOWN) }
  cache.set(model, out)
  return out
}

/** A closed plate's row key. */
export const closedRow = (pathKey: string): string => `c:${pathKey}`

const closedCache = new WeakMap<FuseRows, { closed: readonly KeyDone[]; out: FuseRows }>()

/**
 * The rows with this visit's closed plates (newest per path), after the fuses and before the grey rows. A closed path
 * that is a fuse again (open, lapsed or allowed) is no closed plate any more.
 */
export function withClosed(r: FuseRows, closed: readonly KeyDone[]): FuseRows {
  if (!closed.length) return r
  const had = closedCache.get(r)
  if (had && had.closed.length === closed.length && had.closed.every((d, i) => d === closed[i])) return had.out
  const fuses = new Set(r.rows.filter((x) => x.kind === 'fuse').map((x) => x.key))
  const byPath = new Map<string, KeyDone>()
  for (const d of closed) if (!fuses.has(d.fuse.key)) byPath.set(d.fuse.key, d)
  const add: FuseRow[] = [...byPath.values()].map((d) => ({ kind: 'closed', key: closedRow(d.fuse.key), done: d }))
  const at = r.rows.findIndex((x) => x.kind !== 'fuse')
  const rows = at < 0 ? [...r.rows, ...add] : [...r.rows.slice(0, at), ...add, ...r.rows.slice(at)]
  const out: FuseRows = { rows, byKey: new Map(rows.map((x) => [x.key, x])), hiddenNear: r.hiddenNear }
  closedCache.set(r, { closed, out })
  return out
}

/** The rows the list shows: every near miss once unfolded, else the first NEAR_SHOWN. */
export function shownRows(r: FuseRows, allNear: boolean): FuseRow[] {
  if (allNear || !r.hiddenNear) return r.rows
  let near = 0
  return r.rows.filter((row) => row.kind !== 'near' || ++near <= NEAR_SHOWN)
}

/** The selected row: the picked one while it is in the list, else the first. */
export function selectedRow(r: FuseRows, picked: string | null): FuseRow | null {
  return (picked ? r.byKey.get(picked) : undefined) ?? r.rows[0] ?? null
}

/** The fuse whose glyph carries the leader / stub: the selected row when it is a fuse, else none. */
export function activeGlyph(r: FuseRows, picked: string | null): string | null {
  const row = selectedRow(r, picked)
  return row?.kind === 'fuse' ? row.key : null
}
