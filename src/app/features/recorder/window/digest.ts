/**
 * Digests of places as they are now, signed with the scope's key like the journal's lefts (so a writer's left and the
 * place now compare digest by digest), the empty value's digest per part, and a pin read back as the object it
 * pinned. Read-only.
 */
import type { Database, Page } from '../../../store/types'
import { partsKey, placeCanon, wholeCanon, type PlaceObject } from '../model/canon'
import { parsePlace } from '../model/places'
import { restrictRowParts } from '../model/rowkeys'
import type { NowDigest, PinMeta, PlaceKey, Scope } from '../model/types'
import { currentPlaces } from '../journal/current'
import { deps } from '../journal/deps'
import { digestLeft, digestPart, digestWhole, scopeKey } from '../journal/key'
import { readPinBodies, readPinMetas } from '../journal/pins'

const GONE: NowDigest = { exists: false, h: '-', parts: {}, key: '-' }

/** One object's digest now (`keys`: a row's whole digest over these `p:` keys only — old NEW records compare so). */
export async function objectDigest(scope: Scope, obj: PlaceObject | null, keys?: ReadonlySet<string>): Promise<NowDigest> {
  if (!obj) return GONE
  const c = placeCanon(obj, deps)
  const left = await digestLeft(scope, { parts: c.parts, blocks: c.blocks }, wholeCanon(c.parts, c.blocks))
  const h = keys && obj.kind === 'row' ? await digestWhole(scope, wholeCanon(restrictRowParts(c.parts, keys))) : left.h
  return { exists: true, h, parts: left.parts, ...(left.blocks ? { blocks: left.blocks } : {}), key: partsKey(obj, deps) }
}

/**
 * The places as they are now (one store read — or `state`, the caller's read: the planner digests exactly the objects
 * its working content and re-check refs come from), signed.
 */
export async function nowDigests(scope: Scope, places: Iterable<PlaceKey>, opts?: { keys?: Map<PlaceKey, Set<string>>; state?: { pages: Record<string, Page>; databases: Record<string, Database> } }): Promise<Map<PlaceKey, NowDigest>> {
  const objs = currentPlaces(places, opts?.state)
  const out = new Map<PlaceKey, NowDigest>()
  await Promise.all([...objs].map(async ([p, obj]) => out.set(p, await objectDigest(scope, obj, opts?.keys?.get(p)))))
  return out
}

/* the empty value's digest of a part, per scope key (a wiped scope gets a new key: its memo goes with the old one) */

const empties = new WeakMap<CryptoKey, Map<string, string>>()

async function memoOf(scope: Scope): Promise<Map<string, string>> {
  const key = await scopeKey(scope)
  let m = empties.get(key)
  if (!m) empties.set(key, (m = new Map()))
  return m
}

export async function emptyDigest(scope: Scope, part: string): Promise<string> {
  const m = await memoOf(scope)
  const hit = m.get(part)
  if (hit !== undefined) return hit
  const d = await digestPart(scope, part, '')
  m.set(part, d)
  return d
}

/** A synchronous lookup of the empty digests of `parts` (signed first; an unknown part never equals one). */
export async function emptyLookup(scope: Scope, parts: Iterable<string>): Promise<(part: string) => string> {
  const keys = [...new Set(parts)]
  await Promise.all(keys.map((k) => emptyDigest(scope, k)))
  const m = await memoOf(scope)
  return (part) => m.get(part) ?? '\u0000'
}

/** A pin read back as the place object it pinned (rows with the definitions then); null: gone or partial. */
export async function pinObjectOf(scope: Scope, pinId: string, place: string, memory: boolean): Promise<PlaceObject | null> {
  const meta: PinMeta | undefined = (await readPinMetas(scope, [pinId], memory)).get(pinId)
  if (!meta) return null
  if (meta.kind === 'schema') {
    if (place.startsWith('s:')) return { kind: 'schema', db: meta.db }
    const view = meta.db.views.find((v) => v.id === parsePlace(place as PlaceKey).view)
    return view ? { kind: 'view', view } : null
  }
  let content = null
  if (meta.body) {
    const bodies = await readPinBodies(scope, [[meta.page.id, meta.body]], memory)
    if (!bodies.has(`${meta.page.id}|${meta.body}`)) return null
    content = bodies.get(`${meta.page.id}|${meta.body}`) ?? null
  }
  const page = { ...meta.page, content } as Page
  if (meta.page.databaseId) return { kind: 'row', page, db: meta.defs ? { properties: meta.defs.map((d) => ({ ...d })) as Database['properties'] } : null }
  return { kind: 'page', page }
}
