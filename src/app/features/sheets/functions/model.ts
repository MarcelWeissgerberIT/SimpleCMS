/**
 * Custom functions — the builder's pure model: a draft tree (an FnExpr that may still have empty
 * slots), paths into it, the edits the builder offers (fill, replace, wrap, unwrap, delete, add an
 * argument), checks (names, empty slots, unknown calls, type hints, recursion) and the read-only
 * formula preview in spreadsheet syntax. Nothing here runs anything: a function is data.
 */
import type { CustomFunction, FnExpr, FnParam, FnParamType, ID } from '../../../store/types'
import { FN_LIMITS, FN_NAME_RE, PARAM_NAME_RE, isOperator } from '../../../store/functions'

/** An empty slot (only while building — a saved function has none). */
export type Hole = { k: 'hole' }
export type DNode = Exclude<FnExpr, { k: 'call' }> | { k: 'call'; fn: string; args: DNode[] } | Hole
export type CallNode = Extract<DNode, { k: 'call' }>
/** Child indexes from the root ([] = the root). */
export type Path = number[]

export interface Draft {
  id: ID
  name: string
  description: string
  params: FnParam[]
  body: DNode
  createdAt: number
}

/* ------------------------------------------------------------------ call specs */

/** What the builder needs to know about anything a `call` node may name. */
export interface ArgSlot {
  name: string
  /** the engine's argument type ('number', 'text', 'range' …) — used for hints only */
  type?: string
  optional?: boolean
  repeat?: boolean
}

export interface CallSpec {
  name: string
  kind: 'builtin' | 'operator' | 'custom'
  category: string
  minArgs: number
  maxArgs: number | null
  args: ArgSlot[]
  description?: { en: string; de: string } | string
  example?: string
}

export type SpecLookup = (name: string) => CallSpec | undefined

export const HOLE: Hole = { k: 'hole' }
export const isHole = (n: DNode | undefined): n is Hole => !n || n.k === 'hole'

/** The slot an argument index fills (repeating last argument: "number 3"). */
export function slotAt(spec: CallSpec | undefined, i: number): ArgSlot & { label: string } {
  if (!spec) return { name: String(i + 1), label: String(i + 1) }
  const a = spec.args[i]
  if (a) return { ...a, label: a.name }
  const last = spec.args[spec.args.length - 1]
  if (last?.repeat) {
    const base = last.name.replace(/\d+$/, '')
    return { ...last, optional: true, label: `${base}${i + 1}` }
  }
  return { name: String(i + 1), label: String(i + 1), optional: true }
}

/** Can one more argument be added to this call? */
export const canAddArg = (spec: CallSpec | undefined, count: number): boolean =>
  !!spec && (spec.maxArgs === null ? count < 255 : count < spec.maxArgs) && (spec.args.some((a) => a.optional || a.repeat) || spec.maxArgs === null)

/** May the argument at `i` be removed (instead of emptied)? */
export const canRemoveArg = (spec: CallSpec | undefined, count: number, i: number): boolean => !!spec && count > spec.minArgs && i >= spec.minArgs

/* ------------------------------------------------------------------ tree edits */

export function nodeAt(root: DNode, path: Path): DNode | undefined {
  let n: DNode | undefined = root
  for (const i of path) {
    if (!n || n.k !== 'call') return undefined
    n = n.args[i]
  }
  return n
}

export function replaceAt(root: DNode, path: Path, next: DNode): DNode {
  if (!path.length) return next
  if (root.k !== 'call') return root
  const [i, ...rest] = path
  const args = root.args.slice()
  args[i] = replaceAt(args[i] ?? HOLE, rest, next)
  return { ...root, args }
}

/** A call with empty slots for its required arguments. */
export function newCall(spec: CallSpec, first?: DNode): CallNode {
  const n = Math.max(spec.minArgs, first ? 1 : 0, spec.kind === 'operator' ? 2 : 0)
  const args: DNode[] = Array.from({ length: n }, (_, i) => (i === 0 && first ? first : HOLE))
  return { k: 'call', fn: spec.name, args }
}

