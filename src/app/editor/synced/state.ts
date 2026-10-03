/**
 * Synced blocks — the live index the views and editor rules read (written by ./service.ts).
 * Kept free of heavy imports: the schema (../schema/synced.ts) depends on it.
 *
 *   syncId → { source: page of the live original | null, uses: live pages holding it }
 *
 * `source: null` means the original is gone (block deleted, page trashed): references keep
 * their content, read-only, until "Unsync" — or until the original comes back.
 */
import { useSyncExternalStore } from 'react'
import type { JSONContent } from '@tiptap/core'
import type { ID } from '../../store/types'

export interface SyncedUse {
  pageId: ID
  /** Block id of the first synced block of the group on that page (for ?b= jumps). */
  blockId: string | null
  original: boolean
}

export interface SyncedEntry {
  syncId: string
  /** Page holding the live original; null = deleted / trashed (references keep their content). */
  source: ID | null
  sourceBlockId: string | null
  /** Live pages using the block, the source first. */
  uses: SyncedUse[]
}

let entries = new Map<string, SyncedEntry>()
/** The latest content of each group (the truth the copies follow). */
const canon = new Map<string, JSONContent[]>()
const listeners = new Set<() => void>()
let running = false
/** Originals just created in an editor (not saved yet): treated as live for a moment. */
const pending = new Map<string, { pageId: ID; until: number }>()
let orphans = new Set<string>()

const notify = () => listeners.forEach((l) => l())

export function subscribeSynced(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function syncedEntry(syncId: string | null | undefined): SyncedEntry | undefined {
  return syncId ? entries.get(syncId) : undefined
}

/** React: the index entry of a sync group (re-renders when it changes). */
export function useSyncedEntry(syncId: string | null | undefined): SyncedEntry | undefined {
  return useSyncExternalStore(subscribeSynced, () => syncedEntry(syncId))
}

/** The service is running (the index means something). */
export function syncedRunning(): boolean {
  return running
}

/** The page of the live original (or of one created a moment ago in an editor). */
export function liveSourceOf(syncId: string): ID | null {
  const e = entries.get(syncId)
  if (e?.source) return e.source
  const p = pending.get(syncId)
  return p && p.until > Date.now() ? p.pageId : null
}

/** A reference of this group can't follow anything: its original is gone. */
export function isOrphanGroup(syncId: string): boolean {
  return orphans.has(syncId) && !liveSourceOf(syncId)
}

/** Any orphaned group at all (cheap check before scanning a doc). */
export function hasOrphans(): boolean {
  return orphans.size > 0
}

export function canonContent(syncId: string): JSONContent[] | undefined {
  return canon.get(syncId)
}

/** An editor just made a new original (Copy and sync): count it as live until its page is saved. */
export function expectOriginal(syncId: string, pageId: ID, ms = 4000): void {
  pending.set(syncId, { pageId, until: Date.now() + ms })
  notify()
}

/* ------------------------------------------------------------------ service side */

export function setRunning(on: boolean): void {
  running = on
  if (!on) {
    entries = new Map()
    canon.clear()
    pending.clear()
    orphans = new Set()
  }
  notify()
}

export function setCanon(syncId: string, content: JSONContent[] | null): void {
  if (content) canon.set(syncId, content)
  else canon.delete(syncId)
}

const sameUses = (a: SyncedUse[], b: SyncedUse[]) =>
  a.length === b.length && a.every((u, i) => u.pageId === b[i].pageId && u.blockId === b[i].blockId && u.original === b[i].original)

/** Replace the entries of these groups (undefined = gone). Unchanged entries keep their identity. */
export function putEntries(next: Map<string, SyncedEntry | undefined>): void {
  let changed = false
  const copy = new Map(entries)
  for (const [id, e] of next) {
    const prev = copy.get(id)
    if (!e) {
      if (prev) {
        copy.delete(id)
        changed = true
      }
      continue
    }
    if (e.source) pending.delete(id)
    if (prev && prev.source === e.source && prev.sourceBlockId === e.sourceBlockId && sameUses(prev.uses, e.uses)) continue
    copy.set(id, e)
    changed = true
  }
  if (!changed) return
  entries = copy
  orphans = new Set([...entries.values()].filter((e) => !e.source).map((e) => e.syncId))
  notify()
}

export function allEntries(): SyncedEntry[] {
  return [...entries.values()]
}
