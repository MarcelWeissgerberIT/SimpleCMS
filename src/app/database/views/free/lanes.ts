/**
 * Lanes of a free board (View.free): the options of its lane select (the view's groupBy). Bound to a shared
 * list (PropertyDef.listId) the list itself changes — upsertList then brings every bound property in step.
 */
import type { ColorName, Database, ID, PropertyDef, SelectOption, View } from '../../../store/types'
import { useWorkspace } from '../../../store/store'
import { optionsOfList } from '../../../store/kit'
import { newId } from '../../../lib/ids'
import { writeValue } from '../../model/actions'

const ws = () => useWorkspace.getState()

/** The lane property of a free board (null: none / not a select). */
export function laneOf(db: Database, view: View): PropertyDef | null {
  if (!view.free || !view.groupBy) return null
  const p = db.properties.find((x) => x.id === view.groupBy)
  return p && (p.type === 'select' || p.type === 'status') ? p : null
}

function live(dbId: ID, propId: ID): PropertyDef | null {
  return ws().databases[dbId]?.properties.find((p) => p.id === propId) ?? null
}

/** Write the lanes: into the shared list when the property is bound to one, else into the property. */
function writeLanes(dbId: ID, propId: ID, options: SelectOption[]): void {
  const prop = live(dbId, propId)
  if (!prop) return
  const list = prop.listId ? ws().kit?.lists[prop.listId] : undefined
  if (list) {
    ws().upsertList({ ...list, items: options.map((o) => ({ id: o.id, name: o.name, color: o.color })) })
    return
  }
  ws().updateProperty(dbId, propId, { options })
}

const lanes = (dbId: ID, propId: ID) => (live(dbId, propId)?.options ?? []).map((o) => ({ ...o }))

export function addLane(dbId: ID, propId: ID, name: string, color: ColorName = 'default'): ID {
  const id = newId()
  writeLanes(dbId, propId, [...lanes(dbId, propId), { id, name: name.trim() || '—', color }])
  return id
}

export function renameLane(dbId: ID, propId: ID, laneId: ID, name: string): void {
  const n = name.trim()
  if (!n) return
  writeLanes(dbId, propId, lanes(dbId, propId).map((o) => (o.id === laneId ? { ...o, name: n } : o)))
}

export function recolorLane(dbId: ID, propId: ID, laneId: ID, color: ColorName): void {
  writeLanes(dbId, propId, lanes(dbId, propId).map((o) => (o.id === laneId ? { ...o, color } : o)))
}

/** Move a lane one place left (-1) or right (+1). */
export function moveLane(dbId: ID, propId: ID, laneId: ID, dir: -1 | 1): void {
  const list = lanes(dbId, propId)
  const i = list.findIndex((o) => o.id === laneId)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return
  ;[list[i], list[j]] = [list[j], list[i]]
  writeLanes(dbId, propId, list)
}

/** Delete a lane; its cards go to `moveTo` (null: no lane). */
export function deleteLane(dbId: ID, propId: ID, laneId: ID, moveTo: ID | null): void {
  const prop = live(dbId, propId)
  if (!prop) return
  for (const row of Object.values(ws().pages)) {
    if (row.databaseId !== dbId || row.trashed || row.properties[propId] !== laneId) continue
    writeValue(dbId, prop, row.id, moveTo)
  }
  writeLanes(dbId, propId, lanes(dbId, propId).filter((o) => o.id !== laneId))
}

/** "Lanes from list…": the lane property takes a shared list's items (and follows it from now on). */
export function bindLanesToList(dbId: ID, propId: ID, listId: ID | null): void {
  const list = listId ? ws().kit?.lists[listId] : undefined
  if (!listId) return ws().updateProperty(dbId, propId, { listId: undefined })
  if (!list) return
  ws().updateProperty(dbId, propId, { listId: list.id, options: optionsOfList(list) })
}