/** Put a function where a node is: a call keeps its arguments (as many as fit), anything else starts empty. */
export function replaceWithCall(current: DNode | undefined, spec: CallSpec): CallNode {
  if (current?.k === 'call') {
    const max = spec.maxArgs ?? 255
    const args = current.args.slice(0, max)
    while (args.length < Math.max(spec.minArgs, spec.kind === 'operator' ? 2 : 0)) args.push(HOLE)
    return { k: 'call', fn: spec.name, args }
  }
  return newCall(spec)
}

/** Wrap the node at `path` into a call of `spec` (the node becomes its first argument). */
export function wrapAt(root: DNode, path: Path, spec: CallSpec): DNode {
  const cur = nodeAt(root, path) ?? HOLE
  return replaceAt(root, path, newCall(spec, cur))
}

/** Replace a call by its first filled argument (or an empty slot). */
export function unwrapAt(root: DNode, path: Path): DNode {
  const cur = nodeAt(root, path)
  if (!cur || cur.k !== 'call') return root
  const keep = cur.args.find((a) => !isHole(a)) ?? HOLE
  return replaceAt(root, path, keep)
}

/** Delete: an optional argument goes away, anything else becomes an empty slot. */
export function deleteAt(root: DNode, path: Path, lookup: SpecLookup): { root: DNode; removed: boolean } {
  if (!path.length) return { root: HOLE, removed: false }
  const parentPath = path.slice(0, -1)
  const i = path[path.length - 1]
  const parent = nodeAt(root, parentPath)
  if (parent?.k === 'call') {
    const spec = lookup(parent.fn)
    if (isHole(parent.args[i]) && canRemoveArg(spec, parent.args.length, i)) {
      const args = parent.args.filter((_, j) => j !== i)
      return { root: replaceAt(root, parentPath, { ...parent, args }), removed: true }
    }
  }
  return { root: replaceAt(root, path, HOLE), removed: false }
}

export function addArgAt(root: DNode, path: Path): { root: DNode; added: Path } {
  const cur = nodeAt(root, path)
  if (!cur || cur.k !== 'call') return { root, added: path }
  return { root: replaceAt(root, path, { ...cur, args: [...cur.args, HOLE] }), added: [...path, cur.args.length] }
}

export function removeArgAt(root: DNode, path: Path): DNode {
  const parentPath = path.slice(0, -1)
  const parent = nodeAt(root, parentPath)
  if (!parent || parent.k !== 'call') return root
  const i = path[path.length - 1]
  return replaceAt(root, parentPath, { ...parent, args: parent.args.filter((_, j) => j !== i) })
}

/** Every node in reading order (pre-order) with its path and depth. */
export function flatten(root: DNode): Array<{ node: DNode; path: Path }> {
  const out: Array<{ node: DNode; path: Path }> = []
  const walk = (n: DNode, path: Path) => {
    out.push({ node: n, path })
    if (n.k === 'call') n.args.forEach((a, i) => walk(a, [...path, i]))
  }
  walk(root, [])
  return out
}

export const samePath = (a: Path | null | undefined, b: Path | null | undefined): boolean => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i])
export const pathKey = (p: Path): string => (p.length ? p.join('.') : 'root')

export function countNodes(root: DNode): { nodes: number; holes: number; depth: number } {
  let nodes = 0
  let holes = 0
  let depth = 0
  const walk = (n: DNode, d: number) => {
    nodes++
    depth = Math.max(depth, d)
    if (n.k === 'hole') holes++
    if (n.k === 'call') n.args.forEach((a) => walk(a, d + 1))
  }
  walk(root, 1)
  return { nodes, holes, depth }
}

/** Rename (to = string) or empty (to = null) every reference to a parameter. */
export function remapParam(root: DNode, from: string, to: string | null): DNode {
  if (root.k === 'param' && root.name === from) return to ? { k: 'param', name: to } : HOLE
  if (root.k === 'call') {
    let changed = false
    const args = root.args.map((a) => {
      const b = remapParam(a, from, to)
      if (b !== a) changed = true
      return b
    })
    return changed ? { ...root, args } : root
  }
  return root
}

export function usesParam(root: DNode, name: string): number {
  if (root.k === 'param') return root.name === name ? 1 : 0
  if (root.k === 'call') return root.args.reduce((s, a) => s + usesParam(a, name), 0)
  return 0
}

