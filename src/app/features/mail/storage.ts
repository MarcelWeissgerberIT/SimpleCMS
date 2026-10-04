/**
 * This device's mail sync data, per workspace (IndexedDB `one-mail` / `kv`) — never synced, exported or shared:
 *   state:<ws>          → MailSyncState (account, history id, what was synced into which row, backlog, last run)
 *   html:<ws>:<msg id>  → BodyCache: the mail's HTML + attachment list, kept only for mails with remote
 *                          images ("Load images" renders the body again without asking Gmail)
 * No access token is ever stored here (or anywhere): tokens live in the tab's memory (auth.ts).
 */
import { createStore, del, delMany, get, keys, set, type UseStore } from 'idb-keyval'
import { activeWorkspace } from '../../cloud'
import type { ID } from '../../store/types'
import type { MailAttachment } from './parse'

let store: UseStore | undefined
function db(): UseStore | undefined {
  if (!store && typeof indexedDB !== 'undefined') store = createStore('one-mail', 'kv')
  return store
}

/** "local:local" / "cloud:<id>" */
export function wsKey(): string {
  const ws = activeWorkspace()
  return `${ws.kind}:${ws.id}`
}

/** A mail that was synced: its row, the Gmail labels last written, unread, organised, the body's fingerprint. */
export interface KnownMail {
  /** row page id */
  r: ID
  /** Gmail label ids as last written to the row */
  l: string[]
  /** unread as last written */
  u: boolean
  /** organised by Claude (never again automatically) */
  o?: 1
  /** fingerprint of the body text One wrote (an edited body is never replaced without asking) */
  h?: string
}

export interface MailSyncState {
  /** the Gmail address the state belongs to */
  account: string | null
  /** the database the rows went to */
  databaseId: ID | null
  /** Gmail history id after the last run (incremental sync); null = list from the date */
  historyId: string | null
  /** what the last full listing covered (settings.ts scopeOf) */
  scope: string | null
  lastAt: number | null
  lastAdded: number
  /** friendly message of the last failed run (no mail content) */
  lastError: string | null
  /** message ids listed but not fetched yet (over the per-run limit), newest first */
  backlog: string[]
  /** Gmail message id → what was synced */
  known: Record<string, KnownMail>
}

export function emptyState(): MailSyncState {
  return { account: null, databaseId: null, historyId: null, scope: null, lastAt: null, lastAdded: 0, lastError: null, backlog: [], known: {} }
}

const k = (name: string) => `${name}:${wsKey()}`

export async function loadState(): Promise<MailSyncState> {
  const raw = await get<Partial<MailSyncState>>(k('state'), db())
  const s = { ...emptyState(), ...(raw ?? {}) }
  if (!Array.isArray(s.backlog)) s.backlog = []
  if (!s.known || typeof s.known !== 'object') s.known = {}
  return s
}

export async function saveState(s: MailSyncState): Promise<void> {
  await set(k('state'), s, db())
}

/** What "Load images" needs to render a mail's body again. */
export interface BodyCache {
  html: string
  attachments: MailAttachment[]
}

const htmlKey = (msgId: string) => `html:${wsKey()}:${msgId}`

export async function saveBody(msgId: string, body: BodyCache): Promise<void> {
  await set(htmlKey(msgId), body, db())
}

export async function loadBody(msgId: string): Promise<BodyCache | undefined> {
  const v = await get<BodyCache>(htmlKey(msgId), db())
  return v && typeof v.html === 'string' ? { html: v.html, attachments: Array.isArray(v.attachments) ? v.attachments : [] } : undefined
}

/** Forget everything synced in this workspace (state + kept HTML); the database and its rows stay. */
export async function clearAll(): Promise<void> {
  const prefix = `html:${wsKey()}:`
  const all = (await keys(db())) as string[]
  await delMany(
    all.filter((x) => typeof x === 'string' && x.startsWith(prefix)),
    db(),
  )
  await del(k('state'), db())
}
