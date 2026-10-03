/**
 * Automations engine. Watches the workspace store, diffs database rows and runs the
 * matching automations of a database:
 *   triggers: row_created · row_deleted (trashed or removed) · property_changed (optional property / target value)
 *   actions:  webhook (POST/PUT JSON) · set_property · notify (toast)
 * Only the tab where the change happened fires (changes applied from other tabs are ignored).
 * Rapid edits are coalesced per automation + row so typing doesn't spam webhooks; a new row
 * fires once it has a title and has been quiet for a moment (capped, see CREATED_MAX_MS).
 */
import { useSyncExternalStore } from 'react'
import { pageChanges, useWorkspace } from '../../store/store'
import { isApplyingRemote } from '../../store/persistence'
import { toast } from '../../store/ui'
import type { Automation, AutomationAction, Database, DateValue, ID, Page, PropertyDef, PropertyValue } from '../../store/types'
import { newId } from '../../lib/ids'
import { postWebhook, type WebhookOutcome } from '../../lib/webhook'
import { t } from '../../i18n'

/* The database area is loaded lazily so this always-on service doesn't pull it in statically. */
type DatabaseApi = typeof import('../../database')
let dbApi: DatabaseApi | null = null
let dbApiLoading: Promise<DatabaseApi> | null = null
export function loadDatabaseApi(): Promise<DatabaseApi> {
  return (dbApiLoading ??= import('../../database').then((m) => (dbApi = m)))
}
export const isDatabaseApiLoaded = () => !!dbApi

export type EventType = 'row_created' | 'row_deleted' | 'property_changed'

export interface Change {
  propertyId: ID
  from: PropertyValue | undefined
  to: PropertyValue | undefined
}

export interface WebhookPayload {
  event: EventType | 'test'
  /** only on "Send test" requests, so receivers can ignore them */
  test?: true
  automation: { id: ID; name: string }
  database: { id: ID; title: string }
  row: { id: ID; title: string; url: string; properties: Record<string, string> }
  changes: Array<{ property: string; from: string; to: string }>
  timestamp: string
  source: 'simplecms-one'
  /** added when sent (lib/webhook.ts): the same for a request and its no-cors retry — receivers dedupe on it */
  deliveryId?: string
}

export interface RunLogEntry {
  id: ID
  at: number
  databaseId: ID
  automationId: ID
  automationName: string
  event: EventType | 'test'
  rowTitle: string
  action: AutomationAction['type']
  status: 'ok' | 'error'
  message: string
}

export interface WebhookResult {
  /** delivered, or sent without a readable answer (opaque) — false only for real failures */
  ok: boolean
  /** delivered (2xx) · failed · unconfirmed (no-cors: sent, delivery can't be confirmed) */
  outcome: WebhookOutcome
  status: number
  message: string
  opaque?: boolean
  body?: string
  /** sent in the payload, the same for the CORS attempt and its no-cors retry */
  deliveryId?: string
  ms: number
}

/* ------------------------------------------------------------------ */
/* Run log (in memory, last 30)                                        */
/* ------------------------------------------------------------------ */

let runLog: RunLogEntry[] = []
const logListeners = new Set<() => void>()

function pushLog(e: Omit<RunLogEntry, 'id' | 'at'>) {
  runLog = [{ ...e, id: newId(), at: Date.now() }, ...runLog].slice(0, 30)
  logListeners.forEach((l) => l())
}

export function getRunLog(): RunLogEntry[] {
  return runLog
}

export function useRunLog(): RunLogEntry[] {
  return useSyncExternalStore(
    (cb) => {
      logListeners.add(cb)
      return () => logListeners.delete(cb)
    },
    getRunLog,
    getRunLog,
  )
}

/* ------------------------------------------------------------------ */
/* Pausing (bulk imports, template creation)                          */
/* ------------------------------------------------------------------ */

