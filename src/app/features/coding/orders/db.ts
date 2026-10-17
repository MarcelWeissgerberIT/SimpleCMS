/**
 * Work orders (Prüfaufträge) — the database (spec §1.1, B4). Store actions only.
 *
 *  - `orderDbId()`: the oldest live work-orders database (`Database.system: 'workorders'`; team: a PRIVATE one only, as
 *    the pipelines — never in a template, never trashed).
 *  - `ensureOrderDb(writer)`: that one, or a new one: Name · Status (Entwurf · Planen · Kette bereit · Läuft · Angehalten
 *    · Fertig — the option ids kept in `Database.orders.status`, so nothing ever matches a status by its name) · Repo
 *    (the worker's announced repos) · Pipelines (BA · Coding · QA) · Priorität · ID ("PA-12" / "WO-12") · Erstellt; views
 *    Board (grouped by Status: six lanes) and Table. Team: private (createPrivateDatabase). Viewers: throws.
 *  - `saveOrderConfig(dbId, fn)`: the only writer of `Database.orders` — refused on a locked database and over a later
 *    build's config (readOrderConfig 'unreadable': never overwritten).
 *  - `orderStatusKey(row)` / `writeOrderStatus(row, key, writer)`: a request's Status by option id.
 *  - `orderFields(row)`: the row's Repo, Pipelines and Priorität as the planner reads them (names → kinds in either
 *    language; "Felder der Zeile gehen vor").
 */
import { defaultView, useWorkspace } from '../../../store/store'
import { rowIdsOf } from '../../../store/rowIndex'
import { inTemplate, isEffectivelyTrashed } from '../../../store/selectors'
import type { ColorName, Database, ID, OrderConfig, OrderKind, OrderStatusKey, Page, PropertyDef, View } from '../../../store/types'
import { SYSTEM, withWriter, type Writer } from '../../../store/writer'
import { newId } from '../../../lib/ids'
import { createPrivateDatabase, useCloud } from '../../../cloud'
import { NONE_KEY } from '../../../database'
import { ALL_MESSAGES, t } from '../../../i18n'
import { ORDER_KINDS, ORDER_STATUS_KEYS, newOrderConfig, readOrderConfig, sanitizeOrderConfig } from './config'
import { orderStatusProps } from './status'
import { useCoding } from '../state'

const ws = () => useWorkspace.getState()
const inTeam = () => useCloud.getState().active.kind === 'cloud'

/** The lane colours of the six states (Entwurf grey … Fertig green). */
const STATUS_COLOR: Record<OrderStatusKey, ColorName> = { draft: 'gray', plan: 'blue', ready: 'orange', running: 'purple', halted: 'red', done: 'green' }
const PRIORITIES: Array<[string, ColorName]> = [
  ['high', 'red'],
  ['medium', 'yellow'],
  ['low', 'gray'],
]

/* ------------------------------------------------------------------ finding */

/** Every live work-orders database, oldest first (team: private ones only). */
export function orderDbIds(s: Pick<ReturnType<typeof ws>, 'pages' | 'databases'> = ws()): ID[] {
  const team = inTeam()
  const found: Array<{ id: ID; at: number }> = []
  for (const db of Object.values(s.databases)) {
    if (db.system !== 'workorders') continue
    const p = s.pages[db.id]
    if (!p || p.kind !== 'database' || p.trashed || isEffectivelyTrashed(s.pages, db.id) || inTemplate(s.pages, db.id)) continue
    if (team && !p.private) continue
    found.push({ id: db.id, at: p.createdAt })
  }
  return found.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1)).map((x) => x.id)
}

/** The work-orders database: the oldest live one (team: private). */
export const orderDbId = (): ID | null => orderDbIds()[0] ?? null

/** Is this page a live row of a work-orders database (any of them — each has its own Status options)? */
export function isOrderRow(rowId: ID | null | undefined, s: Pick<ReturnType<typeof ws>, 'pages' | 'databases'> = ws()): boolean {
  if (!rowId) return false
  const p = s.pages[rowId]
  return !!p?.databaseId && !p.trashed && orderDbIds(s).includes(p.databaseId)
}

