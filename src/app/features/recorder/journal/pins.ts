/**
 * Pin capture: the exact state a place had right before a segment's first Vorgang, taken from the store
 * listener's frozen `prev` objects (never from a caller's version) — a page with its row values read by
 * the database as it was then, or the whole database for a schema / view place. Written to the version
 * store by features/history/pins.ts; without IndexedDB kept in this tab (500 pins at most, oldest first
 * out — their segments read partial).
 */
import type { JSONContent } from '@tiptap/core'
import type { Database, ID, Page } from '../../../store/types'
import { propsOf } from '../../history/props'
import { keepPinsSized, loadPinBodies, loadPinMetas, pinSize, type PinInput } from '../../history/pins'
import type { PinMeta, PlaceKey, Scope } from '../model/types'

/** onefile ids anywhere in a JSON value (the device wipe keeps / drops files by them). */
export function fileIdsIn(v: unknown): string[] {
  const out = new Set<string>()
  const s = typeof v === 'string' ? v : JSON.stringify(v ?? null)
  for (const m of s.matchAll(/onefile:([A-Za-z0-9_-]{1,64})/g)) out.add(m[1])
  return [...out]
}

/** A page pin without its body digest (filled in at the flush). */
export function pagePin(page: Page, prevDb: Database | undefined, at: number, seg: string): { meta: PinMeta & { kind: 'page' }; content: JSONContent | null } {
  const { content, plain: _p, comments: _c, ...rest } = page
  const defs = page.databaseId ? (propsOf(page, prevDb)?.defs ?? null) : null
  return {
    meta: { v: 1, kind: 'page', at, seg, page: rest, defs, body: null, files: [...new Set([...fileIdsIn(rest), ...fileIdsIn(content)])] },
    content: content ?? null,
  }
}

/** A schema pin (schema and view places): the whole database as it was. */
export function schemaPin(db: Database, at: number, seg: string): PinMeta & { kind: 'schema' } {
  return { v: 1, kind: 'schema', at, seg, dbId: db.id, db, files: fileIdsIn(db.templates ?? null) }
}

/* ------------------------------------------------------------------ */
/* memory-only mode                                                     */
/* ------------------------------------------------------------------ */

const MEM_MAX = 500
const memMetas = new Map<string, PinMeta>()
const memBodies = new Map<string, JSONContent | null>()
let seq = 0

function keepInMemory(scope: Scope, pins: PinInput[]): string[] {
  // (memory mode keeps no budget: the 500-pin cap is its limit)
  const ids: string[] = []
  for (const p of pins) {
    const id = `${p.place}|m${(++seq).toString(36)}`
    memMetas.set(`${scope}|${id}`, p.meta)
    if (p.meta.kind === 'page' && p.meta.body && p.place.startsWith('p:')) memBodies.set(`${scope}|${p.place.slice(2)}|${p.meta.body}`, p.content ?? null)
    ids.push(id)
  }
  while (memMetas.size > MEM_MAX) {
    const first = memMetas.keys().next().value as string
    memMetas.delete(first)
  }
  // bodies nobody refers to any more
  if (memBodies.size > MEM_MAX) {
    const used = new Set<string>()
    for (const [k, m] of memMetas) if (m.kind === 'page' && m.body) used.add(`${k.slice(0, k.indexOf('|'))}|${m.page.id}|${m.body}`)
    for (const k of [...memBodies.keys()]) if (!used.has(k)) memBodies.delete(k)
  }
  return ids
}

/** Keep pins (IndexedDB, or this tab's memory in memory mode): their ids, and the bytes each added to the store. */
export async function storePins(scope: Scope, pins: PinInput[], memory: boolean): Promise<{ ids: Array<string | null>; bytes: number[] }> {
  if (memory) return { ids: keepInMemory(scope, pins), bytes: pins.map(() => 0) }
  return keepPinsSized(scope, pins)
}

/** Memory mode: the person deleted a place for good — its pins leave this tab (a page's bodies with them). */
export function dropMemoryPins(scope: Scope, place: PlaceKey): void {
  const prefix = `${scope}|${place}|`
  const dbViews = place.startsWith('s:') ? `${scope}|v:${place.slice(2)}/` : null
  for (const k of [...memMetas.keys()]) if (k.startsWith(prefix) || (dbViews && k.startsWith(dbViews))) memMetas.delete(k)
  if (place.startsWith('p:')) for (const k of [...memBodies.keys()]) if (k.startsWith(`${scope}|${place.slice(2)}|`)) memBodies.delete(k)
}

/**
 * The definitions a row's pin reads its values with: the database before this update (`prev`) — plus what the same
 * writer took out of it earlier in its stretch (`earlier`: an option removed, then the values cleared row by row,
 * still reads with the option). Nothing the database had before is ever left out.
 */
export function pinDefsDb(prev: Database | undefined, earlier: Database | undefined): Database | undefined {
  if (!earlier || !prev || earlier === prev) return prev ?? earlier
  const props = prev.properties.map((p) => {
    const was = earlier.properties.find((x) => x.id === p.id)
    const gone = (was?.options ?? []).filter((o) => !(p.options ?? []).some((x) => x.id === o.id))
    return gone.length ? { ...p, options: [...(p.options ?? []), ...gone] } : p
  })
  for (const p of earlier.properties) if (!prev.properties.some((x) => x.id === p.id)) props.push(p)
  return { ...prev, properties: props }
}

export { pinSize }

/** Read pin metas (either store). */
export async function readPinMetas(scope: Scope, ids: string[], memory: boolean): Promise<Map<string, PinMeta>> {
  if (!memory) return loadPinMetas(scope, ids)
  const out = new Map<string, PinMeta>()
  for (const id of ids) {
    const m = memMetas.get(`${scope}|${id}`)
    if (m) out.set(id, m)
  }
  return out
}

export async function readPinBodies(scope: Scope, refs: Array<[ID, string]>, memory: boolean): Promise<Map<string, JSONContent | null>> {
  if (!memory) return loadPinBodies(scope, refs)
  const out = new Map<string, JSONContent | null>()
  for (const [page, d] of refs) {
    const k = `${scope}|${page}|${d}`
    if (memBodies.has(k)) out.set(`${page}|${d}`, memBodies.get(k) ?? null)
  }
  return out
}

/** A pin read back as the object it pinned: a page (rows: with a database of the definitions then), or a database. */
export function pinObject(meta: PinMeta, content: JSONContent | null | undefined): { page?: Page; db?: Database; rowDb?: { properties: Database['properties'] } } {
  if (meta.kind === 'schema') return { db: meta.db as Database }
  const page = { ...meta.page, content: content ?? null } as Page
  return { page, ...(meta.defs ? { rowDb: { properties: meta.defs.map((d) => ({ ...d })) as Database['properties'] } } : {}) }
}

export type { PinInput, PlaceKey }
