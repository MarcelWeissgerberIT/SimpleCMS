/**
 * One Script — running a script.
 *
 *  runScript({ code, mode, … }):
 *   - 'query': read-only (writes, effects and dialogs are refused) — the live tester, tools
 *   - 'dry':   reads for real, records every write and effect, executes none ("This script would: …")
 *   - 'run':   (team: someone else's version is confirmed first) → a silent check pass lists what will
 *              leave One or go to the trash → the person confirms that list once (and may untick
 *              items) → the run writes through the store (origin 'script', a version before the first
 *              change of each page) → "Undo run" restores every page it touched
 *  Every run / dry run of a saved script is kept in this device's run log (runs.ts).
 */
import { useWorkspace } from '../../../store/store'
import type { ID, Page } from '../../../store/types'
import { newId } from '../../../lib/ids'
import { Interpreter, ScriptError, inspect, parse, toPlain, walk, type Limits, type Program, type Value } from '../lang'
import { Host, SCRIPT_ORIGIN } from './host'
import { customFunction, globalsFor, resolveRef } from './globals'
import { isTabular, tabulate } from './table'
import { appRunUI, silentRunUI } from './dialogs'
import { putScriptRun, scriptScope } from './runs'
import { codeHash, isTrusted, trustCode } from './trust'
import type { ChangeItem, EffectItem, ErrorInfo, LogLine, ResultTable, RunMode, RunUI, ScriptRun, UndoData } from './types'

export interface RunOptions {
  code: string
  /** the saved script (run log, trust, page.current …); null / absent = unsaved code */
  scriptId?: ID | null
  name?: string
  mode: 'run' | 'dry' | 'query'
  /** what page.current is (the page a button sits on, the row a command runs for) */
  contextPageId?: ID | null
  /** the dialogs (default: the app's dialog host) */
  ui?: RunUI
  signal?: AbortSignal
  onLog?: (line: LogLine) => void
  /** keep it in the run log (default: run and dry runs of a saved script) */
  record?: boolean
  /** the caller already confirmed this version (team workspaces) */
  trusted?: boolean
  limits?: Partial<Limits>
  /** query mode: build a table of the result (default true) */
  table?: boolean
  /** only these pages are reachable (a custom agent's scope); absent = every live page outside templates */
  scope?: ((id: ID) => boolean) | null
}

export interface RunResult {
  status: 'ok' | 'error' | 'stopped' | 'cancelled'
  /** the value of the last top-level expression */
  value: Value
  /** that value as JSON */
  plain: unknown
  /** that value as text (console) */
  text: string
  /** that value as a table (query mode; lists of rows / records, queries) */
  table: ResultTable | null
  log: LogLine[]
  changes: ChangeItem[]
  effects: EffectItem[]
  error: ErrorInfo | null
  ms: number
  /** the run log entry (run / dry run of a saved script) */
  run: ScriptRun | null
}

/** Undo data of this tab's runs (the run log keeps a copy when it is small enough). */
const undoMemory = new Map<string, UndoData>()
const UNDO_STORE_MAX = 2_000_000

export function errorInfo(e: unknown): ErrorInfo {
  if (e instanceof ScriptError) return { code: e.code, params: e.params, line: e.pos?.line ?? null, col: e.pos?.col ?? null, start: e.pos?.start ?? null, end: e.pos?.end ?? null }
  return { code: 'internal', params: { detail: String((e as Error)?.message ?? e).slice(0, 300) }, line: null, col: null, start: null, end: null }
}

/** Names that make a run ask first: effects and the trash. */
function needsCheck(program: Program): boolean {
  let hit = false
  walk(program, (n) => {
    if (hit) return
    if (n.type === 'Ident' && ['mail', 'claude', 'http', 'trash'].includes(n.name.toLowerCase())) hit = true
    else if (n.type === 'Member' && n.name.toLowerCase() === 'trash') hit = true
  })
  return hit
}

interface PassResult {
  host: Host
  value: Value
  error: unknown
  interp: Interpreter
}

