/**
 * Work orders — this device's consent "Ohne Bestätigung starten" / "Start without confirming" (spec §3.5): localStorage
 * `one.orders.auto:<scope>:<db>` = `{ sig, at }` per work-orders database. Never in `Database.orders`, never synced,
 * exported or backed up — a backup, a restore, a duplicate or an import can never carry it. Local workspaces only: in a
 * team the reader says "none" whatever is stored (auto mode does not exist there).
 *
 * B10 (the Patchbay) reads it — `pipelineGate('order')`: 'byHand' without it, nothing with it — and its key 1 drops it
 * (and puts it back on Undo). B11 switches it on (autoStart.ts `switchAutoOn`: a budget required, the Patchbay asked,
 * the sig over the settings — autoSig.ts) and compares the sig with the settings now (autoWatch.ts, and again at every
 * auto create): a mismatch LAPSES it — the key then holds `{ lapsed: at }` (reads as no consent; the settings say
 * "Einstellungen geändert seit dem Einschalten — erneut einschalten"). A restore of a backup drops every consent of
 * this scope (`dropOrderAutoAll`, features/io/backup.ts), the local reset removes the keys (shell/lib/reset.ts).
 *
 * The sig is kept as it was written (64 hex). Readers sanitize: anything else reads as no consent.
 */
import { useSyncExternalStore } from 'react'
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

/** React: this device's consent for a work-orders database and its lapse note (re-read on every change). */
export function useOrderAuto(db: ID | null | undefined): { consent: OrderAuto | null; lapsed: number | null } {
  const raw = useSyncExternalStore(
    onOrderAuto,
    () => (db ? `${JSON.stringify(readOrderAuto(db))}|${readOrderLapse(db) ?? ''}` : ''),
    () => '',
  )
  const [c, l] = raw.split('|')
  return { consent: c ? (JSON.parse(c) as OrderAuto | null) : null, lapsed: l ? Number(l) : null }
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

/** The e2e seam's writer: set or clear a consent as it is. */
export function setOrderAutoForTest(db: ID, v: OrderAuto | null): boolean {
  return write(db, v ? readAutoValue(v) : null)
}

/** B11: the consent the switch gives (autoStart.ts switchAutoOn only — after the budget, the sig and the Patchbay). */
export function giveOrderAuto(db: ID, sig: string): OrderAuto | null {
  const v = readAutoValue({ sig, at: Date.now() })
  return v && write(db, v) ? v : null
}

/** When this device's consent lapsed (the settings changed since it was given), null: it did not (or was given again). */
export function readOrderLapse(db: ID): number | null {
  if (!local() || !ID_RE.test(db)) return null
  try {
    const raw = localStorage.getItem(keyOf(db))
    const v = raw ? (JSON.parse(raw) as unknown) : null
    const at = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>).lapsed : undefined
    return typeof at === 'number' && Number.isFinite(at) && at >= 0 ? at : null
  } catch {
    return null
  }
}

/**
 * B11: the consent lapses — only the one given with `sig` (a newer one stays): the key then holds `{ lapsed: at }`, read
 * as no consent everywhere (the Patchbay draws the planner by hand again). Returns whether it lapsed here.
 */
export function lapseOrderAuto(db: ID, sig: string): boolean {
  if (readOrderAuto(db)?.sig !== sig || !local() || !ID_RE.test(db)) return false
  try {
    localStorage.setItem(keyOf(db), JSON.stringify({ lapsed: Date.now() }))
  } catch {
    return false
  }
  announce()
  return true
}

/** Forget a lapse note (the person read it, or switched the consent off). */
export function clearOrderLapse(db: ID): void {
  if (readOrderLapse(db) !== null) write(db, null)
}

/**
 * B11: every consent of this device for the workspace now (this scope), lapse notes included — a restored backup never
 * keeps one (the restored wiring is not what was consented to on this device). Returns how many were dropped.
 */
export function dropOrderAutoAll(): number {
  const prefix = `${AUTO_KEY_PREFIX}${orderScope()}:`
  let n = 0
  try {
    for (const k of Object.keys(localStorage))
      if (k.startsWith(prefix)) {
        localStorage.removeItem(k)
        n++
      }
  } catch {
    return 0
  }
  if (n) announce()
  return n
}
