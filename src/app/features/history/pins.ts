/**
 * Flight recorder pins — exact before-images of a place, kept in the version store next to the versions
 * (features/recorder writes them; nothing else reads them):
 *   pin:<scope>|m|<placeKey>|<seg>.<wt> PinMeta — everything of the page but its content (a row's property
 *                                      definitions from the database as it was then), or a database's schema;
 *                                      <seg> = its segment's own id, <wt> = when it was written (base 36): the
 *                                      orphan sweep reads keys only
 *   pin:<scope>|b|<pageId>|<cdig>      PinBody — the content, addressed by its digest per page (pins of the
 *                                      same page with unchanged content share one body)
 * Pins are never listed with the versions (listSnapshots reads `idx:` only), never thinned, never synced,
 * never in a backup; prune and the device wipe remove them by key range.
 */
import type { JSONContent } from '@tiptap/core'
import { getMany, promisifyRequest } from 'idb-keyval'
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

/** A pin's place (its id is `<placeKey>|<seg>.<wt>`). */
export const placeOfPin = (pinId: string): PlaceKey => pinId.slice(0, pinId.lastIndexOf('|')) as PlaceKey

/** A pin's id: its place, its segment's own id (the part after the scope) and when it was written. */
export const pinIdFor = (place: PlaceKey, seg: string, wt: number): string => `${place}|${seg.slice(seg.lastIndexOf('|') + 1)}.${wt.toString(36)}`

/** What a pin's id says (null: an id of another form — read its meta). `seg` is the segment's own id part. */
export function parsePinId(pinId: string): { seg: string; wt: number } | null {
  const last = pinId.slice(pinId.lastIndexOf('|') + 1)
  const dot = last.lastIndexOf('.')
  if (dot <= 0) return null
  const wt = parseInt(last.slice(dot + 1), 36)
  return Number.isFinite(wt) ? { seg: last.slice(0, dot), wt } : null
}

/** A write that failed for lack of room: the recorder frees a day and tries once more (never swallowed). */
export const isQuotaError = (e: unknown): boolean => !!e && typeof e === 'object' && (e as { name?: unknown }).name === 'QuotaExceededError'

export interface PinInput {
  place: PlaceKey
  meta: PinMeta
  /** pages: the content (stored once per page and digest — `meta.body`) */
  content?: JSONContent | null
}

/** A pin body younger than this may belong to a meta another tab is writing right now: never swept as an orphan. */
export const PIN_GRACE = 10 * 60_000

/** A record's rough size in bytes (the recorder's budget). */
export function pinSize(v: unknown): number {
  try {
    return JSON.stringify(v ?? null).length * 2
  } catch {
    return 256
  }
}

/**
 * Keep pins: one read of the body keys, then ONE write of the metas and the bodies not stored yet (a body stored
 * long ago is written again with a fresh time, so no other tab's sweep takes it while these metas refer to it).
 * Resolves with each pin's id (`<placeKey>|<seg>.<wt>`), or null for all when the write failed — a write that
 * failed for lack of room rejects (QuotaExceededError: the recorder frees room and tries again, or pauses).
 */
export async function keepPins(scope: Scope, pins: PinInput[]): Promise<Array<string | null>> {
  return (await keepPinsSized(scope, pins)).ids
}

/**
 * keepPins, with the bytes each pin added to the store (its meta, and its body when this pin wrote it). `onWork`:
 * how long the write's synchronous part took (the puts clone every value — the recorder counts it as its work).
 */
