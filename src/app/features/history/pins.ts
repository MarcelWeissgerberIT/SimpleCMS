/**
 * Flight recorder pins — exact before-images of a place, kept in the version store next to the versions
 * (features/recorder writes them; nothing else reads them):
 *   pin:<scope>|m|<placeKey>|<pinId>   PinMeta — everything of the page but its content (a row's property
 *                                      definitions from the database as it was then), or a database's schema
 *   pin:<scope>|b|<pageId>|<cdig>      PinBody — the content, addressed by its digest per page (pins of the
 *                                      same page with unchanged content share one body)
 * Pins are never listed with the versions (listSnapshots reads `idx:` only), never thinned, never synced,
 * never in a backup; prune and the device wipe remove them by key range.
 */
import type { JSONContent } from '@tiptap/core'
import { getMany, setMany, promisifyRequest } from 'idb-keyval'
import { newId } from '../../lib/ids'
import type { ID, PropertyValue } from '../../store/types'
import type { PinBody, PinMeta, PlaceKey, Scope } from '../recorder/model/types'
import { historyStore, type SnapshotBody } from './snapshots'
import { isEmptyValue } from './props'

const HI = '￿'
export const pinMetaKey = (scope: Scope, pinId: string) => `pin:${scope}|m|${pinId}`
export const pinBodyKey = (scope: Scope, pageId: ID, cdig: string) => `pin:${scope}|b|${pageId}|${cdig}`
const metaRange = (scope: Scope, place?: PlaceKey) => (place ? [`pin:${scope}|m|${place}|`, `pin:${scope}|m|${place}|${HI}`] : [`pin:${scope}|m|`, `pin:${scope}|m|${HI}`])
const bodyRange = (scope: Scope, pageId: ID) => [`pin:${scope}|b|${pageId}|`, `pin:${scope}|b|${pageId}|${HI}`]
const pageOfPlace = (place: string): ID | null => (place.startsWith('p:') ? place.slice(2) : null)

/** A pin's place (its id is `<placeKey>|<pinId>`). */
export const placeOfPin = (pinId: string): PlaceKey => pinId.slice(0, pinId.lastIndexOf('|')) as PlaceKey

export interface PinInput {
  place: PlaceKey
  meta: PinMeta
  /** pages: the content (stored once per page and digest — `meta.body`) */
  content?: JSONContent | null
}

/**
 * Keep pins: one read of the body keys, then ONE write of the metas and the bodies not stored yet.
 * Resolves with each pin's id (`<placeKey>|<pinId>`), or null for all when the write failed.
 */
export async function keepPins(scope: Scope, pins: PinInput[]): Promise<Array<string | null>> {
  const s = historyStore()
  if (!s || !pins.length) return pins.map(() => null)
  try {
    const bodies = new Map<string, JSONContent | null>()
    for (const p of pins) {
      const page = pageOfPlace(p.place)
      if (p.meta.kind === 'page' && page && p.meta.body) bodies.set(pinBodyKey(scope, page, p.meta.body), p.content ?? null)
    }
    const keys = [...bodies.keys()]
    const have = keys.length ? await getMany<PinBody | undefined>(keys, s) : []
    const entries: Array<[string, PinMeta | PinBody]> = []
    keys.forEach((k, i) => {
      if (!have[i]) entries.push([k, { content: bodies.get(k) ?? null }])
    })
    const ids = pins.map((p) => `${p.place}|${newId()}`)
    pins.forEach((p, i) => entries.push([pinMetaKey(scope, ids[i]), p.meta]))
    await setMany(entries, s)
    return ids
  } catch (e) {
    console.warn('[one] flight recorder: pins not kept', e)
    return pins.map(() => null)
  }
}

export async function loadPinMetas(scope: Scope, ids: string[]): Promise<Map<string, PinMeta>> {
  const out = new Map<string, PinMeta>()
  const s = historyStore()
  if (!s || !ids.length) return out
  const vals = await getMany<PinMeta | undefined>(
    ids.map((id) => pinMetaKey(scope, id)),
    s,
  )
  ids.forEach((id, i) => {
    if (vals[i]) out.set(id, vals[i]!)
  })
  return out
}

/** Bodies by `[pageId, cdig]` → content (key `<pageId>|<cdig>`; missing ones are left out). */
export async function loadPinBodies(scope: Scope, refs: Array<[ID, string]>): Promise<Map<string, JSONContent | null>> {
  const out = new Map<string, JSONContent | null>()
  const s = historyStore()
  if (!s || !refs.length) return out
  const vals = await getMany<PinBody | undefined>(
    refs.map(([page, d]) => pinBodyKey(scope, page, d)),
    s,
  )
  refs.forEach(([page, d], i) => {
    if (vals[i]) out.set(`${page}|${d}`, vals[i]!.content)
  })
  return out
}

/** Every pin meta of a scope (or of one place), by pin id. */
export async function listPinMetas(scope: Scope, place?: PlaceKey): Promise<Map<string, PinMeta>> {
  const out = new Map<string, PinMeta>()
  const s = historyStore()
  if (!s) return out
  const [lo, hi] = metaRange(scope, place)
  const prefix = `pin:${scope}|m|`
  await s('readonly', (st) => {
    const req = st.openCursor(IDBKeyRange.bound(lo, hi))
    return new Promise<void>((resolve, reject) => {
      req.onsuccess = () => {
        const c = req.result
        if (!c) return resolve()
        out.set(String(c.key).slice(prefix.length), c.value as PinMeta)
        c.continue()
      }
      req.onerror = () => reject(req.error)
    })
  })
  return out
}

