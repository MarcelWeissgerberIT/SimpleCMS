/**
 * Places as they are in the store now (null: gone) — a page or row (with its database now), a database's schema, a
 * view. Recovery, the window's digests and the eject read them; many places from ONE store read.
 */
import { useWorkspace } from '../../../store/store'
import type { Database, View } from '../../../store/types'
import type { PlaceObject } from '../model/canon'
import { parsePlace } from '../model/places'
import type { PlaceKey } from '../model/types'

type State = ReturnType<typeof useWorkspace.getState>

function placeIn(s: Pick<State, 'pages' | 'databases'>, place: PlaceKey): PlaceObject | null {
  const { kind, id, view } = parsePlace(place)
  if (kind === 'page') {
    const page = s.pages[id]
    if (!page) return null
    return page.databaseId ? { kind: 'row', page, db: s.databases[page.databaseId] } : { kind: 'page', page }
  }
  const db: Database | undefined = s.databases[id]
  if (!db) return null
  if (kind === 'schema') return { kind: 'schema', db }
  const v: View | undefined = db.views.find((x) => x.id === view)
  return v ? { kind: 'view', view: v } : null
}

/** The place as it is in the store now (null: gone). */
export function currentPlace(place: PlaceKey): PlaceObject | null {
  return placeIn(useWorkspace.getState(), place)
}

/** Many places as they are now, from one store read. */
export function currentPlaces(places: Iterable<PlaceKey>): Map<PlaceKey, PlaceObject | null> {
  const s = useWorkspace.getState()
  const out = new Map<PlaceKey, PlaceObject | null>()
  for (const p of places) out.set(p, placeIn(s, p))
  return out
}
