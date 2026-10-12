/**
 * Custom agents — run records of this device (IndexedDB "one-agents" / "runs"; never synced):
 *   runs:<agentId>   AgentRun[] newest first, the last MAX_RUNS of the agent
 *   slot:<agentId>   the newest schedule slot this device has handled (ms)
 *   seq:<agentId>    the number of the agent's newest browser run on this device (AgentRun.seq: 1, 2, 3 …)
 *   state:<ws>:<agentId>   the agent's own small memory (agent_state_set: cursors, last seen ids …) —
 *                    `<ws>` = local:<id> | cloud:<id>; written only when a run ends ok (exec.ts) — and put back
 *                    to the run's `stateBefore` when every proposal of that run is discarded (review.ts)
 * Every write is an atomic read-modify-write (idb-keyval update), then the other tabs are told to
 * reload that agent's runs. Without IndexedDB (private modes) everything still works in memory.
 */
import { create } from 'zustand'
import { createStore, del, get, set, update, type UseStore } from 'idb-keyval'
import type { ID } from '../../store/types'
import type { AgentRun } from './types'
import { wsKey } from './locks'
import { dropBooks } from './trust/book'

export const MAX_RUNS = 100

export interface RunsState {
  /** runs per agent, newest first (only agents loaded so far) */
  byAgent: Record<ID, AgentRun[]>
}

export const useAgentRuns = create<RunsState>()(() => ({ byAgent: {} }))

let db: UseStore | null = null
let noDb = false
const kv = (): UseStore | null => {
  if (noDb || typeof indexedDB === 'undefined') return null
  return (db ??= createStore('one-agents', 'runs'))
}

const TAB = Math.random().toString(36).slice(2)
let channel: BroadcastChannel | null | undefined
function chan(): BroadcastChannel | null {
  if (channel === undefined) channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('one-agents') : null
  return channel
}

type Message = { type: 'runs'; agentId: ID; from: string }

function post(agentId: ID) {
  try {
    chan()?.postMessage({ type: 'runs', agentId, from: TAB } satisfies Message)
  } catch {
    /* closed */
  }
}

let listening = false
/** Reload an agent's runs when another tab wrote them. */
function listen() {
  if (listening) return
  listening = true
  chan()?.addEventListener('message', (e: MessageEvent) => {
    const m = e.data as Message | null
    if (m?.type !== 'runs' || m.from === TAB || typeof m.agentId !== 'string') return
    if (m.agentId in useAgentRuns.getState().byAgent) void loadRuns(m.agentId)
    changeListeners.forEach((l) => l(m.agentId))
  })
}

const changeListeners = new Set<(agentId: ID) => void>()
/** Runs of an agent changed in another tab. */
export function onRunsChanged(fn: (agentId: ID) => void): () => void {
  listen()
  changeListeners.add(fn)
  return () => changeListeners.delete(fn)
}

const isRun = (r: unknown): r is AgentRun => !!r && typeof r === 'object' && typeof (r as AgentRun).id === 'string' && typeof (r as AgentRun).agentId === 'string'

function setRuns(agentId: ID, runs: AgentRun[]) {
  useAgentRuns.setState((s) => ({ byAgent: { ...s.byAgent, [agentId]: runs } }))
}

/** Runs per agent queue their writes: one read-modify-write after another. */
const queues = new Map<ID, Promise<unknown>>()
/** Runs of an agent this tab put whose write is not stored yet (their copy here is the newest). */
const inflight = new Map<ID, Map<string, number>>()

/** Load an agent's runs into useAgentRuns (after this tab's queued writes are stored). */
export async function loadRuns(agentId: ID): Promise<AgentRun[]> {
  listen()
  const store = kv()
  let runs: AgentRun[] = useAgentRuns.getState().byAgent[agentId] ?? []
  if (store) {
    try {
      await queues.get(agentId)
      const v = await get<unknown>(`runs:${agentId}`, store)
      runs = Array.isArray(v) ? v.filter(isRun) : []
      // runs put while this read was going on win over the stored copies
      const fly = inflight.get(agentId)
      if (fly?.size) {
        const mem = useAgentRuns.getState().byAgent[agentId] ?? []
        const newer = mem.filter((r) => fly.has(r.id))
        runs = [...newer, ...runs.filter((r) => !fly.has(r.id))].sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_RUNS)
      }
    } catch (e) {
      console.warn('[one] agents: no IndexedDB, keeping runs in memory', e)
      noDb = true
    }
  }
  setRuns(agentId, runs)
  return runs
}

