/**
 * What a request's sources are, as data classes (pure: a workspace snapshot in, classes out — the Node specs run it).
 * A page is `private` (team: a private page or below one), `mail` (below the Mails database or a mail directory),
 * `memory` (below a memory / memory-log database), `rows` (a database row) or plain `page`; a synced-block copy on the
 * page counts as content of its source page too. A selection (`{ page, as: 'selection' }`) brings only the page's member
 * classes. The gate enforces them against the route (slice 2).
 */
import type { DataClass, SourceRef } from '@/shared/ai/types'
import type { Database, ID, Page } from '../../../store/types'
import type { JSONContent } from '@tiptap/core'

export interface SourceWorld {
  pages: Record<ID, Page>
  databases: Record<ID, Database>
  /** this device's Mails database (settings.mail.databaseId) */
  mailDb?: ID | null
  /** classOfPage's answers within one request (the gate keeps one per request) */
  memo?: Map<ID, Set<DataClass>>
}

/** The member classes (the member's own data): what a selection's page contributes (D-S2-27). */
const MEMBER: readonly DataClass[] = ['private', 'mail', 'memory', 'mcp']

/** Walks at most this many ancestors (a broken parent chain never loops). */
const MAX_DEPTH = 256
/** Synced-block copies looked at per page. */
const MAX_COPIES = 50

function ownClasses(id: ID, w: SourceWorld): Set<DataClass> {
  const out = new Set<DataClass>()
  const start = w.pages[id]
  if (!start) return out
  out.add(start.databaseId ? 'rows' : 'page')
  let cur: Page | undefined = start
  for (let depth = 0; cur && depth < MAX_DEPTH; depth++) {
    if (cur.private) out.add('private')
    const db = w.databases[cur.id]
    if (db) {
      if (db.system === 'memory' || db.system === 'memory-log') out.add('memory')
      if (db.system?.startsWith('mail-') || (w.mailDb && cur.id === w.mailDb)) out.add('mail')
    }
    cur = cur.parentId ? w.pages[cur.parentId] : undefined
  }
  return out
}

/** The source pages of the synced-block copies on a page. */
function syncedSources(page: Page | undefined): ID[] {
  const out: ID[] = []
  const walk = (n: JSONContent | undefined) => {
    if (!n || out.length >= MAX_COPIES) return
    if (n.type === 'syncedBlock' && typeof n.attrs?.sourcePageId === 'string') out.push(n.attrs.sourcePageId)
    n.content?.forEach(walk)
  }
  walk(page?.content as JSONContent | undefined)
  return out
}

/** The data classes a page brings into a request (memoised per request when the world carries a memo). */
export function classOfPage(id: ID, w: SourceWorld): Set<DataClass> {
  const hit = w.memo?.get(id)
  if (hit) return hit
  const out = ownClasses(id, w)
  for (const src of syncedSources(w.pages[id])) if (src !== id) for (const c of ownClasses(src, w)) out.add(c === 'rows' ? 'page' : c)
  w.memo?.set(id, out)
  return out
}

/** A page's classes from itself and its ancestors only (no synced copies) — the cheap first check of retrieval. */
export const ancestorClassesOf = (id: ID, w: SourceWorld): Set<DataClass> => ownClasses(id, w)

/** The member classes of a page (private, mail, memory): what a selection of it brings along — never `page` / `rows`. */
export function memberClassesOf(id: ID, w: SourceWorld): Set<DataClass> {
  return new Set([...classOfPage(id, w)].filter((c) => MEMBER.includes(c)))
}

/** The data classes of a request's sources. */
export function classesOf(sources: readonly SourceRef[], w: SourceWorld): Set<DataClass> {
  const out = new Set<DataClass>()
  for (const s of sources) {
    // a selection of a page carries the page's member classes (its own `selection` comes from the purpose)
    if ('page' in s) for (const c of s.as === 'selection' ? memberClassesOf(s.page, w) : classOfPage(s.page, w)) out.add(c)
    else if ('row' in s) {
      out.add('rows')
      for (const c of classOfPage(s.row, w)) out.add(c)
    } else if ('db' in s) {
      out.add('structure')
      out.add('rows')
      for (const c of classOfPage(s.db, w)) if (c !== 'page') out.add(c)
    } else if ('file' in s) out.add('files')
    else if ('all' in s) out.add('workspace')
  }
  return out
}

/** A valid source list (null: not one). */
export function isSources(v: unknown): v is readonly SourceRef[] {
  if (!Array.isArray(v)) return false
  return v.every((s) => {
    if (!s || typeof s !== 'object') return false
    const o = s as Record<string, unknown>
    if (typeof o.page === 'string') return o.as === undefined || o.as === 'selection'
    return typeof o.row === 'string' || typeof o.db === 'string' || o.file === 'upload' || o.all === true
  })
}
