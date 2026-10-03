/**
 * The builder's bridge to the spreadsheet engine (features/sheets/engine): the built-in catalog,
 * test-bench runs of a draft, and plain values in / out for database formulas.
 */
import { useSyncExternalStore } from 'react'
import type { CustomFunction, FnParam } from '../../../store/types'
import { cellsOf, datasetOf, getFunction, isBuiltin as engineIsBuiltin, isDataset, isErr, isRange, listFunctions, parseNumeric, registryVersion, subscribeRegistry } from '../engine'
import type { CellValue, ErrorCode, FnSpec, Value } from '../engine'
// the bench runs a draft the way a cell runs a saved function: parameters type-checked (callCustom)
import { callCustom, newEnv, LimitError } from '../engine/evaluate'
import { numberText } from '../engine/values'
import type { CallSpec } from './model'

/* ------------------------------------------------------------------ catalog */

let cache: { version: number; list: CallSpec[] } | null = null

const toCallSpec = (s: FnSpec): CallSpec => ({
  name: s.name,
  kind: 'builtin',
  category: s.category,
  minArgs: s.minArgs,
  maxArgs: s.maxArgs,
  args: s.args.map((a) => ({
    name: a.name,
    type: a.type,
    optional: a.optional,
    repeat: a.repeat,
  })),
  description: s.description,
  example: s.example,
})

/** The engine's built-ins (not the custom ones), as call specs. */
export function builtinSpecs(): CallSpec[] {
  const v = registryVersion()
  if (!cache || cache.version !== v)
    cache = {
      version: v,
      list: listFunctions()
        .filter((s) => !s.custom && s.category !== 'custom')
        .map(toCallSpec),
    }
  return cache.list
}

export function useBuiltins(): CallSpec[] {
  useSyncExternalStore(subscribeRegistry, registryVersion)
  return builtinSpecs()
}

export const isBuiltin = (name: string): boolean => engineIsBuiltin(name)

/** A registered custom function by name (case-insensitive). */
export function registeredCustom(name: string): CustomFunction | null {
  return getFunction(name)?.custom ?? null
}

/* ------------------------------------------------------------------ test bench */

export type RunResult =
  | {
      ok: true
      text: string
      kind: 'number' | 'text' | 'bool' | 'empty' | 'dataset'
    }
  | { ok: false; code: ErrorCode; msg?: string }

/** Work allowed per test-bench run (the bench re-runs on every edit). */
const BENCH_STEPS = 250_000

/** "12", "1,5", "2026-10-03", "yes" … → a cell value. */
export function scalarOf(raw: string): CellValue {
  const s = raw.trim()
  if (!s) return null
  const n = parseNumeric(/^[-+]?\d+,\d+$/.test(s) ? s.replace(',', '.') : s)
  if (n !== null) return n
  if (/^(true|wahr|yes|ja)$/i.test(s)) return true
  if (/^(false|falsch|no|nein)$/i.test(s)) return false
  return raw
}

/** "4; 9; 1" (or "4, 9, 1") → the values of a list. */
export function listOf(raw: string): CellValue[] {
  const sep = raw.includes(';') ? ';' : ','
  return raw
    .split(sep)
    .map((x) => x.trim())
    .filter((x) => x !== '')
    .map(scalarOf)
}

export function sampleValue(p: FnParam, raw: string): Value {
  if (p.type === 'range') return datasetOf(listOf(raw))
  if (p.type === 'text') return raw === '' ? null : raw
  return scalarOf(raw)
}

export function display(v: Value): RunResult {
  if (isErr(v)) return { ok: false, code: v.code, msg: v.msg }
  if (isRange(v) || isDataset(v)) {
    const cells = [...cellsOf(v)].slice(0, 51)
    const shown = cells.slice(0, 50).map((c) => (isErr(c) ? c.code : c === null ? '' : typeof c === 'number' ? numberText(c) : typeof c === 'boolean' ? (c ? 'TRUE' : 'FALSE') : c))
    return {
      ok: true,
      kind: 'dataset',
      text: `{${shown.join('; ')}${cells.length > 50 ? '; …' : ''}}`,
    }
  }
  if (v === null) return { ok: true, kind: 'empty', text: '' }
  if (typeof v === 'number') return { ok: true, kind: 'number', text: numberText(v) }
  if (typeof v === 'boolean') return { ok: true, kind: 'bool', text: v ? 'TRUE' : 'FALSE' }
  return { ok: true, kind: 'text', text: v }
}

/**
 * Run a (draft) function with sample inputs. Calls of other functions use the saved versions —
 * so does a recursive call of the function itself.
 */
export function runFunction(fn: CustomFunction, samples: string[], lang: 'en' | 'de'): RunResult {
  const args = fn.params.map((p, i) => sampleValue(p, samples[i] ?? ''))
  try {
    return display(callCustom(fn, args, newEnv({ lang, budget: { left: BENCH_STEPS } })))
  } catch (e) {
    if (e instanceof LimitError) return { ok: false, code: '#NUM!', msg: 'calculation limit reached' }
    return { ok: false, code: '#VALUE!' }
  }
}
