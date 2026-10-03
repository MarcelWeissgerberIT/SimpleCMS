/**
 * Recurring templates — the scheduler (a background service, started once from main.tsx).
 *
 * Runs only while the app is open: shortly after start, every minute, and when the tab becomes
 * visible again. Each due occurrence of a template's `repeat` becomes a row: title from the repeat's
 * title pattern (variables filled), the chosen date property preset to the occurrence's day,
 * the template's content (variables filled) and preset properties. A toast reports it ("· Open").
 *
 * Idempotent across reloads, tabs and devices: a row's id is derived from (database, template,
 * occurrence wall time) — if a page with that id exists (even in the trash) the occurrence is done.
 * `repeat.lastRunAt` marks how far occurrences have been handled; missed ones (the app was closed)
 * are caught up, but only the MAX_CATCH_UP most recent — the toast says how many were skipped.
 *
 * One tab per workspace runs it (Web Locks leadership, released when the tab goes away) and tells
 * the other tabs, so a visible one shows the toast too. Cloud workspaces: only while online and
 * writable (an offline device waits for the sync instead of racing other devices).
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { isEffectivelyTrashed } from '../../store/selectors'
import type { Database, ID, PropertyValue } from '../../store/types'
import { activeWorkspace, useCloud } from '../../cloud'
import { t } from '../../i18n'
import { DEFAULT_REPEAT_TITLE, MAX_CATCH_UP, fillRepeatVars, occurrenceRowId, occurrencesBetween, type FillVars, type Occurrence } from './schedule'

type Template = NonNullable<Database['templates']>[number]

const TICK_MS = 60_000
/** First run after start: lets the UI (and a cloud workspace's sync) settle. */
const SETTLE_MS = 1500
const CHANNEL = 'one-recurring'

export interface RecurringNotice {
  databaseId: ID
  templateName: string
  /** created rows, oldest first */
  rows: Array<{ id: ID; title: string }>
  /** older missed occurrences that were not created */
  skipped: number
}

/* ------------------------------------------------------------------ */
/* One pass                                                            */
/* ------------------------------------------------------------------ */

