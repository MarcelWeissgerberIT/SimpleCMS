/**
 * What the eject dialog says about one planned place, in words: the schema parts that come back or go (by name, from
 * the pin and the database now — "Option „Ready“ kommt zurück — Board bekommt seine Spalte wieder."), why a place is
 * held ("Status ist nicht mehr, was Agent … hinterließ: Du hast „In Arbeit“ gesetzt."), the after-plate's counts.
 * Names and the values shown are read live from the store; nothing here is stored.
 */
import type { Translate } from '@/shared/i18n'
import type { Database, ID, Page } from '../../../store/types'
import { propertyValueToText } from '../../../database'
import type { CoreInput, PlacePlan } from '../model/plan'
import type { EjectRecord, LaneKey, Outcome, PlaceKey } from '../model/types'
import type { laneMeta } from './lanes'
import { whoName } from './WindowPlate'

type Ws = Parameters<typeof laneMeta>[2]
type State = { pages: Record<ID, Page>; databases: Record<ID, Database> }

const BACK: ReadonlySet<Outcome> = new Set(['back', 'trash', 'restore'])

/** The schema / view parts a place puts back or takes out, as lines ("Option „Ready“ kommt zurück"). */
export function decidedLines(t: Translate, x: PlacePlan, input: Pick<CoreInput, 'pins'>, state: State): string[] {
  if (x.build?.kind !== 'db') return []
  const dbId = x.db ?? x.p.slice(2).split('/')[0]
  const cur = state.databases[dbId]
  const out: string[] = []
  for (const g of x.build.groups) {
    const meta = input.pins.metas.get(g.pin)
    const pin = meta?.kind === 'schema' ? meta.db : undefined
    const propName = (id: string) => pin?.properties.find((p) => p.id === id)?.name ?? cur?.properties.find((p) => p.id === id)?.name ?? '—'
    for (const d of g.decided) {
      const back = d.op === 'back'
      if (d.part.startsWith('p:')) out.push(t(back ? 'features.recorder.eject.propBack' : 'features.recorder.eject.propGone', { prop: propName(d.part.slice(2)) }))
      else if (d.part.startsWith('o:')) {
        const [propId, optId] = d.part.slice(2).split('/')
        const opt = pin?.properties.find((p) => p.id === propId)?.options?.find((o) => o.id === optId) ?? cur?.properties.find((p) => p.id === propId)?.options?.find((o) => o.id === optId)
        let line = t(back ? 'features.recorder.eject.optionBack' : 'features.recorder.eject.optionGone', { option: opt?.name ?? '—' })
        // a board grouped by the property gets its column back
        const board = back ? cur?.views.find((v) => v.type === 'board' && v.groupBy === propId) : undefined
        if (board) line = `${line} ${t('features.recorder.eject.columnBack', { view: board.name })}`
        out.push(line)
      } else if (d.part.startsWith('v:')) {
        const id = d.part.slice(2)
        const name = pin?.views.find((v) => v.id === id)?.name ?? cur?.views.find((v) => v.id === id)?.name ?? '—'
        out.push(t(back ? 'features.recorder.eject.viewBack' : 'features.recorder.eject.viewGone', { view: name }))
      } else if (d.part === 'l') out.push(t('features.recorder.eject.lockBack'))
      else out.push(t('features.recorder.eject.orderBack'))
    }
  }
  return [...new Set(out)]
}

/** Why a place stays (held or partial), in a sentence. `writer`: W's name. */
export function heldWhy(t: Translate, x: PlacePlan, input: Pick<CoreInput, 'data'>, state: State, ws: Ws, writer: string): string {
  if (x.why) return t(`features.recorder.eject.notEjectable.${x.why}`)
  const by = x.by[0]
  const who = whoName(by?.lane ?? null, t, ws, true)
  if (x.pk === 'row' && (x.reason === 'changed' || x.reason === 'interleaved')) {
    const w = input.data.places.get(x.p)
    const touched = new Set<string>()
    let all = false
    for (const f of w?.foreign ?? []) {
      if (f.touched === '*') all = true
      else for (const k of f.touched) touched.add(k)
    }
    if (touched.has('c')) return t('features.recorder.eject.heldText', { who, writer })
    const page = state.pages[x.p.slice(2)]
    const db = page?.databaseId ? state.databases[page.databaseId] : undefined
    const prop = db?.properties.find((p) => touched.has(`p:${p.id}`))
    if (!all && page && db && prop) {
      const value = propertyValueToText(db, prop, page) || '—'
      return t('features.recorder.eject.heldValue', { prop: prop.name, writer, who, set: t(by?.lane === 'you' ? 'features.recorder.eject.set.you' : 'features.recorder.eject.set.other'), value })
    }
    return t('features.recorder.eject.heldOther', { who })
  }
  return t(`features.recorder.eject.reason.${x.reason ?? 'changed'}`, { who, writer })
}

/** "Du hast sie seitdem geändert" / "Du und J. Weber habt …" / "{name} hat …" / "{names} haben …". */
export function heldByText(t: Translate, lanes: ReadonlyArray<LaneKey | null>, ws: Ws, n: number): string {
  const one = n === 1 ? '.one' : ''
  const others = lanes.filter((l) => l !== 'you').map((l) => whoName(l, t, ws, true))
  if (lanes.includes('you')) return others.length ? t(`features.recorder.eject.heldBy.youAnd${one}`, { others: others.join(', ') }) : t(`features.recorder.eject.heldBy.you${one}`)
  return others.length === 1 ? t(`features.recorder.eject.heldBy.one${one}`, { name: others[0] }) : t(`features.recorder.eject.heldBy.many${one}`, { names: others.join(', ') })
}

/** A record's places that went back, by kind (rows vs pages read from the store): schema · views · pages · rows · new rows to the trash. */
export function backParts(rec: Pick<EjectRecord, 'outcomes'>, pages: Record<ID, Page>): { schema: number; views: number; pages: number; rows: number; trash: number } {
  const out = { schema: 0, views: 0, pages: 0, rows: 0, trash: 0 }
  for (const [p, o] of Object.entries(rec.outcomes) as Array<[PlaceKey, Outcome]>) {
    if (!BACK.has(o)) continue
    if (p.startsWith('s:')) out.schema++
    else if (p.startsWith('v:')) out.views++
    else if (o === 'trash') out.trash++
    else if (pages[p.slice(2)]?.databaseId) out.rows++
    else out.pages++
  }
  return out
}
