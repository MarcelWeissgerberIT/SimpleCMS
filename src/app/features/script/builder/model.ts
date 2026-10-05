/**
 * The visual query builder's model and its round trip with code. A query the builder can show is ONE
 * expression of the form
 *
 *   db(<ref>).where(<conditions>).sort(<keys>).limit(<n>).select(<fields>)
 *
 * (each step optional, in this order; comments only above it). Conditions: `Prop = value` (= != < <=
 * > >=), `Prop.contains(v)` / `not Prop.contains(v)`, `Prop.starts_with(v)`, `Prop.ends_with(v)`,
 * `empty(Prop)` / `not empty(Prop)`, grouped with `and` / `or` (one level of brackets). Values: text,
 * numbers, true / false, today() ± a duration, date("…"), @person, me(), @page. Anything else: the
 * builder steps aside ("Edit as text") and the code stays exactly as it is.
 */
import { KEYWORDS, parse, tokenize, type Arg, type Expr, type Program } from '../lang'

export type BOp = '=' | '!=' | '<' | '<=' | '>' | '>=' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'empty' | 'not_empty'

export type BVal =
  | { kind: 'text'; v: string }
  | { kind: 'number'; v: number }
  | { kind: 'bool'; v: boolean }
  | { kind: 'null' }
  | { kind: 'today'; days: number }
  | { kind: 'date'; v: string }
  | { kind: 'person'; id: string; label: string }
  | { kind: 'me' }
  | { kind: 'page'; id: string; label: string }
  | { kind: 'none' }

export interface BCond {
  prop: string
  op: BOp
  value: BVal
}

export interface BGroup {
  op: 'and' | 'or'
  items: Array<BCond | BGroup>
}

export interface BQuery {
  /** the db(…) argument as written (`@[Tasks](p:abc)`, `"Tasks"`) and the database id when it is a reference */
  db: { code: string; id: string | null; label: string }
  where: BGroup
  sort: Array<{ prop: string; desc: boolean }>
  limit: number | null
  select: string[]
  /** comment lines above the query (kept as they are) */
  head: string
}

export const isGroup = (x: BCond | BGroup): x is BGroup => 'items' in x

/* ------------------------------------------------------------------ code → model */

function value(e: Expr): BVal | null {
  switch (e.type) {
    case 'Str':
      return e.parts.every((p) => typeof p === 'string') ? { kind: 'text', v: (e.parts as string[]).join('') } : null
    case 'Num':
      return { kind: 'number', v: e.value }
    case 'Bool':
      return { kind: 'bool', v: e.value }
    case 'Null':
      return { kind: 'null' }
    case 'Ref':
      if (e.kind === 'u' && e.id) return { kind: 'person', id: e.id, label: e.label }
      if (e.kind === 'p' && e.id) return { kind: 'page', id: e.id, label: e.label }
      return null
    case 'Call': {
      if (e.callee.type !== 'Ident') return null
      const fn = e.callee.name.toLowerCase()
      if (fn === 'today' && !e.args.length) return { kind: 'today', days: 0 }
      if (fn === 'me' && !e.args.length) return { kind: 'me' }
      if (fn === 'date' && e.args.length === 1 && !e.args[0].name && e.args[0].value.type === 'Str') {
        const s = e.args[0].value.parts.join('')
        return /^\d{4}-\d{2}-\d{2}$/.test(s) ? { kind: 'date', v: s } : null
      }
      return null
    }
    case 'Binary': {
      // today() + 3d · today() - 1w
      if ((e.op === '+' || e.op === '-') && e.right.type === 'Dur' && e.right.ms === 0) {
        const base = value(e.left)
        if (base?.kind === 'today' && base.days === 0) return { kind: 'today', days: (e.op === '+' ? 1 : -1) * e.right.days }
      }
      return null
    }
  }
  return null
}

const propName = (e: Expr): string | null => (e.type === 'Ident' ? e.name : null)