function canWrite(): boolean {
  const c = useCloud.getState()
  return c.status === 'local' || (c.status === 'online' && !c.readOnly)
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function fillContent(node: JSONContent, at: Date, vars: FillVars): JSONContent {
  if (typeof node.text === 'string') node.text = fillRepeatVars(node.text, at, vars)
  node.content?.forEach((c) => fillContent(c, at, vars))
  return node
}

/** Create the row of one occurrence. Null when it exists already (here, in another tab, on another device). */
function createOccurrence(dbId: ID, tpl: Template, occ: Occurrence): { id: ID; title: string } | null {
  const s = useWorkspace.getState()
  const db = s.databases[dbId]
  const r = tpl.repeat
  if (!db || !r) return null
  const id = occurrenceRowId(dbId, tpl.id, occ.wall)
  if (s.pages[id]) return null

  const at = new Date(occ.at)
  const vars: FillVars = { name: tpl.name || t('common.untitled'), lang: s.settings.language }
  const title = fillRepeatVars(r.title?.trim() || DEFAULT_REPEAT_TITLE, at, vars)
  const properties: Record<ID, PropertyValue> = clone(tpl.properties ?? {})
  const dateProp = r.dateProperty ? db.properties.find((p) => p.id === r.dateProperty && p.type === 'date') : undefined
  if (dateProp) properties[dateProp.id] = { start: occ.day }
  const uniqueIds = db.properties.filter((p) => p.type === 'unique_id')
  for (const p of uniqueIds) if (properties[p.id] === undefined) properties[p.id] = db.nextUniqueId

  s.createPage({
    id,
    parentId: dbId,
    databaseId: dbId,
    title,
    icon: tpl.icon ?? null,
    properties,
    content: tpl.content ? fillContent(clone(tpl.content), at, vars) : null,
  })
  if (uniqueIds.length) s.updateDatabase(dbId, { nextUniqueId: db.nextUniqueId + 1 })
  return { id, title }
}

/**
 * Create every due occurrence (at `now`) in every database. Safe to call any time, from any tab:
 * existing occurrence rows are never created again. Returns what was created.
 */
export function runRecurringTemplates(now = Date.now()): RecurringNotice[] {
  const s = useWorkspace.getState()
  if (!s.ready || !canWrite()) return []
  const notices: RecurringNotice[] = []
  for (const db of Object.values(s.databases)) {
    const list = db.templates
    if (!list?.some((x) => x.repeat)) continue
    // a database in the trash pauses; restoring it catches up (capped like any catch-up)
    if (!s.pages[db.id] || isEffectivelyTrashed(s.pages, db.id)) continue
    let changed = false
    const next = list.map((tpl): Template => {
      const r = tpl.repeat
      if (!r) return tpl
      // never anchored (e.g. written by an older client): start counting from now, no backfill
      if (typeof r.lastRunAt !== 'number' || !Number.isFinite(r.lastRunAt)) {
        changed = true
        return { ...tpl, repeat: { ...r, lastRunAt: now } }
      }
      const due = occurrencesBetween(r, r.lastRunAt, now)
      if (!due.length) return tpl
      changed = true
      const recent = due.slice(-MAX_CATCH_UP)
      const rows = recent.map((occ) => createOccurrence(db.id, tpl, occ)).filter((x): x is { id: ID; title: string } => !!x)
      if (rows.length) notices.push({ databaseId: db.id, templateName: tpl.name || t('common.untitled'), rows, skipped: due.length - recent.length })
      return { ...tpl, repeat: { ...r, lastRunAt: now } }
    })
    if (changed) useWorkspace.getState().updateDatabase(db.id, { templates: next })
  }
  return notices
}

/* ------------------------------------------------------------------ */
/* Toast                                                               */
/* ------------------------------------------------------------------ */

/** Open a row in the peek — in another tab it may still be on its way (cross-tab sync). */
function openRow(id: ID) {
  const open = () => useUI.getState().openPeek(id)
  if (useWorkspace.getState().pages[id]) return open()
  const stop = useWorkspace.subscribe((st) => {
    if (!st.pages[id]) return
    stop()
    window.clearTimeout(timeout)
    open()
  })
  const timeout = window.setTimeout(stop, 5000)
}

export function notifyRecurring(n: RecurringNotice): void {
  const newest = n.rows[n.rows.length - 1]
  if (!newest) return
  let message = n.rows.length === 1 ? t('database.repeat.toast.one', { title: newest.title }) : t('database.repeat.toast.many', { count: n.rows.length, name: n.templateName })
  if (n.skipped > 0) message += ` · ${t(n.skipped === 1 ? 'database.repeat.toast.skipped.one' : 'database.repeat.toast.skipped.other', { count: n.skipped })}`
  useUI.getState().toast({ message, kind: 'success', timeout: 10_000, action: { label: t('common.open'), run: () => openRow(newest.id) } })
}

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

let started = false
let leader = false
let generation = 0
let settleTimer = 0
let tickTimer = 0
let releaseLock: (() => void) | null = null
let channel: BroadcastChannel | null = null

function tick() {
  if (!leader) return
  let notices: RecurringNotice[]
  try {
    notices = runRecurringTemplates()
  } catch (e) {
    console.error('[one] recurring templates failed', e)
    return
  }
  for (const n of notices) {
    notifyRecurring(n)
    channel?.postMessage({ type: 'created', notice: n })
  }
}

function onMessage(e: MessageEvent) {
  const d = e.data as { type?: string; notice?: RecurringNotice } | null
  if (d?.type === 'created' && d.notice && document.visibilityState === 'visible') notifyRecurring(d.notice)
}

function onVisible() {
  if (document.visibilityState === 'visible') tick()
}

function lead(gen: number) {
  if (gen !== generation) return
  leader = true
  settleTimer = window.setTimeout(tick, SETTLE_MS)
  tickTimer = window.setInterval(tick, TICK_MS)
}

/**
 * Start the scheduler (idempotent). Call once after the workspace is loaded, next to
 * startHistory() / startAutomations(). Returns a stop function.
 */
export function startRecurringTemplates(): () => void {
  if (started) return stopRecurringTemplates
  started = true
  const gen = ++generation
  channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null
  channel?.addEventListener('message', onMessage)
  document.addEventListener('visibilitychange', onVisible)

  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!locks?.request) {
    lead(gen)
  } else {
    const ws = activeWorkspace()
    // held for the tab's lifetime: the next tab in line takes over when this one closes
    locks
      .request(`${CHANNEL}:${ws.kind}:${ws.id}`, () =>
        new Promise<void>((resolve) => {
          if (gen !== generation) return resolve()
          releaseLock = resolve
          lead(gen)
        }),
      )
      .catch((e) => console.warn('[one] recurring templates: no tab lock', e))
  }
  return stopRecurringTemplates
}

export function stopRecurringTemplates(): void {
  if (!started) return
  started = false
  leader = false
  generation++
  window.clearTimeout(settleTimer)
  window.clearInterval(tickTimer)
  releaseLock?.()
  releaseLock = null
  channel?.removeEventListener('message', onMessage)
  channel?.close()
  channel = null
  document.removeEventListener('visibilitychange', onVisible)
}

// Test hook (dev, or ?e2e): start without main.tsx, run a pass in this tab regardless of leadership.
if (typeof window !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e'))) {
  ;(window as unknown as { __oneRecurring?: unknown }).__oneRecurring = {
    start: startRecurringTemplates,
    stop: stopRecurringTemplates,
    isLeader: () => leader,
    run: (now?: number) => {
      const notices = runRecurringTemplates(now)
      notices.forEach(notifyRecurring)
      return notices
    },
  }
}
