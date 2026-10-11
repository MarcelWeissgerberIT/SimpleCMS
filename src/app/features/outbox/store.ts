/**
 * The Outbox in memory (`useOutbox`): this workspace's slips, loaded once by startOutbox() (main.tsx) after the
 * workspace — plus what lives only in this tab (drafts running, the focused slip, the hand path's question). Every
 * write goes to IndexedDB first (db.ts, one transaction per change) and then here; the other tabs hear which slips
 * changed and read them again. Background duties of startOutbox():
 *  - the boot sweep: a slip left 'sending' whose lock nobody holds is UNCLEAR (slice 2 writes 'sending');
 *  - purge: withdrawn slips after 30 days, sent ones after 365 days or beyond the newest 2,000;
 *  - CHANGED per mirror: when a row with an open slip changes its source fields (a mirror run), the slip's
 *    `lastCheck` says what changed since the draft (watch.ts).
 */
import { create } from 'zustand'
import { activeWorkspace, useCloud } from '../../cloud'
import type { ID } from '../../store/types'
import { dropSlips, loadSlips, onChanged, postChanged, probeStorage, readSlip, updateSlip } from './db'
import { next, type SlipEvent } from './machine'
import { OPEN_STATES, SENT_STATES, type LogLine, type Slip, type SlipId, type SlipQuery, type SlipState } from './types'

export const OUTBOX_LIMITS = {
  /** open slips per workspace */
  open: 500,
  /** the tool's arguments as canonical JSON, in bytes */
  argsBytes: 64 * 1024,
  /** a receipt's result text */
  resultText: 2048,
  withdrawnDays: 30,
  sentDays: 365,
  sentMax: 2000,
  /** log lines per slip */
  log: 30,
  /** rows one draft popover may take */
  rows: 10,
} as const

/** A draft Claude is writing (in memory only: closing the popover never stops it). */
export interface Drafting {
  key: string
  dbId: ID
  rowId: ID
  rowKey: string
  label: string
  startedAt: number
  /** "2 / 5" while several rows are drafted one after another */
  step?: { n: number; of: number }
}

export interface OutboxState {
  scope: string
  loaded: boolean
  storage: { ok: boolean; reason?: string }
  slips: Record<SlipId, Slip>
  drafting: Record<string, Drafting>
  /** the slip the dock / #/outbox has open */
  focus: SlipId | null
  /** the hand path asks "Sent in the ticket tool?" for this slip — about the arguments that were copied */
  asking: { id: SlipId; argsHash: string } | null
  /** a phone / narrow screen: the dock as a sheet, opened on demand */
  sheet: ID | null
}

/**
 * Whose slips: 'local:local', or in a team workspace this member's own ('cloud:<ws>:u:<account>') — another member
 * signing in on the same browser never sees, counts or acts on them (their drafts can quote the member's private pages).
 */
export const scopeNow = (): string => {
  const ref = activeWorkspace()
  if (ref.kind !== 'cloud') return `${ref.kind}:${ref.id}`
  const uid = useCloud.getState().user?.id
  return uid ? `cloud:${ref.id}:u:${uid}` : `cloud:${ref.id}`
}

export const useOutbox = create<OutboxState>(() => ({
  scope: 'local:local',
  loaded: false,
  storage: { ok: true },
  slips: {},
  drafting: {},
  focus: null,
  asking: null,
  sheet: null,
}))

const S = () => useOutbox.getState()

let readyResolve: () => void = () => {}
const ready = new Promise<void>((r) => (readyResolve = r))
/** Resolves once this workspace's slips are loaded. */
export const outboxReady = (): Promise<void> => ready