function cond(e: Expr): BCond | null {
  if (e.type === 'Binary' && ['=', '==', '!=', '<', '<=', '>', '>='].includes(e.op)) {
    const prop = propName(e.left)
    const v = value(e.right)
    if (!prop || !v) return null
    return { prop, op: (e.op === '==' ? '=' : e.op) as BOp, value: v }
  }
  let negate = false
  let inner = e
  if (e.type === 'Unary' && e.op === 'not') {
    negate = true
    inner = e.arg
  }
  if (inner.type === 'Call') {
    const c = inner.callee
    // Prop.contains(v) / starts_with / ends_with
    if (c.type === 'Member' && inner.args.length === 1 && !inner.args[0].name) {
      const prop = propName(c.object)
      const fn = c.name.toLowerCase().replace(/_/g, '')
      const v = value(inner.args[0].value)
      if (!prop || !v) return null
      if (fn === 'contains') return { prop, op: negate ? 'not_contains' : 'contains', value: v }
      if (negate) return null
      if (fn === 'startswith') return { prop, op: 'starts_with', value: v }
      if (fn === 'endswith') return { prop, op: 'ends_with', value: v }
      return null
    }
    // empty(Prop)
    if (c.type === 'Ident' && c.name.toLowerCase() === 'empty' && inner.args.length === 1 && !inner.args[0].name) {
      const prop = propName(inner.args[0].value)
      return prop ? { prop, op: negate ? 'not_empty' : 'empty', value: { kind: 'none' } } : null
    }
  }
  return null
}

function chain(e: Expr, op: 'and' | 'or'): Expr[] {
  return e.type === 'Logical' && e.op === op ? [...chain(e.left, op), ...chain(e.right, op)] : [e]
}

/** A condition, or at level 1 (directly under the where root) a group of conditions (`a or b`, `a and b`). */
function item(e: Expr, level: number): BCond | BGroup | null {
  if (e.type === 'Logical') {
    if (level >= 2) return null
    const items = chain(e, e.op).map((x) => item(x, level + 1))
    if (items.some((x) => !x)) return null
    return { op: e.op, items: items as Array<BCond | BGroup> }
  }
  return cond(e)
}

function sortKey(a: Arg): { prop: string; desc: boolean } | null {
  if (a.name) return null
  const prop = propName(a.value)
  return prop ? { prop, desc: a.order === 'desc' } : null
}

/** The comment lines above the first statement ('' when there are none). */
function headComments(code: string, program: Program): string {
  const first = program.body[0]
  if (!first) return ''
  return code.slice(0, first.pos.start).trimEnd()
}

/** The builder's model of a query, or null when the code is something the builder can't show. */
export function fromCode(code: string): BQuery | null {
  let program: Program
  try {
    program = parse(code)
  } catch {
    return null
  }
  if (program.body.length !== 1 || program.body[0].type !== 'ExprStmt') return null
  const stmt = program.body[0]
  // comments inside or after the query would be lost when the builder writes it
  const toks = tokenize(code, { tolerant: true })
  if (toks.some((t) => t.type === 'comment' && t.pos.start > stmt.pos.start)) return null
  // unwrap the method chain: db(…).where(…).sort(…).limit(…).select(…)
  const steps: Array<{ name: string; args: Arg[] }> = []
  let e: Expr = stmt.expr
  while (e.type === 'Call' && e.callee.type === 'Member') {
    steps.unshift({ name: e.callee.name.toLowerCase(), args: e.args })
    e = e.callee.object
  }
  if (e.type !== 'Call' || e.callee.type !== 'Ident' || e.callee.name.toLowerCase() !== 'db' || e.args.length !== 1 || e.args[0].name) return null
  const dbArg = e.args[0].value
  let db: BQuery['db']
  if (dbArg.type === 'Ref' && (dbArg.kind === 'p' || dbArg.kind === 'name')) db = { code: code.slice(dbArg.pos.start, dbArg.pos.end), id: dbArg.id, label: dbArg.label }
  else if (dbArg.type === 'Str' && dbArg.parts.every((p) => typeof p === 'string')) db = { code: code.slice(dbArg.pos.start, dbArg.pos.end), id: null, label: dbArg.parts.join('') }
  else return null

  const q: BQuery = { db, where: { op: 'and', items: [] }, sort: [], limit: null, select: [], head: headComments(code, program) }
  const ORDER = ['where', 'sort', 'limit', 'select']
  let at = -1
  for (const st of steps) {
    const i = ORDER.indexOf(st.name)
    if (i <= at) return null
    at = i
    if (st.name === 'where') {
      if (st.args.some((a) => a.name || a.order)) return null
      if (st.args.length === 1 && st.args[0].value.type === 'Logical' && st.args[0].value.op === 'or') {
        const items = chain(st.args[0].value, 'or').map((x) => item(x, 1))
        if (items.some((x) => !x)) return null
        q.where = { op: 'or', items: items as Array<BCond | BGroup> }
      } else {
        const items = st.args.map((a) => item(a.value, 1))
        if (items.some((x) => !x)) return null
        // `a and b` inside one argument: the same as two arguments
        q.where = { op: 'and', items: (items as Array<BCond | BGroup>).flatMap((x) => (isGroup(x) && x.op === 'and' ? x.items : [x])) }
      }
    } else if (st.name === 'sort') {
      const keys = st.args.map(sortKey)
      if (!keys.length || keys.some((k) => !k)) return null
      q.sort = keys as BQuery['sort']
    } else if (st.name === 'limit') {
      if (st.args.length !== 1 || st.args[0].name || st.args[0].value.type !== 'Num') return null
      const n = st.args[0].value.value
      if (!Number.isInteger(n) || n < 0) return null
      q.limit = n
    } else {
      const names = st.args.map((a) => (a.name || a.order ? null : propName(a.value)))
      if (!names.length || names.some((n) => !n)) return null
      q.select = names as string[]
    }
  }
  return q
}

