/**
 * The Bordbuch and the opened set — per device and member, IndexedDB `one-preflight` / `kv` (never synced, exported,
 * backed up or sent to Claude; cloud/device.ts and the local reset wipe them):
 *  - `<scope>|log|<day>` = { v: 1, day, events ≤ 600 }: ids, kinds, times, outcomes — labels are resolved live at render
 *    ("—" when gone), never stored; days older than 30 are deleted at the start and at a new Preflight day
 *  - `<scope>|opened` = { [itemId]: at } ≤ 2,000: the cards that were the current card (never stale, never superseded);
 *    written 1 s after the last change (one record), an id gone from every reading for 30 days is dropped
 * Every write is one idb-keyval `update` (a read-modify-write in one transaction, so two tabs never lose each other's
 * events); the other tabs hear of it on BroadcastChannel `one-preflight`. Fail closed and quiet: a browser that refuses
 * IndexedDB keeps no Bordbuch ("no logbook in this browser") and the opened set in memory for the tab.
 */
import { createStore, delMany, get, keys, update, type UseStore } from 'idb-keyval'
import { create } from 'zustand'
import type { LampId } from './registry'
import type { LogDay, PreflightLog } from './types'

export const LOG_MAX = 600
export const OPENED_MAX = 2000
export const LOG_DAYS = 30
const DAY_MS = 86_400_000
const OPENED_WRITE_MS = 1000

let kv: UseStore | null = null
let broken = false

function store(): UseStore | null {
  if (broken || typeof indexedDB === 'undefined') return null
  try {
    return (kv ??= createStore('one-preflight', 'kv'))
  } catch {
    broken = true
    return null
  }
}

const fail = (e: unknown) => {
  if (!broken) console.warn('[one] preflight: no logbook in this browser', e)
  broken = true
  useLog.setState({ ok: false })
}

export const logKey = (scope: string, day: string) => `${scope}|log|${day}`
export const openedKey = (scope: string) => `${scope}|opened`

/* ---------------- what the UI reads (this tab) */

export interface LogState {
  scope: string | null
  day: string
  /** today's events (oldest first) */
  events: PreflightLog[]
  /** IndexedDB works here (false: "no logbook in this browser") */
  ok: boolean
  /** median seconds per card over the last 30 days (null: too few) */
  pace: number | null
}

export const useLog = create<LogState>()(() => ({ scope: null, day: '', events: [], ok: true, pace: null }))

/* ---------------- the opened set */

const opened = new Map<string, number>()
let openedLoaded = false
let openedScope: string | null = null
const openedDirty = new Set<string>()
let openedTimer: ReturnType<typeof setTimeout> | null = null
const openedListeners = new Set<() => void>()

/** Was this card opened (it was the current card, here or in another tab)? null = not known yet. */
export function wasOpened(id: string): boolean | null {
  return openedLoaded ? opened.has(id) : null
}

/** The opened set is known (loaded, or this browser keeps it in memory only). */
export const openedReady = (): boolean => openedLoaded

/** Counts the loads of the opened set (a new member scope loads it again). */
let loads = 0
export const openedLoads = (): number => loads

/** The opened ids (the seam). */
export const openedIds = (): string[] => [...opened.keys()]

/** Called when the opened set loaded or changed (here or in another tab). */
export function onOpened(fn: () => void): () => void {
  openedListeners.add(fn)
  return () => {
    openedListeners.delete(fn)
  }
}

function emitOpened(): void {
  for (const fn of openedListeners) {
    try {
      fn()
    } catch (e) {
      console.warn('[one] preflight: an opened-set listener failed', e)
    }
  }
}

/** A card became the current card: opened (never stale, never superseded). Written 1 s after the last one. */
export function markOpened(id: string, now = Date.now()): void {
  if (!openedScope) return
  if (opened.has(id)) return
  opened.set(id, now)
  openedDirty.add(id)
  emitOpened()
  if (openedTimer) clearTimeout(openedTimer)
  openedTimer = setTimeout(() => void flushOpened(), OPENED_WRITE_MS)
}

/** Write the pending opened ids now (one record). */
export async function flushOpened(): Promise<void> {
  if (openedTimer) clearTimeout(openedTimer)
  openedTimer = null
  const scope = openedScope
  const ids = [...openedDirty]
  openedDirty.clear()
  if (!scope || !ids.length) return
  post({ scope, opened: ids })
  const st = store()
  if (!st) return
  const at = Object.fromEntries(ids.map((id) => [id, opened.get(id) ?? Date.now()]))
  try {
    await update<Record<string, number>>(openedKey(scope), (cur) => trimOpened({ ...sanitizeOpened(cur), ...at }), st)
  } catch (e) {
    fail(e)
  }
}

