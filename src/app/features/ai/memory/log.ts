/**
 * One memory — the usage log ("Memory log" / "Gedächtnis-Verlauf", schema.ts). One row per request that
 * took memories along: Name = "yyyy-MM-dd HH:mm · <the request as typed, ~80 characters>", When (created
 * time), Where (AI terminal / AI menu / ⌘K / Agent · <name>), Page (the title; the row's body links to
 * it), Memories (all that went along) and Used (those Claude cited [M3]) — two-way relations, so each
 * memory shows "Used in" / "Cited in" and its Uses / Last used rollups — and Result (one line).
 *
 * Privacy: only the request text the person typed and links — never page content or Claude's answer.
 * Written with origin 'ai', once per request. The newest 500 rows stay; older ones go to the trash
 * (never deleted for good). Settings → "Keep a usage log" off: no new rows.
 */
import { format } from 'date-fns'
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../../store/store'
import type { ID, PropertyValue } from '../../../store/types'
import { t } from '../../../i18n'
import { ensureLog, logDbId, logProps, memoryDbId, memoryProps, memoryReadOnly, optionIds } from './schema'
import { memorySettings } from './settings'
import type { MemoryUse, PickedMemory } from './types'

export const LOG_KEEP = 500
const ORIGIN = 'ai'
const ws = () => useWorkspace.getState()

export type LogWhere = { kind: 'terminal' | 'menu' | 'palette' } | { kind: 'agent'; name: string }

/** "AI terminal" / "Agent · Weekly digest" — the Where option. */
export const whereLabel = (w: LogWhere) => (w.kind === 'agent' ? t('features.memory.where.agent', { name: w.name }) : t(`features.memory.where.${w.kind}`))

const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1).trimEnd()}…` : one
}

const ids = (v: PropertyValue | undefined): ID[] => (Array.isArray(v) ? v.filter((x): x is ID => typeof x === 'string') : [])

/** Append `add` to a relation value (no duplicates). */
function appendRel(rowId: ID, propId: ID, add: ID) {
  const cur = ids(ws().pages[rowId]?.properties[propId])
  if (!cur.includes(add)) ws().setRowProperty(rowId, propId, [...cur, add])
}

/**
 * Log one request that took memories along (nothing when none went along, the log is switched off or
 * the workspace is read-only). Returns the log row id.
 */
export function logUse(opts: { task: string; where: LogWhere; pageId?: ID | null; use: MemoryUse | null | undefined; cited: PickedMemory[]; result?: string }): ID | null {
  const use = opts.use
  if (!use?.items.length || !memorySettings().log || memoryReadOnly()) return null
  const memId = memoryDbId()
  if (!memId) return null
  let logId: ID
  try {
    logId = ensureLog(memId)
  } catch (e) {
    console.warn('[one] memory: no log', e)
    return null
  }
  const s = ws()
  const log = s.databases[logId]
  const mem = s.databases[memId]
  if (!log || !mem) return null
  const lr = logProps(log, memId)
  const mr = memoryProps(mem)
  const live = (id: ID) => ws().pages[id]?.databaseId === memId && !ws().pages[id]?.trashed
  const memories = use.items.map((x) => x.id).filter(live)
  const used = opts.cited.map((x) => x.id).filter((id) => memories.includes(id))
  const page = opts.pageId ? s.pages[opts.pageId] : undefined
  const pageTitle = page && !page.trashed ? page.title.trim() || t('common.untitled') : ''
  const properties: Record<ID, PropertyValue> = {}
  if (lr.where) {
    const opt = optionIds(logId, lr.where, [whereLabel(opts.where)])[0]
    if (opt) properties[lr.where] = opt
  }
  if (lr.memories) properties[lr.memories] = memories
  if (lr.used) properties[lr.used] = used
  if (lr.page && pageTitle) properties[lr.page] = pageTitle
  if (lr.result && opts.result) properties[lr.result] = clip(opts.result, 120)
  const title = `${format(new Date(), 'yyyy-MM-dd HH:mm')} · ${clip(opts.task, 80) || '—'}`
  const rowId = ws().createRow(logId, { title, properties })
  // the reverse sides: "Used in" / "Cited in" on each memory
  if (mr.usedIn) for (const id of memories) appendRel(id, mr.usedIn, rowId)
  if (mr.citedIn) for (const id of used) appendRel(id, mr.citedIn, rowId)
  // the page it ran on: a link in the row's body (a mention — never its content)
  if (page && !page.trashed) {
    const doc: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: page.id, label: pageTitle, kind: 'page' } }] }] }
    ws().setContent(rowId, doc, ORIGIN)
  }
  pruneLog(logId)
  return rowId
}

/** Keep the newest LOG_KEEP rows; older ones go to the trash (never deleted for good). Returns how many went. */
export function pruneLog(logId: ID | null = logDbId(), keep = LOG_KEEP): number {
  if (!logId) return 0
  const rows = Object.values(ws().pages)
    .filter((p) => p.databaseId === logId && !p.trashed)
    .sort((a, b) => b.createdAt - a.createdAt || (b.order ?? 0) - (a.order ?? 0))
  const old = rows.slice(keep)
  for (const r of old) ws().trashPage(r.id)
  return old.length
}

export interface LogEntry {
  /** the log row */
  id: ID
  at: number
  where: string
  /** the request as it was typed (the row's name without its date) */
  task: string
  /** the page it ran on (from the row's body), null: none */
  pageId: ID | null
  cited: boolean
}

const firstPageMention = (doc: JSONContent | null | undefined): ID | null => {
  let out: ID | null = null
  const walk = (n: JSONContent) => {
    if (out) return
    if (n.type === 'mention' && n.attrs?.kind === 'page' && typeof n.attrs.id === 'string') out = n.attrs.id
    n.content?.forEach(walk)
  }
  if (doc) walk(doc)
  return out
}

/** Every use of a memory, newest first: the log rows that took it along. */
export function memoryHistory(memRowId: ID, limit = 30): LogEntry[] {
  const logId = logDbId()
  const memId = memoryDbId()
  const log = logId ? ws().databases[logId] : undefined
  if (!logId || !log) return []
  const lr = logProps(log, memId)
  if (!lr.memories) return []
  const whereProp = log.properties.find((p) => p.id === lr.where)
  const out: LogEntry[] = []
  for (const row of Object.values(ws().pages)) {
    if (row.databaseId !== logId || row.trashed) continue
    if (!ids(row.properties[lr.memories]).includes(memRowId)) continue
    const w = lr.where ? row.properties[lr.where] : undefined
    out.push({
      id: row.id,
      at: row.createdAt,
      where: typeof w === 'string' ? (whereProp?.options?.find((o) => o.id === w)?.name ?? '') : '',
      task: row.title.replace(/^\d{4}-\d\d-\d\d \d\d:\d\d · /, ''),
      pageId: firstPageMention(row.content),
      cited: lr.used ? ids(row.properties[lr.used]).includes(memRowId) : false,
    })
  }
  return out.sort((a, b) => b.at - a.at).slice(0, limit)
}
