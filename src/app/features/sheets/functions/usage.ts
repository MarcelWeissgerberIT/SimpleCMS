/**
 * Where a custom function is used: spreadsheet cells (the `spreadsheet` block's sheets), database
 * formula properties and other custom functions. Used for the delete warning and for renames
 * (call sites follow the new name). Text outside string literals only — `"MARGIN(1)"` is text.
 */
import type { JSONContent } from '@tiptap/core'
import type { CustomFunction, Database, ID, Page } from '../../../store/types'
import { calledNames, renameCalls } from './model'

export interface Usage {
  cells: number
  dbFormulas: number
  /** names of custom functions that call it */
  functions: string[]
  /** pages holding cells that use it */
  pages: ID[]
  total: number
}

const STRING_RE = /"(?:[^"]|"")*"|“[^”]*”|„[^“”]*[“”]/g

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const callRe = (name: string) => new RegExp(`(^|[^A-Za-z0-9_.$!])(${escape(name)})(\\s*\\()`, 'gi')

/** Code parts and string parts of a formula, in order. */
function segments(src: string): Array<{ code: boolean; text: string }> {
  const out: Array<{ code: boolean; text: string }> = []
  let last = 0
  for (const m of src.matchAll(STRING_RE)) {
    if (m.index! > last) out.push({ code: true, text: src.slice(last, m.index) })
    out.push({ code: false, text: m[0] })
    last = m.index! + m[0].length
  }
  if (last < src.length) out.push({ code: true, text: src.slice(last) })
  return out
}

export function formulaCalls(src: string, name: string): boolean {
  return segments(src).some((s) => s.code && callRe(name).test(s.text))
}

export function renameInFormula(src: string, from: string, to: string): string {
  return segments(src)
    .map((s) => (s.code ? s.text.replace(callRe(from), (_m, pre: string, _n: string, post: string) => `${pre}${to}${post}`) : s.text))
    .join('')
}

type Cells = Record<string, { v?: unknown } | undefined>
type Sheet = { cells?: Cells }

/** Formula cells of every spreadsheet block in a document. */
function* sheetFormulas(doc: JSONContent | null | undefined): Generator<string> {
  if (!doc || typeof doc !== 'object') return
  if (doc.type === 'spreadsheet' && Array.isArray(doc.attrs?.sheets)) {
    for (const sh of doc.attrs.sheets as Sheet[]) {
      for (const c of Object.values(sh?.cells ?? {})) if (typeof c?.v === 'string' && c.v.startsWith('=')) yield c.v
    }
  }
  if (Array.isArray(doc.content)) for (const ch of doc.content) yield* sheetFormulas(ch)
}

export function findUsage(name: string, pages: Record<ID, Page>, databases: Record<ID, Database>, functions: Record<ID, CustomFunction> | undefined, selfId?: ID): Usage {
  let cells = 0
  let dbFormulas = 0
  const where: ID[] = []
  for (const p of Object.values(pages)) {
    if (p.trashed || !p.content) continue
    let n = 0
    for (const f of sheetFormulas(p.content)) if (formulaCalls(f, name)) n++
    if (n) {
      cells += n
      where.push(p.id)
    }
  }
  for (const db of Object.values(databases)) {
    for (const prop of db.properties) if (prop.type === 'formula' && prop.formula && formulaCalls(prop.formula, name)) dbFormulas++
  }
  const fns = Object.values(functions ?? {})
    .filter((f) => f.id !== selfId && calledNames(f.body).has(name))
    .map((f) => f.name)
  return { cells, dbFormulas, functions: fns, pages: where, total: cells + dbFormulas + fns.length }
}

/** A document with every spreadsheet formula renamed (the same object when nothing changed). */
export function renameInDoc(doc: JSONContent, from: string, to: string): JSONContent {
  let changed = false
  const walk = (n: JSONContent): JSONContent => {
    let out = n
    if (n.type === 'spreadsheet' && Array.isArray(n.attrs?.sheets)) {
      const sheets = (n.attrs.sheets as Array<Sheet & Record<string, unknown>>).map((sh) => {
        if (!sh?.cells) return sh
        let touched = false
        const cells: Cells = {}
        for (const [ref, c] of Object.entries(sh.cells)) {
          if (typeof c?.v === 'string' && c.v.startsWith('=') && formulaCalls(c.v, from)) {
            cells[ref] = { ...c, v: renameInFormula(c.v, from, to) }
            touched = true
          } else cells[ref] = c
        }
        if (!touched) return sh
        changed = true
        return { ...sh, cells }
      })
      out = { ...n, attrs: { ...n.attrs, sheets } }
    }
    if (Array.isArray(n.content)) {
      const content = n.content.map(walk)
      if (content.some((c, i) => c !== n.content![i])) out = { ...out, content }
    }
    return out
  }
  const next = walk(doc)
  return changed ? next : doc
}

/** Other functions with their calls renamed (only the ones that changed). */
export function renameInFunctions(functions: Record<ID, CustomFunction> | undefined, from: string, to: string, selfId: ID): CustomFunction[] {
  const out: CustomFunction[] = []
  for (const f of Object.values(functions ?? {})) {
    if (f.id === selfId) continue
    const body = renameCalls(f.body, from, to)
    if (body !== f.body) out.push({ ...f, body })
  }
  return out
}
