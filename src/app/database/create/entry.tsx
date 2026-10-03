/**
 * "Create property “X”" for property pickers (columns, filters, sorts, grouping, chart axes, form
 * questions, the formula reference): typing a name the database doesn't have offers it at the end
 * of the list → the type list → the property is created and the picker's own action goes on with
 * it. Relations open the short relation dialog first. A locked database says so instead.
 */
import { Lock, Plus } from 'lucide-react'
import type { Database, PropertyDef, PropertyType } from '../../store/types'
import { useWorkspace } from '../../store/store'
import type { MenuEntry } from '../../ui/Menu'
import { useT } from '../../i18n'
import { typeEntries } from '../parts'
import { useDbReadOnly } from '../readonly'
import { createPropertyQuick, creatableTypes, propertyByName } from './quick'
import { openCreateProperty } from './state'

export interface PropertyCreateOptions {
  /** Types that make sense for this picker (default: every creatable type). */
  types?: PropertyType[]
  /** Runs before the relation dialog opens — close the panel the picker sits in. */
  beforeDialog?: () => void
}

export interface PropertyCreator {
  /** Nothing can be created here: view only, or (locked) the database is locked. */
  blocked: false | 'readOnly' | 'locked'
  /** The name is new to the database (trimmed, any case). */
  isNew: (name: string) => boolean
  /** Type menu entries that create `name` and continue with onCreated. */
  typeMenu: (name: string, onCreated: (prop: PropertyDef) => void) => MenuEntry[]
  /** Create `name` as `type` (relations: through the relation dialog), then onCreated. */
  create: (name: string, type: PropertyType, onCreated: (prop: PropertyDef) => void) => void
}

export function useCreateProperty(db: Database, opts: PropertyCreateOptions = {}): PropertyCreator {
  const t = useT()
  const readOnly = useDbReadOnly()
  const locked = useWorkspace((s) => s.databases[db.id]?.locked === true)
  const { types, beforeDialog } = opts
  const create = (name: string, type: PropertyType, onCreated: (prop: PropertyDef) => void) => {
    if (type === 'relation') {
      beforeDialog?.()
      openCreateProperty({ dbId: db.id, name, type: 'relation', types: ['relation'], onCreated })
      return
    }
    const prop = createPropertyQuick(db.id, { name, type })
    if (prop) onCreated(prop)
  }
  return {
    blocked: readOnly ? 'readOnly' : locked ? 'locked' : false,
    isNew: (name) => !!name.trim() && !propertyByName(useWorkspace.getState().databases[db.id] ?? db, name),
    typeMenu: (name, onCreated) => [
      { kind: 'section', label: t('database.create.pickType', { name }) },
      ...typeEntries(t, (type) => create(name, type, onCreated), undefined, creatableTypes(types)),
    ],
    create,
  }
}

/** The menu entry for a typed name, or null (nothing typed, the name exists, view only). */
export type CreateEntry = (query: string, onCreated: (prop: PropertyDef) => void) => MenuEntry | null

export function usePropertyCreate(db: Database, opts: PropertyCreateOptions = {}): CreateEntry {
  const t = useT()
  const c = useCreateProperty(db, opts)
  const allowed = creatableTypes(opts.types)
  return (query, onCreated) => {
    const name = query.trim()
    if (c.blocked === 'readOnly' || !allowed.length || !c.isNew(name)) return null
    // the shared menu filters entries by label / keywords: the raw query always matches
    const keywords = query.toLowerCase()
    if (c.blocked === 'locked') return { id: 'db-create-locked', label: t('database.create.lockedEntry'), icon: <Lock size={14} />, disabled: true, keywords }
    const base = { id: 'db-create', label: t('database.create.entry', { name }), icon: <Plus size={14} className="dbc-plus" />, keywords }
    if (allowed.length === 1) return { ...base, hint: t(`database.type.${allowed[0]}`), onSelect: () => c.create(name, allowed[0], onCreated) }
    return { ...base, submenu: c.typeMenu(name, onCreated) }
  }
}
