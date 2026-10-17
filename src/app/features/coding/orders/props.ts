/**
 * Work orders — the chain roles on a pipeline project (orders/roles.ts): `ensureChainProps(project, ordersDb, writer)`
 * adds the relation "Prüfauftrag" (to the work-orders database) and the number "Schritt" the first time a chain makes
 * a step there (startChain, phase 1 — before anything is created). Display only: never part of a task's version, never
 * what the chain engine follows. Shown in the project's tables, not on its board cards.
 *
 *  - 'ok': both there already (the relation pointing at this work-orders database) · 'added': made now ·
 *    'locked': the project is locked and lacks them (the plate: "Projekt gesperrt: Prüfauftrag-Felder fehlen") ·
 *    'other': the project's chain relation points at another work-orders database (a chain never writes into it) ·
 *    'gone': no such live project, or `ordersDb` is no work-orders database.
 */
import { useWorkspace } from '../../../store/store'
import type { ID } from '../../../store/types'
import { withWriter, type Writer } from '../../../store/writer'
import { t } from '../../../i18n'
import { codingProps, kindOfDb } from '../schema'

export type ChainPropsResult = 'ok' | 'added' | 'locked' | 'other' | 'gone'

const ws = () => useWorkspace.getState()

/** Does this project hold both chain roles, its relation pointing at `ordersDb`? */
export function hasChainProps(projectId: ID, ordersDb: ID): boolean {
  const db = ws().databases[projectId]
  if (!db) return false
  const roles = codingProps(db)
  const rel = db.properties.find((p) => p.id === roles.order)
  return !!rel && rel.relationDatabaseId === ordersDb && !!roles.step
}

/**
 * What ensureChainProps would do, without writing: 'ok' (both there) · 'add' (it would add them) · 'locked' · 'other' ·
 * 'gone' — startChain's phase 1 asks before anything is made.
 */
export function chainPropsCheck(projectId: ID, ordersDb: ID): Exclude<ChainPropsResult, 'added'> | 'add' {
  const s = ws()
  const db = s.databases[projectId]
  if (!db || !kindOfDb(projectId) || s.databases[ordersDb]?.system !== 'workorders') return 'gone'
  const roles = codingProps(db)
  const rel = roles.order ? db.properties.find((p) => p.id === roles.order) : undefined
  if (rel && rel.relationDatabaseId !== ordersDb) return 'other'
  if (rel && roles.step) return 'ok'
  return db.locked ? 'locked' : 'add'
}

export function ensureChainProps(projectId: ID, ordersDb: ID, writer: Writer): ChainPropsResult {
  const check = chainPropsCheck(projectId, ordersDb)
  if (check !== 'add') return check
  const db = ws().databases[projectId]!
  const rel = codingProps(db).order ? db.properties.find((p) => p.id === codingProps(db).order) : undefined
  return withWriter(writer, () => {
    const added: ID[] = []
    if (!rel) added.push(ws().addProperty(projectId, { type: 'relation', name: t('features.coding.prop.order'), relationDatabaseId: ordersDb }))
    // the Step number only next to the relation (roles.ts) — the relation is there now
    if (!codingProps(ws().databases[projectId]!).step) added.push(ws().addProperty(projectId, { type: 'number', name: t('features.coding.prop.step') }))
    // board cards stay as they were (the chain chip on #/coding says it); tables show the new columns
    for (const view of ws().databases[projectId]!.views)
      if (view.type === 'board' && added.some((id) => view.visibleProperties.includes(id))) ws().updateView(projectId, view.id, { visibleProperties: view.visibleProperties.filter((id) => !added.includes(id)) })
    return hasChainProps(projectId, ordersDb) ? 'added' : 'gone'
  })
}