export async function keepPinsSized(scope: Scope, pins: PinInput[], onWork?: (ms: number) => void): Promise<{ ids: Array<string | null>; bytes: number[] }> {
  const s = historyStore()
  if (!s || !pins.length) return { ids: pins.map(() => null), bytes: pins.map(() => 0) }
  try {
    const now = Date.now()
    const bodies = new Map<string, { content: JSONContent | null; pin: number }>()
    pins.forEach((p, i) => {
      const page = pageOfPlace(p.place)
      if (p.meta.kind === 'page' && page && p.meta.body && !bodies.has(pinBodyKey(scope, page, p.meta.body))) bodies.set(pinBodyKey(scope, page, p.meta.body), { content: p.content ?? null, pin: i })
    })
    const keys = [...bodies.keys()]
    const have = keys.length ? await getMany<PinBody | undefined>(keys, s) : []
    const entries: Array<[string, PinMeta | PinBody]> = []
    const bytes = pins.map(() => 0)
    keys.forEach((k, i) => {
      const b = bodies.get(k)!
      const old = have[i]
      if (old && (old.at ?? 0) > now - PIN_GRACE / 2) return
      const body: PinBody = { content: old ? old.content : b.content, at: now }
      entries.push([k, body])
      if (!old) bytes[b.pin] += pinSize(body.content)
    })
    const ids = pins.map((p) => (p.meta.seg ? pinIdFor(p.place, p.meta.seg, now) : `${p.place}|${newId()}`))
    pins.forEach((p, i) => {
      const meta = { ...p.meta, wt: now } as PinMeta
      entries.push([pinMetaKey(scope, ids[i]), meta])
      bytes[i] += pinSize(meta)
    })
    await s('readwrite', (st) => {
      const t0 = performance.now()
      for (const [k, v] of entries) st.put(v, k)
      onWork?.(performance.now() - t0)
      return promisifyRequest(st.transaction)
    })
    return { ids, bytes }
  } catch (e) {
    // no room: the caller frees some and tries again (a pin is never silently partial for lack of room)
    if (isQuotaError(e)) throw e
    console.warn('[one] flight recorder: pins not kept', e)
    return { ids: pins.map(() => null), bytes: pins.map(() => 0) }
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

/** Every pin id of a scope — keys only, never a value (the orphan sweep). */
export async function listPinIds(scope: Scope): Promise<string[]> {
  const s = historyStore()
  if (!s) return []
  const [lo, hi] = metaRange(scope)
  const prefix = `pin:${scope}|m|`
  const keys = await s('readonly', (st) => promisifyRequest(st.getAllKeys(IDBKeyRange.bound(lo, hi))))
  return keys.map((k) => String(k).slice(prefix.length))
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

/** What a drop gave back: bytes by the time the pins were taken (the recorder's budget counts per day). */
export type Freed = Array<{ at: number; bytes: number }>

/**
 * Delete the bodies of a page that no pin meta of it refers to any more — and, unless `all`, only bodies older than
 * PIN_GRACE (a younger one may belong to a meta another tab is writing). Resolves with the bytes freed.
 */
async function dropOrphanBodies(scope: Scope, pageIds: Iterable<ID>, all = false): Promise<Map<ID, number>> {
  const out = new Map<ID, number>()
  const s = historyStore()
  if (!s) return out
  const young = Date.now() - PIN_GRACE
  for (const page of new Set(pageIds)) {
    const used = new Set<string>()
    for (const m of (await listPinMetas(scope, `p:${page}`)).values()) if (m.kind === 'page' && m.body) used.add(m.body)
    const [lo, hi] = bodyRange(scope, page)
    let freed = 0
    await s('readwrite', (st) => {
      const req = st.openCursor(IDBKeyRange.bound(lo, hi))
      req.onsuccess = () => {
        const c = req.result
        if (!c) return
        const dig = String(c.key).slice(lo.length)
        const body = c.value as PinBody | undefined
        if (!used.has(dig) && (all || (body?.at ?? 0) < young)) {
          freed += pinSize(body?.content)
          c.delete()
        }
        c.continue()
      }
      return promisifyRequest(st.transaction)
    })
    if (freed) out.set(page, freed)
  }
  return out
}

/** Delete pins (and their pages' bodies nobody refers to any more). Resolves with what that freed. */
export async function dropPins(scope: Scope, ids: string[]): Promise<Freed> {
  const s = historyStore()
  if (!s || !ids.length) return []
  const metas = await getMany<PinMeta | undefined>(
    ids.map((id) => pinMetaKey(scope, id)),
    s,
  ).catch(() => [] as Array<PinMeta | undefined>)
  await s('readwrite', (st) => {
    for (const id of ids) st.delete(pinMetaKey(scope, id))
    return promisifyRequest(st.transaction)
  })
  const freed: Freed = []
  const firstAt = new Map<ID, number>()
  ids.forEach((id, i) => {
    const m = metas[i]
    if (!m) return
    freed.push({ at: m.at, bytes: pinSize(m) })
    const page = pageOfPlace(placeOfPin(id))
    if (page) firstAt.set(page, Math.min(firstAt.get(page) ?? m.at, m.at))
  })
  for (const [page, bytes] of await dropOrphanBodies(
    scope,
    ids.map((id) => pageOfPlace(placeOfPin(id))).filter((x): x is ID => !!x),
  ))
    freed.push({ at: firstAt.get(page) ?? Date.now(), bytes })
  return freed
}

/** Delete every meta in a key range (and sum what it held). */
async function dropMetaRange(lo: string, hi: string): Promise<Freed> {
  const s = historyStore()
  const freed: Freed = []
  if (!s) return freed
  await s('readwrite', (st) => {
    const req = st.openCursor(IDBKeyRange.bound(lo, hi))
    req.onsuccess = () => {
      const c = req.result
      if (!c) return
      const m = c.value as PinMeta | undefined
      freed.push({ at: m?.at ?? Date.now(), bytes: pinSize(m) })
      c.delete()
      c.continue()
    }
    return promisifyRequest(st.transaction)
  })
  return freed
}

/** Every pin of one place (the person deleted it for good), its page's bodies with them. Resolves with what that freed. */
export async function dropPinsOfPlace(scope: Scope, place: PlaceKey): Promise<Freed> {
  const [lo, hi] = metaRange(scope, place)
  const freed = await dropMetaRange(lo, hi)
  const page = pageOfPlace(place)
  if (page) {
    const at = freed.reduce((a, f) => Math.min(a, f.at), Date.now())
    for (const bytes of (await dropOrphanBodies(scope, [page], true)).values()) freed.push({ at, bytes })
  }
  return freed
}

/** Every pin of a database's schema and of its views (the person deleted the database for good). */
export async function dropPinsOfDatabase(scope: Scope, dbId: ID): Promise<Freed> {
  const [lo, hi] = metaRange(scope, `s:${dbId}`)
  return [...(await dropMetaRange(lo, hi)), ...(await dropMetaRange(`pin:${scope}|m|v:${dbId}/`, `pin:${scope}|m|v:${dbId}/${HI}`))]
}

/**
 * Every pin of a scope (the device copy of a team workspace is wiped). A team workspace's scope `cloud:<ws>` takes
 * its members' scopes on this device along (`cloud:<ws>:u:<account>`).
 */
export async function dropPinsOfScope(scope: Scope): Promise<void> {
  const s = historyStore()
  if (!s) return
  await s('readwrite', (st) => {
    st.delete(IDBKeyRange.bound(`pin:${scope}|`, `pin:${scope}|${HI}`))
    if (scope.startsWith('cloud:') && !scope.includes(':u:')) st.delete(IDBKeyRange.bound(`pin:${scope}:u:`, `pin:${scope}:u:${HI}`))
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
