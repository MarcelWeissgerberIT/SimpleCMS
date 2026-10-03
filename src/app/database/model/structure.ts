/**
 * Switching sub-items and dependencies on and off. Each feature owns a two-way self-relation pair
 * (forward id + TWO_WAY_SUFFIX, so writeValue syncs both sides). Off keeps the pair as ordinary
 * relations unless the user asks to delete it; on reuses a kept pair.
 */
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { newId } from '../../lib/ids'
import { t } from '../../i18n'
import type { Database, DependenciesConfig, ID, PropertyDef, SubItemsConfig } from '../../store/types'
import { TWO_WAY_SUFFIX, deletePropertiesWithUndo } from './actions'

const ws = () => useWorkspace.getState()
const toast = (message: string) => useUI.getState().toast({ message })

const relationIn = (db: Database, id: ID | undefined): PropertyDef | undefined =>
  id ? db.properties.find((p) => p.id === id && p.type === 'relation' && p.relationDatabaseId === db.id) : undefined

/** Add a self-relation pair (hidden in every view: rows show it on their page) and return its ids. */
function addPair(dbId: ID, forwardName: string, backName: string): [ID, ID] {
  const s = ws()
  const id = newId()
  const back = id + TWO_WAY_SUFFIX
  s.addProperty(dbId, { id, type: 'relation', name: forwardName, relationDatabaseId: dbId })
  s.addProperty(dbId, { id: back, type: 'relation', name: backName, relationDatabaseId: dbId })
  for (const v of ws().databases[dbId]?.views ?? []) s.updateView(dbId, v.id, { visibleProperties: v.visibleProperties.filter((x) => x !== id && x !== back) })
  return [id, back]
}

export function enableSubItems(dbId: ID): void {
  const db = ws().databases[dbId]
  if (!db || db.subItems?.enabled) return
  const c = db.subItems
  if (c && relationIn(db, c.parentPropertyId) && relationIn(db, c.childPropertyId)) {
    ws().updateDatabase(dbId, { subItems: { ...c, enabled: true } })
  } else {
    const [parentPropertyId, childPropertyId] = addPair(dbId, t('database.sub.parentName'), t('database.sub.childrenName'))
    ws().updateDatabase(dbId, { subItems: { enabled: true, parentPropertyId, childPropertyId } })
  }
  toast(t('database.sub.onToast'))
}

/** Off: keep the two properties as plain relations, or delete them (one undo for both). */
export function disableSubItems(dbId: ID, deleteProps: boolean): void {
  const db = ws().databases[dbId]
  const c = db?.subItems
  if (!db || !c) return
  if (!deleteProps) {
    ws().updateDatabase(dbId, { subItems: { ...c, enabled: false } })
    toast(t('database.sub.offKept'))
    return
  }
  const snapshot: SubItemsConfig = { ...c }
  ws().updateDatabase(dbId, { subItems: null })
  const props = [relationIn(db, c.parentPropertyId), relationIn(db, c.childPropertyId)].filter((p): p is PropertyDef => !!p)
  deletePropertiesWithUndo(db, props, { message: t('database.sub.offDeleted'), onUndo: () => ws().updateDatabase(dbId, { subItems: snapshot }) })
}

export function enableDependencies(dbId: ID): void {
  const db = ws().databases[dbId]
  if (!db || db.dependencies?.enabled) return
  const c = db.dependencies
  if (c && relationIn(db, c.blockedByPropertyId) && relationIn(db, c.blockingPropertyId)) {
    ws().updateDatabase(dbId, { dependencies: { ...c, enabled: true } })
  } else {
    const [blockedByPropertyId, blockingPropertyId] = addPair(dbId, t('database.dep.blockedByName'), t('database.dep.blockingName'))
    ws().updateDatabase(dbId, { dependencies: { enabled: true, blockedByPropertyId, blockingPropertyId, onConflict: c?.onConflict ?? 'shift' } })
  }
  toast(t('database.dep.onToast'))
}

export function disableDependencies(dbId: ID, deleteProps: boolean): void {
  const db = ws().databases[dbId]
  const c = db?.dependencies
  if (!db || !c) return
  if (!deleteProps) {
    ws().updateDatabase(dbId, { dependencies: { ...c, enabled: false } })
    toast(t('database.dep.offKept'))
    return
  }
  const snapshot: DependenciesConfig = { ...c }
  ws().updateDatabase(dbId, { dependencies: null })
  const props = [relationIn(db, c.blockedByPropertyId), relationIn(db, c.blockingPropertyId)].filter((p): p is PropertyDef => !!p)
  deletePropertiesWithUndo(db, props, { message: t('database.dep.offDeleted'), onUndo: () => ws().updateDatabase(dbId, { dependencies: snapshot }) })
}

export function setConflictMode(dbId: ID, mode: 'shift' | 'warn'): void {
  const c = ws().databases[dbId]?.dependencies
  if (c) ws().updateDatabase(dbId, { dependencies: { ...c, onConflict: mode } })
}
