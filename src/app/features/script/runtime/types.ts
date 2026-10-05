/**
 * One Script runtime — shared types: run modes, the console, what a run changed or would change,
 * effects, the result table, the run record and the dialogs a run needs from the person.
 */
import type { ID, Page } from '../../../store/types'

/**
 * - run: writes through the store, effects after the person confirmed them
 * - dry: reads for real, records every write and effect, executes none ("Probelauf")
 * - query: read-only (the live query tester, tools): writes, effects and dialogs are refused
 * - check: the silent pass before a run that lists what will happen (dialogs answer their defaults)
 */
export type RunMode = 'run' | 'dry' | 'query' | 'check'

export type Cell = string | { text: string; pageId: ID }

export interface ResultTable {
  columns: string[]
  rows: Array<{ pageId: ID | null; cells: Cell[] }>
  /** rows before the table was cut (it shows at most TABLE_MAX) */
  total: number
}

export interface LogLine {
  kind: 'print' | 'log' | 'info' | 'warn' | 'error' | 'effect'
  text: string
  /** where in the script (1-based) */
  line?: number
  /** ms since the run started */
  at: number
  table?: ResultTable
}

export interface PropDiff {
  name: string
  before: string
  after: string
}

/** A write of a run (done in a run, planned in a dry run). */
export interface ChangeItem {
  kind: 'set' | 'content' | 'create' | 'trash'
  pageId: ID
  title: string
  /** the database of a row (its name is looked up when shown) */
  dbId: ID | null
  parentId?: ID | null
  props?: PropDiff[]
  /** content: how the page body changed */
  how?: 'append' | 'prepend' | 'replace'
  /** the person unticked it (trash) */
  skipped?: boolean
}

export type EffectKind = 'mail' | 'claude' | 'http'

export interface EffectItem {
  kind: EffectKind
  /** kind#n — the n-th call of that kind in the run */
  key: string
  /** one line: "to anna@… · Daten" */
  label: string
  status: 'planned' | 'done' | 'skipped' | 'failed'
  detail?: string
}

/** One entry of the list the person confirms before a run (things that leave One or go to the trash). */
export interface ConfirmItem {
  key: string
  kind: EffectKind | 'trash'
  label: string
  /** ticked at first (http: not — it is refused unless allowed) */
  on: boolean
}

export interface ErrorInfo {
  code: string
  params: Record<string, string | number>
  line: number | null
  col: number | null
  start: number | null
  end: number | null
}

/** What undoing a run needs: every page it touched as it was before (null = it created the page). */
export interface UndoData {
  before: Record<ID, Page | null>
  /** per page: what the run changed (title, icon, content, trashed, props:<propId>) */
  fields: Record<ID, string[]>
}

/** A run as kept in this device's run log (IndexedDB "one-scripts"). */
export interface ScriptRun {
  id: string
  scriptId: ID
  /** the script's name then */
  name: string
  scope: string
  at: number
  ms: number
  mode: 'run' | 'dry'
  status: 'ok' | 'error' | 'stopped' | 'cancelled'
  log: LogLine[]
  changes: ChangeItem[]
  effects: EffectItem[]
  error: ErrorInfo | null
  /** hash of the code that ran */
  hash: string
  undo?: UndoData | null
  undone?: boolean
}

/** What a run needs from the person. The app's dialog host implements it (ui/DialogHost). */
export interface RunUI {
  modal(text: string, buttons: string[], signal: AbortSignal): Promise<string | null>
  confirm(text: string, signal: AbortSignal): Promise<boolean>
  ask(text: string, def: string, signal: AbortSignal): Promise<string | null>
  choose(text: string, options: string[], signal: AbortSignal): Promise<string | null>
  notify(text: string): void
  /** before a run: the things that leave One or go to the trash; resolves the allowed keys (null: cancel the run) */
  confirmPlan(items: ConfirmItem[], scriptName: string, signal: AbortSignal): Promise<Set<string> | null>
  /** during a run: one more such thing that was not on that list ('all': this one and the rest of its kind in this run) */
  allowOne(item: ConfirmItem, scriptName: string, signal: AbortSignal): Promise<boolean | 'all'>
  /** the time budget ran out: another one? */
  moreTime(scriptName: string, signal: AbortSignal): Promise<boolean>
  /** team workspace: a script someone else changed last — run this exact version? */
  trust(info: { name: string; editor: string | null; code: string }, signal: AbortSignal): Promise<boolean>
}
