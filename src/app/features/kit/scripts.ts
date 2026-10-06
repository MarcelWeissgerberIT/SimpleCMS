/**
 * Building blocks — running an own property type's script bindings. Only through the One Script runtime
 * (features/script: runScript in query / dry / run mode; never eval). Names the code sees: `value` (the
 * value being shown / checked / written, read like `row.<Prop>`), `old` (onChange: the value before),
 * `row` (the row; page.current too).
 *
 * Team workspaces: a binding runs only in a version this device saved or confirmed (SHA-256 of the code,
 * features/script's trust store) — never trusting `updatedBy`. Until then cells show the stored value and
 * a review chip. Value and onChange scripts of a SHARED row see shared pages only.
 */
import { create } from 'zustand'
import { useWorkspace } from '../../store/store'
import type { CustomPropScripts, CustomPropType, ID, Page, PropertyDef, PropertyValue } from '../../store/types'
import { t } from '../../i18n'
import { errorMessage, isScriptTrusted, runScript, scriptsInTeam, silentRunUI, appRunUI, trustScriptCode, type RunResult, type RunUI, type RunVar } from '../script'

export type BindingKey = keyof CustomPropScripts
export const BINDING_KEYS: BindingKey[] = ['value', 'validate', 'options', 'format', 'onChange']

/** The bindings a base offers (options only for select / multi-select). */
export const bindingsFor = (type: Pick<CustomPropType, 'base'>): BindingKey[] => BINDING_KEYS.filter((k) => k !== 'options' || type.base === 'select' || type.base === 'multi_select')

/** Bindings that only read (query mode) — every one but onChange. */
const QUERY_LIMITS = { ms: 3_000, steps: 400_000 }

/* ------------------------------------------------------------------ trust (team workspaces) */

/** code → trusted on this device (checked once per code; absent = not checked yet). */
export const useKitTrust = create<{ ok: Record<string, boolean> }>()(() => ({ ok: {} }))

const checking = new Set<string>()

/** Whether this device may run the code now (team: saved or confirmed here). Remembered per code. */
export async function isCodeTrusted(code: string): Promise<boolean> {
  const known = useKitTrust.getState().ok[code]
  if (known !== undefined) return known
  const ok = await isScriptTrusted({ code })
  useKitTrust.setState((s) => ({ ok: { ...s.ok, [code]: ok } }))
  return ok
}

/** The trust of a code right now (undefined: not checked yet — a check starts). */
export function trustNow(code: string): boolean | undefined {
  if (!scriptsInTeam()) return true
  const known = useKitTrust.getState().ok[code]
  if (known === undefined && !checking.has(code)) {
    checking.add(code)
    void isCodeTrusted(code).finally(() => checking.delete(code))
  }
  return known
}

/** The bindings of a type this device has not saved or confirmed (team workspaces; [] elsewhere). */
export function untrustedOf(type: CustomPropType | null | undefined): BindingKey[] {
  if (!type?.scripts || !scriptsInTeam()) return []
  return BINDING_KEYS.filter((k) => {
    const code = type.scripts?.[k]
    return !!code && trustNow(code) === false
  })
}

/** Remember every binding of the type as saved / confirmed here (saving in the editor, Confirm). */
export async function trustType(type: Pick<CustomPropType, 'scripts'>): Promise<void> {
  const codes = BINDING_KEYS.map((k) => type.scripts?.[k]).filter((c): c is string => !!c)
  await Promise.all(codes.map((c) => trustScriptCode(c)))
  useKitTrust.setState((s) => ({ ok: { ...s.ok, ...Object.fromEntries(codes.map((c) => [c, true])) } }))
}

/** Who saved the type last (team: a member's name), for "Scripts changed by …". */
export function editorName(type: CustomPropType): string | null {
  if (!type.updatedBy) return null
  return useWorkspace.getState().people.find((p) => p.id === type.updatedBy)?.name ?? null
}

/* ------------------------------------------------------------------ running */

/** Script runs of cells at the same time (a long table must not start hundreds at once). */
const MAX_PARALLEL = 4
let running = 0
const waiting: Array<() => void> = []

async function slot<T>(job: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((r) => waiting.push(r))
  running++
  try {
    return await job()
  } finally {
    running--
    waiting.shift()?.()
  }
}

/** Shared rows of a team workspace: the code sees shared pages only (no private page leaks into them). */
function scopeFor(row: Page): ((id: ID) => boolean) | null {
  if (!scriptsInTeam() || row.private) return null
  return (id) => !useWorkspace.getState().pages[id]?.private
}

export interface BindingContext {
  row: Page
  prop: PropertyDef
  /** the value being shown / checked / written (stored shape) */
  value?: PropertyValue
  /** onChange: the value before */
  old?: PropertyValue
  /** the editor's tester: a value typed in (JSON) instead of a stored one */
  valuePlain?: unknown
}

