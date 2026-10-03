/**
 * Formula text analysis for the editor UI (pure): colour groups (every DS(...) one group, every
 * other reference its own), the call + argument at the caret (signature hints), the identifier
 * being typed (autocomplete) and whether a reference can be pointed in at the caret.
 */
import { lex, type RefTok, type Tok } from './lexer'

export interface FormulaGroup {
  /** colour slot (0, 1, 2 …) in order of appearance */
  id: number
  kind: 'ds' | 'ref'
  /** text span in the body (DS: from "DS" to its ")") */
  s: number
  e: number
  refs: RefTok[]
  /** dataset names inside DS(…) */
  names: string[]
}

export interface FormulaPaint {
  tokens: Tok[]
  groups: FormulaGroup[]
  /** group of each token (-1: none) — innermost group wins */
  tokenGroup: number[]
}

/** Paint data for a formula body (text after "="). */
export function paintFormula(body: string): FormulaPaint {
  const tokens = lex(body, true)
  const groups: FormulaGroup[] = []
  const tokenGroup = tokens.map(() => -1)
  const refGroups = new Map<string, number>()
  // stack of open parens: the DS group they belong to (or -1)
  const stack: Array<{ ds: number }> = []
  let pendingDS = -1
  const innerDS = () => {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].ds >= 0) return stack[i].ds
    return -1
  }
  tokens.forEach((t, i) => {
    if (t.t === 'fn' && t.v === 'DS' && tokens[i + 1]?.t === 'lp') {
      const id = groups.length
      groups.push({ id, kind: 'ds', s: t.s, e: body.length, refs: [], names: [] })
      tokenGroup[i] = id
      pendingDS = id
      return
    }
    if (t.t === 'lp') {
      stack.push({ ds: pendingDS })
      if (pendingDS >= 0) tokenGroup[i] = pendingDS
      pendingDS = -1
      return
    }
    if (t.t === 'rp') {
      const top = stack.pop()
      if (top && top.ds >= 0) {
        tokenGroup[i] = top.ds
        groups[top.ds].e = t.e
      } else tokenGroup[i] = innerDS()
      return
    }
    const ds = innerDS()
    if (t.t === 'ref') {
      if (ds >= 0) {
        groups[ds].refs.push(t)
        tokenGroup[i] = ds
      } else {
        const key = body.slice(t.s, t.e).replace(/\$/g, '').toUpperCase()
        let id = refGroups.get(key)
        if (id === undefined) {
          id = groups.length
          refGroups.set(key, id)
          groups.push({ id, kind: 'ref', s: t.s, e: t.e, refs: [], names: [] })
        }
        groups[id].refs.push(t)
        tokenGroup[i] = id
      }
      return
    }
    if (ds >= 0) {
      if ((t.t === 'name' || t.t === 'str') && stack.length && stack[stack.length - 1].ds === ds) groups[ds].names.push(t.v)
      tokenGroup[i] = ds
    }
  })
  return { tokens, groups, tokenGroup }
}

/** The function call around the caret and the index of the argument it is in. */
export function callAt(body: string, caret: number): { name: string; arg: number } | null {
  const tokens = lex(body.slice(0, caret), true)
  const stack: Array<{ name: string | null; arg: number }> = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.t === 'lp') {
      const prev = tokens[i - 1]
      stack.push({ name: prev?.t === 'fn' ? prev.v : null, arg: 0 })
    }
    else if (t.t === 'rp') stack.pop()
    else if (t.t === 'sep' && stack.length) stack[stack.length - 1].arg++
  }
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i].name) return { name: stack[i].name!, arg: stack[i].arg }
  return null
}

const BEFORE_VALUE = /[=(;,+\-*/^&<>:%]/

/** The identifier being typed at the caret (function / dataset name autocomplete). */
export function wordAt(body: string, caret: number): { word: string; start: number } | null {
  const before = body.slice(0, caret)
  const m = /[\p{L}_][\p{L}\p{N}_.]*$/u.exec(before)
  if (!m) return null
  const start = caret - m[0].length
  // inside a "text" literal: no suggestions
  if (((before.slice(0, start).match(/"/g) ?? []).length & 1) === 1) return null
  const prev = body.slice(0, start).replace(/\s+$/, '').slice(-1)
  if (prev && !BEFORE_VALUE.test(prev)) return null
  if (/^\$?[A-Za-z]{1,3}\$?\d+$/.test(m[0])) return null
  return { word: m[0], start }
}

/** Can a reference be inserted at the caret by clicking a cell (Excel "point mode")? */
export function canPoint(body: string, caret: number): boolean {
  const before = body.slice(0, caret).replace(/\s+$/, '')
  if (!before) return true
  if ((before.match(/"/g) ?? []).length % 2) return false
  return /[=(;,+\-*/^&<>:]$/.test(before)
}
