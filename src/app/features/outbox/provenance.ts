/**
 * Where a draft's material comes from — the slice-1 core of the provenance layer (docs/OUTBOX.md § Trust). The Outbox
 * decides trust itself; a caller's word never counts:
 *  - pageTrust: a page is the person's own unless something else wrote it last — an agent, a mirror (its rows), a
 *    sync, a mail import, an MCP call, Claude (contentOrigin 'ai' …), an API / webhook writer, or blocks moved,
 *    restored or copied in from elsewhere (split, editor-move, history, template); a caller naming a page never
 *    brings its text along — the Outbox reads the page itself;
 *  - a row's fields: typed values (number, date, checkbox, a person, an option the profile declares) are exempt; free
 *    text (title, text, a link, a comment) and options a mirror made from the source are foreign — anyone who can
 *    write to the source can write them;
 *  - transcripts, MCP results, mails, files, web pages, coding output, agents' text are always foreign.
 */
import { useWorkspace } from '../../store/store'
import type { Database, ID, Page, PropertyDef } from '../../store/types'
import { propertyValueToText } from '../../database'
import { mirrorSourceOf } from '../agents'
import { readableContent } from '../../editor'
import { t } from '../../i18n'
import { addressSet } from './seal'
import { BASELINE_ROLES, rowBaseline, type RowReading } from './fields'
import { propByRef } from './routes'
import type { SourceInput, SourceKind, SourceRef } from './types'

const ws = () => useWorkspace.getState()

/**
 * Writers whose text is not the person's own — or may not be: blocks moved or split off another page, a restored
 * version and a template copy carry whatever wrote them before (until slice 3 traces trust through the history).
 */
const FOREIGN_ORIGINS = new Set(['ai', 'sync', 'import', 'file', 'mail', 'coding', 'clip', 'mcp', 'agent', 'api', 'hook', 'remote', 'meeting', 'script', 'synced', 'share', 'split', 'editor-move', 'history', 'template'])
const FOREIGN_ACTOR = /^(agent|api|hook):/
/** sources that are never the person's own, whatever a caller says */
const ALWAYS_FOREIGN: SourceKind[] = ['record', 'mcp', 'mail', 'file', 'web', 'image', 'transcript', 'coding', 'agent']

/** always typed: a value of its own kind, never words someone wrote */
const TYPED = new Set<PropertyDef['type']>(['number', 'date', 'checkbox', 'person'])
/** typed only with options the profile declares (recipeOptionNames): a mirror makes the others from the source */
const OPTION_TYPES = new Set<PropertyDef['type']>(['select', 'status'])

/** The options a profile declares, per property name (lower case) — see recipeOptionNames. */
export type DeclaredOptions = Record<string, string[]>

/** Is this field of the row a typed value (exempt from the seal)? */
function typedField(db: Database, prop: PropertyDef, row: Page, declared: DeclaredOptions): boolean {
  if (TYPED.has(prop.type)) return true
  if (!OPTION_TYPES.has(prop.type)) return false
  const allowed = declared[prop.name.toLowerCase()]
  const value = text(db, prop, row)
  return !!allowed && !!value && allowed.includes(value.toLowerCase())
}

/** What a page source may hold as its text: the page itself (its readable part), never a caller's word for it. */
const PAGE_TEXT_MAX = 20_000
function pageText(pageId: ID): string {
  try {
    return readableContent(pageId).markdown.slice(0, PAGE_TEXT_MAX)
  } catch {
    return ''
  }
}

/** One's own origin: links to it point into One (flagged 'internal'). */
export const ownOrigin = () => (typeof location !== 'undefined' ? location.origin : '')

const excerpt = (s: string) => (s.length > 280 ? `${s.slice(0, 279)}…` : s)

/** Is a page the person's own text? (and why not) */
export function pageTrust(pageId: ID): { trusted: boolean; why?: string } {
  const s = ws()
  const p = s.pages[pageId]
  if (!p || p.trashed) return { trusted: false, why: 'gone' }
  if (p.contentOrigin && FOREIGN_ORIGINS.has(p.contentOrigin)) return { trusted: false, why: p.contentOrigin }
  if ((p.updatedBy && FOREIGN_ACTOR.test(p.updatedBy)) || (p.createdBy && FOREIGN_ACTOR.test(p.createdBy))) return { trusted: false, why: 'agent' }
  if (p.databaseId) {
    const db = s.databases[p.databaseId]
    if (s.settings.mail?.databaseId === p.databaseId || db?.system === 'mail-contacts' || db?.system === 'mail-companies' || db?.system === 'mail-conversations') return { trusted: false, why: 'mail' }
    if (mirrorSourceOf(p.databaseId)) return { trusted: false, why: 'mirror' }
  }
  return { trusted: true }
}