/* ------------------------------------------------------------------ the fields */

const both = (key: string) => [ALL_MESSAGES.en[key], ALL_MESSAGES.de[key]].filter(Boolean).map((n) => n.trim().toLowerCase())
const named = (p: PropertyDef, key: string) => both(key).includes(p.name.trim().toLowerCase())

export interface OrderProps {
  title?: ID
  /** the Status select (by its option ids — status.ts) */
  status?: ID
  repo?: ID
  pipelines?: ID
  priority?: ID
  /** the unique id ("PA-12") */
  uid?: ID
}

/** The fields of a work-orders database by role (Status by its option ids; the rest by name in either language + type). */
export function orderProps(db: Database): OrderProps {
  const find = (type: PropertyDef['type'], key: string) => db.properties.find((p) => p.type === type && named(p, key))?.id
  return {
    title: db.properties.find((p) => p.type === 'title')?.id,
    status: orderStatusProps(db)[0]?.id,
    repo: find('select', 'features.coding.prop.repo'),
    pipelines: find('multi_select', 'features.coding.order.prop.pipelines'),
    priority: find('select', 'features.coding.prop.priority'),
    uid: db.properties.find((p) => p.type === 'unique_id')?.id,
  }
}

/** A request's Status as a state (null: no readable config, no option, or an option of none of the six). */
export function orderStatusKey(rowId: ID, s: Pick<ReturnType<typeof ws>, 'pages' | 'databases'> = ws()): OrderStatusKey | null {
  const row = s.pages[rowId]
  const db = row?.databaseId ? s.databases[row.databaseId] : undefined
  if (!row || !db) return null
  return statusKeyOf(db, row)
}

/** The state a row's Status option stands for (by option id — never by its name). */
export function statusKeyOf(db: Database, row: Pick<Page, 'properties'>): OrderStatusKey | null {
  const read = readOrderConfig(db)
  if (read.kind !== 'ok') return null
  const prop = orderProps(db).status
  if (!prop) return null
  const v = row.properties[prop]
  if (typeof v !== 'string' || !v) return null
  for (const key of ORDER_STATUS_KEYS) if (read.config.status[key] === v) return key
  return null
}

/** Write a request's Status (by the config's option id) under `writer`; false: no readable option for that state. */
export function writeOrderStatus(rowId: ID, key: OrderStatusKey, writer: Writer): boolean {
  const s = ws()
  const row = s.pages[rowId]
  const db = row?.databaseId ? s.databases[row.databaseId] : undefined
  if (!row || !db || row.trashed) return false
  const read = readOrderConfig(db)
  const prop = orderProps(db).status
  const option = read.kind === 'ok' ? read.config.status[key] : undefined
  if (!prop || !option || !db.properties.find((p) => p.id === prop)?.options?.some((o) => o.id === option)) return false
  if (row.properties[prop] === option) return true
  withWriter(writer, () => ws().setRowProperty(rowId, prop, option))
  return true
}

/** Other words a Pipelines option may carry for a kind (EN / DE), beside the kinds' own names in either language. */
const KIND_WORDS: Readonly<Record<string, OrderKind>> = {
  spec: 'spec',
  ba: 'spec',
  analysis: 'spec',
  analyse: 'spec',
  'business analysis': 'spec',
  'business-analyse': 'spec',
  'business-analysis': 'spec',
  'business analyse': 'spec',
  coding: 'coding',
  code: 'coding',
  qa: 'qa',
  test: 'qa',
  tests: 'qa',
}

