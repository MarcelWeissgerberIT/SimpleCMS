/** Content branches. No device settings, credentials, agents or workspace policy enter this contract. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type ObjectJson = { [key: string]: Json }
export interface CheckoutPage { meta: ObjectJson; content: ObjectJson }
export interface CheckoutData { pages: Record<string, CheckoutPage>; databases: Record<string, ObjectJson> }
export interface CheckoutSnapshot {
  version: 1
  workspaceId: string
  name: string
  at: number
  revisions: Record<string, string>
  data: CheckoutData
  context: { people: Json[]; functions: ObjectJson; lists: ObjectJson; propTypes: ObjectJson; recordTypes: ObjectJson }
}
export type Choice = 'local' | 'cloud'
export const CHECKOUT_DB_SKIP = ['automations', 'templates', 'commands', 'webhooks'] as const
export interface CheckoutChange {
  key: string
  path: string[]
  base?: Json
  local?: Json
  cloud?: Json
  conflict: boolean
}
export const isObject = (v: unknown): v is ObjectJson => !!v && typeof v === 'object' && !Array.isArray(v)
export function equalJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equalJson(v, b[i]))
  if (!isObject(a) || !isObject(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && equalJson(a[k], b[k]))
}
/** Three-way, per field. Arrays (including rich text) conflict as a unit; no guessed replacement text. */
export function planCheckout(base: CheckoutData, local: CheckoutData, cloud: CheckoutData, choices: Record<string, Choice> = {}) {
  const changes: CheckoutChange[] = []
  const unresolved: CheckoutChange[] = []
  function merge(b: Json | undefined, l: Json | undefined, c: Json | undefined, path: string[]): Json | undefined {
    if (equalJson(l, b) || equalJson(l, c)) return c
    // Computed counters are monotonic; independent row creation never asks a person to pick a smaller counter.
    if (path.length === 3 && path[0] === 'databases' && path[2] === 'nextUniqueId' && typeof b === 'number' && typeof l === 'number' && typeof c === 'number' && l >= b && c >= b) {
      const value = Math.max(l, c)
      return value
    }
    // Moving a page to trash versus editing it is a conflict at the page boundary, too.
    const trashConflict = path.length === 2 && path[0] === 'pages' && isObject(b) && isObject(l) && isObject(c)
      && isObject(b.meta) && isObject(l.meta) && isObject(c.meta)
      && ((l.meta.trashed !== b.meta.trashed && !equalJson(c, b)) || (c.meta.trashed !== b.meta.trashed && !equalJson(l, b)))
    const richText = path.length === 3 && path[0] === 'pages' && path[2] === 'content'
    if (!trashConflict && !richText && isObject(b) && isObject(l) && isObject(c)) {
      const out: ObjectJson = Object.create(null)
      for (const k of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(c)])) {
        const value = merge(b[k], l[k], c[k], [...path, k])
        if (value !== undefined) out[k] = value
      }
      return out
    }
    const conflict = !equalJson(c, b)
    const item: CheckoutChange = { key: JSON.stringify(path), path, base: b, local: l, cloud: c, conflict }
    changes.push(item)
    if (conflict && !choices[item.key]) unresolved.push(item)
    return choices[item.key] === 'cloud' || (conflict && !choices[item.key]) ? c : l
  }
  const data = merge(base as unknown as Json, local as unknown as Json, cloud as unknown as Json, []) as unknown as CheckoutData
  return { data, changes, unresolved }
}

/** Allocate new detached rows against the current cloud's computed ids before displaying the review. */
export function prepareCheckoutIds(base: CheckoutData, proposed: CheckoutData, cloud: CheckoutData): CheckoutData {
  const data = JSON.parse(JSON.stringify(proposed)) as CheckoutData
  for (const [dbId, db] of Object.entries(data.databases)) {
    const props = isObject(db.properties) ? Object.values(db.properties).filter(isObject).filter(p => p.type === 'unique_id') : []
    if (!props.length) continue
    const used = new Set<number>()
    for (const row of Object.values(cloud.pages).filter(p => p.meta.databaseId === dbId)) for (const prop of props) {
      const value = isObject(row.meta.properties) ? row.meta.properties[String(prop.id)] : undefined
      if (typeof value === 'number') used.add(value)
    }
    let next = Math.max(Number(db.nextUniqueId) || 1, Number(cloud.databases[dbId]?.nextUniqueId) || 1, ...[...used].map(n => n + 1))
    for (const [id, row] of Object.entries(data.pages).sort(([a], [b]) => a.localeCompare(b))) {
      if (row.meta.databaseId !== dbId || base.pages[id] || cloud.pages[id]) continue
      if (!isObject(row.meta.properties)) row.meta.properties = {}
      const values = row.meta.properties as ObjectJson
      const current = values[String(props[0]!.id)]
      while (used.has(next)) next++
      const number = typeof current === 'number' && !used.has(current) ? current : next++
      for (const prop of props) values[String(prop.id)] = number
      used.add(number)
    }
    db.nextUniqueId = Math.max(Number(db.nextUniqueId) || 1, Number(cloud.databases[dbId]?.nextUniqueId) || 1, ...[...used].map(n => n + 1))
  }
  return data
}

export function checkoutFileIds(data: CheckoutData): string[] {
  return [...new Set([...JSON.stringify(data).matchAll(/onefile:([A-Za-z0-9_-]{1,64})/g)].map(m => m[1]!))]
}
