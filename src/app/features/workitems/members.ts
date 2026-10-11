/**
 * The active team workspace's member account ids — for task reminders (who a task rings for) and the people
 * picker (members first). Asked from the server (`listMembers`), kept 60 s in memory, asked again when this
 * member's role changes. null locally and until the first answer.
 */
import { useSyncExternalStore } from 'react'
import { activeWorkspace, listMembers, useCloud } from '../../cloud'

const TTL = 60_000

let cache: { ws: string; at: number; ids: Set<string> } | null = null
/** a refused / failed request with nothing kept yet: not asked again before `until` */
let backoff: { ws: string; until: number } | null = null
const RETRY = 10_000
let asking: string | null = null
const listeners = new Set<() => void>()
let watching = false

function watchRole(): void {
  if (watching) return
  watching = true
  useCloud.subscribe((s, prev) => {
    if (s.role !== prev.role || s.active.id !== prev.active.id) {
      if (cache) cache = { ...cache, at: 0 }
      backoff = null
      void refresh()
    }
  })
}

async function refresh(): Promise<void> {
  const ws = activeWorkspace()
  if (ws.kind !== 'cloud' || asking === ws.id) return
  asking = ws.id
  try {
    const members = await listMembers(ws.id)
    if (activeWorkspace().id !== ws.id) return
    cache = { ws: ws.id, at: Date.now(), ids: new Set(members.map((m) => m.user.id)) }
    backoff = null
    for (const l of listeners) l()
  } catch {
    // offline / refused: keep what we had (or nothing) and ask again in a while — not on every read
    if (cache?.ws === ws.id) cache = { ...cache, at: Date.now() - TTL + RETRY }
    backoff = { ws: ws.id, until: Date.now() + RETRY }
  } finally {
    asking = null
  }
}

/** Tests only (e2e seam `__oneItems.forgetMembers`): nothing known — the next memberIds() asks the server. */
export function forgetMembers(): void {
  cache = null
  backoff = null
}

/** The member account ids of the active team workspace (null locally / not known yet). Never waits. */
export function memberIds(): Set<string> | null {
  const ws = activeWorkspace()
  if (ws.kind !== 'cloud') return null
  watchRole()
  const fresh = cache && cache.ws === ws.id && Date.now() - cache.at < TTL
  const waiting = backoff?.ws === ws.id && Date.now() < backoff.until
  if (!fresh && !waiting) void refresh()
  return cache?.ws === ws.id ? cache.ids : null
}

const snapshot = () => {
  const ws = activeWorkspace()
  return ws.kind === 'cloud' && cache?.ws === ws.id ? cache.ids : null
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  memberIds()
  return () => listeners.delete(fn)
}

/** memberIds() as a hook (re-renders when the list arrives). */
export function useMemberIds(): Set<string> | null {
  return useSyncExternalStore(subscribe, snapshot, () => null)
}