async function pass(program: Program, code: string, mode: RunMode, o: RunOptions, ui: RunUI, signal: AbortSignal, approved: { keys: Set<string>; labels: Map<string, string> } | null, onLog?: (l: LogLine) => void): Promise<PassResult> {
  const lang = useWorkspace.getState().settings.language === 'de' ? 'de' : 'en'
  const host = new Host({ mode, scriptId: o.scriptId ?? null, scriptName: o.name ?? '', contextPageId: o.contextPageId ?? null, ui, signal, lang, onLog, approved, scope: o.scope ?? null })
  const interp = new Interpreter({
    globals: globalsFor(host),
    fallback: customFunction,
    resolveRef: (ref) => resolveRef(host, ref),
    limits: o.limits,
    signal,
    lang,
    host,
    onTimeout: mode === 'run' || mode === 'dry' ? () => ui.moreTime(host.scriptName, signal) : undefined,
    onPrint: async (values, kind, ctx) => {
      if (mode === 'check') return
      if (values.length === 1 && isTabular(values[0])) {
        const table = await tabulate(values[0], ctx)
        host.write(kind, table ? `${table.total}` : inspect(values[0]), ctx.pos, table ?? undefined)
        return
      }
      host.write(kind, values.map((v) => inspect(v)).join(' '), ctx.pos)
    },
  })
  interp.setSource(code)
  try {
    const value = await interp.run(program)
    return { host, value, error: null, interp }
  } catch (e) {
    return { host, value: null, error: e, interp }
  }
}

/** What the run changed, as undo data (each page as it was, and which of its fields the run changed). */
function undoData(host: Host): UndoData | null {
  if (!host.before.size) return null
  const after = useWorkspace.getState().pages
  const before: Record<ID, Page | null> = {}
  const fields: Record<ID, string[]> = {}
  for (const [id, b] of host.before) {
    const now = after[id]
    if (b === null) {
      before[id] = null
      fields[id] = ['created']
      continue
    }
    if (!now) continue
    const f: string[] = []
    if (now.title !== b.title) f.push('title')
    if (now.icon !== b.icon) f.push('icon')
    if (now.content !== b.content) f.push('content')
    if (now.trashed !== b.trashed) f.push('trashed')
    for (const k of new Set([...Object.keys(now.properties), ...Object.keys(b.properties)])) if (now.properties[k] !== b.properties[k]) f.push(`props:${k}`)
    if (f.length) {
      before[id] = b
      fields[id] = f
    }
  }
  return Object.keys(fields).length ? { before, fields } : null
}

export async function runScript(o: RunOptions): Promise<RunResult> {
  const t0 = Date.now()
  const ui = o.ui ?? appRunUI
  const signal = o.signal ?? new AbortController().signal
  const empty = (status: RunResult['status'], error: ErrorInfo | null = null): RunResult => ({ status, value: null, plain: null, text: '', table: null, log: [], changes: [], effects: [], error, ms: Date.now() - t0, run: null })

  let program: Program
  try {
    program = parse(o.code)
  } catch (e) {
    return empty('error', errorInfo(e))
  }

  // team workspaces: a version this device did not save or confirm runs only after the person confirmed it
  if (o.mode === 'run' && !o.trusted && o.scriptId && !(await isTrusted({ code: o.code }))) {
    const s = useWorkspace.getState()
    const script = s.scripts?.[o.scriptId]
    const editor = script?.updatedBy ? (s.people.find((p) => p.id === script.updatedBy)?.name ?? null) : null
    if (!(await ui.trust({ name: script?.name ?? o.name ?? '', editor, code: o.code }, signal))) return empty('cancelled')
    await trustCode(o.code)
  }

  // a run first lists what will leave One or go to the trash, and asks once
  let approved: { keys: Set<string>; labels: Map<string, string> } | null = null
  if (o.mode === 'run' && needsCheck(program)) {
    const check = await pass(program, o.code, 'check', o, silentRunUI, signal, null)
    if (signal.aborted) return empty('stopped', errorInfo(new ScriptError('stopped')))
    const items = check.host.confirmItems
    // a script that asks the person first (ask, choose …) may do other things than the check saw:
    // then each of them is asked when it comes (with "Allow all" for the rest of its kind)
    if (!check.error && items.length && !check.host.usedDialogs) {
      const keys = await ui.confirmPlan(items, o.name ?? '', signal)
      if (!keys) return empty('cancelled')
      approved = { keys, labels: new Map(items.map((i) => [i.key, i.label])) }
    }
  }

  const main = await pass(program, o.code, o.mode, o, ui, signal, approved, o.onLog)
  const { host } = main
  let status: RunResult['status'] = 'ok'
  let error: ErrorInfo | null = null
  if (main.error) {
    error = errorInfo(main.error)
    status = error.code === 'stopped' ? 'stopped' : 'error'
  }
  let table: ResultTable | null = null
  let text = ''
  if (!main.error) {
    text = inspect(main.value)
    if (o.mode === 'query' && o.table !== false) {
      try {
        table = await tabulate(main.value, main.interp.contextFor('result'))
      } catch (e) {
        error = errorInfo(e)
        status = 'error'
      }
    }
  }
  const ms = Date.now() - t0

  let run: ScriptRun | null = null
  const record = o.record ?? (!!o.scriptId && (o.mode === 'run' || o.mode === 'dry'))
  if (record && o.scriptId && (o.mode === 'run' || o.mode === 'dry')) {
    const undo = o.mode === 'run' ? undoData(host) : null
    run = {
      id: newId(),
      scriptId: o.scriptId,
      name: o.name ?? '',
      scope: scriptScope(),
      at: t0,
      ms,
      mode: o.mode,
      status,
      log: host.log,
      changes: host.changes,
      effects: host.effects,
      error,
      hash: await codeHash(o.code),
    }
    if (undo) {
      undoMemory.set(run.id, undo)
      run.undo = JSON.stringify(undo).length <= UNDO_STORE_MAX ? undo : null
    }
    void putScriptRun(run)
  }
  return { status, value: main.value, plain: main.error ? null : toPlain(main.value), text, table, log: host.log, changes: host.changes, effects: host.effects, error, ms, run }
}

