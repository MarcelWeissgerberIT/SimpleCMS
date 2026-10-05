/**
 * One Script for tools (model-facing English): the AI terminal's run_query / write_script, custom
 * agents' run_query and the MCP tools one_run_query / one_run_script. A query runs read-only (mode
 * 'query': writes, effects and dialogs refused) and answers rows as JSON, capped; code Claude wrote is
 * parsed before anyone sees it. Light: the interpreter loads on the first call.
 */
import { useWorkspace } from '../../../store/store'
import type { ID, OneScript } from '../../../store/types'
import type { RunResult } from '../runtime/run'
import type { ChangeItem, ConfirmItem, EffectItem, ErrorInfo, LogLine, ResultTable, RunUI } from '../runtime/types'

/** Rows of a query answer (the rest is counted, not sent). */
export const TOOL_ROWS_MAX = 100
/** Characters of a script Claude may write. */
export const TOOL_CODE_MAX = 20_000

/** An error of a run as English text ("3:5 Unknown name Statu."). */
export async function errorTextOf(info: Pick<ErrorInfo, 'code' | 'params' | 'line' | 'col'>): Promise<string> {
  const { ERROR_TEXT_EN } = await import('../lang/errors')
  const tpl = (ERROR_TEXT_EN as Record<string, string>)[info.code] ?? info.code
  const text = tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in info.params ? String(info.params[k]) : m))
  return info.line ? `${info.line}:${info.col ?? 1} ${text}` : text
}

/** The syntax error of code as English text, or null when it parses. */
export async function syntaxErrorText(code: string): Promise<string | null> {
  const { syntaxError } = await import('../lang/parser')
  const e = syntaxError(code)
  if (!e) return null
  return errorTextOf({ code: e.code, params: e.params, line: e.pos?.line ?? null, col: e.pos?.col ?? null })
}

const cellText = (c: ResultTable['rows'][number]['cells'][number]) => (typeof c === 'string' ? c : c.text)

/** A result table as JSON rows: { id?, <column>: text }. */
function rowsOf(table: ResultTable, max: number): Array<Record<string, string>> {
  return table.rows.slice(0, max).map((r) => {
    const row: Record<string, string> = r.pageId ? { id: r.pageId } : {}
    table.columns.forEach((col, i) => {
      // a column named "id" never hides the row's own id
      row[col === 'id' && r.pageId ? 'id ' : col] = cellText(r.cells[i] ?? '')
    })
    return row
  })
}

export interface QueryAnswer {
  ok: true
  /** rows in the answer: a table result */
  count?: number
  columns?: string[]
  rows?: Array<Record<string, string>>
  /** more rows than the answer carries */
  truncated?: boolean
  /** a single value (a number, a text, a record …) */
  value?: unknown
  ms: number
}

export type QueryOutcome = QueryAnswer | { ok: false; error: string }

/**
 * Run code read-only and answer its result as JSON: a table (queries, lists of rows / records) as
 * rows, anything else as its plain value. `scope`: only these pages are reachable (custom agents).
 */
export async function runQueryForTool(code: string, o: { scope?: ((id: ID) => boolean) | null; maxRows?: number; signal?: AbortSignal; contextPageId?: ID | null } = {}): Promise<QueryOutcome> {
  const src = code.trim()
  if (!src) return { ok: false, error: 'Empty query: pass One Script code, e.g. db("Tasks").where(Status = "Open").' }
  if (src.length > TOOL_CODE_MAX) return { ok: false, error: `The query is too long (${src.length} characters, at most ${TOOL_CODE_MAX}).` }
  const syntax = await syntaxErrorText(src)
  if (syntax) return { ok: false, error: `Syntax error: ${syntax}` }
  const { runScript } = await import('../runtime/run')
  const r: RunResult = await runScript({ code: src, mode: 'query', record: false, signal: o.signal, scope: o.scope ?? null, contextPageId: o.contextPageId ?? null, limits: { ms: 15_000 } })
  if (r.status !== 'ok' || r.error) return { ok: false, error: r.error ? await errorTextOf(r.error) : `The query ended: ${r.status}.` }
  const max = Math.max(1, Math.min(TOOL_ROWS_MAX, o.maxRows ?? TOOL_ROWS_MAX))
  if (r.table) {
    const rows = rowsOf(r.table, max)
    return { ok: true, count: r.table.total, columns: r.table.columns, rows, ...(r.table.total > rows.length ? { truncated: true } : {}), ms: r.ms }
  }
  return { ok: true, value: r.plain, ms: r.ms }
}