export interface BindingRun {
  ok: boolean
  /** the result as JSON (dates as ISO text, rows { id, title }, people { id, name }) */
  plain: unknown
  /** the result as text */
  text: string
  /** the error in the UI language (with its line) */
  error: string | null
  result: RunResult
}

export interface RunBindingOptions {
  mode?: 'query' | 'dry' | 'run'
  signal?: AbortSignal
  ui?: RunUI
  /** run even though this device has not confirmed the code (the editor's tester, the person's own draft) */
  trusted?: boolean
}

/** The text of a failed run, in the UI language. */
export function runError(r: Pick<RunResult, 'error' | 'status'>): string {
  if (!r.error) return r.status === 'cancelled' ? t('features.kit.script.cancelled') : t('features.kit.script.failed')
  const msg = errorMessage(r.error, t)
  return r.error.line ? t('features.kit.script.atLine', { line: r.error.line, msg }) : msg
}

/**
 * Run one binding of an own type for a row. Null: the type has no such binding; 'untrusted': a team
 * version this device did not save or confirm (nothing ran).
 */
export async function runBinding(type: CustomPropType, key: BindingKey, ctx: BindingContext, o: RunBindingOptions = {}): Promise<BindingRun | 'untrusted' | null> {
  const code = type.scripts?.[key]
  if (!code?.trim()) return null
  return runCode(code, type.name, key, ctx, o)
}

/** Run code as a binding (the editor's tester runs the draft through this). */
export async function runCode(code: string, name: string, key: BindingKey, ctx: BindingContext, o: RunBindingOptions = {}): Promise<BindingRun | 'untrusted'> {
  if (!o.trusted && !(await isCodeTrusted(code))) return 'untrusted'
  const mode = o.mode ?? (key === 'onChange' ? 'run' : 'query')
  const vars: Record<string, RunVar> = { row: { page: ctx.row.id } }
  vars.value = ctx.valuePlain !== undefined ? { plain: ctx.valuePlain } : { prop: ctx.prop.id, row: ctx.row.id, raw: ctx.value === undefined ? (ctx.row.properties[ctx.prop.id] ?? null) : ctx.value }
  if (key === 'onChange') vars.old = { prop: ctx.prop.id, row: ctx.row.id, raw: ctx.old ?? null }
  const scope = key === 'value' || key === 'onChange' ? scopeFor(ctx.row) : null
  const go = () =>
    runScript({
      code,
      mode,
      name: `${name} · ${t(`features.kit.binding.${key}`)}`,
      contextPageId: ctx.row.id,
      vars,
      record: false,
      // the person runs it (or confirmed it above): the runtime asks nothing more about the version
      trusted: true,
      ui: o.ui ?? (mode === 'run' ? appRunUI : silentRunUI),
      signal: o.signal,
      scope,
      table: false,
      limits: mode === 'query' ? QUERY_LIMITS : undefined,
    })
  const result = mode === 'query' ? await slot(go) : await go()
  const ok = result.status === 'ok'
  return { ok, plain: ok ? result.plain : null, text: ok ? result.text : '', error: ok ? null : runError(result), result }
}

/* ------------------------------------------------------------------ what a binding's answer means */

/** validate: true / null = fine, a text = refused with it, false = refused. Returns the refusal or null. */
export function refusalOf(plain: unknown): string | null {
  if (plain === true || plain === null || plain === undefined) return null
  if (typeof plain === 'string') return plain.trim() ? plain.trim().slice(0, 300) : null
  if (plain === false) return t('features.kit.validate.refused')
  return null
}

export interface ScriptOption {
  name: string
  color?: string
}

/** options: a list of texts or { name, color } records. */
export function optionsOf(plain: unknown): ScriptOption[] {
  const list = Array.isArray(plain) ? plain : []
  const out: ScriptOption[] = []
  const seen = new Set<string>()
  for (const x of list.slice(0, 500)) {
    const name = typeof x === 'string' || typeof x === 'number' ? String(x) : x && typeof x === 'object' ? String((x as Record<string, unknown>).name ?? (x as Record<string, unknown>).title ?? '') : ''
    const n = name.replace(/\s+/g, ' ').trim().slice(0, 200)
    if (!n || seen.has(n.toLowerCase())) continue
    seen.add(n.toLowerCase())
    const color = x && typeof x === 'object' && typeof (x as Record<string, unknown>).color === 'string' ? ((x as Record<string, unknown>).color as string) : undefined
    out.push(color ? { name: n, color } : { name: n })
  }
  return out
}

/** format: the text to show (records / lists as their text). */
export function formatOf(r: BindingRun): string {
  if (typeof r.plain === 'string') return r.plain.slice(0, 500)
  if (r.plain === null || r.plain === undefined) return ''
  return r.text.slice(0, 500)
}
