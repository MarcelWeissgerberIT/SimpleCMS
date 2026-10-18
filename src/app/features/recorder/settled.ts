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

type Msg = { kind: 'settled'; runKey: string; ids: string[]; on: boolean; ref?: string } | { kind: 'ejectRef'; id: string }

export interface SettledNote {
  runKey: string
  /** the change ids (empty: the whole run) */
  ids: string[]
  /** marked (true) or taken back (false) */
  on: boolean
  /** this tab's own mark */
  local: boolean
  /** the eject that settled them (its id), when the mark names it */
  ref?: string
}

/** run key → settled change ids ('*': the whole run) */
const settled = new Map<string, Set<string> | '*'>()
const ejects = new Set<string>()
const listeners = new Set<(n: SettledNote) => void>()
let channel: BroadcastChannel | null = null
let hooked = false
/** when this tab last heard of an eject (its own or another tab's: a mark, a bring-back, an eject or its Undo begun) */
let lastNote = 0

function chan(): BroadcastChannel | null {
  if (hooked) return channel
  hooked = true
  try {
    if (typeof BroadcastChannel === 'undefined') return null
    channel = new BroadcastChannel('one-recorder')
    channel.onmessage = (e) => {
      const m = e.data as Msg | null
      // the journal's own kinds (flushed, reset, eject) are the bus's
      if (m?.kind === 'settled' && typeof m.runKey === 'string' && Array.isArray(m.ids)) apply(m.runKey, m.ids.filter((x) => typeof x === 'string'), !!m.on, false, typeof m.ref === 'string' ? m.ref : undefined)
      else if (m?.kind === 'ejectRef' && typeof m.id === 'string') {
        ejects.add(m.id)
        lastNote = Date.now()
      }
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

function apply(runKey: string, ids: string[], on: boolean, local: boolean, ref?: string): void {
  lastNote = Date.now()
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
      l({ runKey, ids, on, local, ...(ref ? { ref } : {}) })
    } catch (e) {
      console.warn('[recorder] a settled listener failed', e)
    }
  }
}

/** An eject (`ref`: its id) settled these changes of a run (none: the whole run) — in this tab and the others. */
export function markSettled(runKey: string, changeIds: readonly string[] = [], ref?: string): void {
  chan()
  apply(runKey, [...changeIds], true, true, ref)
  post({ kind: 'settled', runKey, ids: [...changeIds], on: true, ...(ref ? { ref } : {}) })
}

/** The eject's Undo gave them back. */
export function unmarkSettled(runKey: string, changeIds: readonly string[] = [], ref?: string): void {
  chan()
  apply(runKey, [...changeIds], false, true, ref)
  post({ kind: 'settled', runKey, ids: [...changeIds], on: false, ...(ref ? { ref } : {}) })
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
  lastNote = Date.now()
  ejects.add(id)
  // said again for its Undo too: the other tabs hear of it before its write reaches them
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

/**
 * Did this tab hear of an eject (its own or another tab's) within the last `ms`? A replay of another tab's write that
 * arrives meanwhile may be the eject's own write or its Undo's — derived work that reacts to replays (the work orders'
 * chain passes) leaves it alone; the tab that wrote it runs its own.
 */
export function ejectHeardWithin(ms: number): boolean {
  chan()
  return Date.now() - lastNote < ms
}
