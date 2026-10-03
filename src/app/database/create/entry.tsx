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

/** The menu entry for a typed name, or null (nothing typed, the name exists, view only). */
export type CreateEntry = (query: string, onCreated: (prop: PropertyDef) => void) => MenuEntry | null

export function usePropertyCreate(db: Database, opts: PropertyCreateOptions = {}): CreateEntry {
  const t = useT()
  const readOnly = useDbReadOnly()
  const locked = useWorkspace((s) => s.databases[db.id]?.locked === true)
  const { types, beforeDialog } = opts
  return (query, onCreated) => {
    const name = query.trim()
    if (!name || readOnly) return null
    const live = useWorkspace.getState().databases[db.id] ?? db
    if (propertyByName(live, name)) return null
    // the shared menu filters entries by label / keywords: the raw query always matches
    const keywords = query.toLowerCase()
    if (locked) return { id: 'db-create-locked', label: t('database.create.lockedEntry'), icon: <Lock size={14} />, disabled: true, keywords }
    const allowed = creatableTypes(types)
    if (!allowed.length) return null
    const pick = (type: PropertyType) => {
      if (type === 'relation') {
        beforeDialog?.()
        openCreateProperty({ dbId: db.id, name, type: 'relation', types: ['relation'], onCreated })
        return
      }
      const prop = createPropertyQuick(db.id, { name, type })
      if (prop) onCreated(prop)
    }
    const base = { id: 'db-create', label: t('database.create.entry', { name }), icon: <Plus size={14} className="dbc-plus" />, keywords }
    if (allowed.length === 1) return { ...base, hint: t(`database.type.${allowed[0]}`), onSelect: () => pick(allowed[0]) }
    return { ...base, submenu: [{ kind: 'section', label: t('database.create.pickType', { name }) }, ...typeEntries(t, pick, undefined, allowed)] }
  }
}