function sanitizeOpened(v: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) if (typeof n === 'number' && k.length <= 300) out[k] = n
  return out
}

/** The newest 2,000. */
export function trimOpened(m: Record<string, number>): Record<string, number> {
  const list = Object.entries(m)
  if (list.length <= OPENED_MAX) return m
  return Object.fromEntries(list.sort((a, b) => b[1] - a[1]).slice(0, OPENED_MAX))
}

/**
 * Drop opened ids gone from every reading for 30 days; an id still in a reading is kept (its time refreshed once a
 * day, so it is measured from when it was last seen). `live`: every id of the lamps' readings now.
 */
export function pruneOpenedMap(m: Record<string, number>, live: ReadonlySet<string>, now: number): Record<string, number> | null {
  let changed = false
  const out: Record<string, number> = {}
  for (const [id, at] of Object.entries(m)) {
    if (live.has(id)) {
      if (at < now - DAY_MS) changed = true
      out[id] = at < now - DAY_MS ? now : at
    } else if (at >= now - LOG_DAYS * DAY_MS) out[id] = at
    else changed = true
  }
  return changed ? out : null
}

export async function pruneOpened(live: ReadonlySet<string>, now = Date.now()): Promise<void> {
  const scope = openedScope
  const st = store()
  if (!scope || !st || !openedLoaded) return
  try {
    let next: Record<string, number> | null = null
    await update<Record<string, number>>(
      openedKey(scope),
      (cur) => {
        const m = sanitizeOpened(cur)
        next = pruneOpenedMap(m, live, now)
        return next ?? m
      },
      st,
    )
    if (next) {
      opened.clear()
      for (const [k, v] of Object.entries(next as Record<string, number>)) opened.set(k, v)
    }
  } catch (e) {
    fail(e)
  }
}

/* ---------------- the Bordbuch */

let logScope: string | null = null
let logDay = ''
let queue: Promise<void> = Promise.resolve()

/** Add an event to today's Bordbuch (this member, this device). Never text: ids, kinds, times, outcomes. */
export function appendLog(ev: PreflightLog): void {
  const scope = logScope
  const day = logDay
  if (!scope || !day) return
  useLog.setState((s) => (s.scope === scope && s.day === day ? { events: [...s.events, ev].slice(-LOG_MAX) } : {}))
  const st = store()
  if (!st) return
  queue = queue
    .then(() => update<LogDay>(logKey(scope, day), (cur) => ({ v: 1, day, events: [...sanitizeDay(cur, day).events, ev].slice(-LOG_MAX) }), st))
    .then(() => post({ scope, log: day }))
    .catch(fail)
}

/** Wait for the Bordbuch's pending writes (tests, the seam). */
export async function logSettled(): Promise<void> {
  await queue.catch(() => {})
  await flushOpened()
}

const LOG_KINDS = new Set(['test', 'ack', 'card', 'undo', 'source', 'fold', 'unfold', 'clear', 'relit'])

/** A stored day; another version's or a damaged record reads as empty. Strings longer than ids are dropped. */
export function sanitizeDay(v: unknown, day: string): LogDay {
  if (!v || typeof v !== 'object' || (v as LogDay).v !== 1 || !Array.isArray((v as LogDay).events)) return { v: 1, day, events: [] }
  const events = (v as LogDay).events.filter((e): e is PreflightLog => !!e && typeof e === 'object' && typeof e.at === 'number' && LOG_KINDS.has(e.k)).slice(-LOG_MAX)
  return { v: 1, day, events }
}

/** One day of this member's Bordbuch ([] without IndexedDB). */
export async function readDay(day: string, scope = logScope): Promise<PreflightLog[]> {
  const st = store()
  if (!scope || !st) return scope === logScope && day === logDay ? useLog.getState().events : []
  try {
    return sanitizeDay(await get(logKey(scope, day), st), day).events
  } catch (e) {
    fail(e)
    return []
  }
}

/** yyyy-MM-dd → the day number (UTC, for "older than 30 days"). */
const dayNo = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY_MS)

