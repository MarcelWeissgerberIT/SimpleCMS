/**
 * Work orders — this device's consent "Ohne Bestätigung starten" / "Start without confirming" (spec §3.5): localStorage
 * `one.orders.auto:<scope>:<db>` = `{ sig, at }` per work-orders database. Never in `Database.orders`, never synced,
 * exported or backed up — a backup, a restore, a duplicate or an import can never carry it. Local workspaces only: in a
 * team the reader says "none" whatever is stored (auto mode does not exist there).
 *
 * B10 (the Patchbay) reads it — `pipelineGate('order')`: 'byHand' without it, nothing with it — and its key 1 drops it
 * (and puts it back on Undo). Switching it on (budget required, the Patchbay asked, the sig over the settings) is B11's;
 * until then only the e2e seam writes one (`__oneOrders.setAuto`).
 *
 * The sig is kept as it was written (64 hex); B11 compares it with the settings now — a mismatch drops the consent.
 * Readers sanitize: anything else reads as no consent.
 */
import type { ID } from '../../../store/types'
import { activeWorkspace } from '../../../cloud'
import { orderScope } from './records'

export interface OrderAuto {
  /** SHA-256 hex over the settings the consent was given for (B11 writes and compares it) */
  sig: string
  /** when it was given (ms) */
  at: number
}

export const AUTO_KEY_PREFIX = 'one.orders.auto:'
const SIG_RE = /^[0-9a-f]{64}$/
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

const keyOf = (db: ID, scope = orderScope()) => `${AUTO_KEY_PREFIX}${scope}:${db}`

/** A stored consent as this build reads it (null: none, or not one it can read). */
export function readAutoValue(v: unknown): OrderAuto | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  if (typeof o.sig !== 'string' || !SIG_RE.test(o.sig)) return null
  if (typeof o.at !== 'number' || !Number.isFinite(o.at) || o.at < 0) return null
  return { sig: o.sig, at: o.at }
}

const local = (): boolean => activeWorkspace().kind !== 'cloud'

/** This device's consent for a work-orders database (null: every chain is confirmed by hand — always in a team). */
export function readOrderAuto(db: ID): OrderAuto | null {
  if (!local() || !ID_RE.test(db)) return null
  try {
    const raw = localStorage.getItem(keyOf(db))
    return raw ? readAutoValue(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

const listeners = new Set<() => void>()
const announce = () => {
  for (const fn of [...listeners]) fn()
}

/** Hear a consent change (this tab's writes, another tab's through the storage event). */
export function onOrderAuto(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

if (typeof window !== 'undefined')
  window.addEventListener('storage', (e) => {
    if (e.key === null || e.key.startsWith(AUTO_KEY_PREFIX)) announce()
  })

function write(db: ID, v: OrderAuto | null): boolean {
  if (!local() || !ID_RE.test(db)) return false
  try {
    if (v) localStorage.setItem(keyOf(db), JSON.stringify(v))
    else localStorage.removeItem(keyOf(db))
  } catch {
    return false
  }
  announce()
  return true
}

/**
 * Drop this device's consent (the Patchbay's key 1, a lapse): every chain of that database is confirmed by hand again.
 * Returns the consent it dropped (null: there was none).
 */
export function dropOrderAuto(db: ID): OrderAuto | null {
  const was = readOrderAuto(db)
  if (!was) return null
  return write(db, null) ? was : null
}

/** Put a dropped consent back as it was (the key's Undo) — only while none is stored (false: refused). */
export function restoreOrderAuto(db: ID, v: OrderAuto): boolean {
  const ok = readAutoValue(v)
  if (!ok || readOrderAuto(db)) return false
  return write(db, ok)
}

/** The e2e seam's writer (B11 builds the real switch): set or clear a consent as it is. */
export function setOrderAutoForTest(db: ID, v: OrderAuto | null): boolean {
  return write(db, v ? readAutoValue(v) : null)
}