/** Names of the functions a tree calls (operators excluded). */
export function calledNames(root: DNode | FnExpr, out = new Set<string>()): Set<string> {
  if (root.k === 'call') {
    if (!isOperator(root.fn)) out.add(root.fn)
    root.args.forEach((a) => calledNames(a as DNode, out))
  }
  return out
}

/** Rename calls of one function (another custom function was renamed). */
export function renameCalls<T extends DNode | FnExpr>(root: T, from: string, to: string): T {
  if (root.k !== 'call') return root
  const args = root.args.map((a) => renameCalls(a as DNode, from, to))
  const changed = root.fn === from || args.some((a, i) => a !== root.args[i])
  return (changed ? { ...root, fn: root.fn === from ? to : root.fn, args } : root) as T
}

/* ------------------------------------------------------------------ drafts */

export function toDraft(fn: CustomFunction): Draft {
  return {
    id: fn.id,
    name: fn.name,
    description: fn.description ?? '',
    params: fn.params.map((p) => ({ ...p })),
    body: JSON.parse(JSON.stringify(fn.body)) as DNode,
    createdAt: fn.createdAt,
  }
}

/** The stored shape of a complete draft (null while a slot is empty). */
export function fromDraft(d: Draft, now = Date.now()): CustomFunction | null {
  const body = toExpr(d.body)
  if (!body) return null
  const fn: CustomFunction = { id: d.id, name: d.name, params: d.params.map((p) => ({ ...p })), body, createdAt: d.createdAt || now, updatedAt: now }
  const desc = d.description.trim()
  if (desc) fn.description = desc.slice(0, FN_LIMITS.description)
  for (const p of fn.params) if (!p.description?.trim()) delete p.description
  return fn
}

export function toExpr(n: DNode): FnExpr | null {
  if (n.k === 'hole') return null
  if (n.k !== 'call') return n
  const args: FnExpr[] = []
  for (const a of n.args) {
    const e = toExpr(a)
    if (!e) return null
    args.push(e)
  }
  return { k: 'call', fn: n.fn, args }
}

export function sameDraft(a: Draft, b: Draft): boolean {
  return JSON.stringify([a.name, a.description, a.params, a.body]) === JSON.stringify([b.name, b.description, b.params, b.body])
}

/* ------------------------------------------------------------------ names */

/** Typing help: "net margin" → "NET_MARGIN" (only what a name may hold). */
export const normalizeFnName = (s: string): string =>
  s
    .toUpperCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^A-Z0-9_]/g, '')
    .slice(0, 32)

/** Typing help: "Unit Price" → "unit_price". */
export const normalizeParamName = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' })[c] ?? c)
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 32)

/** Names a spreadsheet would read as something else: cell references (AB12) and R1C1 refs. */
const CELL_LIKE = /^([A-Z]{1,3}[0-9]+|R[0-9]*C[0-9]*)$/
const RESERVED = new Set(['TRUE', 'FALSE', 'DS', 'NULL'])

export type NameIssue = 'empty' | 'format' | 'builtin' | 'cellLike' | 'reserved' | 'taken'

export function checkFnName(name: string, id: ID, isBuiltin: (n: string) => boolean, functions: Record<ID, CustomFunction> | undefined): NameIssue | null {
  if (!name) return 'empty'
  if (!FN_NAME_RE.test(name)) return 'format'
  if (RESERVED.has(name)) return 'reserved'
  if (CELL_LIKE.test(name)) return 'cellLike'
  if (isBuiltin(name)) return 'builtin'
  if (Object.values(functions ?? {}).some((f) => f.id !== id && f.name === name)) return 'taken'
  return null
}

export type ParamIssue = 'empty' | 'format' | 'duplicate'

export function checkParamName(name: string, index: number, params: FnParam[]): ParamIssue | null {
  if (!name) return 'empty'
  if (!PARAM_NAME_RE.test(name)) return 'format'
  if (params.some((p, i) => i !== index && p.name === name)) return 'duplicate'
  return null
}

/** A fresh parameter name (x, y, z, a, b …, then p1, p2 …). */
export function nextParamName(params: FnParam[]): string {
  const taken = new Set(params.map((p) => p.name))
  for (const n of ['x', 'y', 'z', 'a', 'b', 'c', 'd']) if (!taken.has(n)) return n
  let i = 1
  while (taken.has(`p${i}`)) i++
  return `p${i}`
}