/* ------------------------------------------------------------------ model → code */

const IDENT = /^[\p{L}_][\p{L}\p{N}_]*$/u

/** A property name as code: bare when it can be, else in backticks. */
export function nameCode(name: string): string {
  return IDENT.test(name) && !KEYWORDS.has(name) && name !== 'desc' && name !== 'asc' ? name : `\`${name.replace(/`/g, '')}\``
}

export function valueCode(v: BVal): string {
  switch (v.kind) {
    case 'text':
      return JSON.stringify(v.v).replace(/\{/g, '\\{').replace(/\}/g, '\\}')
    case 'number':
      return String(v.v)
    case 'bool':
      return v.v ? 'true' : 'false'
    case 'null':
    case 'none':
      return 'null'
    case 'today':
      if (!v.days) return 'today()'
      return `today() ${v.days > 0 ? '+' : '-'} ${Math.abs(v.days) % 7 === 0 ? `${Math.abs(v.days) / 7}w` : `${Math.abs(v.days)}d`}`
    case 'date':
      return `date("${v.v}")`
    case 'person':
      return `@[${v.label.replace(/[\]\\]/g, (c) => `\\${c}`)}](u:${v.id})`
    case 'page':
      return `@[${v.label.replace(/[\]\\]/g, (c) => `\\${c}`)}](p:${v.id})`
    case 'me':
      return 'me()'
  }
}

export function condCode(c: BCond): string {
  const p = nameCode(c.prop)
  switch (c.op) {
    case 'contains':
      return `${p}.contains(${valueCode(c.value)})`
    case 'not_contains':
      return `not ${p}.contains(${valueCode(c.value)})`
    case 'starts_with':
      return `${p}.starts_with(${valueCode(c.value)})`
    case 'ends_with':
      return `${p}.ends_with(${valueCode(c.value)})`
    case 'empty':
      return `empty(${p})`
    case 'not_empty':
      return `not empty(${p})`
    default:
      return `${p} ${c.op} ${valueCode(c.value)}`
  }
}

function itemCode(x: BCond | BGroup, nested: boolean): string {
  if (!isGroup(x)) return condCode(x)
  const inner = x.items.map((i) => itemCode(i, true)).join(` ${x.op} `)
  return nested && x.items.length > 1 ? `(${inner})` : inner
}

/** The code of a model (one line when short, else one step per line). */
export function toCode(q: BQuery): string {
  const steps: string[] = []
  const where = q.where.items.filter((x) => !isGroup(x) || x.items.length)
  if (where.length) {
    if (q.where.op === 'or') steps.push(`.where(${where.map((x) => itemCode(x, true)).join(' or ')})`)
    else steps.push(`.where(${where.map((x) => itemCode(x, isGroup(x) && x.op === 'and' ? false : true)).join(', ')})`)
  }
  if (q.sort.length) steps.push(`.sort(${q.sort.map((s) => `${nameCode(s.prop)}${s.desc ? ' desc' : ''}`).join(', ')})`)
  if (q.limit !== null) steps.push(`.limit(${q.limit})`)
  if (q.select.length) steps.push(`.select(${q.select.map(nameCode).join(', ')})`)
  const head = `db(${q.db.code})`
  const oneLine = head + steps.join('')
  const body = oneLine.length <= 72 || steps.length <= 1 ? oneLine : [head, ...steps.map((s) => `  ${s}`)].join('\n')
  return q.head ? `${q.head}\n${body}` : body
}

/** A fresh query on a database (the builder's "pick a database"). */
export function newQuery(dbId: string, title: string): BQuery {
  return { db: { code: `@[${title.replace(/[\]\\]/g, (c) => `\\${c}`)}](p:${dbId})`, id: dbId, label: title }, where: { op: 'and', items: [] }, sort: [], limit: null, select: [], head: '' }
}
