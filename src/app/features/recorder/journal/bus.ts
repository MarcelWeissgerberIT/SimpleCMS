/**
 * "The journal changed": this tab's flushes hand their ops and runs to listeners straight away (the deck merges them
 * without a read), and a BroadcastChannel `one-recorder` pings other tabs, which re-read what they show (debounced
 * by the reader). A wipe or a prune says so too (everything shown may be gone).
 */
import type { JOp, JRun, PlaceKey, Scope } from '../model/types'

export interface Flushed {
  /** copies of the ops written (a typing fold is written again with each flush that grew it) */
  ops: JOp[]
  runs: JRun[]
  /** keys of the ops written for the first time — new Vorgänge (the strip and the minute bars count only these) */
  fresh?: string[]
  /** places (and their scopes) whose segments this flush wrote (a segment closing on its idle timer writes no op) */
  places?: PlaceKey[]
  scopes?: Scope[]
}

/** The journal's revision in this tab: up with every flush (closing segments too), every ping of another tab, every
 * eject record, wipe or prune — never reset (a reading memoised on it is never served stale). */
let rev = 0
export const journalRev = (): number => rev

export type JournalChange = { kind: 'flushed'; scopes: Scope[] } | { kind: 'reset'; scope: Scope | null } | { kind: 'eject'; scope: Scope }

const flushListeners = new Set<(f: Flushed) => void>()
const changeListeners = new Set<(c: JournalChange, local: boolean) => void>()
let channel: BroadcastChannel | null = null
let hooked = false

function chan(): BroadcastChannel | null {
  if (hooked) return channel
  hooked = true
  try {
    if (typeof BroadcastChannel === 'undefined') return null
    channel = new BroadcastChannel('one-recorder')
    channel.onmessage = (e) => {
      const c = e.data as JournalChange | null
      // other kinds on this channel (settled marks, eject refs — features/recorder/settled.ts) are not the journal's
      if (!c || (c.kind !== 'flushed' && c.kind !== 'reset' && c.kind !== 'eject')) return
      rev++
      for (const l of changeListeners) l(c, false)
    }
  } catch {
    channel = null
  }
  return channel
}

/** This tab's flushes, as they land. */
export function onFlushed(fn: (f: Flushed) => void): () => void {
  flushListeners.add(fn)
  return () => flushListeners.delete(fn)
}

/** Any tab's journal changed (`local`: this tab). */
export function onJournalChange(fn: (c: JournalChange, local: boolean) => void): () => void {
  chan()
  changeListeners.add(fn)
  return () => changeListeners.delete(fn)
}

function tell(c: JournalChange): void {
  rev++
  for (const l of changeListeners) l(c, true)
  try {
    chan()?.postMessage(c)
  } catch {
    /* closed */
  }
}

/** The processor wrote these (called after the transaction completed). */
export function emitFlushed(f: Flushed): void {
  if (!f.ops.length && !f.runs.length && !f.places?.length) return
  rev++
  for (const l of flushListeners) {
    try {
      l(f)
    } catch (e) {
      console.warn('[recorder] a flush listener failed', e)
    }
  }
  const scopes = [...new Set([...f.ops.map((o) => o.s), ...f.runs.map((r) => r.s), ...(f.scopes ?? [])])]
  if (scopes.length) tell({ kind: 'flushed', scopes })
}

/** An eject record of a scope was written or changed (the deck re-reads the span's eject records). */
export function emitEject(scope: Scope): void {
  tell({ kind: 'eject', scope })
}

/** A scope's records went (a wipe; null = a prune of any scope). */
export function emitReset(scope: Scope | null): void {
  tell({ kind: 'reset', scope })
}