/** What the row says about where to plan: its Repo, its Pipelines (null: none picked — the settings' kinds), Priorität. */
export function orderFields(rowId: ID): { repo: string | null; kinds: OrderKind[] | null; priority: 'high' | 'medium' | 'low' | null } {
  const s = ws()
  const row = s.pages[rowId]
  const db = row?.databaseId ? s.databases[row.databaseId] : undefined
  if (!row || !db) return { repo: null, kinds: null, priority: null }
  const props = orderProps(db)
  const optionName = (propId: ID | undefined, v: unknown) => db.properties.find((p) => p.id === propId)?.options?.find((o) => o.id === v)?.name.trim() ?? null
  const repo = props.repo ? optionName(props.repo, row.properties[props.repo]) : null
  const picked = props.pipelines ? row.properties[props.pipelines] : null
  const names = Array.isArray(picked) ? picked.map((v) => optionName(props.pipelines, v)?.toLowerCase()).filter((n): n is string => !!n) : []
  const kinds = ORDER_KINDS.filter((k) => names.some((n) => KIND_WORDS[n] === k || both(`features.coding.pipe.${k}`).includes(n)))
  const pri = props.priority ? optionName(props.priority, row.properties[props.priority])?.toLowerCase() : null
  const priority = (['high', 'medium', 'low'] as const).find((p) => both(`features.coding.priority.${p}`).includes(pri ?? '')) ?? null
  return { repo, kinds: kinds.length ? kinds : null, priority }
}

/** "PA-12" — the row's unique id (null: none). */
export function orderCode(rowId: ID): string | null {
  const s = ws()
  const row = s.pages[rowId]
  const db = row?.databaseId ? s.databases[row.databaseId] : undefined
  if (!row || !db) return null
  const uid = db.properties.find((p) => p.type === 'unique_id')
  const n = uid ? row.properties[uid.id] : null
  return uid && typeof n === 'number' ? `${uid.idPrefix ? `${uid.idPrefix}-` : ''}${n}` : null
}

/** The live rows of every work-orders database (the shared row index — no page-map walk). */
export function orderRowIds(s: Pick<ReturnType<typeof ws>, 'pages' | 'databases'> = ws()): ID[] {
  const out: ID[] = []
  for (const db of orderDbIds(s)) for (const id of rowIdsOf(db)) if (s.pages[id] && !s.pages[id].trashed) out.push(id)
  return out
}

/** Requests not Fertig (the #/coding key's "2 offen", the database head). */
export function openOrderCount(s: Pick<ReturnType<typeof ws>, 'pages' | 'databases'> = ws()): number {
  let n = 0
  for (const id of orderRowIds(s)) if (orderStatusKey(id, s) !== 'done') n++
  return n
}

/** Requests whose Status is Läuft (the "Alle Ketten anhalten" key shows while there is one). */
export function runningOrderCount(s: Pick<ReturnType<typeof ws>, 'pages' | 'databases'> = ws()): number {
  let n = 0
  for (const id of orderRowIds(s)) if (orderStatusKey(id, s) === 'running') n++
  return n
}

/** Work orders whose chain was started at least once — running, halted or done (the Patchbay's band, lamp 06). */
export function startedOrderCount(s: Pick<ReturnType<typeof ws>, 'pages' | 'databases'> = ws()): number {
  let n = 0
  for (const id of orderRowIds(s)) {
    const k = orderStatusKey(id, s)
    if (k === 'running' || k === 'halted' || k === 'done') n++
  }
  return n
}

/* ------------------------------------------------------------------ creating */

interface Made {
  properties: PropertyDef[]
  status: Record<OrderStatusKey, ID>
  ids: { status: ID; repo: ID; priority: ID; uid: ID }
}

function baseProps(lang: 'en' | 'de'): Made {
  const status = Object.fromEntries(ORDER_STATUS_KEYS.map((k) => [k, newId()])) as Record<OrderStatusKey, ID>
  const ids = { status: newId(), repo: newId(), priority: newId(), uid: newId() }
  const properties: PropertyDef[] = [
    { id: newId(), name: t('features.coding.order.prop.name'), type: 'title' },
    { id: ids.status, name: t('features.coding.order.prop.status'), type: 'select', options: ORDER_STATUS_KEYS.map((k) => ({ id: status[k], name: t(`features.coding.order.status.${k}`), color: STATUS_COLOR[k] })) },
    { id: ids.repo, name: t('features.coding.prop.repo'), type: 'select', options: [] },
    { id: newId(), name: t('features.coding.order.prop.pipelines'), type: 'multi_select', options: ORDER_KINDS.map((k, i) => ({ id: newId(), name: t(`features.coding.pipe.${k}`), color: (['blue', 'purple', 'green'] as ColorName[])[i]! })) },
    { id: ids.priority, name: t('features.coding.prop.priority'), type: 'select', options: PRIORITIES.map(([key, color]) => ({ id: newId(), name: t(`features.coding.priority.${key}`), color })) },
    { id: ids.uid, name: t('features.coding.order.prop.id'), type: 'unique_id', idPrefix: lang === 'de' ? 'PA' : 'WO' },
    { id: newId(), name: t('features.coding.order.prop.created'), type: 'created_time' },
  ]
  return { properties, status, ids }
}

