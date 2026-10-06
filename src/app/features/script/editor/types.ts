/**
 * One Script editor — the kinds of values the editor infers without running anything (pure, no store):
 * a database or a query on it, its rows, one row, pages, people, texts, numbers, dates, lists of
 * something, records with known fields, the groups of .group(…). What the editor knows about the
 * workspace comes in through WsInfo (the workbench passes the store's; tests pass their own).
 */
import type { MemberKind } from '../catalog'

export interface PropInfo {
  name: string
  /** the database property type ('status', 'date', 'relation' …) */
  type: string
  /** select / status / multi_select: option names (status: in their order) */
  options: string[]
  /** relation: the related database */
  target: string | null
}

export interface DbInfo {
  id: string
  name: string
  props: PropInfo[]
}

export interface RefInfo {
  kind: 'database' | 'row' | 'page'
  /** a row's database */
  dbId: string | null
}

/** What the editor may know about the workspace. */
export interface WsInfo {
  /** a database by id, else by title */
  db(id: string | null, name: string | null): DbInfo | null
  /** what an @ reference's page is */
  ref(id: string): RefInfo | null
  /** the names of the workspace's people */
  people(): string[]
  /** titles of a database's entries (values of a relation to it) */
  titles(dbId: string): string[]
  /** names the code sees without declaring them (features/kit: `value`, `old`, `row`) */
  globals?(): Array<[string, Ty | null]>
}

export const NO_WS: WsInfo = { db: () => null, ref: () => null, people: () => [], titles: () => [] }

/** A database as the code names it: by id (an @ chip) and / or by name. */
export interface DbRef {
  id: string | null
  name: string | null
}

export type Ty =
  /** a database (q = with query steps: where / sort … — add() needs the plain database) */
  | { k: 'db'; db: DbRef; q: boolean }
  | { k: 'row'; db: DbRef }
  | { k: 'list'; of: Ty | null }
  | { k: 'record'; fields: Array<[string, Ty | null]> | null }
  /** one group of .group(…): key, rows (of `of`), count */
  | { k: 'group'; of: Ty | null }
  | { k: 'ns'; name: 'mail' | 'create' | 'http' | 'pagefn' }
  | { k: 'page' }
  | { k: 'person' }
  | { k: 'text' }
  | { k: 'number' }
  | { k: 'bool' }
  | { k: 'date' }
  | { k: 'duration' }
  | { k: 'fn' }
  | { k: 'agent' }
  | { k: 'script' }

export const T = {
  text: { k: 'text' } as Ty,
  number: { k: 'number' } as Ty,
  bool: { k: 'bool' } as Ty,
  date: { k: 'date' } as Ty,
  duration: { k: 'duration' } as Ty,
  page: { k: 'page' } as Ty,
  person: { k: 'person' } as Ty,
  fn: { k: 'fn' } as Ty,
  agent: { k: 'agent' } as Ty,
  script: { k: 'script' } as Ty,
  list: (of: Ty | null): Ty => ({ k: 'list', of }),
  row: (db: DbRef): Ty => ({ k: 'row', db }),
  db: (db: DbRef, q = false): Ty => ({ k: 'db', db, q }),
  record: (fields: Array<[string, Ty | null]> | null): Ty => ({ k: 'record', fields }),
}

/** The kind whose members a value has. */
export function memberKindOf(ty: Ty | null): MemberKind | null {
  if (!ty) return null
  switch (ty.k) {
    case 'db':
      return 'query'
    case 'ns':
      return ty.name
    case 'fn':
      return null
    case 'bool':
      return null
    default:
      return ty.k
  }
}

/** One item of a list-like value (for … in, where / map on it). */
export function elemOf(ty: Ty | null): Ty | null {
  if (!ty) return null
  if (ty.k === 'db') return T.row(ty.db)
  if (ty.k === 'list') return ty.of
  if (ty.k === 'text') return T.text
  return null
}

/** The database rows of this value belong to (a query, rows, a row). */
export function dbOf(ty: Ty | null): DbRef | null {
  if (!ty) return null
  if (ty.k === 'db' || ty.k === 'row') return ty.db
  if (ty.k === 'list' && ty.of?.k === 'row') return ty.of.db
  if (ty.k === 'group') return dbOf(ty.of)
  return null
}

/** What a database property reads as in a script. */
export function propTy(p: PropInfo): Ty | null {
  switch (p.type) {
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
    case 'select':
    case 'status':
    case 'created_by':
    case 'last_edited_by':
      return T.text
    case 'number':
    case 'rating':
    case 'unique_id':
      return T.number
    case 'checkbox':
      return T.bool
    case 'multi_select':
    case 'files':
      return T.list(T.text)
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return T.date
    case 'person':
      return T.list(T.person)
    case 'relation':
      return T.list(p.target ? T.row({ id: p.target, name: null }) : null)
    default:
      return null
  }
}

/** A property by name: exact, then ignoring case and spaces around it (like the runtime). */
export function propByName(db: DbInfo, name: string): PropInfo | undefined {
  const n = name.trim().toLowerCase()
  return db.props.find((p) => p.name === name) ?? db.props.find((p) => p.name.trim().toLowerCase() === n)
}

/**
 * A short label of a type for the completion list (language-neutral parts; the UI translates `key`):
 * { key: 'rowsOf', db: 'Projects' } → "ROWS · Projects".
 */
export interface TyLabel {
  key: 'db' | 'query' | 'rows' | 'row' | 'list' | 'record' | 'group' | 'page' | 'person' | 'text' | 'number' | 'bool' | 'date' | 'duration' | 'fn' | 'agent' | 'script' | 'ns'
  /** the database's name, a list's item kind … */
  of?: string
}

export function tyLabel(ty: Ty | null, ws: WsInfo): TyLabel | null {
  if (!ty) return null
  const dbName = (r: DbRef) => (r.id ? ws.db(r.id, r.name)?.name : null) ?? r.name ?? undefined
  switch (ty.k) {
    case 'db':
      return { key: ty.q ? 'query' : 'db', of: dbName(ty.db) }
    case 'row':
      return { key: 'row', of: dbName(ty.db) }
    case 'list':
      if (ty.of?.k === 'row') return { key: 'rows', of: dbName(ty.of.db) }
      return { key: 'list', of: ty.of ? tyLabel(ty.of, ws)?.key : undefined }
    case 'ns':
      return { key: 'ns', of: ty.name }
    default:
      return { key: ty.k }
  }
}