const listeners = new Set<() => void>()
/** Called after any slip changed (here or in another tab). Returns an unsubscribe function. */
export function onSlipsChanged(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const emit = () => {
  for (const fn of listeners) {
    try {
      fn()
    } catch (e) {
      console.warn('[one] outbox listener failed', e)
    }
  }
}

function putMemory(list: Array<Slip | undefined>, gone: SlipId[] = []): void {
  useOutbox.setState((s) => {
    const slips = { ...s.slips }
    for (const x of list) if (x && x.scope === s.scope) slips[x.id] = x
    for (const id of gone) delete slips[id]
    return { slips }
  })
  emit()
}

/** Storage is blocked: nothing is staged and no send key works (fail closed). */
export const storageOk = () => S().storage.ok

/** Write a new slip (a fresh id: refused when one is stored under it already). */
export async function insertSlip(slip: Slip): Promise<Slip | null> {
  const stored = await updateSlip(slip.scope, slip.id, (cur) => cur ?? slip)
  if (stored !== slip) return null
  putMemory([slip])
  postChanged(slip.scope, [slip.id])
  return slip
}

/**
 * Change a slip: one read-modify-write of the stored record (`fn` sees the stored one; return it unchanged to leave
 * it). Resolves with the slip afterwards (null: gone).
 */
export async function mutateSlip(id: SlipId, fn: (cur: Slip) => Slip): Promise<Slip | null> {
  const scope = S().scope
  let changed = false
  const after = await updateSlip(scope, id, (cur) => {
    if (!cur) return cur
    const nx = fn(cur)
    changed = nx !== cur
    return nx === cur ? cur : { ...nx, updatedAt: Date.now() }
  })
  if (!after) {
    putMemory([], [id])
    return null
  }
  putMemory([after])
  if (changed) postChanged(scope, [id])
  return after
}

/** A state change through the machine (refused → null and nothing written). */
export async function transition(id: SlipId, event: SlipEvent, patch: (s: Slip, to: SlipState) => Partial<Slip> = () => ({})): Promise<Slip | null> {
  let ok = false
  const after = await mutateSlip(id, (cur) => {
    const to = next(cur.state, event)
    if (!to) return cur
    ok = true
    return { ...cur, ...patch(cur, to), state: to }
  })
  return ok ? after : null
}

/** A logbook line (codes + values only; the newest 30 stay). */
export function withLog(s: Slip, code: string, v?: LogLine['v']): Slip {
  const line: LogLine = { at: Date.now(), code, ...(v ? { v } : {}) }
  return { ...s, log: [...s.log, line].slice(-OUTBOX_LIMITS.log) }
}

/* ------------------------------------------------------------------ reading */

export function matches(s: Slip, q: SlipQuery): boolean {
  if (q.dbId && s.target.dbId !== q.dbId) return false
  if (q.rowId && s.target.rowId !== q.rowId) return false
  if (q.groupId && s.group?.id !== q.groupId) return false
  if (q.origin && (s.origin.kind !== q.origin.kind || (q.origin.ref !== undefined && s.origin.ref !== q.origin.ref))) return false
  if (q.states && !q.states.includes(s.state)) return false
  return true
}

const byNewest = (a: Slip, b: Slip) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1)

/** Slips of this workspace (newest first). */
export function getSlips(q: SlipQuery = {}): Slip[] {
  return Object.values(S().slips).filter((s) => matches(s, q)).sort(byNewest)
}

export const getSlip = (id: SlipId): Slip | null => S().slips[id] ?? null

/* ------------------------------------------------------------------ start */

let started = false

async function purge(scope: string, list: Slip[]): Promise<Slip[]> {
  const now = Date.now()
  const day = 86_400_000
  const drop = new Set<SlipId>()
  for (const s of list) if (s.state === 'withdrawn' && now - s.updatedAt > OUTBOX_LIMITS.withdrawnDays * day) drop.add(s.id)
  const sent = list.filter((s) => SENT_STATES.includes(s.state)).sort((a, b) => (b.receipt?.at ?? b.updatedAt) - (a.receipt?.at ?? a.updatedAt))
  sent.forEach((s, i) => {
    if (i >= OUTBOX_LIMITS.sentMax || now - (s.receipt?.at ?? s.updatedAt) > OUTBOX_LIMITS.sentDays * day) drop.add(s.id)
  })
  if (drop.size) await dropSlips(scope, [...drop]).catch(() => undefined)
  return list.filter((s) => !drop.has(s.id))
}

/** Boot: a slip left 'sending' whose Web Lock nobody holds — the call may have run: UNCLEAR. */
async function sweep(list: Slip[]): Promise<void> {
  const sending = list.filter((s) => s.state === 'sending')
  if (!sending.length) return
  let held = new Set<string>()
  try {
    const q = await navigator.locks?.query()
    held = new Set((q?.held ?? []).map((l) => l.name ?? ''))
  } catch {
    /* no Web Locks: nobody holds one */
  }
  for (const s of sending) if (!held.has(lockName(s.scope, s.id))) await transition(s.id, 'boot', (cur) => withLog(cur, 'boot.unclear'))
}

export const lockName = (scope: string, id: SlipId) => `one-outbox:${scope}:${id}`

/** Load this workspace's slips and keep them in step with the other tabs. Call once from main.tsx after the workspace. */
export function startOutbox(): () => void {
  if (started) return () => {}
  started = true
  const scope = scopeNow()
  useOutbox.setState({ scope })
  void (async () => {
    const probe = await probeStorage()
    if (!probe.ok) {
      useOutbox.setState({ storage: { ok: false, reason: probe.reason }, loaded: true })
      readyResolve()
      return
    }
    try {
      const list = await purge(scope, await loadSlips(scope))
      useOutbox.setState({ slips: Object.fromEntries(list.map((s) => [s.id, s])), loaded: true })
      emit()
      await sweep(list)
    } catch (e) {
      console.warn('[one] outbox could not load', e)
      useOutbox.setState({ storage: { ok: false, reason: (e as Error)?.message || 'blocked' }, loaded: true })
    }
    readyResolve()
  })()
  const off = onChanged((sc, ids) => {
    if (sc !== S().scope) return
    void Promise.all(ids.map((id) => readSlip(sc, id).catch(() => undefined))).then((got) => {
      putMemory(
        got.filter((x): x is Slip => !!x),
        ids.filter((_, i) => !got[i]),
      )
    })
  })
  return () => {
    started = false
    off()
  }
}

/** Open = missing · ready · held · sending · unclear · failed · unconfirmed. */
export const openStates = OPEN_STATES
