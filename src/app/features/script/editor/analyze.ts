/**
 * One Script editor — what the editor knows about the code without running it: the tokens, highlighted
 * segments, variables and which database a variable or a loop variable stands for (`let open =
 * db(@Tasks)…`, `for t in open`) for highlighting, the databases the code names. What to offer at the
 * caret (type-aware completion, signature help, docs) is complete.ts. The last analyses are kept, so
 * the highlighter and the completion read the same one.
 */
import { tokenize, type Token } from '../lang'
import { GLOBAL_FUNCTIONS } from '../catalog'

export type SegClass = 'kw' | 'fn' | 'prop' | 'var' | 'num' | 'str' | 'ref' | 'comment' | 'op' | 'err' | 'plain'

export interface Segment {
  start: number
  end: number
  cls: SegClass
  /** ref tokens: the parts of the chip */
  ref?: { label: string; kind: string; id: string | null }
}

const FN_NAMES = new Set(GLOBAL_FUNCTIONS.map((f) => f.name.replace(/_/g, '')))
const norm = (s: string) => s.toLowerCase().replace(/_/g, '')

export type VarType = { kind: 'query'; dbId: string | null; dbName: string | null } | { kind: 'row'; dbId: string | null; dbName: string | null } | { kind: 'page' } | { kind: 'other' }

export interface Analysis {
  tokens: Token[]
  vars: Map<string, VarType>
  /** databases the code names (ids from @ references, names from db("…") / @Name) */
  dbRefs: Array<{ id: string | null; name: string | null }>
}

/** The database a db(…) call starting at token i names. */
function dbArgAt(toks: Token[], i: number): { id: string | null; name: string | null } | null {
  // db ( <ref|str> )
  if (toks[i]?.type !== 'ident' || norm(String(toks[i].value)) !== 'db' || toks[i + 1]?.text !== '(') return null
  const a = toks[i + 2]
  if (a?.type === 'ref') {
    const v = a.value as { kind: string; id: string | null; label: string }
    return { id: v.kind === 'p' ? v.id : null, name: v.label }
  }
  if (a?.type === 'str') return { id: null, name: (a.value as unknown[]).filter((p) => typeof p === 'string').join('') }
  return null
}

const recent: Array<{ code: string; a: Analysis }> = []

export function analyze(code: string): Analysis {
  const hit = recent.find((r) => r.code === code)
  if (hit) return hit.a
  const a = analyzeNow(code)
  recent.unshift({ code, a })
  recent.length = Math.min(recent.length, 3)
  return a
}

function analyzeNow(code: string): Analysis {
  const tokens = tokenize(code, { tolerant: true })
  const vars = new Map<string, VarType>()
  const dbRefs: Analysis['dbRefs'] = []
  const toks = tokens.filter((t) => t.type !== 'comment')
  for (let i = 0; i < toks.length; i++) {
    const db = dbArgAt(toks, i)
    if (db) dbRefs.push(db)
    const t = toks[i]
    // let x = …
    if (t.type === 'kw' && t.text === 'let' && toks[i + 1]?.type === 'ident' && toks[i + 2]?.text === '=') {
      const name = String(toks[i + 1].value)
      const rhs = dbArgAt(toks, i + 3)
      if (rhs) vars.set(name, { kind: 'query', dbId: rhs.id, dbName: rhs.name })
      else if (toks[i + 3]?.type === 'ident' && vars.get(String(toks[i + 3].value))?.kind === 'query' && toks[i + 4]?.text === '.') vars.set(name, vars.get(String(toks[i + 3].value))!)
      else if (toks[i + 3]?.type === 'ident' && norm(String(toks[i + 3].value)) === 'page') vars.set(name, { kind: 'page' })
      else if (!vars.has(name)) vars.set(name, { kind: 'other' })
    }
    // fn name(…)
    if (t.type === 'kw' && t.text === 'fn' && toks[i + 1]?.type === 'ident') vars.set(String(toks[i + 1].value), { kind: 'other' })
    // for x in <query var | db(…)>
    if (t.type === 'kw' && t.text === 'for') {
      let j = i + 1
      const names: string[] = []
      while (toks[j]?.type === 'ident' || toks[j]?.text === ',') {
        if (toks[j].type === 'ident') names.push(String(toks[j].value))
        j++
      }
      if (toks[j]?.type === 'kw' && toks[j].text === 'in' && names.length) {
        const src = toks[j + 1]
        const q = src?.type === 'ident' ? vars.get(String(src.value)) : null
        const d = dbArgAt(toks, j + 1)
        const row: VarType = q?.kind === 'query' ? { kind: 'row', dbId: q.dbId, dbName: q.dbName } : d ? { kind: 'row', dbId: d.id, dbName: d.name } : { kind: 'other' }
        vars.set(names[names.length - 1], row)
        if (names.length > 1) vars.set(names[0], { kind: 'other' })
      }
    }
  }
  return { tokens, vars, dbRefs }
}

/** Highlight segments (every non-space character belongs to one). */
export function segments(a: Analysis, propNames: Set<string>): Segment[] {
  const out: Segment[] = []
  for (const t of a.tokens) {
    if (t.type === 'eof' || t.type === 'nl') continue
    const base = { start: t.pos.start, end: t.pos.end }
    switch (t.type) {
      case 'kw':
        out.push({ ...base, cls: 'kw' })
        break
      case 'num':
      case 'dur':
        out.push({ ...base, cls: 'num' })
        break
      case 'str':
        out.push({ ...base, cls: 'str' })
        break
      case 'comment':
        out.push({ ...base, cls: 'comment' })
        break
      case 'error':
        out.push({ ...base, cls: 'err' })
        break
      case 'op':
        out.push({ ...base, cls: 'op' })
        break
      case 'ref': {
        const v = t.value as { kind: string; id: string | null; label: string }
        out.push({ ...base, cls: 'ref', ref: { label: v.label, kind: v.kind, id: v.id } })
        break
      }
      case 'ident': {
        const name = String(t.value)
        const cls: SegClass = a.vars.has(name) ? 'var' : propNames.has(name) || t.quoted ? 'prop' : FN_NAMES.has(norm(name)) ? 'fn' : 'plain'
        out.push({ ...base, cls })
        break
      }
    }
  }
  return out
}

/* ------------------------------------------------------------------ completion (complete.ts) */

export { completionAt, candidatesFor, callAt, docAt, type CompletionContext, type Candidate } from './complete'
