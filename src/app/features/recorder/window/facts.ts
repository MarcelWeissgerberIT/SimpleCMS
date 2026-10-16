/**
 * The facts an incident report reads beside its window (read-only): the workspace's name, the writer's label, every
 * writer of the span from ONE read of its Vorgänge (their places from their events, a lane with more than 2,000
 * Vorgänge in the window shows "…"), and live titles — a private page or one this member cannot see is counted, never
 * named.
 */
import type { Translate } from '@/shared/i18n'
import { useCloud } from '../../../cloud'
import { useWorkspace } from '../../../store/store'
import { propertyValueToText } from '../../../database'
import { parsePlace } from '../model/places'
import { F, type LaneKey, type PlaceKey } from '../model/types'
import { eventsOf, opsInSpan } from '../journal/query'
import { laneMeta } from '../ui/lanes'
import type { ReadModel } from './read'
import type { ReportFacts, WriterRow } from './report'

const LANE_EVENTS_MAX = 2000

export async function reportFacts(model: ReadModel, t: Translate): Promise<ReportFacts> {
  const { sel } = model
  const s = useWorkspace.getState()
  const c = useCloud.getState()
  const active = c.active
  const team = active.kind === 'cloud' ? c.workspaces.find((w) => w.id === active.id)?.name : null
  const cloud = sel.scope.startsWith('cloud:')
  const ws = { agents: s.agents, scripts: s.scripts, databases: s.databases, settings: s.settings, pages: s.pages }

  // every writer of the span: Vorgänge, first, last (one read); places from each lane's events (in parallel)
  const lanes = new Map<LaneKey, { ops: number; first: number; last: number }>()
  for (const o of await opsInSpan(sel.scope, sel.a, sel.b - 1)) {
    if (o.at < sel.a || o.at >= sel.b || (o.f ?? 0) & F.COPY || o.l === 'system') continue
    const cur = lanes.get(o.l)
    if (cur) {
      cur.ops++
      cur.first = Math.min(cur.first, o.at)
      cur.last = Math.max(cur.last, o.t2 ?? o.at)
    } else lanes.set(o.l, { ops: 1, first: o.at, last: o.t2 ?? o.at })
  }
  const writers: WriterRow[] = await Promise.all(
    [...lanes].map(async ([lane, v]) => {
      let places: number | null = null
      if (v.ops <= LANE_EVENTS_MAX) {
        const seen = new Set<string>()
        for (const e of await eventsOf(sel.scope, { lane }, sel.a, sel.b)) if (!((e.f ?? 0) & F.COPY)) seen.add(e.p)
        places = seen.size
      }
      return { label: laneMeta(lane, t, ws).title, ops: v.ops, places, first: v.first, last: v.last }
    }),
  )
  writers.sort((a, b) => b.ops - a.ops || a.first - b.first)

  // names of properties a delta named (a property deleted since keeps its name there)
  const deltaNames = new Map<string, string>()
  for (const evs of model.data.schemaEvents.values()) for (const e of evs) for (const d of e.x ?? []) if (d.prop) deltaNames.set(d.prop.id, d.prop.name)

  return {
    workspace: team || s.settings.workspaceName.trim() || 'One',
    writer: laneMeta(sel.lane, t, ws).title,
    ...(sel.run && model.data.runs[sel.run]?.meta?.seq ? { seq: model.data.runs[sel.run].meta!.seq } : {}),
    writers,
    title(p: PlaceKey) {
      const page = s.pages[parsePlace(p).id]
      if (!page) return cloud ? null : t('features.recorder.report.gone')
      if (page.private) return null
      return page.title
    },
    rowKey(p: PlaceKey) {
      const page = s.pages[parsePlace(p).id]
      const db = page?.databaseId ? s.databases[page.databaseId] : undefined
      const uid = db?.properties.find((x) => x.type === 'unique_id')
      return db && uid && page ? propertyValueToText(db, uid, page) || null : null
    },
    dbTitle: (db: string) => s.pages[db]?.title || t('features.recorder.report.untitled'),
    propName: (db: string, prop: string) => s.databases[db]?.properties.find((x) => x.id === prop)?.name ?? deltaNames.get(prop) ?? null,
    propIndex: (db: string, prop: string) => s.databases[db]?.properties.findIndex((x) => x.id === prop) ?? -1,
  }
}