/** A saved script by id, else by exact name (any case); null when none or ambiguous. */
export function findScript(ref: string): { script: OneScript } | { error: string } {
  const all = Object.values(useWorkspace.getState().scripts ?? {})
  const key = ref.trim()
  if (!key) return { error: 'Pass the script\'s id or name.' }
  const byId = all.find((s) => s.id === key)
  if (byId) return { script: byId }
  const n = key.toLowerCase()
  const named = all.filter((s) => s.name.trim().toLowerCase() === n)
  if (named.length === 1) return { script: named[0] }
  const list = all
    .slice(0, 30)
    .map((s) => `${JSON.stringify(s.name)} (id: ${s.id}, ${s.kind})`)
    .join('; ')
  if (named.length > 1) return { error: `${named.length} scripts are named ${JSON.stringify(key)}: pass the id. Scripts: ${list}.` }
  return { error: `No script ${JSON.stringify(key)}. ${all.length ? `Scripts: ${list}.` : 'This workspace has no scripts yet.'}` }
}

/* ------------------------------------------------------------------ a run the person approved elsewhere */

/**
 * The things of a dry run that a run asks for (effects, the trash) as `kind#n` keys with their labels —
 * the same keys and labels the run's own list uses (runtime/host.ts `allow`).
 */
export function plannedItems(r: Pick<RunResult, 'changes' | 'effects'>): Array<{ key: string; kind: ConfirmItem['kind']; label: string }> {
  const out: Array<{ key: string; kind: ConfirmItem['kind']; label: string }> = r.effects.map((e) => ({ key: e.key, kind: e.kind, label: e.label }))
  let n = 0
  for (const c of r.changes) if (c.kind === 'trash') out.push({ key: `trash#${++n}`, kind: 'trash', label: c.title.trim() || '—' })
  return out
}

/**
 * The app's dialogs — except the list before a run, when the person already approved exactly that list
 * elsewhere (the MCP approval card showed the dry run): then it is not asked again. Anything else (a web
 * request — off unless ticked —, a list that differs from the dry run, one more effect during the run,
 * the script's own questions) is asked in the app as usual.
 */
export function preApprovedUI(base: RunUI, approved: Array<{ key: string; label: string }>): RunUI {
  const seen = new Map(approved.map((i) => [i.key, i.label]))
  return {
    ...base,
    confirmPlan: (items, scriptName, signal) => {
      const same = items.every((i) => i.kind !== 'http' && seen.get(i.key) === i.label)
      return same ? Promise.resolve(new Set(items.map((i) => i.key))) : base.confirmPlan(items, scriptName, signal)
    },
  }
}

/* ------------------------------------------------------------------ what a run did, as JSON */

const dbTitle = (dbId: ID | null) => (dbId ? useWorkspace.getState().pages[dbId]?.title.trim() || 'Untitled' : null)

function changeJson(c: ChangeItem): Record<string, unknown> {
  const db = dbTitle(c.dbId)
  return {
    kind: c.kind,
    ...(c.pageId.startsWith('draft-') ? {} : { id: c.pageId }),
    title: c.title.trim() || 'Untitled',
    ...(db ? { database: db } : {}),
    ...(c.props?.length ? { properties: c.props.map((p) => ({ name: p.name, before: p.before, after: p.after })) } : {}),
    ...(c.how ? { content: c.how } : {}),
    ...(c.skipped ? { skipped: true } : {}),
  }
}

const effectJson = (e: EffectItem) => ({ kind: e.kind, label: e.label, status: e.status, ...(e.detail ? { detail: e.detail } : {}) })
const lineJson = (l: LogLine) => `${l.kind === 'print' ? '' : `${l.kind}: `}${l.text}`

/**
 * A run or dry run for a tool answer: status, what it changed (or would change), its effects, the lines
 * it printed and its result — capped so one answer stays small.
 */
export async function runReport(r: RunResult, mode: 'run' | 'dry'): Promise<Record<string, unknown>> {
  const result = r.plain === undefined || r.plain === null ? null : JSON.stringify(r.plain).length > 8000 ? `${r.text.slice(0, 8000)}…` : r.plain
  return {
    mode,
    status: r.status,
    ...(r.error ? { error: await errorTextOf(r.error) } : {}),
    changes: r.changes.slice(0, 100).map(changeJson),
    ...(r.changes.length > 100 ? { moreChanges: r.changes.length - 100 } : {}),
    effects: r.effects.map(effectJson),
    printed: r.log.slice(0, 60).map(lineJson),
    result,
    ms: r.ms,
  }
}

/** The workspace's scripts for a tool answer (id, name, kind, description). */
export function scriptList(): Array<{ id: ID; name: string; kind: 'script' | 'query'; description?: string }> {
  return Object.values(useWorkspace.getState().scripts ?? {})
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({ id: s.id, name: s.name, kind: s.kind, ...(s.description ? { description: s.description } : {}) }))
}