let paused = 0
/** Suspend automations (e.g. during an import). Returns a resume function. */
export function pauseAutomations(): () => void {
  paused++
  let done = false
  return () => {
    if (done) return
    done = true
    paused = Math.max(0, paused - 1)
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const COMPUTED = new Set<PropertyDef['type']>(['formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'unique_id'])

export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return (a ?? null) === (b ?? null) || (isEmpty(a) && isEmpty(b))
  if (typeof a !== 'object' || typeof b !== 'object') return false
  return JSON.stringify(a) === JSON.stringify(b)
}

const isEmpty = (v: unknown) => v == null || v === '' || v === false || (Array.isArray(v) && v.length === 0)

function rawText(value: PropertyValue | undefined): string {
  if (value == null) return ''
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'object') return (value as DateValue).end ? `${(value as DateValue).start} → ${(value as DateValue).end}` : (value as DateValue).start
  return String(value)
}

function valueText(db: Database, prop: PropertyDef, row: Page, value: PropertyValue | undefined): string {
  if (prop.type === 'title') return typeof value === 'string' ? value : row.title
  if (!dbApi) return rawText(value)
  try {
    return dbApi.propertyValueToText(db, prop, { ...row, properties: { ...row.properties, [prop.id]: value ?? null } })
  } catch {
    return rawText(value)
  }
}

export function rowUrl(id: ID): string {
  return `${window.location.origin}${window.location.pathname}#/p/${id}`
}

export function buildPayload(db: Database, automation: Pick<Automation, 'id' | 'name'>, row: Page, event: WebhookPayload['event'], changes: Change[]): WebhookPayload {
  const pages = useWorkspace.getState().pages
  const properties: Record<string, string> = {}
  for (const p of db.properties) properties[p.name] = p.type === 'title' ? row.title : valueText(db, p, row, row.properties[p.id])
  return {
    event,
    automation: { id: automation.id, name: automation.name },
    database: { id: db.id, title: pages[db.id]?.title ?? '' },
    row: { id: row.id, title: row.title, url: rowUrl(row.id), properties },
    changes: changes.flatMap((c) => {
      const prop = db.properties.find((p) => p.id === c.propertyId)
      if (!prop) return []
      return [{ property: prop.name, from: valueText(db, prop, row, c.from), to: valueText(db, prop, row, c.to) }]
    }),
    timestamp: new Date().toISOString(),
    source: 'simplecms-one',
  }
}

/** Does a changed value satisfy the trigger's "to value" condition? */
function reachesValue(from: PropertyValue | undefined, to: PropertyValue | undefined, want: PropertyValue): boolean {
  if (Array.isArray(to) && !Array.isArray(want)) return to.includes(String(want)) && !(Array.isArray(from) && from.includes(String(want)))
  return sameValue(to, want) && !sameValue(from, want)
}

/** Resolve special set_property values: "@now" / "@today" for dates. */
export function resolveSetValue(prop: PropertyDef | undefined, value: PropertyValue): PropertyValue {
  if (prop?.type === 'date' && typeof value === 'string') {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    if (value === '@now') return { start: `${day}T${pad(d.getHours())}:${pad(d.getMinutes())}`, includeTime: true }
    if (value === '@today') return { start: day }
  }
  return value
}

/* ------------------------------------------------------------------ */
/* Webhook                                                             */
/* ------------------------------------------------------------------ */

export function isValidWebhookUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Send the payload (+ a `deliveryId`) through the shared helper (lib/webhook.ts): JSON + CORS
 * first, one no-cors retry on a network/CORS failure. A no-cors send is "unconfirmed": it is not
 * an error (ok stays true, the run is not marked failed), but it is never reported as delivered.
 */
export async function sendWebhook(url: string, method: 'POST' | 'PUT', payload: object, headers: Record<string, string> = {}): Promise<WebhookResult> {
  if (!isValidWebhookUrl(url)) return { ok: false, outcome: 'failed', status: 0, message: t('features.auto.err.url'), ms: 0 }
  const res = await postWebhook(url, method, payload, { headers, timeoutMs: 10_000, readBody: 400 })
  const base = { outcome: res.outcome, status: res.status, deliveryId: res.deliveryId, ms: res.ms, ...(res.body !== undefined ? { body: res.body } : {}) }
  if (res.outcome === 'unconfirmed') return { ...base, ok: true, opaque: true, message: t('features.auto.res.opaque') }
  if (res.error === 'timeout') return { ...base, ok: false, message: t('features.auto.err.timeout') }
  if (res.error === 'url') return { ...base, ok: false, message: t('features.auto.err.url') }
  if (res.error === 'network') return { ...base, ok: false, message: t('features.auto.err.network', { msg: res.detail ?? '' }) }
  return { ...base, ok: res.outcome === 'delivered', message: `${res.status} ${res.statusText || (res.outcome === 'delivered' ? 'OK' : '')}`.trim() }
}

/* ------------------------------------------------------------------ */
/* Running                                                             */
/* ------------------------------------------------------------------ */

let applyingAction = false

function setStatus(dbId: ID, automationId: ID, status: 'ok' | 'error', message: string) {
  const s = useWorkspace.getState()
  const db = s.databases[dbId]
  if (!db?.automations) return
  s.updateDatabase(dbId, {
    automations: db.automations.map((a) => (a.id === automationId ? { ...a, lastRunAt: Date.now(), lastStatus: status, lastMessage: message.slice(0, 200) } : a)),
  })
}

function fill(template: string, db: Database, row: Page): string {
  const pages = useWorkspace.getState().pages
  // any property name works, umlauts and punctuation included: {Priorität}, {Fällig}, {Due date}
  return template.replace(/\{([^{}\n]+)\}/g, (all, raw: string) => {
    const key = raw.trim()
    if (key === 'title') return row.title || t('common.untitled')
    if (key === 'database') return pages[db.id]?.title || t('common.untitled')
    const prop = db.properties.find((p) => p.name.toLowerCase() === key.toLowerCase())
    return prop ? valueText(db, prop, row, prop.type === 'title' ? row.title : row.properties[prop.id]) : all
  })
}

async function runAutomation(dbId: ID, automationId: ID, rowSnapshot: Page, event: EventType, changes: Change[]) {
  await loadDatabaseApi().catch(() => null)
  const state = useWorkspace.getState()
  const db = state.databases[dbId]
  const automation = db?.automations?.find((a) => a.id === automationId)
  if (!db || !automation?.enabled) return
  const row = state.pages[rowSnapshot.id] ?? rowSnapshot
  let status: 'ok' | 'error' = 'ok'
  const messages: string[] = []
  for (const action of automation.actions) {
    let ok = true
    let message = ''
    try {
      if (action.type === 'webhook') {
        const res = await sendWebhook(action.url, action.method, buildPayload(db, automation, row, event, changes), action.headers)
        ok = res.ok
        message = `${action.method} → ${res.message}`
      } else if (action.type === 'set_property') {
        const prop = db.properties.find((p) => p.id === action.propertyId)
        if (!prop) throw new Error(t('features.auto.err.prop'))
        if (event === 'row_deleted') throw new Error(t('features.auto.err.deleted'))
        applyingAction = true
        try {
          if (prop.type === 'title') useWorkspace.getState().updatePage(row.id, { title: String(action.value ?? '') })
          else useWorkspace.getState().setRowProperty(row.id, prop.id, resolveSetValue(prop, action.value))
        } finally {
          applyingAction = false
        }
        message = t('features.auto.res.set', { prop: prop.name })
      } else if (action.type === 'notify') {
        const text = fill(action.message || automation.name, db, row)
        toast({ message: text, kind: 'info', action: event !== 'row_deleted' ? { label: t('common.open'), run: () => (window.location.hash = `#/p/${row.id}`) } : undefined })
        message = t('features.auto.res.notified')
      }
    } catch (err) {
      ok = false
      message = (err as Error)?.message || String(err)
    }
    if (!ok) status = 'error'
    messages.push(message)
    pushLog({ databaseId: dbId, automationId, automationName: automation.name, event, rowTitle: row.title, action: action.type, status: ok ? 'ok' : 'error', message })
  }
  setStatus(dbId, automationId, status, messages.join(' · ') || t('features.auto.res.noActions'))
}

/* ------------------------------------------------------------------ */
/* Change detection                                                    */
/* ------------------------------------------------------------------ */

interface Pending {
  timer: number
  dbId: ID
  automationId: ID
  rowId: ID
  /** last known row (used when the row is gone, e.g. row_deleted) */
  row: Page
  event: EventType
  changes: Map<ID, Change>
  firstAt: number
}
const pending = new Map<string, Pending>()
/** Quiet time before an event fires (edits within it are merged). */
const COALESCE_MS: Record<EventType, number> = { row_created: 1800, row_deleted: 0, property_changed: 900 }
/** A new row waits for a title and a quiet moment, but never longer than this. */
const CREATED_MAX_MS = 15_000

function arm(key: string, entry: Pending, delay: number) {
  window.clearTimeout(entry.timer)
  entry.timer = window.setTimeout(() => flush(key), delay)
}

function flush(key: string) {
  const entry = pending.get(key)
  if (!entry) return
  const state = useWorkspace.getState()
  const latest = state.pages[entry.rowId]
  if (entry.event === 'row_created') {
    // undone / deleted before it settled → nothing to report
    if (!latest || latest.trashed) return void pending.delete(key)
    // still untitled (e.g. the title cell is being typed) → keep waiting, up to the cap
    if (!latest.title.trim() && Date.now() - entry.firstAt < CREATED_MAX_MS) return arm(key, entry, 1000)
    pending.delete(key)
    void runAutomation(entry.dbId, entry.automationId, latest, 'row_created', [])
    return
  }
  pending.delete(key)
  if (entry.event === 'property_changed') {
    const trig = state.databases[entry.dbId]?.automations?.find((a) => a.id === entry.automationId)?.trigger
    if (!trig || trig.type !== 'property_changed' || !latest || latest.trashed) return
    let list = [...entry.changes.values()].filter((c) => !sameValue(c.from, c.to))
    if (trig.toValue !== undefined && trig.toValue !== null) list = list.filter((c) => reachesValue(c.from, c.to, trig.toValue!))
    if (list.length) void runAutomation(entry.dbId, entry.automationId, latest, 'property_changed', list)
    return
  }
  void runAutomation(entry.dbId, entry.automationId, latest ?? entry.row, entry.event, [])
}

function schedule(db: Database, automation: Automation, row: Page, event: EventType, changes: Change[]) {
  const key = `${automation.id}:${row.id}`
  let entry = pending.get(key)
  if (!entry || entry.event !== event) {
    if (entry) window.clearTimeout(entry.timer)
    entry = { timer: 0, dbId: db.id, automationId: automation.id, rowId: row.id, row, event, changes: new Map(), firstAt: Date.now() }
    pending.set(key, entry)
  }
  entry.row = row
  for (const c of changes) {
    const had = entry.changes.get(c.propertyId)
    entry.changes.set(c.propertyId, { propertyId: c.propertyId, from: had ? had.from : c.from, to: c.to })
  }
  arm(key, entry, COALESCE_MS[event])
}

/** Any edit to a row that is waiting to report "created" restarts its quiet period (within the cap). */
function touchCreated(rowId: ID) {
  for (const [key, p] of pending) {
    if (p.event !== 'row_created' || p.rowId !== rowId) continue
    const left = CREATED_MAX_MS - (Date.now() - p.firstAt)
    arm(key, p, Math.max(0, Math.min(COALESCE_MS.row_created, left)))
  }
}

function diff(state: ReturnType<typeof useWorkspace.getState>, prev: ReturnType<typeof useWorkspace.getState>) {
  const active = new Map<ID, Database>()
  for (const db of Object.values(state.databases)) if (db.automations?.some((a) => a.enabled)) active.set(db.id, db)
  if (!active.size) return

  const fire = (db: Database, row: Page, event: EventType, changes: Change[]) => {
    for (const a of db.automations ?? []) {
      if (!a.enabled || a.trigger.type !== event) continue
      if (a.trigger.type === 'property_changed') {
        const pid = a.trigger.propertyId
        const relevant = pid ? changes.filter((c) => c.propertyId === pid) : changes
        if (!relevant.length) continue
        schedule(db, a, row, event, relevant)
      } else schedule(db, a, row, event, [])
    }
  }

  const { changed, removed } = pageChanges(state.pages, prev.pages)
  for (const id of changed) {
    const page = state.pages[id]
    const db = page.databaseId ? active.get(page.databaseId) : undefined
    if (!db) continue
    const before = prev.pages[id]
    if (!before) {
      // a database created in the same update (import / template) doesn't count
      if (prev.pages[db.id] && !page.trashed) fire(db, page, 'row_created', [])
      continue
    }
    if (page.trashed !== before.trashed) {
      if (page.trashed) fire(db, page, 'row_deleted', [])
      continue
    }
    if (page.trashed) continue
    if (pending.size) touchCreated(id)
    const changes: Change[] = []
    for (const prop of db.properties) {
      if (COMPUTED.has(prop.type)) continue
      if (prop.type === 'title') {
        if (before.title !== page.title) changes.push({ propertyId: prop.id, from: before.title, to: page.title })
      } else if (!sameValue(before.properties[prop.id], page.properties[prop.id])) {
        changes.push({ propertyId: prop.id, from: before.properties[prop.id], to: page.properties[prop.id] })
      }
    }
    if (changes.length) fire(db, page, 'property_changed', changes)
  }
  // rows removed without passing through the trash (permanent delete of a live row)
  for (const id of removed) {
    const before = prev.pages[id]
    if (before.trashed || !before.databaseId) continue
    const db = active.get(before.databaseId)
    if (db && state.pages[db.id]) fire(db, before, 'row_deleted', [])
  }
}

let started = false

/** Start the engine once (main.tsx). Returns a stop function. */
export function startAutomations(): () => void {
  if (started) return () => {}
  started = true
  const unsub = useWorkspace.subscribe((state, prev) => {
    if (state.pages === prev.pages || !state.ready || !prev.ready) return
    if (paused || applyingAction || isApplyingRemote()) return
    try {
      diff(state, prev)
    } catch (err) {
      console.error('[automations] diff failed', err)
    }
  })
  return () => {
    unsub()
    started = false
    pending.forEach((p) => window.clearTimeout(p.timer))
    pending.clear()
  }
}

/** Send one webhook with a sample payload marked as a test (event "test", test: true). */
export async function testWebhook(dbId: ID, automation: Automation, action: Extract<AutomationAction, { type: 'webhook' }>): Promise<WebhookResult> {
  await loadDatabaseApi().catch(() => null)
  const payload = samplePayload(dbId, automation, { test: true })
  const res = await sendWebhook(action.url, action.method, payload, action.headers)
  pushLog({
    databaseId: dbId,
    automationId: automation.id,
    automationName: automation.name,
    event: 'test',
    rowTitle: payload.row.title,
    action: 'webhook',
    status: res.ok ? 'ok' : 'error',
    message: `${action.method} → ${res.message}`,
  })
  return res
}

/** Payload as it would be sent for this automation (uses the first row, or a placeholder row). */
export function samplePayload(dbId: ID, automation: Pick<Automation, 'id' | 'name' | 'trigger'>, opts: { test?: boolean } = {}): WebhookPayload {
  const s = useWorkspace.getState()
  const db = s.databases[dbId]
  const row =
    Object.values(s.pages)
      .filter((p) => p.databaseId === dbId && !p.trashed)
      .sort((a, b) => a.order - b.order)[0] ??
    ({ id: 'row_id', title: t('features.auto.sampleRow'), properties: {}, databaseId: dbId } as unknown as Page)
  if (!db) throw new Error('database missing')
  const trig = automation.trigger
  const event: WebhookPayload['event'] = opts.test ? 'test' : trig.type
  let changes: Change[] = []
  if (trig.type === 'property_changed') {
    const prop = db.properties.find((p) => p.id === trig.propertyId) ?? db.properties.find((p) => p.type !== 'title' && !COMPUTED.has(p.type))
    if (prop) changes = [{ propertyId: prop.id, from: prop.type === 'title' ? '' : null, to: trig.toValue ?? (prop.type === 'title' ? row.title : row.properties[prop.id]) }]
  }
  const payload = buildPayload(db, automation, row, event, changes)
  if (!opts.test) return payload
  const { event: ev, ...rest } = payload
  return { event: ev, test: true, ...rest }
}
