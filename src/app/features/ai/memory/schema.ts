/**
 * One memory — the two databases, found by their marker (`Database.system`), created on first use (the
 * first confirmed memory, or "Set up memory" in Settings). Store actions only.
 *
 *  - 'memory' — "One memory" / "One-Gedächtnis": Name (the memory as one sentence), Type, Topics, Source,
 *    Active, Used in / Cited in (two-way relations to the log), Uses / Last used (rollups over Cited in).
 *  - 'memory-log' — "Memory log" / "Gedächtnis-Verlauf": one row per request that took memories along
 *    (log.ts): Name (date · request), When (created time), Where, Page, Memories / Used (the forward
 *    sides of the two relations), Result.
 *  - Local workspace: top level. Team workspace: in the member's PRIVATE section (createPrivateDatabase,
 *    like Mail), and only private ones count — a memory moved to the shared space is no longer read.
 *  - Several marked databases (a duplicate, a restored backup): the oldest live one counts. A deleted log
 *    is created again (with fresh relations) on next use; a deleted memory just means "no memory yet".
 *  - Both are ordinary databases: properties are found by name (EN / DE) and type, then by type alone, so
 *    renamed columns keep working; a missing one is left out when reading or writing; a locked database
 *    gets no new properties.
 */
import { defaultView, useWorkspace } from '../../../store/store'
import { inTemplate, isEffectivelyTrashed } from '../../../store/selectors'
import type { ColorName, Database, ID, PropertyDef, SelectOption, View } from '../../../store/types'
import { newId } from '../../../lib/ids'
import { createPrivateDatabase, useCloud } from '../../../cloud'
import { ALL_MESSAGES, t } from '../../../i18n'
import { MEMORY_TYPES, type MemoryRole, type MemoryType } from './types'

/** The reverse side of a two-way relation pair (database/model/actions.ts TWO_WAY_SUFFIX). */
const TWO_WAY = '.2way'

const ROLE_TYPE: Record<MemoryRole, PropertyDef['type']> = {
  type: 'select',
  topics: 'multi_select',
  source: 'text',
  active: 'checkbox',
  tag: 'text',
}
const ROLES = Object.keys(ROLE_TYPE) as MemoryRole[]

export type LogRole = 'when' | 'where' | 'page' | 'memories' | 'used' | 'result'

export const TYPE_COLOR: Record<MemoryType, ColorName> = { fact: 'gray', preference: 'blue', decision: 'orange', procedure: 'green', example: 'brown' }

const ws = () => useWorkspace.getState()

/** Team workspace? (the memory is then private) */
export const inTeam = () => useCloud.getState().active.kind === 'cloud'

/** Is the active workspace read-only for this person (a viewer)? */
export const memoryReadOnly = () => useCloud.getState().readOnly

/** Both languages' strings of a key, lower-cased (an existing database may be in the other language). */
const both = (key: string) => [ALL_MESSAGES.en[key], ALL_MESSAGES.de[key]].filter(Boolean).map((n) => n.trim().toLowerCase())
const named = (p: PropertyDef, key: string) => both(key).includes(p.name.trim().toLowerCase())

/** The type of an option name (either language; '' / unknown = null). */
export function typeOfName(name: string | undefined | null): MemoryType | null {
  const n = (name ?? '').trim().toLowerCase()
  if (!n) return null
  return MEMORY_TYPES.find((x) => both(`features.memory.type.${x}`).includes(n) || x === n) ?? null
}

/* ------------------------------------------------------------------ */
/* Finding                                                             */
/* ------------------------------------------------------------------ */

function findSystem(kind: 'memory' | 'memory-log'): ID | null {
  const { pages, databases } = ws()
  const team = inTeam()
  let best: { id: ID; at: number } | null = null
  for (const db of Object.values(databases)) {
    if (db.system !== kind) continue
    const p = pages[db.id]
    if (!p || p.kind !== 'database' || p.trashed || isEffectivelyTrashed(pages, db.id) || inTemplate(pages, db.id)) continue
    if (team && !p.private) continue
    if (!best || p.createdAt < best.at || (p.createdAt === best.at && db.id < best.id)) best = { id: db.id, at: p.createdAt }
  }
  return best?.id ?? null
}

/** The memory database: the oldest live marked one (team: a private one only). */
export const memoryDbId = (): ID | null => findSystem('memory')