function views({ properties, ids }: Made): View[] {
  const db = { properties } as Database
  const board = defaultView('board', db, t('features.coding.order.view.board'))
  board.groupBy = ids.status
  // every request has a Status: no "No value" lane — the six lanes in their order
  board.hiddenGroups = [NONE_KEY]
  board.visibleProperties = [ids.uid, ids.repo, ids.priority]
  const table = defaultView('table', db, t('features.coding.order.view.table'))
  table.visibleProperties = properties.filter((p) => p.type !== 'title').map((p) => p.id)
  return [board, table]
}

/** Is this workspace read-only for the person (a viewer)? */
const readOnly = () => useCloud.getState().readOnly

/**
 * The work-orders database — made when there is none (top level; private in a team) under `writer` (the person's act
 * that needed it). `made`: whether it was made now. Throws for a viewer.
 */
export function ensureOrderDb(writer: Writer = { kind: 'you', via: 'ui' }): { id: ID; made: boolean } {
  const found = orderDbId()
  if (found) return { id: found, made: false }
  if (readOnly()) throw new Error('read-only')
  const lang = ws().settings.language === 'de' ? 'de' : 'en'
  const made = baseProps(lang)
  const data = { id: newId(), parentId: null, title: t('features.coding.order.db'), icon: { type: 'asset' as const, value: 'search' }, properties: made.properties, views: views(made) }
  const id = withWriter(writer, () => {
    const dbId = inTeam() ? createPrivateDatabase(data) : ws().createDatabase(data)
    ws().updateDatabase(dbId, { system: 'workorders', orders: newOrderConfig(made.status) })
    return dbId
  })
  // a worker that connected before the database existed: its repos are the Repo options (upkeep, nobody's change)
  const repos = useCoding.getState().worker?.repos.map((r) => r.name) ?? []
  if (repos.length) withWriter(SYSTEM('maintenance'), () => addOrderRepoOptions(id, repos))
  return { id, made: true }
}

/** Add the repo names a worker announced to a work-orders database's Repo select (never in a locked database). */
export function addOrderRepoOptions(dbId: ID, names: string[]): void {
  const db = ws().databases[dbId]
  if (!db || db.locked || db.system !== 'workorders') return
  const prop = db.properties.find((p) => p.id === orderProps(db).repo)
  if (!prop) return
  const options = [...(prop.options ?? [])]
  const palette: ColorName[] = ['blue', 'green', 'purple', 'pink', 'brown', 'yellow', 'orange', 'red', 'gray']
  let added = false
  for (const name of names) {
    if (options.some((o) => o.name === name)) continue
    options.push({ id: newId(), name, color: palette[options.length % palette.length]! })
    added = true
  }
  if (added) ws().updateProperty(dbId, prop.id, { options })
}

/**
 * Change `Database.orders` — the only way in. Refused (false): no such work-orders database, a locked one, a viewer,
 * or a config a later build wrote (kept as it is). `fn` gets the config as every reader keeps it.
 */
export function saveOrderConfig(dbId: ID, fn: (config: OrderConfig) => OrderConfig, writer: Writer = { kind: 'you', via: 'ui' }): boolean {
  const db = ws().databases[dbId]
  if (!db || db.system !== 'workorders' || db.locked || readOnly()) return false
  const read = readOrderConfig(db)
  if (read.kind === 'unreadable' || read.kind === 'none') return false
  const next = sanitizeOrderConfig(fn(read.config))
  if (next.kind !== 'ok') return false
  withWriter(writer, () => ws().updateDatabase(dbId, { orders: next.config }))
  return true
}
