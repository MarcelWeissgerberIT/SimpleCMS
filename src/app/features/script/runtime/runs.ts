/**
 * One Script — this device's run log and trusted versions (IndexedDB "one-scripts" / "kv"; never
 * synced, wiped with a team workspace's copy — cloud/device.ts):
 *   <scope>|runs|<scriptId>   ScriptRun[] newest first, the last MAX_RUNS of the script
 *   <scope>|trust             code hashes this device ran or confirmed (team workspaces)
 * <scope> = "local:local" / "cloud:<workspace id>". Without IndexedDB everything stays in memory.
 */
import { create } from 'zustand'
import { createStore, del, get, update, type UseStore } from 'idb-keyval'
import { activeWorkspace } from '../../../cloud'
import type { ID } from '../../../store/types'
import type { ScriptRun } from './types'

export const MAX_RUNS = 50
const MAX_TRUST = 500

/** This workspace's key: runs of another workspace are never shown. */
export function scriptScope(): string {
  const ref = activeWorkspace()
  return `${ref.kind}:${ref.id}`
}

interface RunsState {
  /** `<scope>|<scriptId>` → runs, newest first (only scripts loaded so far) */
  byScript: Record<string, ScriptRun[]>
}

export const useScriptRuns = create<RunsState>()(() => ({ byScript: {} }))

let db: UseStore | null = null
let noDb = false
const kv = (): UseStore | null => {
  if (noDb || typeof indexedDB === 'undefined') return null
  return (db ??= createStore('one-scripts', 'kv'))
}

const runsKey = (scope: string, scriptId: ID) => `${scope}|runs|${scriptId}`
const memKey = (scope: string, scriptId: ID) => `${scope}|${scriptId}`
const isRun = (r: unknown): r is ScriptRun => !!r && typeof r === 'object' && typeof (r as ScriptRun).id === 'string' && typeof (r as ScriptRun).scriptId === 'string'

const queue = new Map<string, Promise<unknown>>()

/** Load a script's runs into useScriptRuns. */
export async function loadScriptRuns(scriptId: ID, scope = scriptScope()): Promise<ScriptRun[]> {
  const store = kv()
  let runs: ScriptRun[] = useScriptRuns.getState().byScript[memKey(scope, scriptId)] ?? []
  if (store) {
    try {
      await queue.get(runsKey(scope, scriptId))
      const v = await get<unknown>(runsKey(scope, scriptId), store)
      runs = Array.isArray(v) ? v.filter(isRun) : []
    } catch (e) {
      console.warn('[one] scripts: no IndexedDB, keeping runs in memory', e)
      noDb = true
    }
  }
  useScriptRuns.setState((s) => ({ byScript: { ...s.byScript, [memKey(scope, scriptId)]: runs } }))
  return runs
}

/** Insert or replace a run (by id): in memory at once, then stored. */
export function putScriptRun(run: ScriptRun): Promise<void> {
  const mk = memKey(run.scope, run.scriptId)
  const merge = (list: ScriptRun[]) => [run, ...list.filter((r) => r.id !== run.id)].sort((a, b) => b.at - a.at).slice(0, MAX_RUNS)
  useScriptRuns.setState((s) => ({ byScript: { ...s.byScript, [mk]: merge(s.byScript[mk] ?? []) } }))
  const store = kv()
  if (!store) return Promise.resolve()
  const key = runsKey(run.scope, run.scriptId)
  const job = (queue.get(key) ?? Promise.resolve())
    .then(() => update<unknown>(key, (cur) => merge(Array.isArray(cur) ? cur.filter(isRun) : []), store))
    .catch((e) => console.warn('[one] scripts: could not save a run', e))
  queue.set(key, job)
  return job
}

/** Forget a script's runs (it was deleted). */
export async function dropScriptRuns(scriptId: ID, scope = scriptScope()): Promise<void> {
  useScriptRuns.setState((s) => {
    const byScript = { ...s.byScript }
    delete byScript[memKey(scope, scriptId)]
    return { byScript }
  })
  const store = kv()
  if (!store) return
  try {
    await del(runsKey(scope, scriptId), store)
  } catch {
    /* nothing stored */
  }
}

/* ------------------------------------------------------------------ trusted versions */

const trusted = new Map<string, Set<string>>()

export async function trustedHashes(scope = scriptScope()): Promise<Set<string>> {
  let set = trusted.get(scope)
  if (set) return set
  set = new Set()
  const store = kv()
  if (store) {
    try {
      const v = await get<unknown>(`${scope}|trust`, store)
      if (Array.isArray(v)) for (const h of v) if (typeof h === 'string') set.add(h)
    } catch {
      /* in memory only */
    }
  }
  const mem = trusted.get(scope)
  if (mem) for (const h of mem) set.add(h)
  trusted.set(scope, set)
  return set
}

export async function addTrusted(hash: string, scope = scriptScope()): Promise<void> {
  const set = await trustedHashes(scope)
  if (set.has(hash)) return
  set.add(hash)
  const store = kv()
  if (!store) return
  try {
    await update<unknown>(`${scope}|trust`, (cur) => {
      const list = Array.isArray(cur) ? cur.filter((x): x is string => typeof x === 'string' && x !== hash) : []
      return [hash, ...list].slice(0, MAX_TRUST)
    }, store)
  } catch {
    /* in memory only */
  }
}
