/**
 * What an eject settled, for the in-memory undo closures that outlive a review (Δ10, Δ30): an agent apply's undo
 * (ai/agent/apply.ts), the terminal's batch Undo, a script run's toast — each asks `isSettled(runKey, changeId?)`
 * and leaves a settled change alone, so an Undo pressed after an eject never writes the old values over the ejected
 * state. And which writes are the eject's own (`isEjectWriter`): the eject, a bring-back, and the Undo of an eject this
 * tab knows — automations, agent triggers, autofill, the coding trust watch and the attribution keeper skip them.
 * Marks and eject ids reach the other tabs on the channel `one-recorder` (the journal's bus ignores these kinds). In
 * memory only: the closures it guards live in memory too. Dependency-free (imported directly, never through the
 * recorder's index — ai/agent/apply.ts would cycle).
 */
import type { Writer } from '../../store/writer'

type Msg = { kind: 'settled'; runKey: string; ids: string[]; on: boolean } | { kind: 'ejectRef'; id: string }

export interface SettledNote {
  runKey: string
  /** the change ids (empty: the whole run) */
  ids: string[]
  /** marked (true) or taken back (false) */
  on: boolean
  /** this tab's own mark */
  local: boolean
}

/** run key → settled change ids ('*': the whole run) */
const settled = new Map<string, Set<string> | '*'>()
const ejects = new Set<string>()
const listeners = new Set<(n: SettledNote) => void>()
let channel: BroadcastChannel | null = null
let hooked = false

function chan(): BroadcastChannel | null {
  if (hooked) return channel
  hooked = true
  try {
    if (typeof BroadcastChannel === 'undefined') return null
    channel = new BroadcastChannel('one-recorder')
    channel.onmessage = (e) => {
      const m = e.data as Msg | null
      // the journal's own kinds (flushed, reset, eject) are the bus's
      if (m?.kind === 'settled' && typeof m.runKey === 'string' && Array.isArray(m.ids)) apply(m.runKey, m.ids.filter((x) => typeof x === 'string'), !!m.on, false)
      else if (m?.kind === 'ejectRef' && typeof m.id === 'string') ejects.add(m.id)
    }
  } catch {
    channel = null
  }
  return channel
}

function post(m: Msg): void {
  try {
    chan()?.postMessage(m)
  } catch {
    /* closed */
  }
}

function apply(runKey: string, ids: string[], on: boolean, local: boolean): void {
  const cur = settled.get(runKey)
  if (on) {
    if (!ids.length) settled.set(runKey, '*')
    else if (cur !== '*') settled.set(runKey, new Set([...(cur ?? []), ...ids]))
  } else if (!ids.length || cur === '*') settled.delete(runKey)
  else if (cur) {
    for (const id of ids) cur.delete(id)
    if (!cur.size) settled.delete(runKey)
  }
  for (const l of listeners) {
    try {
      l({ runKey, ids, on, local })
    } catch (e) {
      console.warn('[recorder] a settled listener failed', e)
    }
  }
}

/** An eject settled these changes of a run (none: the whole run) — in this tab and the others. */
export function markSettled(runKey: string, changeIds: readonly string[] = []): void {
  chan()
  apply(runKey, [...changeIds], true, true)
  post({ kind: 'settled', runKey, ids: [...changeIds], on: true })
}

/** The eject's Undo gave them back. */
export function unmarkSettled(runKey: string, changeIds: readonly string[] = []): void {
  chan()
  apply(runKey, [...changeIds], false, true)
  post({ kind: 'settled', runKey, ids: [...changeIds], on: false })
}

/** Did an eject settle this change of the run (no id: the whole run)? */
export function isSettled(runKey: string, changeId?: string): boolean {
  chan()
  const cur = settled.get(runKey)
  if (!cur) return false
  if (cur === '*') return true
  return changeId !== undefined && cur.has(changeId)
}

/** Marks as they come (this tab's and the other tabs'). */
export function onSettled(fn: (n: SettledNote) => void): () => void {
  chan()
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** An eject this tab (or another) made: its Undo's writes are the eject's too. */
export function noteEject(id: string): void {
  chan()
  if (ejects.has(id)) return
  ejects.add(id)
  post({ kind: 'ejectRef', id })
}

/** The eject's own writes: an eject, a bring-back, the Undo of an eject this tab knows. */
export function isEjectWriter(w: Writer | null | undefined): boolean {
  if (!w) return false
  if (w.kind === 'eject' || w.kind === 'rewind') return true
  if (w.kind !== 'you' || w.via !== 'undo' || !w.ref) return false
  chan()
  return ejects.has(w.ref)
}
