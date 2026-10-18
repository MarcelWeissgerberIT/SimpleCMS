/**
 * One's own databases are read-only over MCP (the local bridge's src/app/features/mcp/system.ts — same rules, same
 * words): the memory and its log, Mails and the mail directories, the Coding · Business analysis · QA pipelines and
 * the test cases (the meta document's database entry `system`). No row, property, view or option of one changes, no
 * page below its rows is created or edited, none of it is moved or trashed over MCP. Reading stays allowed.
 *
 * Seams (small and exported): systemOf(r, id) · systemBelow(r, id) · systemRefusal(hit) · assertNotSystem(r, id) ·
 * assertTreeNotSystem(r, id).
 */
import * as Y from 'yjs'
import { databaseMap, inTemplate, pageMap, type Roots } from '../api/meta.ts'
import { ApiError } from '../errors.ts'

export const SYSTEM_KINDS = ['memory', 'memory-log', 'mails', 'mail-contacts', 'mail-companies', 'mail-conversations', 'coding', 'spec', 'qa', 'testcases'] as const
export type SystemKind = (typeof SYSTEM_KINDS)[number]

export interface SystemHit {
  kind: SystemKind
  dbId: string
  title: string
}

const KIND_TEXT: Record<SystemKind, string> = {
  memory: 'memory',
  'memory-log': 'memory log',
  mails: 'Mails',
  'mail-contacts': 'mail contacts',
  'mail-companies': 'mail companies',
  'mail-conversations': 'mail conversations',
  coding: 'Coding pipeline',
  spec: 'Business analysis pipeline',
  qa: 'QA pipeline',
  testcases: 'test cases',
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : null)

/** The `system` marker of a database entry (any non-empty string counts — a newer kind is guarded too). */
export function systemKindOf(r: Roots, dbId: string): SystemKind | null {
  const kind = str(databaseMap(r, dbId)?.get('system'))
  return (kind as SystemKind | null) ?? null
}

/** The One database a page belongs to: the database page itself, a row, or a page below a row (cycle-safe). */
export function systemOf(r: Roots, id: string | null | undefined): SystemHit | null {
  const seen = new Set<string>()
  let cur = id ?? null
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const yp = pageMap(r, cur)
    if (!yp) return null
    if (yp.get('kind') === 'database') {
      const kind = systemKindOf(r, cur)
      if (kind) return { kind, dbId: cur, title: String(yp.get('title') ?? '').trim() || 'Untitled' }
    }
    cur = str(yp.get('databaseId')) ?? str(yp.get('parentId'))
  }
  return null
}

/** A One database in this page's tree (the page itself or anything below it, trashed parts left out). */
export function systemBelow(r: Roots, id: string): SystemHit | null {
  const own = systemOf(r, id)
  if (own) return own
  const kids = new Map<string, string[]>()
  for (const [pid, yp] of r.pages.entries()) {
    if (!(yp instanceof Y.Map) || yp.get('trashed') === true) continue
    const parent = str(yp.get('parentId'))
    if (parent) kids.set(parent, [...(kids.get(parent) ?? []), pid])
  }
  const stack = [id]
  const seen = new Set(stack)
  while (stack.length) {
    for (const kid of kids.get(stack.pop()!) ?? []) {
      if (seen.has(kid)) continue
      seen.add(kid)
      const yp = pageMap(r, kid)
      const kind = yp?.get('kind') === 'database' ? systemKindOf(r, kid) : null
      if (kind && !inTemplate(r, kid)) return { kind, dbId: kid, title: String(yp?.get('title') ?? '').trim() || 'Untitled' }
      stack.push(kid)
    }
  }
  return null
}

export const systemNote = (kind: SystemKind): string => `One's ${KIND_TEXT[kind] ?? kind} database: read-only over MCP (rows, properties, views).`

/**
 * The `system_database` refusal (422). `path`: the argument it is about; `why`: what the call would have changed there,
 * when that is not plain from the call (a two-way relation's reverse side, a partner row).
 */
export function systemRefusal(hit: SystemHit, path = '', why = '') {
  return new ApiError(
    422,
    'system_database',
    `system_database: ${path ? `${path}: ` : ''}${JSON.stringify(hit.title)} is One's ${KIND_TEXT[hit.kind] ?? hit.kind} database; over MCP it is read-only (its rows, the pages below them, its properties and views)${why ? ` — ${why}` : ''}. Nothing was changed. Reading it stays allowed; changes there are made in One.`,
  )
}

export function assertNotSystem(r: Roots, id: string | null | undefined, path = '', why = ''): void {
  const hit = systemOf(r, id)
  if (hit) throw systemRefusal(hit, path, why)
}

export function assertTreeNotSystem(r: Roots, id: string): void {
  const hit = systemBelow(r, id)
  if (hit) throw systemRefusal(hit)
}