/** A source as the Outbox keeps it: trust decided here, the text reduced to its addresses and a short excerpt. */
export function sourceRef(i: SourceInput, own: { trusted: boolean; typed?: boolean }): SourceRef {
  const text = i.text ?? ''
  return {
    kind: i.kind,
    ref: String(i.ref).slice(0, 200),
    label: String(i.label).slice(0, 120),
    trusted: own.trusted,
    ...(own.typed ? { typed: true } : {}),
    ...(i.server ? { server: String(i.server).slice(0, 64) } : {}),
    addresses: text ? addressSet(text, ownOrigin()) : [],
    ...(text ? { excerpt: excerpt(text.trim()) } : {}),
  }
}

/**
 * Trust for a caller's source (the public API): only a page that is the person's own and a typed field of a row
 * count — a caller's `trusted` / `typed` are never taken, nor its text for a page (the page is read here: an own page's
 * id cannot carry foreign words). The person's own instruction comes in through the draft path (draft.ts).
 */
export function judgeSource(i: SourceInput, declared: DeclaredOptions = {}): SourceRef {
  if (ALWAYS_FOREIGN.includes(i.kind)) return sourceRef(i, { trusted: false })
  if (i.kind === 'page') {
    const trusted = pageTrust(i.ref).trusted
    return sourceRef({ ...i, text: trusted ? pageText(i.ref) : '' }, { trusted })
  }
  if (i.kind === 'row') {
    const [rowId, propId] = String(i.ref).split(':')
    const s = ws()
    const row = s.pages[rowId]
    const db = row?.databaseId ? s.databases[row.databaseId] : undefined
    const prop = db?.properties.find((p) => p.id === propId)
    if (row && db && prop && typedField(db, prop, row, declared)) return sourceRef({ ...i, text: '' }, { trusted: false, typed: true })
    return sourceRef(i, { trusted: false })
  }
  // 'text' / 'memory' from a caller: someone else's words as far as the Outbox can tell
  return sourceRef(i, { trusted: false })
}

/* ------------------------------------------------------------------ a mirrored row */

export interface RowRead extends RowReading {
  key: string | null
  link: string | null
  owner: string
  title: string
}

const text = (db: Database, prop: PropertyDef | null, row: Page) => (prop ? propertyValueToText(db, prop, row).trim() : '')

/** A date field as its stored stamp (with the time, so a later comment the same day counts), anything else as text. */
const stamp = (db: Database, prop: PropertyDef | null, row: Page) => {
  if (prop?.type !== 'date') return text(db, prop, row)
  const v = row.properties[prop.id] as { start?: unknown } | null | undefined
  return typeof v?.start === 'string' ? v.start : ''
}

/** A row as the Outbox reads it: key, link, owner, the source fields compared for CHANGED, the newest comment. */
export function readRow(rowId: ID, roles: Record<string, string[]>): RowRead | null {
  const s = ws()
  const row = s.pages[rowId]
  const db = row?.databaseId ? s.databases[row.databaseId] : undefined
  if (!row || !db) return null
  const keyProp = db.properties.find((p) => p.key) ?? null
  const values: Partial<Record<string, { label: string; text: string }>> = {}
  for (const role of BASELINE_ROLES) {
    const prop = propByRef(db, role, roles)
    if (prop) values[role] = { label: prop.name, text: stamp(db, prop, row) }
  }
  const latest = text(db, propByRef(db, 'lastComment', roles), row)
  const link = text(db, propByRef(db, 'link', roles), row)
  return {
    ...rowBaseline(values, latest || undefined),
    key: keyProp ? text(db, keyProp, row) || null : null,
    link: /^https?:\/\//i.test(link) ? link : null,
    owner: text(db, propByRef(db, 'owner', roles), row),
    title: row.title,
  }
}

/** The row's own fields as sources: typed values exempt, free text (and options made from the source) foreign ("Comment T. Brandt"). */
export function rowSources(rowId: ID, roles: Record<string, string[]>, declared: DeclaredOptions = {}): SourceRef[] {
  const s = ws()
  const row = s.pages[rowId]
  const db = row?.databaseId ? s.databases[row.databaseId] : undefined
  if (!row || !db) return []
  const owner = text(db, propByRef(db, 'owner', roles), row)
  const commentProp = propByRef(db, 'lastComment', roles)
  const out: SourceRef[] = []
  for (const prop of db.properties) {
    if (prop.agentReadOnly) continue
    const value = prop.type === 'title' ? row.title : text(db, prop, row)
    if (!value) continue
    if (typedField(db, prop, row, declared)) {
      out.push(sourceRef({ kind: 'row', ref: `${rowId}:${prop.id}`, label: prop.name }, { trusted: false, typed: true }))
      continue
    }
    const comment = prop === commentProp
    const label = comment && owner ? t('features.outbox.src.comment', { who: owner }) : prop.name
    out.push({ ...sourceRef({ kind: 'row', ref: `${rowId}:${prop.id}`, label, text: value }, { trusted: false }), ...(comment ? { role: 'comment' as const } : {}) })
  }
  return out
}
