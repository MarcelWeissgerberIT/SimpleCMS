/**
 * What an eject record keeps of its targets (Δ27): per place that goes back, the HMAC digests of the parts the plan
 * DECIDED (a part taken out reads '-'), and the block strings of the hunks it put back — never the parts it left alone
 * (the order, kit-computed values, a synced copy may change by right after the eject). The boot compares the places as
 * they are then with the same function (a crashed commit is finished from them, E16). No text, no values.
 */
import type { Database, ID, Page } from '../../../store/types'
import { placeCanon, type PlaceObject } from '../model/canon'
import type { Plan } from '../model/plan'
import type { EjectRecord, PlaceKey, Scope } from '../model/types'
import { deps } from '../journal/deps'
import { digestPart } from '../journal/key'

/** The decided part keys of a place (the order never). */
export function decidedParts(x: Plan['places'][number]): string[] {
  const b = x.build
  if (!b) return []
  if (b.kind === 'trash') return ['tr']
  if (b.kind === 'page') return b.parts.filter((k) => k !== 'o')
  const keys = b.groups.flatMap((g) => g.decided.map((d) => d.part))
  // a view place's own part is its whole view
  return x.pk === 'view' ? ['v'] : keys.filter((k) => !k.startsWith('v:'))
}

/** A place object out of a state (rows read with their database there). */
export function objectIn(state: { pages: Record<ID, Page>; databases: Record<ID, Database> }, p: PlaceKey): PlaceObject | null {
  if (p.startsWith('p:')) {
    const page = state.pages[p.slice(2)]
    if (!page) return null
    return page.databaseId ? { kind: 'row', page, db: state.databases[page.databaseId] } : { kind: 'page', page }
  }
  if (p.startsWith('s:')) {
    const db = state.databases[p.slice(2)]
    return db ? { kind: 'schema', db } : null
  }
  const [dbId, viewId] = p.slice(2).split('/')
  const view = state.databases[dbId]?.views.find((v) => v.id === viewId)
  return view ? { kind: 'view', view } : null
}

/** The digests of `keys` of an object (a part it does not have: '-'). */
export async function partDigests(scope: Scope, obj: PlaceObject | null, keys: readonly string[]): Promise<Record<string, string>> {
  const parts = obj ? placeCanon(obj, deps).parts : {}
  const out: Record<string, string> = {}
  await Promise.all(keys.map(async (k) => (out[k] = k in parts ? await digestPart(scope, k, parts[k]) : '-')))
  return out
}

/** The record's targets: the decided parts of every place that goes back, signed, as the patch makes them. */
export async function targetDigests(scope: Scope, plan: Plan, patch: { pages: Record<ID, Page>; databases: Record<ID, Database> }, state: { pages: Record<ID, Page>; databases: Record<ID, Database> }): Promise<EjectRecord['targets']> {
  const after = { pages: { ...state.pages, ...patch.pages }, databases: { ...state.databases, ...patch.databases } }
  const out: EjectRecord['targets'] = {}
  await Promise.all(
    plan.places.map(async (x) => {
      if (!x.build || (x.outcome !== 'back' && x.outcome !== 'trash' && x.outcome !== 'restore')) return
      const parts = await partDigests(scope, objectIn(after, x.p), decidedParts(x))
      const blocks = x.build.kind === 'page' ? x.build.restored : undefined
      out[x.p] = { parts, ...(blocks?.length ? { blocks } : {}) }
    }),
  )
  return out
}
