/**
 * Inbox data of this device, per workspace (IndexedDB "one-inbox" / "kv"; nothing of it syncs):
 *   data:<kind>:<id>   items (+ read / archived marks), reminders seen / fired here, settings
 *   snap:<kind>:<id>   team workspaces: what concerned me per page at the last scan (engine.ts)
 *
 * Every write is an atomic read-modify-write (idb-keyval update), so the scheduler's tab and a tab
 * where someone marks an item read never overwrite each other; the writer tells the other tabs,
 * which reload. Without IndexedDB (private modes) everything still works in memory.
 */
import { create } from 'zustand'
import { createStore, get, set, update, type UseStore } from 'idb-keyval'
import type { ID } from '../../store/types'
import type { WorkspaceRef } from '../../cloud'
import type { TeamFacts } from './scan'

export type InboxKind = 'reminder' | 'mention' | 'comment' | 'assigned'
export const INBOX_KINDS: InboxKind[] = ['reminder', 'mention', 'comment', 'assigned']

export interface InboxItem {
  /** r:<reminder key> · m:<page>:<block>:<n> · c:<reply id> · a:<row>:<property> */
  id: string
  kind: InboxKind
  pageId: ID
  /** when it happened: a reminder's due time, a reply's time, when a mention / assignment arrived */
  at: number
  /** the block to scroll to */
  blockId?: string | null
  /** context: the line of a mention, a reply's text, a property's name */
  excerpt?: string
  /** who: a reply's author */
  actor?: string
  /** reminder: its date (stored string) and code */
  iso?: string
  code?: string
  /** date property reminder / assignment: the property */
  propId?: ID | null
  /** comment reply: its thread */
  threadId?: ID
  read?: boolean
  archived?: boolean
}

export interface InboxData {
  v: 1
  /** this device's first scan of the workspace (team changes before it are the baseline, not news) */
  baselineAt: number
  items: InboxItem[]
  /** reminder key → when this device first saw it (and when it fired here) */
  rem: Record<string, { seen: number; fired?: number }>
  /** browser notifications (this device, this workspace) */
  notify: boolean
}

export type Snapshot = Record<ID, TeamFacts>

export interface InboxState {
  /** "<kind>:<id>" of the workspace the data belongs to */
  ws: string | null
  loaded: boolean
  data: InboxData
}

const MAX_ITEMS = 400

export const emptyData = (now = Date.now()): InboxData => ({ v: 1, baselineAt: now, items: [], rem: {}, notify: false })

export const useInbox = create<InboxState>()(() => ({ ws: null, loaded: false, data: emptyData() }))

let db: UseStore | null = null
const kv = () => (db ??= createStore('one-inbox', 'kv'))

export const wsKey = (ref: WorkspaceRef) => `${ref.kind}:${ref.id}`

function normalize(v: unknown): InboxData {
  const d = v as Partial<InboxData> | undefined
  if (!d || typeof d !== 'object' || d.v !== 1) return emptyData()
  return {
    v: 1,
    baselineAt: typeof d.baselineAt === 'number' ? d.baselineAt : Date.now(),
    items: Array.isArray(d.items) ? d.items.filter((i) => i && typeof i.id === 'string' && typeof i.pageId === 'string') : [],
    rem: d.rem && typeof d.rem === 'object' ? d.rem : {},
    notify: !!d.notify,
  }
}

/** Newest first; at most MAX_ITEMS (archived, then read ones go first). */
function trim(d: InboxData): void {
  d.items.sort((a, b) => b.at - a.at)
  if (d.items.length <= MAX_ITEMS) return
  const drop = new Set<string>()
  for (const pass of [(i: InboxItem) => !!i.archived, (i: InboxItem) => !!i.read, () => true])
    for (let k = d.items.length - 1; k >= 0 && d.items.length - drop.size > MAX_ITEMS; k--) if (pass(d.items[k])) drop.add(d.items[k].id)
  d.items = d.items.filter((i) => !drop.has(i.id))
}

