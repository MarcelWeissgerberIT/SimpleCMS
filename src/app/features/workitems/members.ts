/**
 * The active team workspace's member account ids — for task reminders (who a task rings for) and the people
 * picker (members first) — and their emails (folded → account id) for Claude's task owners (settle.ts: a member's
 * email resolves to that member; emails are never listed to Claude). Asked from the server (`listMembers`), kept
 * 60 s in memory, asked again when this member's role changes. null locally and until the first answer;
 * `warmMembers()` waits a moment for it (a terminal task / agent run / MCP call start, before tools that never wait).
 */
import { useSyncExternalStore } from 'react'
import { activeWorkspace, listMembers, useCloud } from '../../cloud'

const TTL = 60_000

let cache: { ws: string; at: number; ids: Set<string>; emails: Map<string, string> } | null = null
/** a refused / failed request with nothing kept yet: not asked again before `until` */
let backoff: { ws: string; until: number } | null = null
const RETRY = 10_000
let asking: { ws: string; done: Promise<void> } | null = null
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

/** A member email as compared: trimmed, lower case. */
const foldEmail = (email: string) => email.trim().toLowerCase()

/** Ask the server (the request already running for this workspace, if there is one). */
function refresh(): Promise<void> {
  const ws = activeWorkspace()
  if (ws.kind !== 'cloud') return Promise.resolve()
  if (asking?.ws === ws.id) return asking.done
  const ask = async (): Promise<void> => {
    try {
      const members = await listMembers(ws.id)
      if (activeWorkspace().id !== ws.id) return
      const emails = new Map<string, string>()
      for (const m of members) if (typeof m.user.email === 'string' && m.user.email.trim()) emails.set(foldEmail(m.user.email), m.user.id)
      cache = { ws: ws.id, at: Date.now(), ids: new Set(members.map((m) => m.user.id)), emails }
      backoff = null
      for (const l of listeners) l()
    } catch {
      // offline / refused: keep what we had (or nothing) and ask again in a while — not on every read
      if (cache?.ws === ws.id) cache = { ...cache, at: Date.now() - TTL + RETRY }
      backoff = { ws: ws.id, until: Date.now() + RETRY }
    } finally {
      if (asking === mine) asking = null
    }
  }
  const mine = { ws: ws.id, done: Promise.resolve() }
  asking = mine
  mine.done = ask()
  return mine.done
}

/** Tests only (e2e seam `__oneItems.forgetMembers`): nothing known — the next memberIds() asks the server. */
export function forgetMembers(): void {
  cache = null
  backoff = null
}

/** The kept answer for the active team workspace (asking again when it is stale) — null locally / not known yet. */
function current(): NonNullable<typeof cache> | null {
  const ws = activeWorkspace()
  if (ws.kind !== 'cloud') return null
  watchRole()
  const fresh = cache && cache.ws === ws.id && Date.now() - cache.at < TTL
  const waiting = backoff?.ws === ws.id && Date.now() < backoff.until
  if (!fresh && !waiting) void refresh()
  return cache?.ws === ws.id ? cache : null
}

/** The member account ids of the active team workspace (null locally / not known yet). Never waits. */
export function memberIds(): Set<string> | null {
  return current()?.ids ?? null
}

/**
 * The members' emails of the active team workspace, folded (trimmed, lower case) → account id — null locally / not
 * known yet. Never waits; the same answer and freshness as memberIds(). Never listed to Claude.
 */
export function memberEmails(): ReadonlyMap<string, string> | null {
  return current()?.emails ?? null
}

/**
 * Team: wait (at most `ms`) for the member list when it is not fresh — for staging tools that never wait (a
 * terminal task, an agent run, an MCP call start). Resolves on the answer or the timeout; never throws.
 */
export async function warmMembers(ms = 1500): Promise<void> {
  const ws = activeWorkspace()
  if (ws.kind !== 'cloud') return
  watchRole()
  if (cache?.ws === ws.id && Date.now() - cache.at < TTL) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([refresh(), new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)))])
  } catch {
    /* refresh() never rejects; nothing to report either way */
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
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
