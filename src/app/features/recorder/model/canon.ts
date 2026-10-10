/**
 * Canonical strings of a place, part by part — what the journal's digests sign and what "touched" and
 * the eject compare. Rows: title, icon, content, trash, parent, record type, order and every stored
 * property value. Pages: the same fields plus cover and their top-level blocks one by one. Schemas: each
 * property (without options), each option, option and property order, the lock and the database's other
 * parts. Views: the whole view. Never part of a place: comments, settings, favorite, hidden, template,
 * stamps, private, content origin / rev, plain. Pure — app helpers come in as `deps`.
 */
import type { JSONContent } from '@tiptap/core'
import type { Database, Page, PageIcon, PropertyType, PropertyValue, View } from '../../../store/types'
import { automationsCore, defCore, stable, templatesCore } from './schema'

export interface CanonDeps {
  /** content identity (schema-normalised, block ids ignored, trailing empty paragraph dropped) */
  contentKey(content: JSONContent | null | undefined): string
  /** stable text of a stored value ('' = empty) */
  valueKey(v: PropertyValue | undefined, type?: PropertyType): string
  iconKey(icon: PageIcon | null | undefined): string
  /** one block without volatile ids */
  blockKey(block: JSONContent): string
  /** the doc as the editor's schema reads it (default attrs filled in) — absent: as stored */
  normalize?(content: JSONContent | null | undefined): JSONContent | null
}

/** Never stored: computed from other data (history keeps the same list). */
const COMPUTED = new Set<PropertyType>(['title', 'formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by'])
export const isStoredType = (t: PropertyType) => !COMPUTED.has(t)

/** A top-level block: its id (null: none) and its canonical string. */
export interface BlockCanon {
  id: string | null
  canon: string
}

/** The top-level blocks of a doc (normalised; the trailing empty paragraph dropped). */
export function blockList(content: JSONContent | null | undefined, deps: CanonDeps): BlockCanon[] {
  const doc = deps.normalize ? deps.normalize(content) : (content ?? null)
  const blocks = [...(doc?.content ?? [])]
  while (blocks.length > 1 && blocks[blocks.length - 1].type === 'paragraph' && !blocks[blocks.length - 1].content?.length) blocks.pop()
  return blocks.map((b) => {
    const id = typeof b.attrs?.id === 'string' && b.attrs.id ? (b.attrs.id as string) : null
    return { id, canon: deps.blockKey(b) }
  })
}

const pa = (p: Page) => `${p.databaseId ?? ''}|${p.parentId ?? ''}`

/** A database row, part by part (stored values of every property its database has then). */
export function rowParts(page: Page, db: Pick<Database, 'properties'> | null | undefined, deps: CanonDeps): Record<string, string> {
  const out: Record<string, string> = {
    t: page.title,
    i: deps.iconKey(page.icon),
    c: deps.contentKey(page.content),
    tr: page.trashed ? '1' : '0',
    pa: pa(page),
    r: page.recordType ?? '',
    o: String(page.order),
  }
  if (db) {
    for (const p of db.properties) if (isStoredType(p.type)) out[`p:${p.id}`] = deps.valueKey(page.properties?.[p.id], p.type)
  } else {
    for (const k of Object.keys(page.properties ?? {})) out[`p:${k}`] = deps.valueKey(page.properties[k])
  }
  return out
}

/** A page (or a database's own page) without its blocks — those come from blockList(). */
export function pageParts(page: Page, deps: CanonDeps): Record<string, string> {
  return {
    t: page.title,
    i: deps.iconKey(page.icon),
    tr: page.trashed ? '1' : '0',
    pa: pa(page),
    o: String(page.order),
    cv: stable(page.cover ?? null),
  }
}

/** A database's schema, part by part. */
export function schemaParts(db: Database): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of db.properties) {
    out[`p:${p.id}`] = stable(defCore(p))
    for (const o of p.options ?? []) out[`o:${p.id}/${o.id}`] = stable({ id: o.id, name: o.name, color: o.color, group: o.group ?? null })
    if (p.options?.length) out[`oo:${p.id}`] = p.options.map((o) => o.id).join(',')
  }
  out.po = db.properties.map((p) => p.id).join(',')
  out.l = db.locked ? '1' : '0'
  out.cmd = stable(db.commands ?? null)
  out.tpl = stable(templatesCore(db))
  out.auto = stable(automationsCore(db))
  out.pipe = stable(db.pipeline ?? null)
  out.rt = stable(db.recordTypes ?? null)
  out.sub = stable(db.subItems ?? null)
  out.dep = stable(db.dependencies ?? null)
  return out
}

/** A view: one part. */
export const viewPart = (view: View): Record<string, string> => ({ v: stable(view) })

/** The whole canonical string of a place: its parts in key order, then (pages) its blocks in order. */
export function wholeCanon(parts: Record<string, string>, blocks?: BlockCanon[]): string {
  const keys = Object.keys(parts).sort()
  let s = keys.map((k) => `${k}\u0000${parts[k]}`).join('\u0001')
  if (blocks) s += `\u0002${blocks.map((b) => `${b.id ?? '#'}=${b.canon}`).join('\u0003')}`
  return s
}

/** A place object: a page / row (with its database then), a database (schema), or a view. */
export type PlaceObject = { kind: 'row'; page: Page; db: Pick<Database, 'properties'> | null | undefined } | { kind: 'page'; page: Page } | { kind: 'schema'; db: Database } | { kind: 'view'; view: View }

/** Parts and (pages) blocks of a place object. */
export function placeCanon(o: PlaceObject, deps: CanonDeps): { parts: Record<string, string>; blocks?: BlockCanon[] } {
  switch (o.kind) {
    case 'row':
      return { parts: rowParts(o.page, o.db, deps) }
    case 'page':
      return { parts: pageParts(o.page, deps), blocks: blockList(o.page.content, deps) }
    case 'schema':
      return { parts: schemaParts(o.db) }
    case 'view':
      return { parts: viewPart(o.view) }
  }
}

function fnv1a(str: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/**
 * A synchronous key of a place's parts (no HMAC) — the eject's re-check before its one store update and
 * its Undo compare these (stamps, ids added by an editor and follow-up writes leave it unchanged).
 */
export function partsKey(o: PlaceObject | null | undefined, deps: CanonDeps): string {
  if (!o) return '-'
  const { parts, blocks } = placeCanon(o, deps)
  const s = wholeCanon(parts, blocks)
  return `${fnv1a(s)}.${s.length.toString(36)}`
}
