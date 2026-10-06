/**
 * One memory — writing memories (store actions only; page bodies with origin 'ai'). Nothing is written
 * without the person's OK: callers are the confirm keys of a proposal (terminal card, AI-menu card), the
 * terminal's review (the `remember` tool's staged change) and Settings → "Set up memory".
 *  - saveMemory: a new row (the database and its log are created on first use)
 *  - updateMemory: "Update existing" for a near-identical memory (findDuplicate)
 * What a request used is written by log.ts (the memory log; Uses / Last used are rollups over it).
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../../store/store'
import type { ID, PropertyValue } from '../../../store/types'
import { claudeDoc } from '../claudeDoc'
import { t } from '../../../i18n'
import { ensureMemoryDb, memoryDbId, memoryProps, optionIds, typeOption } from './schema'
import { readMemories } from './read'
import type { Memory, MemoryProposal } from './types'

const ORIGIN = 'ai'
const ws = () => useWorkspace.getState()

const words = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').split(/\s+/).filter((w) => w.length > 2))

/** How alike two sentences are (0…1, word overlap). */
export function similarity(a: string, b: string): number {
  const x = words(a)
  const y = words(b)
  if (!x.size || !y.size) return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0
  let both = 0
  for (const w of x) if (y.has(w)) both += 1
  return both / (x.size + y.size - both)
}

/** A near-identical ACTIVE memory (the proposal would repeat it): offer "Update existing" instead. */
export function findDuplicate(text: string, all: Memory[] = readMemories()): Memory | null {
  let best: { m: Memory; s: number } | null = null
  for (const m of all) {
    if (!m.active) continue
    const s = similarity(text, m.text)
    if (s >= 0.6 && (!best || s > best.s)) best = { m, s }
  }
  return best?.m ?? null
}

function bodyDoc(markdown: string): JSONContent | null {
  const md = markdown.trim()
  if (!md) return null
  // a memory's body comes from Claude (a proposal after a task that may have read a mail or a file)
  const doc = claudeDoc(md)
  return doc.content?.length ? doc : null
}

function values(dbId: ID, p: MemoryProposal, keepSource?: string): Record<ID, PropertyValue> {
  const db = ws().databases[dbId]
  if (!db) return {}
  const roles = memoryProps(db)
  const out: Record<ID, PropertyValue> = {}
  if (roles.type) {
    const opt = typeOption(dbId, roles.type, p.type)
    if (opt) out[roles.type] = opt
  }
  if (roles.topics) out[roles.topics] = optionIds(dbId, roles.topics, p.topics)
  if (roles.source) out[roles.source] = keepSource ?? p.source
  if (roles.active) out[roles.active] = true
  return out
}

/** Save a confirmed memory as a new row: its id and the undo. Throws when the memory cannot be written (read-only). */
export function saveMemory(p: MemoryProposal): { id: ID; undo: () => void } {
  const dbId = ensureMemoryDb()
  const properties = values(dbId, p)
  const id = ws().createRow(dbId, { title: p.text.trim(), properties })
  const doc = bodyDoc(p.body)
  if (doc) ws().setContent(id, doc, ORIGIN)
  return { id, undo: removeCreated(id) }
}

/** Undo of a created memory: deleted for good while untouched, else to the trash (recoverable). */
function removeCreated(id: ID): () => void {
  const rev = ws().pages[id]?.contentRev
  const title = ws().pages[id]?.title
  return () => {
    const now = ws().pages[id]
    if (!now) return
    if (now.contentRev !== rev || now.title !== title) ws().trashPage(id)
    else ws().deletePagePermanently(id)
  }
}

/** Write a proposal over an existing memory (its topics are kept and extended, its source kept). Returns the undo. */
export function updateMemory(id: ID, p: MemoryProposal): () => void {
  const dbId = memoryDbId()
  const row = ws().pages[id]
  if (!dbId || !row || row.databaseId !== dbId) throw new Error('gone')
  const db = ws().databases[dbId]!
  const roles = memoryProps(db)
  const before = { title: row.title, properties: { ...row.properties }, content: row.content }
  const optNames = (ids: PropertyValue | undefined) =>
    Array.isArray(ids) ? ids.map((x) => db.properties.find((q) => q.id === roles.topics)?.options?.find((o) => o.id === x)?.name ?? '').filter(Boolean) : []
  const topics = [...new Set([...optNames(roles.topics ? row.properties[roles.topics] : undefined), ...p.topics])]
  const keep = roles.source && typeof row.properties[roles.source] === 'string' && (row.properties[roles.source] as string).trim() ? (row.properties[roles.source] as string) : undefined
  ws().updatePage(id, { title: p.text.trim() })
  for (const [propId, v] of Object.entries(values(dbId, { ...p, topics }, keep))) ws().setRowProperty(id, propId, v)
  const doc = bodyDoc(p.body)
  if (doc) ws().setContent(id, doc, ORIGIN)
  return () => {
    if (!ws().pages[id]) return
    ws().updatePage(id, { title: before.title })
    for (const [propId, v] of Object.entries(before.properties)) ws().setRowProperty(id, propId, v)
    if (doc) ws().setContent(id, before.content, ORIGIN)
  }
}

/** "Page title · #/p/<id>" — the source line of a memory taken from a page. */
export function pageSource(pageId: ID | null | undefined): string {
  const p = pageId ? ws().pages[pageId] : undefined
  if (!p) return ''
  return `${p.title.trim() || t('common.untitled')} · #/p/${p.id}`
}
