/**
 * Acknowledgements per lamp, per device and member: localStorage `one.preflight.ack:<scope>` =
 * `{ v: 1, lamps: { [lampId]: { n, h, set ≤ 300 hashes, at } } }` (FNV hashes of ids, never the ids or their text).
 * A lamp is new while its reading holds an id whose hash is not in the set. Fail-soft: a browser that refuses storage
 * keeps the acknowledgements in memory for this tab (prefs.ts readRaw / writeRaw).
 */
import { ackKey, readRaw, writeRaw } from './prefs'
import { ACK_SET_MAX } from './lamps'
import type { LampId } from './registry'
import type { AckEntry, AckRecord } from './types'

/** a lamp not on the panel for this long loses its record */
export const ACK_PRUNE_MS = 30 * 86_400_000

const HASH = /^[0-9a-f]{8}$/

function sanitizeEntry(v: unknown): AckEntry | null {
  if (!v || typeof v !== 'object') return null
  const e = v as Record<string, unknown>
  if (typeof e.n !== 'number' || !(e.n >= 0) || typeof e.at !== 'number' || typeof e.h !== 'string' || !Array.isArray(e.set)) return null
  const set = e.set.filter((x): x is string => typeof x === 'string' && HASH.test(x)).slice(0, ACK_SET_MAX)
  return { n: Math.floor(e.n), h: HASH.test(e.h) ? e.h : '00000000', set, at: e.at }
}

export function sanitizeAcks(raw: unknown): AckRecord {
  const out: AckRecord = { v: 1, lamps: {} }
  if (!raw || typeof raw !== 'object') return out
  const lamps = (raw as { lamps?: unknown }).lamps
  if (!lamps || typeof lamps !== 'object') return out
  for (const [id, v] of Object.entries(lamps as Record<string, unknown>).slice(0, 128)) {
    const e = sanitizeEntry(v)
    if (e && id.length <= 120) out.lamps[id] = e
  }
  return out
}

export function readAcks(scope: string): AckRecord {
  const raw = readRaw(ackKey(scope))
  if (!raw) return { v: 1, lamps: {} }
  try {
    return sanitizeAcks(JSON.parse(raw))
  } catch {
    return { v: 1, lamps: {} }
  }
}

function writeAcks(scope: string, rec: AckRecord): void {
  writeRaw(ackKey(scope), Object.keys(rec.lamps).length ? JSON.stringify(rec) : null)
}

/** Store the acknowledgement of these lamps (read again, so another tab's acknowledgements stay). */
export function putAcks(scope: string, entries: Record<LampId, AckEntry>): AckRecord {
  const rec = readAcks(scope)
  for (const [id, e] of Object.entries(entries)) rec.lamps[id] = e
  writeAcks(scope, rec)
  return rec
}

/** Drop the records of lamps not on the panel whose last acknowledgement is older than 30 days. */
export function pruneAcks(scope: string, live: ReadonlySet<LampId>, now: number): void {
  const rec = readAcks(scope)
  let changed = false
  for (const [id, e] of Object.entries(rec.lamps)) {
    if (live.has(id) || now - e.at < ACK_PRUNE_MS) continue
    delete rec.lamps[id]
    changed = true
  }
  if (changed) writeAcks(scope, rec)
}
