/**
 * Autofill rows the watch paused at the red line (Regler § 5.7) — persisted per device and member so a reload does not
 * lose them: localStorage `one.governor.paused:<scope>` = { rows: [{ db, prop, row, cause, at }], dropped }. At most 200
 * rows; older ones go and are counted (the panel says "n Zeilen nicht nachgeholt"). Each row keeps the writer key of the
 * change that caused it (`cause`), so a resumed fill is written as { kind: 'autofill', db, prop, cause } — never as the
 * person. Never synced, exported or backed up; wiped with the device copy and the local reset. Pure apart from the
 * storage handed in.
 */
import { localKV, type KV } from './device'

export const PAUSED_PREFIX = 'one.governor.paused:'
export const PAUSED_MAX = 200

export interface PausedRow {
  db: string
  prop: string
  row: string
  /** the writer key of the change that made the row due (store/writer.ts causeKey()); null: none known */
  cause: string | null
  at: number
}

export interface PausedList {
  rows: PausedRow[]
  /** rows dropped over the cap since the list was last emptied */
  dropped: number
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
/** the writer-key alphabet (store/writer.ts) */
const CAUSE_RE = /^[A-Za-z0-9_\-:/#<>~@+.]{1,200}$/
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

const keyOf = (scope: string) => `${PAUSED_PREFIX}${scope}`
const same = (a: Pick<PausedRow, 'db' | 'prop' | 'row'>, b: Pick<PausedRow, 'db' | 'prop' | 'row'>) => a.db === b.db && a.prop === b.prop && a.row === b.row

function readRow(v: unknown): PausedRow | null {
  if (!isObj(v) || typeof v.db !== 'string' || !ID_RE.test(v.db) || typeof v.prop !== 'string' || !ID_RE.test(v.prop) || typeof v.row !== 'string' || !ID_RE.test(v.row)) return null
  if (typeof v.at !== 'number' || !Number.isFinite(v.at)) return null
  return { db: v.db, prop: v.prop, row: v.row, cause: typeof v.cause === 'string' && CAUSE_RE.test(v.cause) ? v.cause : null, at: v.at }
}

/** This scope's paused rows (oldest first) as every reader keeps them. */
export function readPaused(scope: string, kv: KV | null = localKV()): PausedList {
  let v: unknown
  try {
    const raw = kv?.getItem(keyOf(scope))
    v = raw ? JSON.parse(raw) : undefined
  } catch {
    v = undefined
  }
  if (!isObj(v)) return { rows: [], dropped: 0 }
  const rows: PausedRow[] = []
  for (const x of Array.isArray(v.rows) ? v.rows : []) {
    const r = readRow(x)
    if (r && !rows.some((o) => same(o, r))) rows.push(r)
  }
  rows.sort((a, b) => a.at - b.at)
  const dropped = typeof v.dropped === 'number' && Number.isInteger(v.dropped) && v.dropped >= 0 ? v.dropped : 0
  return { rows: rows.slice(-PAUSED_MAX), dropped: dropped + Math.max(0, rows.length - PAUSED_MAX) }
}

function writePaused(scope: string, list: PausedList, kv: KV | null): boolean {
  if (!kv) return false
  try {
    if (!list.rows.length && !list.dropped) kv.removeItem(keyOf(scope))
    else kv.setItem(keyOf(scope), JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

/** Rows paused now (a row already paused keeps its place, gets the newer cause and time). The list after. */
export function addPaused(scope: string, add: readonly PausedRow[], kv: KV | null = localKV()): PausedList {
  const cur = readPaused(scope, kv)
  const rows = cur.rows.filter((r) => !add.some((a) => same(a, r)))
  for (const a of add) {
    const r = readRow(a)
    if (r && !rows.some((o) => same(o, r))) rows.push(r)
  }
  rows.sort((a, b) => a.at - b.at)
  const over = Math.max(0, rows.length - PAUSED_MAX)
  const list = { rows: rows.slice(over), dropped: cur.dropped + over }
  writePaused(scope, list, kv)
  return list
}

/** Take the paused rows that match (all without a filter) out of the list — the watch resumes them. */
export function takePaused(scope: string, match: { db?: string; prop?: string } = {}, kv: KV | null = localKV()): PausedRow[] {
  const cur = readPaused(scope, kv)
  const hit = (r: PausedRow) => (match.db === undefined || r.db === match.db) && (match.prop === undefined || r.prop === match.prop)
  const taken = cur.rows.filter(hit)
  if (!taken.length) return []
  const rest = cur.rows.filter((r) => !hit(r))
  writePaused(scope, { rows: rest, dropped: rest.length ? cur.dropped : 0 }, kv)
  return taken
}

/** Forget this scope's paused rows (the device copy, the local reset). */
export function wipePaused(scope: string, kv: KV | null = localKV()): void {
  try {
    kv?.removeItem(keyOf(scope))
  } catch {
    /* blocked storage */
  }
}