/** Insert or replace a run (by id) — in this tab right away, then stored. */
export function putRun(run: AgentRun): Promise<void> {
  const agentId = run.agentId
  const merge = (list: AgentRun[]) => {
    const rest = list.filter((r) => r.id !== run.id)
    const at = list.findIndex((r) => r.id === run.id)
    const next = at >= 0 ? [...list.slice(0, at), run, ...list.slice(at + 1)] : [run, ...rest]
    return next.sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_RUNS)
  }
  setRuns(agentId, merge(useAgentRuns.getState().byAgent[agentId] ?? []))
  const store = kv()
  if (!store) return Promise.resolve()
  const fly = inflight.get(agentId) ?? new Map<string, number>()
  inflight.set(agentId, fly)
  fly.set(run.id, (fly.get(run.id) ?? 0) + 1)
  const prev = queues.get(agentId) ?? Promise.resolve()
  const job = prev
    .then(() => update<unknown>(`runs:${agentId}`, (cur) => merge(Array.isArray(cur) ? cur.filter(isRun) : []), store))
    .then(() => post(agentId))
    .catch((e) => console.warn('[one] agents: could not save a run', e))
    .finally(() => {
      const left = (fly.get(run.id) ?? 1) - 1
      if (left > 0) fly.set(run.id, left)
      else fly.delete(run.id)
    })
  queues.set(agentId, job)
  return job
}

/**
 * Change ONE stored run of an agent: `fn` gets the run as it is STORED (inside the read-modify-write, after this tab's
 * queued writes) and returns its new value — null leaves it as it is. Applied to this tab's copy right away too, and
 * the stored result replaces it once written. `fn` must be pure (it may run twice: on the copy here, on the stored
 * run). Reviews write their outcome this way (review.ts, inside withRunLock): only the changes they acted on change, so
 * what another tab wrote meanwhile is never put back. Resolves with the stored run as written (null: not stored / not
 * changed). New runs and the run going on are written with putRun.
 */
export function patchRun(agentId: ID, runId: string, fn: (stored: AgentRun) => AgentRun | null): Promise<AgentRun | null> {
  const mem = useAgentRuns.getState().byAgent[agentId]
  const at = mem ? mem.findIndex((r) => r.id === runId) : -1
  let local: AgentRun | null = null
  if (mem && at >= 0) {
    local = fn(mem[at])
    if (local) setRuns(agentId, [...mem.slice(0, at), local, ...mem.slice(at + 1)])
  }
  const store = kv()
  if (!store) return Promise.resolve(local)
  const fly = inflight.get(agentId) ?? new Map<string, number>()
  inflight.set(agentId, fly)
  fly.set(runId, (fly.get(runId) ?? 0) + 1)
  let written: AgentRun | null = null
  const prev = queues.get(agentId) ?? Promise.resolve()
  const job = prev
    .then(() =>
      update<unknown>(
        `runs:${agentId}`,
        (cur) => {
          const list = Array.isArray(cur) ? cur.filter(isRun) : []
          const i = list.findIndex((r) => r.id === runId)
          written = i >= 0 ? fn(list[i]) : null
          return written ? [...list.slice(0, i), written, ...list.slice(i + 1)] : list
        },
        store,
      ),
    )
    .then(() => {
      // the stored result is the truth: this tab's copy follows it (a copy older than another tab's write included) —
      // the proposals it did not change keep this copy's objects (the review's rows draw only what changed)
      const now = useAgentRuns.getState().byAgent[agentId]
      const w = written
      if (now && w) setRuns(agentId, now.map((r) => (r.id === runId ? sharing(r, w) : r)))
      if (w) post(agentId)
    })
    .catch((e) => console.warn('[one] agents: could not save a run', e))
    .finally(() => {
      const left = (fly.get(runId) ?? 1) - 1
      if (left > 0) fly.set(runId, left)
      else fly.delete(runId)
    })
  queues.set(agentId, job)
  return job.then(() => written)
}

