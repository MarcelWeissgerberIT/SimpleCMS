/**
 * Function registry: built-ins (functions/*.ts) and the workspace's custom functions. Name lookups
 * go through Maps (no prototype chain: a function named "CONSTRUCTOR" or "__PROTO__" is just a
 * missing key).
 */
import type { CustomFunction } from '../../../store/types'
import type { FnCtx, FnSpec, Value } from './types'
import { err } from './values'

const builtins = new Map<string, FnSpec>()
let customs = new Map<string, FnSpec>()
let version = 0
const listeners = new Set<() => void>()

/** Custom functions run through the evaluator (bound by evaluate.ts — avoids an import cycle). */
type Invoker = (fn: CustomFunction, args: Value[], ctx: FnCtx) => Value
let invoker: Invoker | null = null
export function bindCustomInvoker(fn: Invoker): void {
  invoker = fn
}

const NAME_RE = /^[A-Z][A-Z0-9_.]{0,31}$/
const CUSTOM_NAME_RE = /^[A-Z][A-Z0-9_]{1,31}$/

function bump() {
  version++
  for (const l of listeners) l()
}

/** Register built-in functions (replaces a built-in of the same name). */
export function registerFunctions(specs: FnSpec[]): void {
  for (const s of specs) {
    const name = s.name.toUpperCase()
    if (!NAME_RE.test(name)) continue
    builtins.set(name, { ...s, name })
    customs.delete(name)
  }
  bump()
}

export const isBuiltin = (name: string): boolean => builtins.has(name.toUpperCase())

/** A built-in or custom function by name (case-insensitive); null when unknown. */
export function getFunction(name: string): FnSpec | null {
  const n = name.toUpperCase()
  return builtins.get(n) ?? customs.get(n) ?? null
}

/** Every function: built-ins first (registration order), then custom ones by name. */
export function listFunctions(): FnSpec[] {
  return [...builtins.values(), ...[...customs.values()].sort((a, b) => a.name.localeCompare(b.name))]
}

function customSpec(fn: CustomFunction): FnSpec {
  const desc = fn.description ?? ''
  return {
    name: fn.name,
    category: 'custom',
    minArgs: fn.params.length,
    maxArgs: fn.params.length,
    args: fn.params.map((p) => ({ name: p.name, type: p.type === 'range' ? 'dataset' : p.type === 'any' ? 'any' : p.type })),
    description: { en: desc, de: desc },
    example: `=${fn.name}(${fn.params.map((p) => p.name).join('; ')})`,
    impl: (args, ctx) => (invoker ? invoker(fn, args, ctx) : err('#NAME?', `${fn.name} is not available`)),
    custom: fn,
  }
}

/**
 * Replace the set of custom functions. Names must be UPPER_SNAKE and may not shadow a built-in
 * (those entries are skipped); later duplicates of a name are skipped too.
 */
export function setCustomFunctions(list: CustomFunction[]): void {
  const next = new Map<string, FnSpec>()
  for (const fn of list) {
    if (!fn || typeof fn.name !== 'string') continue
    const name = fn.name.toUpperCase()
    if (!CUSTOM_NAME_RE.test(name) || builtins.has(name) || next.has(name)) continue
    next.set(name, customSpec({ ...fn, name }))
  }
  customs = next
  bump()
}

/** Changes whenever the function set changes (workbooks recalculate). */
export const registryVersion = (): number => version

export function subscribeRegistry(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