/* ------------------------------------------------------------------ tabs */

const TAB = Math.random().toString(36).slice(2)
let channel: BroadcastChannel | null | undefined

export type InboxMessage =
  | { type: 'changed'; ws: string }
  | { type: 'fired'; ws: string; items: InboxItem[]; now: number }
  | { type: 'local'; ws: string; ids: ID[]; at: number }

function chan(): BroadcastChannel | null {
  if (channel === undefined) channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('one-inbox') : null
  return channel
}

export function postInbox(msg: InboxMessage): void {
  try {
    chan()?.postMessage({ ...msg, from: TAB })
  } catch {
    /* closed channel */
  }
}

/** Messages from other tabs of this browser. Returns an unsubscribe function. */
export function onInboxMessage(fn: (msg: InboxMessage) => void): () => void {
  const c = chan()
  if (!c) return () => {}
  const h = (e: MessageEvent) => {
    const d = e.data as (InboxMessage & { from?: string }) | null
    if (d && d.from !== TAB && typeof d.type === 'string') fn(d)
  }
  c.addEventListener('message', h)
  return () => c.removeEventListener('message', h)
}

/* ------------------------------------------------------------------ load / write */

/** Load this device's inbox of a workspace into useInbox. */
export async function loadInbox(ws: string): Promise<void> {
  let data: InboxData
  try {
    data = normalize(await get(`data:${ws}`, kv()))
  } catch (e) {
    console.warn('[one] inbox: no IndexedDB, keeping it in memory', e)
    data = useInbox.getState().ws === ws ? useInbox.getState().data : emptyData()
  }
  useInbox.setState({ ws, loaded: true, data })
}

/**
 * Change the inbox: `fn` edits a draft (applied to the latest stored copy, atomically) and returns
 * whatever the caller needs from it (e.g. what was really fired). Other tabs reload afterwards.
 */
export async function mutateInbox<R>(fn: (d: InboxData) => R): Promise<R | undefined> {
  const ws = useInbox.getState().ws
  if (!ws) return undefined
  // this tab shows the change right away …
  const local = structuredClone(useInbox.getState().data)
  let result = fn(local)
  trim(local)
  useInbox.setState({ data: local })
  // … and the stored copy (maybe changed by another tab meanwhile) gets the same edit
  try {
    let next: InboxData | null = null
    await update(
      `data:${ws}`,
      (cur) => {
        const d = cur === undefined ? local : normalize(cur)
        if (cur !== undefined) result = fn(d)
        trim(d)
        next = d
        return d
      },
      kv(),
    )
    if (next && useInbox.getState().ws === ws) useInbox.setState({ data: next })
    postInbox({ type: 'changed', ws })
  } catch (e) {
    console.warn('[one] inbox: could not save', e)
  }
  return result
}

export async function loadSnapshot(ws: string): Promise<Snapshot | null> {
  try {
    const v = await get(`snap:${ws}`, kv())
    return v && typeof v === 'object' ? (v as Snapshot) : null
  } catch {
    return null
  }
}

export async function saveSnapshot(ws: string, snap: Snapshot): Promise<void> {
  try {
    await set(`snap:${ws}`, snap, kv())
  } catch (e) {
    console.warn('[one] inbox: could not save the snapshot', e)
  }
}

/* ------------------------------------------------------------------ read state (UI) */

const edit = (ids: string[], patch: Partial<Pick<InboxItem, 'read' | 'archived'>>) => {
  const set = new Set(ids)
  return mutateInbox((d) => {
    for (const i of d.items) if (set.has(i.id)) Object.assign(i, patch)
  })
}

export const markRead = (ids: string[], read = true) => edit(ids, { read })
export const archiveItems = (ids: string[], archived = true) => edit(ids, archived ? { archived, read: true } : { archived })
export const setNotify = (on: boolean) =>
  mutateInbox((d) => {
    d.notify = on
  })