/** `next` (as stored) with the proposals and row ids that equal this tab's copy `was` taken from `was` (same objects). */
function sharing(was: AgentRun, next: AgentRun): AgentRun {
  if (was === next || !was.staged || !next.staged) return next
  const old = new Map(was.staged.map((c) => [c.id, c]))
  const staged = next.staged.map((c) => {
    const o = old.get(c.id)
    return o && o !== c && JSON.stringify(o) === JSON.stringify(c) ? o : c
  })
  const rowIds = was.rowIds && next.rowIds && JSON.stringify(was.rowIds) === JSON.stringify(next.rowIds) ? was.rowIds : next.rowIds
  return { ...next, staged, ...(rowIds ? { rowIds } : {}) }
}

/** The agent's in-tab queue of locked work (without Web Locks: the only lock). */
const lockQueues = new Map<string, Promise<unknown>>()

/**
 * Run `fn` holding the agent's run lock: reviews (apply · discard · undo) and superseding of one agent's runs happen one
 * after another — across the tabs of this browser (a Web Lock `one-agents-run:<ws>:<agentId>`), else within this tab.
 * Not the lock that keeps two runs of an agent apart (locks.ts `exclusive`): a run going on never waits for a review.
 * Never nest it (Web Locks are not re-entrant).
 */
export function withRunLock<T>(agentId: ID, fn: () => Promise<T>): Promise<T> {
  const name = `one-agents-run:${wsKey()}:${agentId}`
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  const prev = lockQueues.get(name) ?? Promise.resolve()
  const run: Promise<T> = prev.catch(() => {}).then((): Promise<T> => (locks?.request ? (locks.request(name, () => fn()) as Promise<T>) : fn()))
  const tail = run.catch(() => {})
  lockQueues.set(name, tail)
  void tail.then(() => {
    if (lockQueues.get(name) === tail) lockQueues.delete(name)
  })
  return run
}

/** Forget every run of an agent (it was deleted) — and its saved state and its trust books (every scope of this browser). */
export async function dropRuns(agentId: ID): Promise<void> {
  await dropBooks(agentId)
  useAgentRuns.setState((s) => {
    const byAgent = { ...s.byAgent }
    delete byAgent[agentId]
    return { byAgent }
  })
  memState.delete(stateKey(agentId))
  memSeq.delete(agentId)
  const store = kv()
  if (!store) return
  try {
    await set(`runs:${agentId}`, [], store)
    await del(`slot:${agentId}`, store)
    await del(`seq:${agentId}`, store)
    await del(stateKey(agentId), store)
    slots.delete(agentId)
    primed.delete(agentId)
    post(agentId)
  } catch {
    /* nothing stored */
  }
}

const slots = new Map<ID, number>()
/** agents whose slot was read from IndexedDB in this tab (or set here) — `cachedSlot` knows them */
const primed = new Set<ID>()

/** The newest schedule slot this device handled for an agent (null: none yet). */
export async function getSlot(agentId: ID): Promise<number | null> {
  if (slots.has(agentId)) return slots.get(agentId)!
  const store = kv()
  if (!store) {
    primed.add(agentId)
    return null
  }
  try {
    const v = await get<unknown>(`slot:${agentId}`, store)
    primed.add(agentId)
    if (typeof v === 'number') {
      slots.set(agentId, Math.max(v, slots.get(agentId) ?? 0))
      return slots.get(agentId)!
    }
  } catch {
    /* in memory only */
    primed.add(agentId)
  }
  return slots.get(agentId) ?? null
}

/**
 * The slot `getSlot` would answer, without waiting (the Preflight "missed" lamp reads it synchronously): a number,
 * null = none handled yet, undefined = not read in this tab yet (`primeSlots` reads it).
 */