/** The memory log database (same rules). */
export const logDbId = (): ID | null => findSystem('memory-log')

export interface MemoryProps extends Partial<Record<MemoryRole, ID>> {
  /** relations to the log (reverse sides): every request that took the memory along / that cited it */
  usedIn?: ID
  citedIn?: ID
}

/** The property ids of the memory database by role (by name in either language + type, then by type). */
export function memoryProps(db: Database): MemoryProps {
  const out: MemoryProps = {}
  const taken = new Set<ID>()
  for (const role of ROLES) {
    const fits = (p: PropertyDef) => p.type === ROLE_TYPE[role] && !taken.has(p.id)
    const prop = db.properties.find((p) => fits(p) && named(p, `features.memory.prop.${role}`)) ?? db.properties.find(fits)
    if (prop) {
      out[role] = prop.id
      taken.add(prop.id)
    }
  }
  // the relations to the log: the reverse sides of the log's Memories / Used
  const logId = logDbId()
  const log = logId ? ws().databases[logId] : undefined
  if (log) {
    const lr = logProps(log, db.id)
    const rel = (fwd: ID | undefined) => (fwd ? db.properties.find((p) => p.id === fwd + TWO_WAY && p.type === 'relation' && p.relationDatabaseId === log.id)?.id : undefined)
    out.usedIn = rel(lr.memories)
    out.citedIn = rel(lr.used)
  }
  return out
}

/** The property ids of the log by role (Memories / Used: relations to `memId`, by name, then in order). */
export function logProps(db: Database, memId: ID | null = memoryDbId()): Partial<Record<LogRole, ID>> & { title?: ID } {
  const out: Partial<Record<LogRole, ID>> & { title?: ID } = {}
  out.title = db.properties.find((p) => p.type === 'title')?.id
  const find = (type: PropertyDef['type'], key: string, taken: Set<ID>) => db.properties.find((p) => p.type === type && !taken.has(p.id) && named(p, key)) ?? db.properties.find((p) => p.type === type && !taken.has(p.id))
  const taken = new Set<ID>()
  const put = (role: LogRole, p: PropertyDef | undefined) => {
    if (!p) return
    out[role] = p.id
    taken.add(p.id)
  }
  put('when', find('created_time', 'features.memory.log.prop.when', taken))
  put('where', find('select', 'features.memory.log.prop.where', taken))
  put('page', find('text', 'features.memory.log.prop.page', taken))
  put('result', find('text', 'features.memory.log.prop.result', taken))
  const rels = db.properties.filter((p) => p.type === 'relation' && !!memId && p.relationDatabaseId === memId)
  const byName = (key: string) => rels.find((p) => !taken.has(p.id) && named(p, key))
  put('memories', byName('features.memory.log.prop.memories') ?? rels.find((p) => !taken.has(p.id)))
  put('used', byName('features.memory.log.prop.used') ?? rels.find((p) => !taken.has(p.id)))
  return out
}

/* ------------------------------------------------------------------ */
/* Creating                                                            */
/* ------------------------------------------------------------------ */

function create(input: { id: ID; title: string; icon: string; properties: PropertyDef[]; views: View[] }, system: 'memory' | 'memory-log'): ID {
  const data = { id: input.id, parentId: null, title: input.title, icon: { type: 'asset' as const, value: input.icon }, properties: input.properties, views: input.views }
  const id = inTeam() ? createPrivateDatabase(data) : ws().createDatabase(data)
  ws().updateDatabase(id, { system })
  return id
}

function memoryBaseProps(): PropertyDef[] {
  return [
    { id: newId(), name: t('features.memory.prop.name'), type: 'title' },
    { id: newId(), name: t('features.memory.prop.type'), type: 'select', options: MEMORY_TYPES.map((x): SelectOption => ({ id: newId(), name: t(`features.memory.type.${x}`), color: TYPE_COLOR[x] })) },
    { id: newId(), name: t('features.memory.prop.topics'), type: 'multi_select', options: [] },
    { id: newId(), name: t('features.memory.prop.active'), type: 'checkbox' },
    { id: newId(), name: t('features.memory.prop.source'), type: 'text' },
    { id: newId(), name: t('features.memory.prop.tag'), type: 'text' },
  ]
}

