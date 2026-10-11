/**
 * Start-up recovery: tabs that died with open segments or unwritten records. Every tab holds the Web Lock
 * `one-recorder-tab:<tab>` for its lifetime and keeps `kv <scope>|tab|<tab>` = { start, lastFlush, clean }.
 * A tab whose lock is free is gone: its open segments close — their `left` taken ONLY when exact (the next
 * segment's pin, or the place as it is now when nothing came after, has exactly the digest the segment's
 * last event left), else null (partial); a tab that did not end cleanly leaves a lost-tail marker
 * `kv <scope>|gap|<lastFlush>` ("recording interrupted"). Nothing is ever guessed.
 */
import type { Database, Page } from '../../../store/types'
import { placeCanon, wholeCanon, type PlaceObject } from '../model/canon'
import { parsePlace } from '../model/places'
import { touchedParts } from '../model/touched'
import { F, type JSegment, type LostTail, type PinMeta, type Scope, type TabRecord } from '../model/types'
import { currentPlace } from './current'
import { HI, openJournal, pad13 } from './db'
import { deps } from './deps'
import { digestLeft, digestWhole } from './key'
import { readPinBodies, readPinMetas } from './pins'
import { liveTabs } from './prune'

/** A pin read back as the place object it pinned (rows with the definitions then). */
async function pinPlace(scope: Scope, pinId: string, place: string, memory: boolean): Promise<PlaceObject | null> {
  const meta: PinMeta | undefined = (await readPinMetas(scope, [pinId], memory)).get(pinId)
  if (!meta) return null
  if (meta.kind === 'schema') {
    if (place.startsWith('s:')) return { kind: 'schema', db: meta.db }
    const view = meta.db.views.find((v) => v.id === parsePlace(place as JSegment['p']).view)
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

const canonOf = (o: PlaceObject) => {
  const c = placeCanon(o, deps)
  return { c, whole: wholeCanon(c.parts, c.blocks) }
}

export interface RecoverResult {
  closed: number
  exact: number
  partial: number
  tails: number
}

/** Recover the segments and lost tails of tabs that are gone (this scope; `current` = the store reads this scope). */
export async function recoverScope(scope: Scope, ownTab: string, memory: boolean, current = true): Promise<RecoverResult> {
  const res: RecoverResult = { closed: 0, exact: 0, partial: 0, tails: 0 }
  const live = await liveTabs()
  // without Web Locks nobody can tell a gone tab from a quiet one: nothing is closed
  if (!live) return res
  const alive = (tab: string) => tab === ownTab || live.has(tab)
  const j = await openJournal()
  const open = await j.range<JSegment>({ store: 'segs', index: 'open', lo: [scope, 1], hi: [scope, 1] })
  const put: JSegment[] = []
  for (const seg of open) {
    if (alive(seg.tab)) continue
    const later = (await j.range<JSegment>({ store: 'segs', index: 'place', lo: [scope, seg.p, seg.from], hi: [scope, seg.p, Number.MAX_SAFE_INTEGER] }))
      .filter((s) => s.id !== seg.id && (s.from > seg.from || (s.from === seg.from && s.id > seg.id)))
      .sort((a, b) => a.from - b.from)
    let leftObj: PlaceObject | null = null
    let leftCanon: ReturnType<typeof canonOf> | null = null
    if (seg.lastLh && seg.lastLh !== '-') {
      const candidate = later.length ? (later[0].before ? await pinPlace(scope, later[0].before, seg.p, memory) : null) : current ? currentPlace(seg.p) : null
      if (candidate) {
        const cc = canonOf(candidate)
        if ((await digestWhole(scope, cc.whole)) === seg.lastLh) {
          leftObj = candidate
          leftCanon = cc
        }
      }
    }
    const next: JSegment = { ...seg }
    delete next.o
    if (leftObj && leftCanon) {
      const isNew = !!(seg.f & F.NEW)
      next.left = await digestLeft(scope, leftCanon.c, leftCanon.whole)
      const first = !isNew && seg.before ? await pinPlace(scope, seg.before, seg.p, memory) : null
      next.touched = isNew || !first ? '*' : touchedParts(first, leftObj, deps)
      res.exact++
    } else {
      next.left = null
      next.touched = '*'
      res.partial++
    }
    put.push(next)
    res.closed++
  }
  // tabs that are gone: a lost tail when they did not end cleanly; their records leave
  const tabs = await j.range<TabRecord & { k: string }>({ store: 'kv', lo: `${scope}|tab|`, hi: `${scope}|tab|${HI}` })
  const tails: Array<LostTail & { k: string }> = []
  const del: Array<{ store: 'kv'; key: string }> = []
  const now = Date.now()
  for (const t of tabs) {
    const tab = t.k.slice(`${scope}|tab|`.length)
    if (alive(tab)) continue
    if (!t.clean) tails.push({ k: `${scope}|gap|${pad13(t.lastFlush)}`, from: t.lastFlush, to: now, tab })
    del.push({ store: 'kv', key: t.k })
  }
  res.tails = tails.length
  if (put.length || tails.length || del.length) await j.write({ put: { segs: put as unknown as Array<Record<string, unknown>>, kv: tails as unknown as Array<Record<string, unknown>> }, del })
  return res
}

/** Lost-tail markers of a scope (seam, deck). */
export async function lostTails(scope: Scope): Promise<LostTail[]> {
  const j = await openJournal()
  return j.range<LostTail>({ store: 'kv', lo: `${scope}|gap|`, hi: `${scope}|gap|${HI}` })
}
