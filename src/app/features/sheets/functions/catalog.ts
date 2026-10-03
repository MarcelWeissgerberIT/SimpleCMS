/**
 * What a `call` node may name, as the builder sees it: the spreadsheet engine's built-ins (minus
 * DS — a body has no cells, parameters bring the data in), the operators (shown as keys) and the
 * workspace's other custom functions.
 */
import type { CustomFunction, ID } from '../../../store/types'
import { FN_OPERATORS } from '../../../store/functions'
import { customSpec, type CallSpec, type SpecLookup } from './model'

/** Key face and spoken name (functions.op.<id>) of each operator. */
export const OPERATOR_KEYS: Record<(typeof FN_OPERATORS)[number], { key: string; id: string }> = {
  '+': { key: '+', id: 'plus' },
  '-': { key: '−', id: 'minus' },
  '*': { key: '×', id: 'times' },
  '/': { key: '÷', id: 'divide' },
  '^': { key: '^', id: 'power' },
  '&': { key: '&', id: 'concat' },
  '=': { key: '=', id: 'eq' },
  '<>': { key: '≠', id: 'ne' },
  '<': { key: '<', id: 'lt' },
  '<=': { key: '≤', id: 'le' },
  '>': { key: '>', id: 'gt' },
  '>=': { key: '≥', id: 'ge' },
}

export const OPERATOR_SPECS: CallSpec[] = FN_OPERATORS.map((op) => ({
  name: op,
  kind: 'operator',
  category: 'operator',
  minArgs: 2,
  maxArgs: 2,
  args: op === '&' ? [{ name: 'a', type: 'text' }, { name: 'b', type: 'text' }] : ['+', '-', '*', '/', '^'].includes(op) ? [{ name: 'a', type: 'number' }, { name: 'b', type: 'number' }] : [{ name: 'a' }, { name: 'b' }],
}))

/** Built-ins the picker never offers inside a body. */
const NOT_IN_BODIES = new Set(['DS'])

export interface Catalog {
  builtins: CallSpec[]
  operators: CallSpec[]
  customs: CallSpec[]
  lookup: SpecLookup
  isBuiltin: (name: string) => boolean
}

export function makeCatalog(builtins: CallSpec[], functions: Record<ID, CustomFunction> | undefined, exceptId?: ID): Catalog {
  const offered = builtins.filter((b) => !NOT_IN_BODIES.has(b.name) && b.category !== 'data')
  const customs = Object.values(functions ?? {})
    .filter((f) => f.id !== exceptId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(customSpec)
  const map = new Map<string, CallSpec>()
  for (const s of [...builtins, ...OPERATOR_SPECS, ...customs]) map.set(s.name, s)
  const builtinNames = new Set(builtins.map((b) => b.name))
  return {
    builtins: offered,
    operators: OPERATOR_SPECS,
    customs,
    lookup: (name) => map.get(name),
    isBuiltin: (name) => builtinNames.has(name),
  }
}

/** Categories in the order the picker lists them. */
export const CATEGORY_ORDER = ['math', 'stats', 'logic', 'text', 'date', 'lookup', 'info']
