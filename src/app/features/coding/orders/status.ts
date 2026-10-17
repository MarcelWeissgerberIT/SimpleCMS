/**
 * Work orders (Prüfaufträge) — which field is a request's Status (spec § 3.8, B2 hardening). Pure (a Node spec reads it).
 *
 *  - The Status is the select (or status) property holding the Status options the database's config names
 *    (`Database.orders.status`, by option id — never by its name). Without a readable config, or when no property holds
 *    one of those options, every select / status property named "Status" counts (the same word in EN and DE) — a guard
 *    then errs on the side of refusing.
 *  - Draft ("Entwurf"): the option a row an agent created lands in — only from a readable config whose draft option a
 *    Status property really holds (null otherwise: nothing is guessed).
 *
 * Who must never write the Status: custom agents and the MCP bridge (ai/agent/coding.ts guardOrderRows), the folder /
 * GitHub pick-up (sync/pickup.ts). The person, the planner's own writer and the AI terminal (reviewed) may.
 */
import type { Database, PropertyDef, SelectOption } from '../../../store/types'
import { readOrderConfig } from './config'

type OrdersDb = Pick<Database, 'system' | 'orders' | 'properties'>

/** The name a Status property goes by when no config says which one it is (EN = DE). */
const STATUS_NAMES = ['status']

const isChoice = (p: PropertyDef) => p.type === 'select' || p.type === 'status'

/** Is this a work-orders database (Database.system 'workorders')? */
export const isOrdersDb = (db: Pick<Database, 'system'> | null | undefined): boolean => db?.system === 'workorders'

/** The Status properties of a work-orders database (see the head of this file; [] for any other database). */
export function orderStatusProps(db: OrdersDb | null | undefined): PropertyDef[] {
  if (!db || !isOrdersDb(db)) return []
  const read = readOrderConfig(db)
  const ids = new Set<string>(read.kind === 'ok' ? Object.values(read.config.status).filter((x): x is string => typeof x === 'string') : [])
  const byOption = ids.size ? db.properties.filter((p) => isChoice(p) && (p.options ?? []).some((o) => ids.has(o.id))) : []
  if (byOption.length) return byOption
  return db.properties.filter((p) => isChoice(p) && STATUS_NAMES.includes(p.name.trim().toLowerCase()))
}

/** Is `propId` a Status property of this work-orders database? */
export const isOrderStatusProp = (db: OrdersDb | null | undefined, propId: string): boolean => orderStatusProps(db).some((p) => p.id === propId)

/** Where a new row lands: the Status property and its Draft option (null: no readable config holds one). */
export function orderDraftOf(db: OrdersDb | null | undefined): { prop: PropertyDef; option: SelectOption } | null {
  if (!db || !isOrdersDb(db)) return null
  const read = readOrderConfig(db)
  if (read.kind !== 'ok' || !read.config.status.draft) return null
  const draft = read.config.status.draft
  for (const prop of db.properties) {
    if (!isChoice(prop)) continue
    const option = (prop.options ?? []).find((o) => o.id === draft)
    if (option) return { prop, option }
  }
  return null
}
