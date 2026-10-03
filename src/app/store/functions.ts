/**
 * Custom functions (Workspace.functions): the shape rules, and the sanitizer every copy from
 * outside this tab goes through — stored records, backups, the team meta document. A function is
 * data (an expression tree), never code; this keeps it small and plain: bounded sizes, known keys
 * only, fresh objects (nothing of the input's prototype chain survives).
 */
import type { CustomFunction, FnExpr, FnParam, FnParamType, ID } from './types'

/** UPPER_SNAKE, 2–32 characters. */
export const FN_NAME_RE = /^[A-Z][A-Z0-9_]{1,31}$/
/** lower_snake, 1–32 characters. */
export const PARAM_NAME_RE = /^[a-z][a-z0-9_]{0,31}$/
/** What a `call` node may name: an operator, or a function (built-ins may carry a dot: STDEV.S). */
export const FN_OPERATORS = ['+', '-', '*', '/', '^', '&', '=', '<>', '<', '<=', '>', '>='] as const
const CALL_NAME_RE = /^[A-Z][A-Z0-9_.]{0,31}$/
export const FN_PARAM_TYPES: FnParamType[] = ['number', 'text', 'date', 'bool', 'range', 'any']

export const FN_LIMITS = {
  /** parameters per function */
  params: 16,
  /** nodes per body */
  nodes: 2000,
  /** nesting depth of a body */
  depth: 64,
  /** text literal length */
  str: 32_000,
  description: 2000,
  /** functions per workspace */
  functions: 500,
} as const

const SAFE_ID = /^[\w-]{1,64}$/
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined)

export const isSafeFunctionId = (id: unknown): id is ID => typeof id === 'string' && SAFE_ID.test(id) && !RESERVED_KEYS.has(id)
export const isOperator = (fn: string): boolean => (FN_OPERATORS as readonly string[]).includes(fn)

/** A clean copy of an expression tree, or null when anything in it is not a valid node. */
export function sanitizeExpr(raw: unknown): FnExpr | null {
  let nodes = 0
  const walk = (v: unknown, depth: number): FnExpr | null => {
    if (!isObj(v) || depth > FN_LIMITS.depth || ++nodes > FN_LIMITS.nodes) return null
    const k = own(v, 'k')
    if (k === 'num') {
      const n = own(v, 'v')
      return typeof n === 'number' && Number.isFinite(n) ? { k: 'num', v: n } : null
    }
    if (k === 'str') {
      const s = own(v, 'v')
      return typeof s === 'string' && s.length <= FN_LIMITS.str ? { k: 'str', v: s } : null
    }
    if (k === 'bool') {
      const b = own(v, 'v')
      return typeof b === 'boolean' ? { k: 'bool', v: b } : null
    }
    if (k === 'param') {
      const name = own(v, 'name')
      return typeof name === 'string' && PARAM_NAME_RE.test(name) ? { k: 'param', name } : null
    }
    if (k === 'call') {
      const fn = own(v, 'fn')
      const args = own(v, 'args')
      if (typeof fn !== 'string' || !(isOperator(fn) || CALL_NAME_RE.test(fn)) || !Array.isArray(args) || args.length > 255) return null
      const out: FnExpr[] = []
      for (const a of args) {
        const c = walk(a, depth + 1)
        if (!c) return null
        out.push(c)
      }
      return { k: 'call', fn, args: out }
    }
    return null
  }
  return walk(raw, 1)
}

function sanitizeParams(raw: unknown): FnParam[] | null {
  if (!Array.isArray(raw) || raw.length > FN_LIMITS.params) return null
  const seen = new Set<string>()
  const out: FnParam[] = []
  for (const p of raw) {
    if (!isObj(p)) return null
    const name = own(p, 'name')
    const type = own(p, 'type')
    if (typeof name !== 'string' || !PARAM_NAME_RE.test(name) || seen.has(name)) return null
    seen.add(name)
    const param: FnParam = { name, type: FN_PARAM_TYPES.includes(type as FnParamType) ? (type as FnParamType) : 'any' }
    const d = own(p, 'description')
    if (typeof d === 'string' && d) param.description = d.slice(0, FN_LIMITS.description)
    out.push(param)
  }
  return out
}

/** A clean copy of a custom function, or null when it is not one. `id`: the key it was stored under. */
export function sanitizeFunction(id: unknown, raw: unknown): CustomFunction | null {
  if (!isObj(raw) || !isSafeFunctionId(id) || own(raw, 'id') !== id) return null
  const name = own(raw, 'name')
  if (typeof name !== 'string' || !FN_NAME_RE.test(name)) return null
  const params = sanitizeParams(own(raw, 'params'))
  const body = sanitizeExpr(own(raw, 'body'))
  if (!params || !body) return null
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  const createdAt = num(own(raw, 'createdAt'), 0)
  const fn: CustomFunction = { id, name, params, body, createdAt, updatedAt: num(own(raw, 'updatedAt'), createdAt) }
  const d = own(raw, 'description')
  if (typeof d === 'string' && d) fn.description = d.slice(0, FN_LIMITS.description)
  return fn
}

/** Every valid function of a stored / imported map (`dropped`: entries that were not valid). */
export function sanitizeFunctions(raw: unknown): { functions: Record<ID, CustomFunction>; dropped: number } {
  const functions: Record<ID, CustomFunction> = {}
  let dropped = 0
  if (raw === undefined || raw === null) return { functions, dropped }
  if (!isObj(raw)) return { functions, dropped: 1 }
  for (const id of Object.keys(raw)) {
    const fn = Object.keys(functions).length < FN_LIMITS.functions ? sanitizeFunction(id, own(raw, id)) : null
    if (fn) functions[id] = fn
    else dropped++
  }
  return { functions, dropped }
}