/** Every pin body of a scope (`<pageId>|<cdig>` → content) — the recorder's test seam. */
export async function listPinBodies(scope: Scope): Promise<Map<string, JSONContent | null>> {
  const out = new Map<string, JSONContent | null>()
  const s = historyStore()
  if (!s) return out
  const prefix = `pin:${scope}|b|`
  await s('readonly', (st) => {
    const req = st.openCursor(IDBKeyRange.bound(prefix, `${prefix}${HI}`))
    return new Promise<void>((resolve, reject) => {
      req.onsuccess = () => {
        const c = req.result
        if (!c) return resolve()
        out.set(String(c.key).slice(prefix.length), (c.value as PinBody)?.content ?? null)
        c.continue()
      }
      req.onerror = () => reject(req.error)
    })
  })
  return out
}

/** Delete the bodies of a page that no pin meta of it refers to any more. */
async function dropOrphanBodies(scope: Scope, pageIds: Iterable<ID>): Promise<void> {
  const s = historyStore()
  if (!s) return
  for (const page of new Set(pageIds)) {
    const used = new Set<string>()
    for (const m of (await listPinMetas(scope, `p:${page}`)).values()) if (m.kind === 'page' && m.body) used.add(m.body)
    const [lo, hi] = bodyRange(scope, page)
    await s('readwrite', (st) => {
      const req = st.openCursor(IDBKeyRange.bound(lo, hi))
      req.onsuccess = () => {
        const c = req.result
        if (!c) return
        const dig = String(c.key).slice(lo.length)
        if (!used.has(dig)) c.delete()
        c.continue()
      }
      return promisifyRequest(st.transaction)
    })
  }
}

/** Delete pins (and their pages' bodies nobody refers to any more). */
export async function dropPins(scope: Scope, ids: string[]): Promise<void> {
  const s = historyStore()
  if (!s || !ids.length) return
  await s('readwrite', (st) => {
    for (const id of ids) st.delete(pinMetaKey(scope, id))
    return promisifyRequest(st.transaction)
  })
  await dropOrphanBodies(
    scope,
    ids.map((id) => pageOfPlace(placeOfPin(id))).filter((x): x is ID => !!x),
  )
}

/** Every pin of one place (the person deleted it for good). */
export async function dropPinsOfPlace(scope: Scope, place: PlaceKey): Promise<void> {
  const s = historyStore()
  if (!s) return
  const page = pageOfPlace(place)
  await s('readwrite', (st) => {
    const [lo, hi] = metaRange(scope, place)
    st.delete(IDBKeyRange.bound(lo, hi))
    if (page) {
      const [blo, bhi] = bodyRange(scope, page)
      st.delete(IDBKeyRange.bound(blo, bhi))
    }
    return promisifyRequest(st.transaction)
  })
}

/** Every pin of a scope (the device copy of a team workspace is wiped). */
export async function dropPinsOfScope(scope: Scope): Promise<void> {
  const s = historyStore()
  if (!s) return
  await s('readwrite', (st) => {
    st.delete(IDBKeyRange.bound(`pin:${scope}|`, `pin:${scope}|${HI}`))
    return promisifyRequest(st.transaction)
  })
}

/** Pin metas whose segment record never landed (orphans): every meta id of a scope with its segment id. */
export async function pinSegments(scope: Scope): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const [id, m] of await listPinMetas(scope)) out.set(id, m.seg)
  return out
}

/** The file ids every scope's pin metas refer to (metas only — never a body), for the device wipe. */
export async function pinFileRefs(): Promise<Map<Scope, Set<string>>> {
  const out = new Map<Scope, Set<string>>()
  const s = historyStore()
  if (!s) return out
  await s('readonly', (st) => {
    const req = st.openCursor(IDBKeyRange.bound('pin:', `pin:${HI}`))
    return new Promise<void>((resolve, reject) => {
      req.onsuccess = () => {
        const c = req.result
        if (!c) return resolve()
        const key = String(c.key)
        const m = /^pin:(.+?)\|([mb])\|/.exec(key)
        if (m && m[2] === 'b') {
          // skip the scope's bodies: jump to its metas
          c.continue(`pin:${m[1]}|m|`)
          return
        }
        if (m) {
          const meta = c.value as PinMeta
          const scope = m[1] as Scope
          if (meta?.files?.length) {
            const set = out.get(scope) ?? new Set<string>()
            meta.files.forEach((f) => set.add(f))
            out.set(scope, set)
          }
        }
        c.continue()
      }
      req.onerror = () => reject(req.error)
    })
  })
  return out
}

/** A page pin as a version body — DocDiff, PropsDiff, diffPropsBetween and restore planning read it unchanged. */
export function pinToBody(meta: PinMeta & { kind: 'page' }, content: JSONContent | null): SnapshotBody {
  const page = meta.page
  const out: SnapshotBody = { content, title: page.title, icon: page.icon }
  if (page.databaseId && meta.defs) {
    const values: Record<ID, PropertyValue> = {}
    for (const d of meta.defs) {
      const v = page.properties?.[d.id]
      if (!isEmptyValue(v)) values[d.id] = structuredClone(v) as PropertyValue
    }
    out.props = { databaseId: page.databaseId, values, defs: meta.defs.map((d) => ({ ...d })) }
  }
  return out
}