/** Delete this member's days older than 30 (at the start and at a new Preflight day). */
async function retain(scope: string, today: string): Promise<void> {
  const st = store()
  if (!st) return
  try {
    const prefix = `${scope}|log|`
    const old = (await keys(st)).map(String).filter((k) => k.startsWith(prefix) && dayNo(k.slice(prefix.length)) < dayNo(today) - LOG_DAYS)
    if (old.length) await delMany(old, st)
  } catch (e) {
    fail(e)
  }
}

/** Median seconds per card over the last 30 days: gaps between cards of one sitting (≤ 10 min apart). */
export function paceOf(days: PreflightLog[][]): number | null {
  const gaps: number[] = []
  for (const events of days) {
    const cards = events.filter((e) => e.k === 'card').map((e) => e.at).sort((a, b) => a - b)
    for (let i = 1; i < cards.length; i++) {
      const g = (cards[i] - cards[i - 1]) / 1000
      if (g > 0 && g <= 600) gaps.push(g)
    }
  }
  if (gaps.length < 5) return null
  gaps.sort((a, b) => a - b)
  const m = gaps.length >> 1
  return gaps.length % 2 ? gaps[m] : (gaps[m - 1] + gaps[m]) / 2
}

async function loadPace(scope: string): Promise<void> {
  const st = store()
  if (!st) return
  try {
    const prefix = `${scope}|log|`
    const list = (await keys(st)).map(String).filter((k) => k.startsWith(prefix))
    const days = await Promise.all(list.map(async (k) => sanitizeDay(await get(k, st), k.slice(prefix.length)).events))
    if (logScope === scope) useLog.setState({ pace: paceOf(days) })
  } catch (e) {
    fail(e)
  }
}

/* ---------------- tabs */

let channel: BroadcastChannel | null = null
type Msg = { scope: string; opened?: string[]; log?: string }

function post(msg: Msg): void {
  try {
    channel?.postMessage(msg)
  } catch {
    /* closed */
  }
}

let reread: ReturnType<typeof setTimeout> | null = null

function onMessage(msg: Msg): void {
  if (!msg || typeof msg !== 'object') return
  if (msg.opened && msg.scope === openedScope) {
    let added = false
    for (const id of msg.opened) {
      if (typeof id !== 'string' || opened.has(id)) continue
      opened.set(id, Date.now())
      added = true
    }
    if (added) emitOpened()
  }
  if (msg.log && msg.scope === logScope && msg.log === logDay) {
    if (reread) clearTimeout(reread)
    reread = setTimeout(() => {
      const scope = logScope
      const day = logDay
      void readDay(day, scope).then((events) => {
        if (logScope === scope && logDay === day) useLog.setState({ events })
      })
    }, 150)
  }
}

/* ---------------- scope and day */

/**
 * Enter a member scope and Preflight day (the engine calls it on a scope change and at a new day; null = none): loads
 * the day's events and the opened set, deletes old days, works out the pace.
 */
export async function enterLog(scope: string | null, day: string): Promise<void> {
  if (!channel && typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel('one-preflight')
      channel.onmessage = (e: MessageEvent) => onMessage(e.data as Msg)
    } catch {
      channel = null
    }
  }
  const sameScope = scope === logScope
  if (sameScope && day === logDay) return
  if (!sameScope) await flushOpened()
  logScope = scope
  logDay = day
  useLog.setState({ scope, day, events: [], ...(sameScope ? {} : { pace: null }) })
  if (!scope) {
    openedScope = null
    openedLoaded = false
    opened.clear()
    return
  }
  if (!sameScope) {
    openedScope = scope
    openedLoaded = false
    opened.clear()
    const st = store()
    if (st) {
      try {
        const m = sanitizeOpened(await get(openedKey(scope), st))
        if (openedScope !== scope) return
        for (const [k, v] of Object.entries(m)) opened.set(k, v)
      } catch (e) {
        fail(e)
      }
    }
    if (openedScope !== scope) return
    openedLoaded = true
    loads++
    emitOpened()
  }
  const events = await readDay(day, scope)
  if (logScope === scope && logDay === day) useLog.setState({ events: [...events, ...useLog.getState().events.filter((e) => !events.some((x) => x.at === e.at && x.k === e.k))] })
  await retain(scope, day)
  void loadPace(scope)
}

/** The lamps a card event names, by lamp (Bordbuch rows, the strip's done line). */
export const cardsOf = (events: readonly PreflightLog[], lamp?: LampId) => events.filter((e): e is Extract<PreflightLog, { k: 'card' }> => e.k === 'card' && (!lamp || e.lamp === lamp))
