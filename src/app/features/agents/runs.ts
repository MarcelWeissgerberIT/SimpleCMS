/**
 * Custom agents — run records of this device (IndexedDB "one-agents" / "runs"; never synced):
 *   runs:<agentId>   AgentRun[] newest first, the last MAX_RUNS of the agent
 *   slot:<agentId>   the newest schedule slot this device has handled (ms)
 * Every write is an atomic read-modify-write (idb-keyval update), then the other tabs are told to
 * reload that agent's runs. Without IndexedDB (private modes) everything still works in memory.
 */
import { create } from 'zustand'
import { createStore, del, get, set, update, type UseStore } from 'idb-keyval'
import type { ID } from '../../store/types'
import type { AgentRun } from './types'

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

/** Forget every run of an agent (it was deleted). */
export async function dropRuns(agentId: ID): Promise<void> {
  useAgentRuns.setState((s) => {
    const byAgent = { ...s.byAgent }
    delete byAgent[agentId]
    return { byAgent }
  })
  const store = kv()
  if (!store) return
  try {
    await set(`runs:${agentId}`, [], store)
    await del(`slot:${agentId}`, store)
    slots.delete(agentId)
    post(agentId)
  } catch {
    /* nothing stored */
  }
}

const slots = new Map<ID, number>()

/** The newest schedule slot this device handled for an agent (null: none yet). */
export async function getSlot(agentId: ID): Promise<number | null> {
  if (slots.has(agentId)) return slots.get(agentId)!
  const store = kv()
  if (!store) return null
  try {
    const v = await get<unknown>(`slot:${agentId}`, store)
    if (typeof v === 'number') {
      slots.set(agentId, Math.max(v, slots.get(agentId) ?? 0))
      return slots.get(agentId)!
    }
  } catch {
    /* in memory only */
  }
  return slots.get(agentId) ?? null
}

export async function setSlot(agentId: ID, slot: number): Promise<void> {
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
}

/** A run with staged changes nobody has reviewed yet. */
export const awaitsReview = (r: AgentRun) => r.status === 'staged' && (r.staged ?? []).some((c) => c.status === 'pending' || c.status === 'failed')