/** The memory's views: "All" (Name, Type, Topics, Uses, Last used, Active) and "By type" (board). */
function memoryViews(db: Database): View[] {
  const r = memoryProps(db)
  const uses = db.properties.find((p) => p.type === 'rollup' && p.rollup?.fn === 'count')?.id
  const last = db.properties.find((p) => p.type === 'rollup' && p.rollup?.fn === 'latest_date')?.id
  const table = defaultView('table', db, t('features.memory.view.all'))
  table.visibleProperties = [r.type, r.tag, r.topics, uses, last, r.active].filter((x): x is ID => !!x)
  const board = defaultView('board', db, t('features.memory.view.byType'))
  board.groupBy = r.type ?? null
  board.visibleProperties = [r.topics, uses].filter((x): x is ID => !!x)
  return [table, board]
}

/** A fresh log for `memId`: its own properties + the forward sides of Memories / Used. */
function createLog(memId: ID): ID {
  const id = newId()
  const title: PropertyDef = { id: newId(), name: t('features.memory.log.prop.name'), type: 'title' }
  const when: PropertyDef = { id: newId(), name: t('features.memory.log.prop.when'), type: 'created_time' }
  const where: PropertyDef = { id: newId(), name: t('features.memory.log.prop.where'), type: 'select', options: [] }
  const page: PropertyDef = { id: newId(), name: t('features.memory.log.prop.page'), type: 'text' }
  const memories: PropertyDef = { id: newId(), name: t('features.memory.log.prop.memories'), type: 'relation', relationDatabaseId: memId }
  const used: PropertyDef = { id: newId(), name: t('features.memory.log.prop.used'), type: 'relation', relationDatabaseId: memId }
  const result: PropertyDef = { id: newId(), name: t('features.memory.log.prop.result'), type: 'text' }
  const properties = [title, when, where, memories, used, page, result]
  const table = defaultView('table', { properties }, t('features.memory.log.view.table'))
  table.sorts = [{ propertyId: when.id, direction: 'desc' }]
  table.visibleProperties = [when.id, where.id, memories.id, used.id, page.id, result.id]
  const feed = defaultView('feed', { properties }, t('features.memory.log.view.feed'))
  feed.feed = { dateProperty: null, order: 'newest', content: true }
  feed.visibleProperties = [where.id, used.id]
  return create({ id, title: t('features.memory.log.dbTitle'), icon: 'clock', properties, views: [table, feed] }, 'memory-log')
}

/**
 * The log of the memory `memId` — created when there is none — with the reverse relations ("Used in",
 * "Cited in") and the rollups (Uses, Last used) on the memory (not on a locked one). Returns the log id.
 */
export function ensureLog(memId: ID): ID {
  const logId = logDbId() ?? createLog(memId)
  const s = ws()
  const mem = s.databases[memId]
  const log = s.databases[logId]
  if (!mem || !log || mem.locked) return logId
  const lr = logProps(log, memId)
  const titleId = lr.title
  // the reverse sides, backfilled from the log's rows
  const pairs: Array<[ID | undefined, string]> = [
    [lr.memories, t('features.memory.prop.usedIn')],
    [lr.used, t('features.memory.prop.citedIn')],
  ]
  for (const [fwd, name] of pairs) {
    if (!fwd || mem.properties.some((p) => p.id === fwd + TWO_WAY)) continue
    const back = s.addProperty(memId, { id: fwd + TWO_WAY, type: 'relation', name, relationDatabaseId: logId })
    const index = new Map<ID, ID[]>()
    for (const row of Object.values(ws().pages)) {
      if (row.databaseId !== logId || row.trashed) continue
      for (const m of (row.properties[fwd] as ID[] | undefined) ?? []) index.set(m, [...(index.get(m) ?? []), row.id])
    }
    for (const [m, ids] of index) if (ws().pages[m]?.databaseId === memId) ws().setRowProperty(m, back, ids)
  }
  // Uses / Last used: computed over Cited in
  const cited = lr.used ? lr.used + TWO_WAY : null
  const now = ws().databases[memId]!
  if (cited && now.properties.some((p) => p.id === cited)) {
    const rollups: Array<[string, 'count' | 'latest_date', ID | undefined]> = [
      ['features.memory.prop.uses', 'count', titleId],
      ['features.memory.prop.lastUsed', 'latest_date', lr.when],
    ]
    for (const [key, fn, target] of rollups) {
      if (!target) continue
      const cfg = { relationPropertyId: cited, targetPropertyId: target, fn }
      const prop = now.properties.find((p) => p.type === 'rollup' && named(p, key)) ?? now.properties.find((p) => p.type === 'rollup' && p.rollup?.fn === fn)
      if (!prop) ws().addProperty(memId, { type: 'rollup', name: t(key), rollup: cfg })
      else if (prop.rollup?.relationPropertyId !== cited || prop.rollup?.targetPropertyId !== target) ws().updateProperty(memId, prop.id, { rollup: cfg })
    }
  }
  return logId
}

