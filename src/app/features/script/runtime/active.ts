/**
 * One Script — runs in progress in this tab (one per script; Stop from anywhere: the editor, the list,
 * Mod+.) and runScriptById(): the one call other areas use to run a saved script (buttons, database
 * commands, automations, ⌘K) — the app's dialogs, the run log, and a toast with Undo when it changed
 * something. Light on purpose: the interpreter loads on the first run.
 */
import { create } from 'zustand'
import { useWorkspace } from '../../../store/store'
import type { ID } from '../../../store/types'
import { toast } from '../../../store/ui'
import { t } from '../../../i18n'
import { errorMessage } from '../ui/errors'
import type { RunOptions, RunResult } from './run'

export interface ActiveRun {
  mode: 'run' | 'dry'
  ctrl: AbortController
  startedAt: number
}

/** scriptId → the run in progress */
export const useActiveRuns = create<{ runs: Record<ID, ActiveRun> }>()(() => ({ runs: {} }))

/** Register a run (null: that script is already running in this tab). */
export function beginRun(scriptId: ID, mode: 'run' | 'dry'): AbortController | null {
  if (useActiveRuns.getState().runs[scriptId]) return null
  const ctrl = new AbortController()
  useActiveRuns.setState((s) => ({ runs: { ...s.runs, [scriptId]: { mode, ctrl, startedAt: Date.now() } } }))
  return ctrl
}

export function endRun(scriptId: ID, ctrl: AbortController): void {
  useActiveRuns.setState((s) => {
    if (s.runs[scriptId]?.ctrl !== ctrl) return s
    const runs = { ...s.runs }
    delete runs[scriptId]
    return { runs }
  })
}

/** Stop a script's run in this tab (it ends at its next step). */
export function stopScript(scriptId: ID): void {
  useActiveRuns.getState().runs[scriptId]?.ctrl.abort()
}

export interface RunByIdOptions extends Omit<RunOptions, 'code' | 'scriptId' | 'name' | 'mode' | 'signal'> {
  mode?: 'run' | 'dry'
  /** a toast when it is done: what it changed (with Undo) or its error (default true) */
  notify?: boolean
}

/** Run a saved script (or dry-run it) by id. null: no such script, or it is running already. */
export async function runScriptById(id: ID, o: RunByIdOptions = {}): Promise<RunResult | null> {
  const script = useWorkspace.getState().scripts?.[id]
  if (!script) return null
  const mode = o.mode ?? 'run'
  const ctrl = beginRun(id, mode)
  if (!ctrl) return null
  try {
    const { runScript } = await import('./run')
    const r = await runScript({ ...o, code: script.code, scriptId: id, name: script.name, mode, signal: ctrl.signal })
    if (o.notify !== false) notifyResult(script.name, mode, r)
    return r
  } finally {
    endRun(id, ctrl)
  }
}

/** The toast after a run: changes with Undo, or the error. Dry runs and cancelled runs stay quiet. */
export function notifyResult(name: string, mode: 'run' | 'dry', r: RunResult): void {
  if (r.status === 'cancelled' || r.status === 'stopped') return
  if (r.status === 'error' && r.error) {
    const message = errorMessage(r.error, t)
    toast({ kind: 'error', message: t('features.script.failedToast', { name, message: r.error.line ? `${r.error.line}:${r.error.col ?? 1} ${message}` : message }) })
    return
  }
  if (mode !== 'run') return
  const n = r.changes.filter((c) => !c.skipped).length
  const run = r.run
  if (!n) {
    toast({ kind: 'success', message: t('features.script.ranNothing', { name }) })
    return
  }
  const undo = async () => {
    const { undoRun } = await import('./run')
    if (run && (await undoRun(run))) toast({ message: t('features.script.runs.undoneToast'), kind: 'success' })
  }
  toast({
    kind: 'success',
    message: t(n === 1 ? 'features.script.ranToast.one' : 'features.script.ranToast.other', { name, n }),
    action: run ? { label: t('common.undo'), run: () => void undo() } : undefined,
    timeout: 8000,
  })
}