/** Whether a run can still be undone in this tab or from its stored copy. */
export const canUndo = (run: ScriptRun): boolean => run.mode === 'run' && !run.undone && (undoMemory.has(run.id) || !!run.undo)

/**
 * Undo a run: pages it created go to the trash, every field it changed on other pages (title, icon,
 * content, properties, trash state) goes back to how it was before the run.
 */
export async function undoRun(run: ScriptRun): Promise<boolean> {
  const undo = undoMemory.get(run.id) ?? run.undo
  if (!undo || run.undone) return false
  const s = useWorkspace.getState()
  for (const [id, fields] of Object.entries(undo.fields)) {
    const before = undo.before[id]
    const cur = useWorkspace.getState().pages[id]
    if (!cur) continue
    if (before === null || fields.includes('created')) {
      if (!cur.trashed) s.trashPage(id)
      continue
    }
    if (fields.includes('title') || fields.includes('icon')) s.updatePage(id, { ...(fields.includes('title') ? { title: before.title } : {}), ...(fields.includes('icon') ? { icon: before.icon } : {}) })
    if (fields.includes('content')) s.setContent(id, before.content, SCRIPT_ORIGIN)
    for (const f of fields) if (f.startsWith('props:')) s.setRowProperty(id, f.slice(6), before.properties[f.slice(6)] ?? null)
    if (fields.includes('trashed')) {
      if (before.trashed) s.trashPage(id)
      else s.restorePage(id)
    }
  }
  undoMemory.delete(run.id)
  await putScriptRun({ ...run, undone: true, undo: null })
  return true
}

/**
 * Evaluate a selection of a script (Mod+E): the script's top-level `let` / `fn` statements before it
 * run first (read-only), then the selected expression.
 */
export async function evaluateSelection(code: string, from: number, to: number, o: Omit<RunOptions, 'code' | 'mode'> = {}): Promise<RunResult> {
  const sel = code.slice(from, to)
  let prefix = ''
  try {
    const program = parse(code)
    const lets = program.body.filter((st) => (st.type === 'Let' || st.type === 'FnDecl') && st.pos.end <= from)
    prefix = lets.map((st) => code.slice(st.pos.start, st.pos.end)).join('\n')
  } catch {
    prefix = ''
  }
  // a single expression stands on its own line after the definitions
  return runScript({ ...o, code: `${prefix}${prefix ? '\n' : ''}${sel.trim()}`, mode: 'query', record: false })
}

