/**
 * Per-field trust — what the plate lists (pure; the workspace, the book and the runs come in as arguments):
 *  - rows = the keys with verdicts on this device ∪ the value properties of the databases the agent's last 5 runs here
 *    staged changes for (at most 4 databases, newest first; "+n databases" beyond);
 *  - grouped by database (the recent ones first), inside a group DIREKT → FREIGEBBAR → most green → property order;
 *  - the footer's NIE DIREKT names: "only by hand" properties and the key property of the databases on the plate.
 */
import type { Translate } from '@/shared/i18n'
import type { Database, ID, Page, PropertyType, Workspace } from '../../../store/types'
import { isHandOnly, keyPropOf } from '../../../store/keys'
import { notDirect, parseTrustKey, propTrustKey, type TrustKey } from '../../../store/autonomy'
import type { AgentRun } from '../types'
import { keyLabel, type KeyLabel } from './keys'
import { lampOf, readiness, type Lamp, type Readiness } from './rules'
import type { TrustBook } from './types'

/** Runs read for "databases it worked on". */
const RECENT_RUNS = 5
/** Databases from those runs on the plate. */
const MAX_DBS = 4
/** Rows shown before "+ n more". */
export const PLATE_ROWS = 12
/** S1 is read only: nothing can be granted yet, so every lamp reads PRÜFUNG (the notes say how far a key is). S2: true. */
export const GRANTS = false

/** Property types that are never a key's field: the title (its own change) and the computed ones. */
const NOT_VALUE: ReadonlySet<PropertyType> = new Set<PropertyType>(['title', 'formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id'])

export interface PlateRow {
  key: TrustKey
  label: KeyLabel
  r: Readiness
  lamp: Lamp
  /** verdicts of the key on this device */
  entries: number
  granted: boolean
  effective: boolean
}

export interface PlateGroup {
  /** the database (or page) the keys are about; null: new top-level pages */
  id: ID | null
  title: string
  rows: PlateRow[]
}

export interface Plate {
  groups: PlateGroup[]
  /** rows in all groups */
  total: number
  /** databases of recent runs left off the plate */
  moreDbs: number
  /** NIE DIREKT: "only by hand" property names and key property names of the plate's databases */
  hand: string[]
  keyProps: string[]
  /** no verdict on this device and nothing granted */
  empty: boolean
}

type Ws = Pick<Workspace, 'pages' | 'databases'>

const live = (s: Ws, id: ID | null | undefined): id is ID => !!id && !!s.databases[id] && !!s.pages[id] && !s.pages[id].trashed

/** The databases the agent's newest runs staged changes for, newest first. */
export function recentDatabases(runs: AgentRun[], s: Ws): ID[] {
  const out: ID[] = []
  for (const run of runs.slice(0, RECENT_RUNS)) {
    for (const c of run.staged ?? []) {
      const row = run.rowIds?.[c.pageId] ?? c.pageId
      const db = c.kind === 'update_row' || c.kind === 'create_row' ? (c.databaseId ?? s.pages[row]?.databaseId) : s.pages[row]?.databaseId
      if (live(s, db) && !out.includes(db)) out.push(db)
    }
  }
  return out
}

/** The id a key belongs under (its database, the page it is about, a new page's parent). */
function groupOf(k: TrustKey): ID | null {
  const p = parseTrustKey(k)
  if (!p) return null
  if (p.kind === 'prop' || p.kind === 'row') return p.db
  if (p.kind === 'page') return p.parent
  return p.target
}

const RANK: Record<Lamp, number> = { direct: 0, ready: 1, idle: 2, review: 3, never: 4 }

export function plateOf(x: { book: TrustBook | null; runs: AgentRun[]; ws: Ws; now: number; t: Translate }): Plate {
  const { book, ws, now, t } = x
  const recent = recentDatabases(x.runs, ws)
  const dbs = recent.slice(0, MAX_DBS)
  const keys = new Set<TrustKey>()
  for (const [k, list] of Object.entries(book?.entries ?? {})) if (list.length) keys.add(k)
  for (const k of Object.keys(book?.head.granted ?? {})) keys.add(k)
  const hand = new Set<string>()
  const keyProps = new Set<string>()
  for (const id of dbs) {
    const db: Database = ws.databases[id]
    const key = keyPropOf(db)
    for (const p of db.properties) {
      if (NOT_VALUE.has(p.type)) continue
      if (isHandOnly(p)) hand.add(p.name.trim())
      else if (key?.id === p.id) keyProps.add(p.name.trim())
      else keys.add(propTrustKey(id, p.id))
    }
  }
  const empty = !Object.values(book?.entries ?? {}).some((l) => l.length) && !Object.keys(book?.head.granted ?? {}).length
  const rows: Array<PlateRow & { group: ID | null; order: number }> = []
  for (const k of keys) {
    const p = parseTrustKey(k)
    if (!p) continue
    // a hand-only or key property with old verdicts stays off the rows: the footer names it
    const why = notDirect(k, ws)
    if (why === 'hand' || why === 'key') continue
    const entries = book?.entries[k] ?? []
    const r = readiness(entries, book?.head.lastRevoke[k], now)
    const granted = false
    const effective = false
    const order = p.kind === 'prop' ? (ws.databases[p.db]?.properties.findIndex((d) => d.id === p.prop) ?? 999) : 999
    rows.push({ key: k, label: keyLabel(k, ws, t), r, lamp: lampOf(r, granted, effective, why === null), entries: entries.length, granted, effective, group: groupOf(k), order })
  }
  rows.sort((a, b) => RANK[a.lamp] - RANK[b.lamp] || b.r.green - a.r.green || a.order - b.order || a.key.localeCompare(b.key))
  // groups: the recent databases first, then the others by their best row
  const ids: Array<ID | null> = [...dbs.filter((id) => rows.some((r) => r.group === id))]
  for (const r of rows) if (!ids.includes(r.group)) ids.push(r.group)
  const groups: PlateGroup[] = ids.map((id) => ({
    id,
    title: id ? titleOf(ws.pages, id, t) : '',
    rows: rows.filter((r) => r.group === id).map(({ group: _g, order: _o, ...row }) => row),
  }))
  return { groups, total: rows.length, moreDbs: Math.max(0, recent.length - dbs.length), hand: [...hand], keyProps: [...keyProps], empty }
}

const titleOf = (pages: Record<ID, Page>, id: ID, t: Translate) => pages[id]?.title.trim() || t('common.untitled')