/** NEW_FUNCTION, NEW_FUNCTION_2 … (unique among the workspace's functions and drafts). */
export function uniqueFnName(base: string, taken: Iterable<string>): string {
  const set = new Set(taken)
  const root = base.slice(0, 29)
  if (!set.has(root)) return root
  let i = 2
  while (set.has(`${root}_${i}`)) i++
  return `${root}_${i}`
}

/* ------------------------------------------------------------------ checks */

export type Issue =
  | { kind: 'name'; code: NameIssue }
  | { kind: 'param'; code: ParamIssue; index: number }
  | { kind: 'holes'; count: number; first: Path }
  | { kind: 'unknown'; name: string; path: Path }
  | { kind: 'paramMissing'; name: string; path: Path }
  | { kind: 'arity'; name: string; path: Path }
  | { kind: 'type'; path: Path; expected: string; got: string }
  | { kind: 'recursion'; chain: string[] }
  | { kind: 'size' }

/** Blocking issues keep a draft from being saved; the others are hints. */
export const isBlocking = (i: Issue): boolean => i.kind !== 'type' && i.kind !== 'recursion'

/** What kind of value an expected argument type takes ('number', 'text', 'bool', 'date', 'range' or null = anything). */
export function argKind(type: string | undefined): 'number' | 'text' | 'bool' | 'date' | 'range' | null {
  const t = (type ?? '').toLowerCase()
  if (/^(number|numeric|num|integer|int)$/.test(t)) return 'number'
  if (/^(text|string|str)$/.test(t)) return 'text'
  if (/^(bool|boolean|logical)$/.test(t)) return 'bool'
  if (/^date/.test(t)) return 'date'
  if (/^(range|dataset|array|ref|reference)/.test(t)) return 'range'
  return null
}

/** The kind of value a leaf delivers (null = can't tell before it runs). */
function leafKind(n: DNode, params: FnParam[]): FnParamType | null {
  if (n.k === 'num') return 'number'
  if (n.k === 'str') return 'text'
  if (n.k === 'bool') return 'bool'
  if (n.k === 'param') {
    const p = params.find((x) => x.name === n.name)
    return p && p.type !== 'any' ? p.type : null
  }
  return null
}

function typeClash(expected: ReturnType<typeof argKind>, got: FnParamType | null): boolean {
  if (!expected || !got) return false
  if (expected === 'range') return got !== 'range'
  if (got === 'range') return true
  if (expected === 'number') return got === 'text' || got === 'bool'
  if (expected === 'date') return got === 'bool'
  return false
}

export function checkDraft(
  d: Draft,
  lookup: SpecLookup,
  isBuiltin: (n: string) => boolean,
  functions: Record<ID, CustomFunction> | undefined,
): Issue[] {
  const issues: Issue[] = []
  const nameIssue = checkFnName(d.name, d.id, isBuiltin, functions)
  if (nameIssue) issues.push({ kind: 'name', code: nameIssue })
  d.params.forEach((p, i) => {
    const code = checkParamName(p.name, i, d.params)
    if (code) issues.push({ kind: 'param', code, index: i })
  })
  const { nodes, holes, depth } = countNodes(d.body)
  if (nodes > FN_LIMITS.nodes || depth > FN_LIMITS.depth || d.params.length > FN_LIMITS.params) issues.push({ kind: 'size' })
  if (holes) {
    const first = flatten(d.body).find((x) => x.node.k === 'hole')!.path
    issues.push({ kind: 'holes', count: holes, first })
  }
  for (const { node, path } of flatten(d.body)) {
    if (node.k === 'param' && !d.params.some((p) => p.name === node.name)) issues.push({ kind: 'paramMissing', name: node.name, path })
    if (node.k !== 'call') continue
    const spec = node.fn === d.name ? selfSpec(d) : lookup(node.fn)
    if (!spec) {
      issues.push({ kind: 'unknown', name: node.fn, path })
      continue
    }
    if (node.args.length < spec.minArgs || (spec.maxArgs !== null && node.args.length > spec.maxArgs)) issues.push({ kind: 'arity', name: node.fn, path })
    node.args.forEach((a, i) => {
      const expected = argKind(slotAt(spec, i).type)
      const got = leafKind(a, d.params)
      if (typeClash(expected, got)) issues.push({ kind: 'type', path: [...path, i], expected: expected!, got: got! })
    })
  }
  const chain = recursionChain(d, functions)
  if (chain) issues.push({ kind: 'recursion', chain })
  return issues
}

