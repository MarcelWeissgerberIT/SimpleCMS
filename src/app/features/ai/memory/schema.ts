/**
 * One memory — the database: found by its marker (`Database.system = 'memory'`), created on first use
 * (the first confirmed memory, or "Set up memory" in Settings). Store actions only.
 *
 *  - Local workspace: a top-level database "One memory" / "One-Gedächtnis".
 *  - Team workspace: in the member's PRIVATE section (cloud createPrivateDatabase, like Mail) — and only a
 *    private one counts: a memory moved to the shared space is no longer read.
 *  - Several marked databases (a duplicate, a restored backup): the oldest live one counts. A deleted one
 *    simply means "no memory yet".
 *  - It is an ordinary database: properties are found by name (EN / DE) and type, then by type alone, so
 *    renamed columns keep working; a missing one is just left out when reading or writing.
 */
import { defaultView, useWorkspace } from '../../../store/store'
import { inTemplate, isEffectivelyTrashed } from '../../../store/selectors'
import type { ColorName, Database, ID, PropertyDef, SelectOption, View } from '../../../store/types'
import { newId } from '../../../lib/ids'
import { createPrivateDatabase, useCloud } from '../../../cloud'
import { ALL_MESSAGES, t } from '../../../i18n'
import { MEMORY_TYPES, type MemoryRole, type MemoryType } from './types'

const ROLE_TYPE: Record<MemoryRole, PropertyDef['type']> = {
  type: 'select',
  topics: 'multi_select',
  source: 'text',
  active: 'checkbox',
  uses: 'number',
  lastUsed: 'date',
}
const ROLES = Object.keys(ROLE_TYPE) as MemoryRole[]

export const TYPE_COLOR: Record<MemoryType, ColorName> = { fact: 'gray', preference: 'blue', decision: 'orange', procedure: 'green' }

/** Team workspace? (the memory is then private) */
export const inTeam = () => useCloud.getState().active.kind === 'cloud'

/** Both languages' strings of a key, lower-cased (an existing database may be in the other language). */
const both = (key: string) => [ALL_MESSAGES.en[key], ALL_MESSAGES.de[key]].filter(Boolean).map((n) => n.trim().toLowerCase())

/** The type of an option name (either language; '' / unknown = null). */
export function typeOfName(name: string | undefined | null): MemoryType | null {
  const n = (name ?? '').trim().toLowerCase()
  if (!n) return null
  return MEMORY_TYPES.find((x) => both(`features.memory.type.${x}`).includes(n) || x === n) ?? null
}

/** The memory database: the oldest live marked one (team: a private one only). */
export function memoryDbId(): ID | null {
  const { pages, databases } = useWorkspace.getState()
  const team = inTeam()
  let best: { id: ID; at: number } | null = null
  for (const db of Object.values(databases)) {
    if (db.system !== 'memory') continue
    const p = pages[db.id]
    if (!p || p.kind !== 'database' || p.trashed || isEffectivelyTrashed(pages, db.id) || inTemplate(pages, db.id)) continue
    if (team && !p.private) continue
    if (!best || p.createdAt < best.at || (p.createdAt === best.at && db.id < best.id)) best = { id: db.id, at: p.createdAt }
  }
  return best?.id ?? null
}

/** The property ids of the memory database by role (by name in either language + type, then by type). */
export function memoryProps(db: Database): Partial<Record<MemoryRole, ID>> {
  const out: Partial<Record<MemoryRole, ID>> = {}
  const taken = new Set<ID>()
  for (const role of ROLES) {
    const names = both(`features.memory.prop.${role}`)
    const fits = (p: PropertyDef) => p.type === ROLE_TYPE[role] && !taken.has(p.id)
    const prop = db.properties.find((p) => fits(p) && names.includes(p.name.trim().toLowerCase())) ?? db.properties.find(fits)
    if (prop) {
      out[role] = prop.id
      taken.add(prop.id)
    }
  }
  return out
}

function makeProp(role: MemoryRole): PropertyDef {
  const p: PropertyDef = { id: newId(), name: t(`features.memory.prop.${role}`), type: ROLE_TYPE[role] }
  if (role === 'type') p.options = MEMORY_TYPES.map((x): SelectOption => ({ id: newId(), name: t(`features.memory.type.${x}`), color: TYPE_COLOR[x] }))
  if (role === 'topics') p.options = []
  if (role === 'uses') p.numberFormat = 'number'
  return p
}

function views(props: PropertyDef[], typeId: ID): View[] {
  const table = defaultView('table', { properties: props }, t('features.memory.view.all'))
  const board = defaultView('board', { properties: props }, t('features.memory.view.byType'))
  board.groupBy = typeId
  return [table, board]
}

/** Is the active workspace read-only for this person (a viewer)? */
export const memoryReadOnly = () => useCloud.getState().readOnly

/**
 * The memory database — created when there is none (top level; private in a team workspace). Throws
 * when it cannot be created (a viewer in a team workspace).
 */
export function ensureMemoryDb(): ID {
  const found = memoryDbId()
  if (found) return found
  if (memoryReadOnly()) throw new Error('read-only')
  const title: PropertyDef = { id: newId(), name: t('features.memory.prop.name'), type: 'title' }
  const made = ROLES.map((r) => makeProp(r))
  const properties = [title, ...made]
  const typeId = made[0].id
  const input = { parentId: null, title: t('features.memory.dbTitle'), icon: { type: 'asset' as const, value: 'cardbox' }, properties, views: views(properties, typeId) }
  const id = inTeam() ? createPrivateDatabase(input) : useWorkspace.getState().createDatabase(input)
  useWorkspace.getState().updateDatabase(id, { system: 'memory' })
  return id
}

/** The option id for a memory type in the Type property (added when missing, never in a locked database). */
export function typeOption(dbId: ID, propId: ID, type: MemoryType): ID | null {
  const s = useWorkspace.getState()
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

/** Option ids for topic names (case-insensitive; missing ones are added, never in a locked database). */
export function topicOptions(dbId: ID, propId: ID, names: string[]): ID[] {
  const s = useWorkspace.getState()
  const db = s.databases[dbId]
  const prop = db?.properties.find((p) => p.id === propId)
  if (!db || !prop) return []
  const options: SelectOption[] = [...(prop.options ?? [])]
  const palette: ColorName[] = ['blue', 'green', 'orange', 'purple', 'pink', 'brown', 'yellow', 'red', 'gray']
  const out: ID[] = []
  let added = false
  for (const raw of names) {
    const name = raw.trim()
    if (!name) continue
    let opt = options.find((o) => o.name.trim().toLowerCase() === name.toLowerCase())
    if (!opt && !db.locked) {
      opt = { id: newId(), name, color: palette[options.length % palette.length] }
      options.push(opt)
      added = true
    }
    if (opt && !out.includes(opt.id)) out.push(opt.id)
  }
  if (added) s.updateProperty(dbId, propId, { options })
  return out
}
