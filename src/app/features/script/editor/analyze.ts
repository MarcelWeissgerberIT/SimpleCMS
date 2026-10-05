/**
 * One Script editor — what the editor knows about the code without running it: highlighted segments,
 * variables, which database a variable or a loop variable stands for (`let open = db(@Tasks)…`,
 * `for t in open`), and what to offer at the caret (@ references, names, members, property names,
 * signature help).
 */
import { KEYWORDS, tokenize, type Token } from '../lang'
import { GLOBAL_FUNCTIONS, MEMBERS, PROP_ARG_METHODS, signatureOf, type FnInfo, type MemberKind } from '../catalog'

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

export function analyze(code: string): Analysis {
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

/* ------------------------------------------------------------------ completion */

export type CompletionContext =
  | { kind: 'ref'; from: number; query: string }
  | { kind: 'member'; from: number; prefix: string; on: MemberKind | null; dbId: string | null; dbName: string | null }
  | { kind: 'name'; from: number; prefix: string; propsOf: { dbId: string | null; dbName: string | null } | null }
  | null

const isWord = (c: string) => /[\p{L}\p{N}_]/u.test(c)

/** The token the offset falls in (strings / comments: no completion there). */
function tokenAt(a: Analysis, offset: number): Token | null {
  for (const t of a.tokens) if (t.pos.start < offset && offset <= t.pos.end) return t
  return null
}

/** The innermost open call around the offset: its callee name, whether it is a method, and the db it works on. */
export function openCall(a: Analysis, offset: number): { name: string; member: boolean; argIndex: number; dbId: string | null; dbName: string | null } | null {
  const toks = a.tokens.filter((t) => t.type !== 'comment' && t.type !== 'nl' && t.pos.end <= offset)
  let depth = 0
  let commas = 0
  for (let i = toks.length - 1; i >= 0; i--) {
    const t = toks[i]
    if (t.type !== 'op') continue
    if (t.text === ')' || t.text === ']' || t.text === '}') depth++
    else if (t.text === '[' || t.text === '{') {
      if (depth === 0) return null
      depth--
    } else if (t.text === ',' && depth === 0) commas++
    else if (t.text === '(') {
      if (depth > 0) {
        depth--
        continue
      }
      const callee = toks[i - 1]
      if (!callee || (callee.type !== 'ident' && callee.type !== 'kw')) return null
      const member = toks[i - 2]?.text === '.'
      const db = member ? chainDb(a, toks, i - 2) : null
      return { name: String(callee.value ?? callee.text), member, argIndex: commas, dbId: db?.dbId ?? null, dbName: db?.dbName ?? null }
    }
  }
  return null
}

/** The database a method chain ending before token `dot` (a ".") works on. */
function chainDb(a: Analysis, toks: Token[], dot: number): { dbId: string | null; dbName: string | null; kind: 'query' | 'row' } | null {
  // walk back over calls and members to the chain's start
  let i = dot - 1
  let depth = 0
  for (; i >= 0; i--) {
    const t = toks[i]
    if (t.type === 'op' && (t.text === ')' || t.text === ']')) depth++
    else if (t.type === 'op' && (t.text === '(' || t.text === '[')) {
      if (depth === 0) break
      depth--
    } else if (depth === 0 && !(t.type === 'ident' || t.type === 'kw' || (t.type === 'op' && t.text === '.'))) break
  }
  const start = i + 1
  const d = dbArgAt(toks, start)
  if (d) return { dbId: d.id, dbName: d.name, kind: 'query' }
  const v = toks[start]?.type === 'ident' ? a.vars.get(String(toks[start].value)) : null
  if (v && (v.kind === 'query' || v.kind === 'row')) {
    // row.Prop. … → not the row any more; only a bare row variable counts as a row
    if (v.kind === 'row' && start !== dot - 1) return null
    return { dbId: v.dbId, dbName: v.dbName, kind: v.kind }
  }
  return null
}

export function completionAt(code: string, a: Analysis, offset: number): CompletionContext {
  const tok = tokenAt(a, offset)
  // inside a comment, a text or a finished @ chip: nothing to offer (an @Name being typed is a ref token too)
  const chip = tok?.type === 'ref' && !!(tok.value as { id: string | null } | undefined)?.id
  if (tok && (tok.type === 'comment' || (tok.type === 'str' && offset < tok.pos.end) || chip)) return null
  // @ references: "@" … caret on one line, no brackets in between
  const lineStart = code.lastIndexOf('\n', offset - 1) + 1
  const before = code.slice(lineStart, offset)
  const at = before.lastIndexOf('@')
  if (at >= 0 && !/[()[\]{},"'`=]/.test(before.slice(at + 1)) && before.slice(at + 1).length <= 60 && (at === 0 || !isWord(before[at - 1]))) {
    const inTok = tokenAt(a, lineStart + at + 1)
    if (!inTok || inTok.type === 'ref' || inTok.type === 'error') return { kind: 'ref', from: lineStart + at, query: before.slice(at + 1) }
  }
  // the word being typed
  let s = offset
  while (s > 0 && isWord(code[s - 1])) s--
  const prefix = code.slice(s, offset)
  if (code[s - 1] === '.') {
    const toks = a.tokens.filter((t) => t.type !== 'comment' && t.type !== 'nl' && t.pos.end <= s)
    const dot = toks.length - 1
    const prev = toks[dot - 1]
    let on: MemberKind | null = null
    let db: { dbId: string | null; dbName: string | null } | null = null
    if (prev?.type === 'ident') {
      const n = norm(String(prev.value))
      const v = a.vars.get(String(prev.value))
      if (v?.kind === 'query' || v?.kind === 'row') {
        on = v.kind
        db = v
      } else if (v?.kind === 'page') on = 'page'
      else if (!v && n === 'mail') on = 'mail'
      else if (!v && n === 'create') on = 'create'
      else if (!v && n === 'http') on = 'http'
      else if (!v && n === 'page') on = 'pagefn'
    }
    if (!on) {
      const c = chainDb(a, toks, dot)
      if (c) {
        on = c.kind
        db = c
      }
    }
    return { kind: 'member', from: s, prefix, on, dbId: db?.dbId ?? null, dbName: db?.dbName ?? null }
  }
  if (!prefix && !(code[offset - 1] === '(' || code[offset - 1] === ',' || code[offset - 1] === ' ')) return null
  const call = openCall(a, offset)
  const propsOf = call && call.member && PROP_ARG_METHODS.has(norm(call.name)) && (call.dbId || call.dbName) ? { dbId: call.dbId, dbName: call.dbName } : null
  if (!prefix && !propsOf) return null
  return { kind: 'name', from: s, prefix, propsOf }
}

/** Names offered for a prefix: variables, keywords, functions. */
export function nameCandidates(a: Analysis, prefix: string): Array<{ label: string; insert: string; detail: string; kind: 'var' | 'kw' | 'fn' }> {
  const p = prefix.toLowerCase()
  const out: Array<{ label: string; insert: string; detail: string; kind: 'var' | 'kw' | 'fn' }> = []
  for (const [name] of a.vars) if (name.toLowerCase().startsWith(p) && name !== prefix) out.push({ label: name, insert: name, detail: '', kind: 'var' })
  for (const f of GLOBAL_FUNCTIONS) if (f.name.startsWith(p)) out.push({ label: f.name, insert: f.prop ? f.name : `${f.name}(`, detail: f.sig, kind: 'fn' })
  for (const k of KEYWORDS) if (k.startsWith(p) && k.length > p.length) out.push({ label: k, insert: k, detail: '', kind: 'kw' })
  return out.slice(0, 40)
}

export function memberCandidates(on: MemberKind | null, prefix: string): FnInfo[] {
  const p = prefix.toLowerCase()
  const lists = on ? [MEMBERS[on]] : [MEMBERS.query, MEMBERS.row, MEMBERS.text, MEMBERS.list]
  const seen = new Set<string>()
  const out: FnInfo[] = []
  for (const l of lists)
    for (const f of l) {
      if (!f.name.startsWith(p) || seen.has(f.name)) continue
      seen.add(f.name)
      out.push(f)
    }
  return out
}

export { signatureOf }