/**
 * The memory database — created with its log when there is none (top level; private in a team
 * workspace). Throws when it cannot be created (a viewer in a team workspace).
 */
export function ensureMemoryDb(): ID {
  const found = memoryDbId()
  if (found) {
    if (!logDbId()) ensureLog(found)
    return found
  }
  if (memoryReadOnly()) throw new Error('read-only')
  const properties = memoryBaseProps()
  const id = create({ id: newId(), title: t('features.memory.dbTitle'), icon: 'cardbox', properties, views: [defaultView('table', { properties }, t('features.memory.view.all'))] }, 'memory')
  ensureLog(id)
  const db = ws().databases[id]
  if (db) ws().updateDatabase(id, { views: memoryViews(db) })
  return id
}

/**
 * Examples (example.ts) need the Type option "Example" and the property "Tag" — added to a memory database
 * made before them. Throws 'locked' when a locked database lacks them.
 */
export function ensureExampleSchema(dbId: ID): { typeId: ID; tagId: ID } {
  const s = ws()
  let db = s.databases[dbId]
  if (!db) throw new Error('gone')
  let r = memoryProps(db)
  if (!r.tag) {
    if (db.locked) throw new Error('locked')
    s.addProperty(dbId, { type: 'text', name: t('features.memory.prop.tag') })
    db = ws().databases[dbId]!
    r = memoryProps(db)
  }
  if (!r.type) {
    if (db.locked) throw new Error('locked')
    s.addProperty(dbId, { type: 'select', name: t('features.memory.prop.type'), options: [] })
    r = memoryProps(ws().databases[dbId]!)
  }
  if (!r.type || !r.tag || !typeOption(dbId, r.type, 'example')) throw new Error('locked')
  return { typeId: r.type, tagId: r.tag }
}

/** The option id for a memory type in the Type property (added when missing, never in a locked database). */
export function typeOption(dbId: ID, propId: ID, type: MemoryType): ID | null {
  const s = ws()
  const db = s.databases[dbId]
  const prop = db?.properties.find((p) => p.id === propId)
  if (!db || !prop) return null
  const hit = (prop.options ?? []).find((o) => typeOfName(o.name) === type)
  if (hit) return hit.id
  if (db.locked) return null
  const opt: SelectOption = { id: newId(), name: t(`features.memory.type.${type}`), color: TYPE_COLOR[type] }
  s.updateProperty(dbId, propId, { options: [...(prop.options ?? []), opt] })
  return opt.id
}

const PALETTE: ColorName[] = ['blue', 'green', 'orange', 'purple', 'pink', 'brown', 'yellow', 'red', 'gray']

/** Option ids for names of a select / multi-select (case-insensitive; missing ones are added, never in a locked database). */
export function optionIds(dbId: ID, propId: ID, names: string[]): ID[] {
  const s = ws()
  const db = s.databases[dbId]
  const prop = db?.properties.find((p) => p.id === propId)
  if (!db || !prop) return []
  const options: SelectOption[] = [...(prop.options ?? [])]
  const out: ID[] = []
  let added = false
  for (const raw of names) {
    const name = raw.trim()
    if (!name) continue
    let opt = options.find((o) => o.name.trim().toLowerCase() === name.toLowerCase())
    if (!opt && !db.locked) {
      opt = { id: newId(), name, color: PALETTE[options.length % PALETTE.length] }
      options.push(opt)
      added = true
    }
    if (opt && !out.includes(opt.id)) out.push(opt.id)
  }
  if (added) s.updateProperty(dbId, propId, { options })
  return out
}