export function cachedSlot(agentId: ID): number | null | undefined {
  if (slots.has(agentId)) return slots.get(agentId)!
  return primed.has(agentId) ? null : undefined
}

/** Read the slots of these agents into the tab's cache (the ones not read yet). */
export async function primeSlots(ids: Iterable<ID>): Promise<void> {
  await Promise.all([...ids].filter((id) => !primed.has(id) && !slots.has(id)).map((id) => getSlot(id)))
}

export async function setSlot(agentId: ID, slot: number): Promise<void> {
  primed.add(agentId)
  slots.set(agentId, Math.max(slot, slots.get(agentId) ?? 0))
  const store = kv()
  if (!store) return
  try {
    await update<unknown>(`slot:${agentId}`, (cur) => Math.max(typeof cur === 'number' ? cur : 0, slot), store)
  } catch {
    /* in memory only */
  }
}

/** Forget cached slots (another tab may have advanced them). */
export function forgetSlots(): void {
  slots.clear()
  primed.clear()
}

/** without IndexedDB: this tab only */
const memSeq = new Map<ID, number>()
const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)

/**
 * The number of an agent's next browser run on this device (1, 2, 3 …) — one atomic read-modify-write, so two tabs
 * never hand out the same number. Server runs have none.
 */
export async function nextSeq(agentId: ID): Promise<number> {
  const store = kv()
  if (store) {
    try {
      let n = 0
      await update<unknown>(`seq:${agentId}`, (cur) => (n = count(cur) + 1), store)
      memSeq.set(agentId, n)
      return n
    } catch {
      /* in memory only */
    }
  }
  const n = (memSeq.get(agentId) ?? 0) + 1
  memSeq.set(agentId, n)
  return n
}

/** A run with staged changes nobody has reviewed yet (a held one too — it waits for the person, slice SJ). */
export const awaitsReview = (r: AgentRun) => r.status === 'staged' && (r.staged ?? []).some((c) => c.status === 'pending' || c.status === 'failed' || c.status === 'held')

/** A run that did its job (its writes applied or proposed): the "last successful run" of the next one. */
export const succeeded = (r: AgentRun) => r.status === 'ok' || r.status === 'staged'

/** The newest successful run of a list (newest first), leaving out `exceptId` (the run going on). */
export const lastSuccess = (runs: AgentRun[], exceptId?: string): AgentRun | null => runs.find((r) => r.id !== exceptId && succeeded(r)) ?? null

/* ------------------------------------------------------------------ the agent's own state */

/** What agent_state_set saved (JSON text ≤ STATE_BYTES), when, by which run. */
export interface AgentState {
  json: string
  at: number
  runId: string
}

const stateKey = (agentId: ID) => `state:${wsKey()}:${agentId}`
/** without IndexedDB: this tab only */
const memState = new Map<string, AgentState>()

const isState = (v: unknown): v is AgentState => !!v && typeof v === 'object' && typeof (v as AgentState).json === 'string' && typeof (v as AgentState).at === 'number'

/** The agent's saved state on this device (null: nothing saved yet). */
export async function getAgentState(agentId: ID): Promise<AgentState | null> {
  const key = stateKey(agentId)
  const store = kv()
  if (store) {
    try {
      const v = await get<unknown>(key, store)
      return isState(v) ? { json: v.json, at: v.at, runId: typeof v.runId === 'string' ? v.runId : '' } : null
    } catch {
      /* in memory only */
    }
  }
  return memState.get(key) ?? null
}

/** Save the agent's state (only at the end of a successful run, state.ts) — `null` clears it. */
export async function putAgentState(agentId: ID, state: AgentState | null): Promise<void> {
  const key = stateKey(agentId)
  if (state) memState.set(key, state)
  else memState.delete(key)
  const store = kv()
  if (!store) return
  try {
    if (state) await set(key, state, store)
    else await del(key, store)
    post(agentId)
  } catch {
    /* in memory only */
  }
}
