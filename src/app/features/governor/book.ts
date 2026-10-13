/**
 * Reservations across tabs (Regler G-D5): gossip, no leader. Every tab announces its open reservations on its OWN
 * BroadcastChannel `one-ledger-res` — never on `one-ledger`, whose slice-1 listener reads again on any message —
 * debounced 50 ms after a change and every 30 s while it holds any; `bye` on pagehide; a tab that starts says `hello` and
 * every started tab answers with its list at once (a long step's reservation reaches a reloaded tab in ms, not 30 s). Each tab keeps the others' lists
 * and drops a tab's 2 minutes after its last message (or on its bye). The brake compares spent + reserved here +
 * reserved elsewhere; the caller's own reservation (`except`) is never counted. A soft pre-brake: two tabs can still race
 * one request (said in the UI); the hard limit is the provider's.
 *
 * The state functions are pure (Node specs); the channel opens only with startBook() — nothing at module load. The
 * ledger hands in this tab's open reservations (setBookSource) and calls bookChanged() on every reserve / adjust / settle.
 */
import { newId } from '../../lib/ids'

export const BOOK_CHANNEL = 'one-ledger-res'
export const BOOK_HEARTBEAT_MS = 30_000
export const BOOK_STALE_MS = 120_000
const DEBOUNCE_MS = 50
const MAX_ITEMS = 200

/** One open reservation as announced: its id, what it may cost, the ledger scope it counts for. */
export interface ResItem {
  id: string
  usd: number
  scope: string
}

export type BookMsg = { type: 'res'; tab: string; scope: string; list: ResItem[]; at: number } | { type: 'bye'; tab: string } | { type: 'hello'; tab: string }

/** The other tabs' lists, by tab id. */
export interface BookState {
  others: Map<string, { list: ResItem[]; at: number }>
}