/** The draft itself as a call spec (a function may call itself — recursion is capped by the engine). */
export function selfSpec(d: Draft): CallSpec {
  return customSpec({ name: d.name, params: d.params, description: d.description })
}

export function customSpec(fn: Pick<CustomFunction, 'name' | 'params' | 'description'>): CallSpec {
  return {
    name: fn.name,
    kind: 'custom',
    category: 'custom',
    minArgs: fn.params.length,
    maxArgs: fn.params.length,
    args: fn.params.map((p) => ({ name: p.name, type: p.type })),
    description: fn.description,
  }
}

/** A path of calls that leads back to the draft (MARGIN → HELPER → MARGIN), or null. */
export function recursionChain(d: Draft, functions: Record<ID, CustomFunction> | undefined): string[] | null {
  const byName = new Map(Object.values(functions ?? {}).filter((f) => f.id !== d.id).map((f) => [f.name, f]))
  const seen = new Set<string>()
  const visit = (names: Set<string>, chain: string[]): string[] | null => {
    for (const n of names) {
      if (n === d.name) return [...chain, n]
      if (seen.has(n)) continue
      seen.add(n)
      const f = byName.get(n)
      if (!f) continue
      const r = visit(calledNames(f.body), [...chain, n])
      if (r) return r
    }
    return null
  }
  return visit(calledNames(d.body), [d.name])
}

/* ------------------------------------------------------------------ preview */

/** Excel precedence (higher binds tighter); all binary operators are left-associative. */
const PREC: Record<string, number> = { '=': 1, '<>': 1, '<': 1, '<=': 1, '>': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 }

export interface PreviewPart {
  text: string
  /** the node this text belongs to */
  path: Path
  kind: 'fn' | 'op' | 'num' | 'str' | 'bool' | 'param' | 'hole' | 'punct'
}

/**
 * The tree in spreadsheet syntax, as parts that know their node — `=ROUND((price - cost) / price; 2)`.
 * `sep`: the argument separator.
 */
export function previewParts(root: DNode, sep = '; '): PreviewPart[] {
  const out: PreviewPart[] = []
  const push = (text: string, path: Path, kind: PreviewPart['kind']) => out.push({ text, path, kind })
  const walk = (n: DNode, path: Path, parentPrec: number, rightSide: boolean) => {
    switch (n.k) {
      case 'hole':
        return push('□', path, 'hole')
      case 'num':
        return push(numText(n.v), path, 'num')
      case 'str':
        return push(`"${n.v.replace(/"/g, '""')}"`, path, 'str')
      case 'bool':
        return push(n.v ? 'TRUE' : 'FALSE', path, 'bool')
      case 'param':
        return push(n.name, path, 'param')
      case 'call': {
        if (isOperator(n.fn) && n.args.length === 2) {
          const prec = PREC[n.fn] ?? 0
          const paren = prec < parentPrec || (rightSide && prec === parentPrec)
          if (paren) push('(', path, 'punct')
          walk(n.args[0], [...path, 0], prec, false)
          push(` ${n.fn} `, path, 'op')
          walk(n.args[1], [...path, 1], prec, true)
          if (paren) push(')', path, 'punct')
          return
        }
        push(`${n.fn}(`, path, 'fn')
        n.args.forEach((a, i) => {
          if (i) push(sep, path, 'punct')
          walk(a, [...path, i], 0, false)
        })
        push(')', path, 'fn')
      }
    }
  }
  walk(root, [], 0, false)
  return out
}

export const previewText = (root: DNode, sep = '; '): string => `=${previewParts(root, sep).map((p) => p.text).join('')}`

/** A number as a formula writes it (no float noise, no exponent for everyday values). */
export function numText(v: number): string {
  if (!Number.isFinite(v)) return '0'
  return String(Number(v.toPrecision(15)))
}

/** A signature line: `MARGIN(price; cost)`. */
export const signature = (name: string, params: Array<{ name: string }>, sep = '; '): string => `${name}(${params.map((p) => p.name).join(sep)})`
