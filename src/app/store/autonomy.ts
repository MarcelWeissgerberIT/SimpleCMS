/**
 * Per-field trust keys (features/agents/trust) — pure rules shared by the store, the agents' review and the runner:
 *
 *  - a trust key names what kind of change an agent makes, and where: `prop:<db>:<prop>` (update_row, one per
 *    property), `row:<db>` (create_row), `append:` / `rename:` / `edit:<target>` (a row's database, else the page) and
 *    `page:<parent>` (create_page; `-` = top level). Ids are [A-Za-z0-9_-]{1,64}.
 *  - verdicts are kept for every key; only DIRECT_KINDS can ever be granted, and only while `notDirect()` is null.
 *
 * Nothing here reaches the store or the DOM (a Node spec loads it).
 */
import type { Database, ID, Page, PropertyType, Workspace } from './types'
import { isHandOnly, keyPropOf } from './keys'

/** A trust key: what kind of change, where. Ids [A-Za-z0-9_-]{1,64}. */
export type TrustKey = string

export const TRUST_KEY_RE = /^(?:prop:[\w-]{1,64}:[\w-]{1,64}|row:[\w-]{1,64}|(?:append|rename|edit):[\w-]{1,64}|page:(?:[\w-]{1,64}|-))$/

export type ParsedKey =
  /** update_row, one per property — direct-eligible (S2) */
  | { kind: 'prop'; db: ID; prop: ID }
  /** create_row in that database — direct-eligible (S4) */
  | { kind: 'row'; db: ID }
  /** a row's database id, else the page id — verdicts only */
  | { kind: 'append' | 'rename' | 'edit'; target: ID }
  /** create_page (null = top level) — verdicts only */
  | { kind: 'page'; parent: ID | null }

export function parseTrustKey(k: string): ParsedKey | null {
  if (typeof k !== 'string' || !TRUST_KEY_RE.test(k)) return null
  const at = k.indexOf(':')
  const kind = k.slice(0, at)
  const rest = k.slice(at + 1)
  if (kind === 'prop') {
    const [db, prop] = rest.split(':')
    return { kind, db, prop }
  }
  if (kind === 'row') return { kind, db: rest }
  if (kind === 'page') return { kind, parent: rest === '-' ? null : rest }
  if (kind === 'append' || kind === 'rename' || kind === 'edit') return { kind, target: rest }
  return null
}

export const propTrustKey = (db: ID, prop: ID): TrustKey => `prop:${db}:${prop}`
export const rowTrustKey = (db: ID): TrustKey => `row:${db}`

/** Key kinds a grant may name. S1–S3: prop only; S4 adds 'row'. */
export const DIRECT_KINDS: ReadonlySet<ParsedKey['kind']> = new Set(['prop'])

/** Property types a direct change may write (v1). Never: title, person, relation, files, computed types, own types. */
export const DIRECT_TYPES: ReadonlySet<PropertyType> = new Set<PropertyType>(['checkbox', 'select', 'multi_select', 'status', 'number', 'date', 'text', 'url', 'email', 'phone'])

/**
 * Why a key cannot be direct now (null = it can): a kind that is never direct, the database / property gone or
 * trashed, "only by hand" (isHandOnly), the database's key property (`keyPropOf`, store/keys.ts — a direct rewrite
 * would break how upsert_rows finds rows), an own type (`PropertyDef.custom`) or a type outside DIRECT_TYPES.
 */
export type NotDirect = 'kind' | 'gone' | 'trashed' | 'hand' | 'type' | 'custom' | 'key'

/** The page or one of its ancestors is in the trash (a plain walk: this module may not load the store's selectors). */
function trashedUp(pages: Record<ID, Page>, id: ID): boolean {
  const seen = new Set<ID>()
  let cur: Page | undefined = pages[id]
  while (cur && !seen.has(cur.id)) {
    if (cur.trashed) return true
    seen.add(cur.id)
    cur = cur.parentId ? pages[cur.parentId] : undefined
  }
  return false
}

export function notDirect(k: TrustKey, s: Pick<Workspace, 'pages' | 'databases'>): NotDirect | null {
  const p = parseTrustKey(k)
  if (!p || !DIRECT_KINDS.has(p.kind) || p.kind !== 'prop') return 'kind'
  const db: Database | undefined = s.databases[p.db]
  const prop = db?.properties.find((d) => d.id === p.prop)
  if (!db || !s.pages[p.db] || !prop) return 'gone'
  if (trashedUp(s.pages, p.db)) return 'trashed'
  if (isHandOnly(prop)) return 'hand'
  if (keyPropOf(db)?.id === prop.id) return 'key'
  if (prop.custom) return 'custom'
  if (!DIRECT_TYPES.has(prop.type)) return 'type'
  return null
}
