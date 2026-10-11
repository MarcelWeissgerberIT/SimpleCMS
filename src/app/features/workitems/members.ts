/**
 * The active team workspace's member account ids — for task reminders (who a task rings for) and the people
 * picker (members first). Asked from the server (`listMembers`), kept 60 s in memory, asked again when this
 * member's role changes. null locally and until the first answer.
 */
import { useSyncExternalStore } from 'react'
import { activeWorkspace, listMembers, useCloud } from '../../cloud'

const TTL = 60_000

let cache: { ws: string; at: number; ids: Set<string> } | null = null
let asking: string | null = null
const listeners = new Set<() => void>()
let watching = false

function watchRole(): void {
  if (watching) return
  watching = true
  useCloud.subscribe((s, prev) => {
    if (s.role !== prev.role || s.active.id !== prev.active.id) {
      if (cache) cache = { ...cache, at: 0 }
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
    for (const l of listeners) l()
  } catch {
    // offline / refused: keep what we had (or nothing) and ask again on the next read
    if (cache?.ws === ws.id) cache = { ...cache, at: Date.now() - TTL + 10_000 }
  } finally {
    asking = null
  }
}

/** The member account ids of the active team workspace (null locally / not known yet). Never waits. */
export function memberIds(): Set<string> | null {
  const ws = activeWorkspace()
  if (ws.kind !== 'cloud') return null
  watchRole()
  const fresh = cache && cache.ws === ws.id && Date.now() - cache.at < TTL
  if (!fresh) void refresh()
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