export const emptyBook = (): BookState => ({ others: new Map() })

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const SCOPE_RE = /^[a-z]+:[A-Za-z0-9_:.-]{1,160}$/
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** A message as received (null: not one of the book's). */
export function readBookMsg(v: unknown): BookMsg | null {
  if (!isObj(v) || typeof v.tab !== 'string' || !ID_RE.test(v.tab)) return null
  if (v.type === 'bye') return { type: 'bye', tab: v.tab }
  if (v.type === 'hello') return { type: 'hello', tab: v.tab }
  if (v.type !== 'res' || !Array.isArray(v.list) || typeof v.at !== 'number') return null
  const list: ResItem[] = []
  for (const x of v.list.slice(0, MAX_ITEMS)) {
    if (!isObj(x) || typeof x.id !== 'string' || !ID_RE.test(x.id) || typeof x.usd !== 'number' || !Number.isFinite(x.usd) || x.usd < 0) continue
    const scope = typeof x.scope === 'string' && SCOPE_RE.test(x.scope) ? x.scope : typeof v.scope === 'string' && SCOPE_RE.test(v.scope) ? v.scope : null
    if (scope) list.push({ id: x.id, usd: x.usd, scope })
  }
  return { type: 'res', tab: v.tab, scope: typeof v.scope === 'string' ? v.scope : '', list, at: v.at }
}

/** Another tab spoke (its list replaces the one kept; an empty list or a bye forgets it; a hello asks for every list). */
export function hearBook(state: BookState, msg: BookMsg, now: number): void {
  if (msg.type === 'hello') return
  if (msg.type === 'bye' || !msg.list.length) state.others.delete(msg.tab)
  // the receiver's clock decides staleness (the sender's may differ)
  else state.others.set(msg.tab, { list: msg.list, at: now })
}

/** Lists not renewed for 2 minutes go (a tab that crashed or slept). */
export function expireBook(state: BookState, now: number): void {
  for (const [tab, o] of state.others) if (now - o.at > BOOK_STALE_MS) state.others.delete(tab)
}

const inScope = (r: ResItem, scopes: readonly string[] | null) => !scopes || scopes.includes(r.scope)

/**
 * What the open reservations add up to: this tab's (`own`) and the others' — of these scopes (null: every scope), never
 * the reservation `except` (the caller's own: what this request or run may spend is not spent).
 */
export function reservedIn(own: readonly ResItem[], state: BookState, now: number, scopes: readonly string[] | null, except?: string | null): number {
  expireBook(state, now)
  let sum = 0
  for (const r of own) if (r.id !== except && inScope(r, scopes)) sum += r.usd
  for (const o of state.others.values()) for (const r of o.list) if (r.id !== except && inScope(r, scopes)) sum += r.usd
  return sum
}

/** The others' part only (the seam; the two-tab spec waits for it). */
export function reservedByOthers(state: BookState, now: number, scopes: readonly string[] | null = null): number {
  return reservedIn([], state, now, scopes)
}

/* ------------------------------------------------------------------ */
/* Live: this tab                                                       */
/* ------------------------------------------------------------------ */

export const TAB_ID = newId()
const state = emptyBook()
let source: () => { scope: string; list: ResItem[] } = () => ({ scope: '', list: [] })
let bc: BroadcastChannel | null = null
let started = false
let debounce: ReturnType<typeof setTimeout> | null = null
let heartbeat: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

/** The ledger hands in this tab's open reservations (and the tab's current scope). */
export function setBookSource(fn: () => { scope: string; list: ResItem[] }): void {
  source = fn
}

function post(): void {
  debounce = null
  if (!bc) return
  const { scope, list } = source()
  try {
    bc.postMessage({ type: 'res', tab: TAB_ID, scope, list: list.slice(0, MAX_ITEMS), at: Date.now() } satisfies BookMsg)
  } catch {
    /* closed */
  }
  if (list.length && !heartbeat) heartbeat = setInterval(post, BOOK_HEARTBEAT_MS)
  if (!list.length && heartbeat) {
    clearInterval(heartbeat)
    heartbeat = null
  }
}

/** This tab reserved, adjusted or settled: tell the others (debounced). Nothing before startBook(). */
export function bookChanged(): void {
  if (!started) return
  debounce ??= setTimeout(post, DEBOUNCE_MS)
  for (const fn of listeners) fn()
}

/** Open the channel and listen (idempotent; install.ts at boot). */
export function startBook(): void {
  if (started || typeof window === 'undefined') return
  started = true
  try {
    bc = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(BOOK_CHANNEL)
  } catch {
    bc = null
  }
  if (bc)
    bc.onmessage = (ev: MessageEvent) => {
      const msg = readBookMsg(ev.data)
      if (!msg || msg.tab === TAB_ID) return
      // a tab that just started asks: every started tab answers with its list at once (never only at its heartbeat)
      if (msg.type === 'hello') {
        if (debounce) clearTimeout(debounce)
        post()
        return
      }
      hearBook(state, msg, Date.now())
      for (const fn of listeners) fn()
    }
  window.addEventListener('pagehide', () => {
    try {
      bc?.postMessage({ type: 'bye', tab: TAB_ID } satisfies BookMsg)
    } catch {
      /* closed */
    }
  })
  // ask the others for what they hold now (they answer at once), and say what this tab already holds
  try {
    bc?.postMessage({ type: 'hello', tab: TAB_ID } satisfies BookMsg)
  } catch {
    /* closed */
  }
  post()
}

/** This tab's and the other tabs' open reservations (scopes: null = every scope), never `except`. */
export const reservedNow = (scopes: readonly string[] | null, except?: string | null): number => reservedIn(source().list, state, Date.now(), scopes, except)

export const reservedOthersNow = (scopes: readonly string[] | null = null): number => reservedByOthers(state, Date.now(), scopes)

/** Any change of the book (this tab's or another's). Returns the unsubscribe. */
export function onBookChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** The seam: what this tab knows of the others. */
export const bookOthers = (): Array<{ tab: string; list: ResItem[]; at: number }> => [...state.others].map(([tab, o]) => ({ tab, ...o }))
