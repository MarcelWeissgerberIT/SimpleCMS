/**
 * Workspace data ("system metrics"): numbers about the workspace itself, local and team.
 * Pages in the trash, template pages and — in team workspaces — other members' private pages
 * (they never reach this device) are not counted. Each metric has a label + description
 * (charts.metric.<id> / .desc). Time metrics take a range and a bucket.
 */
import type { JSONContent } from '@tiptap/core'
import { createStore, getMany, values as idbValues } from 'idb-keyval'
import { addDays, addMonths, addWeeks, startOfDay, startOfMonth, startOfWeek, subDays, subMonths } from 'date-fns'
import type { ColorName, ID, Page } from '../../../store/types'
import { useWorkspace } from '../../../store/store'
import { inTemplate, isEffectivelyTrashed } from '../../../store/selectors'
import { useCloud } from '../../../cloud'
import { bucketLabel } from '../../../database'
import { t } from '../../../i18n'
import { collectReminders } from '../../inbox/scan'
import { findJournalDatabase } from '../../journal/journal'
import type { ChartData, ChartKind, SystemBucket, SystemRange } from '../types'

export interface MetricQuery {
  range: SystemRange
  bucket?: SystemBucket
}

export interface MetricDef {
  id: string
  /** time series: range + bucket apply */
  time: boolean
  /** counts forward from today (upcoming reminders) */
  forward?: boolean
  /** team workspaces only */
  team?: boolean
  /** reads IndexedDB (history, files): resolved asynchronously */
  async?: boolean
  /** suggested chart type */
  kind: ChartKind
  /** default range */
  range: SystemRange
}

export const METRICS: MetricDef[] = [
  { id: 'pagesCreated', time: true, kind: 'bar', range: '30d' },
  { id: 'pagesEdited', time: true, async: true, kind: 'line', range: '30d' },
  { id: 'rowsPerDatabase', time: false, kind: 'barH', range: 'all' },
  { id: 'todos', time: false, kind: 'donut', range: 'all' },
  { id: 'wordsTopPages', time: false, kind: 'barH', range: 'all' },
  { id: 'storageByType', time: false, async: true, kind: 'donut', range: 'all' },
  { id: 'remindersUpcoming', time: true, forward: true, kind: 'bar', range: '7d' },
  { id: 'journalPerMonth', time: true, kind: 'bar', range: '12m' },
  { id: 'activityByMember', time: false, team: true, kind: 'stacked', range: '30d' },
]

export const metricDef = (id: string): MetricDef | undefined => METRICS.find((m) => m.id === id)

export const isTeam = (): boolean => useCloud.getState().active.kind === 'cloud'

/** Metrics offered here (team-only ones only in team workspaces). */
export function availableMetrics(): MetricDef[] {
  const team = isTeam()
  return METRICS.filter((m) => !m.team || team)
}

const lang = (): 'en' | 'de' => (useWorkspace.getState().settings.language === 'de' ? 'de' : 'en')

/* ------------------------------------------------------------------ */
/* Live pages                                                          */
/* ------------------------------------------------------------------ */

/** Pages that count: not in the trash (or under a trashed parent), not part of a template. */
function livePages(): Page[] {
  const pages = useWorkspace.getState().pages
  const out: Page[] = []
  for (const id of Object.keys(pages)) {
    const p = pages[id]
    if (p.trashed || isEffectivelyTrashed(pages, id) || inTemplate(pages, id)) continue
    out.push(p)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Time buckets                                                        */
/* ------------------------------------------------------------------ */

const START: Record<SystemBucket, (d: Date) => Date> = { day: startOfDay, week: (d) => startOfWeek(d, { weekStartsOn: 1 }), month: startOfMonth }
const NEXT: Record<SystemBucket, (d: Date) => Date> = { day: (d) => addDays(d, 1), week: (d) => addWeeks(d, 1), month: (d) => addMonths(d, 1) }

export function defaultBucket(range: SystemRange): SystemBucket {
  return range === '7d' || range === '30d' ? 'day' : range === '90d' ? 'week' : 'month'
}

interface Buckets {
  starts: number[]
  labels: string[]
  /** bucket index of a time (-1 = outside the range) */
  index: (ms: number) => number
}

export function timeBuckets(q: MetricQuery, opts: { forward?: boolean; earliest?: number; now?: number } = {}): Buckets {
  const now = new Date(opts.now ?? Date.now())
  const bucket = q.bucket ?? defaultBucket(q.range)
  const startOf = START[bucket]
  let from: Date
  let to: Date
  if (opts.forward) {
    from = startOfDay(now)
    to = q.range === '7d' ? addDays(from, 6) : q.range === '30d' ? addDays(from, 29) : q.range === '90d' ? addDays(from, 89) : addMonths(from, 12)
  } else {
    to = now
    from =
      q.range === '7d'
        ? subDays(startOfDay(now), 6)
        : q.range === '30d'
          ? subDays(startOfDay(now), 29)
          : q.range === '90d'
            ? subDays(startOfDay(now), 89)
            : q.range === '12m'
              ? subMonths(startOfMonth(now), 11)
              : new Date(Math.min(opts.earliest ?? now.getTime(), now.getTime()))
  }
  const starts: number[] = []
  const labels: string[] = []
  let cur = startOf(from)
  while (cur.getTime() <= to.getTime() && starts.length < 400) {
    starts.push(cur.getTime())
    labels.push(bucketLabel(cur, bucket, lang()))
    cur = NEXT[bucket](cur)
  }
  const end = cur.getTime()
  const index = (ms: number) => {
    if (!starts.length || ms < starts[0] || ms >= end) return -1
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= ms) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  return { starts, labels, index }
}

const timeData = (b: Buckets, series: Array<{ name: string; values: number[] }>, unit?: string): ChartData => ({ labels: b.labels, series, axis: 'time', ...(unit ? { unit } : {}) })

/* ------------------------------------------------------------------ */
/* Content walks                                                       */
/* ------------------------------------------------------------------ */

function walk(n: JSONContent | null | undefined, fn: (n: JSONContent) => void) {
  if (!n) return
  fn(n)
  n.content?.forEach((c) => walk(c, fn))
}

function wordsOf(content: JSONContent | null | undefined): number {
  let n = 0
  walk(content, (node) => {
    if (typeof node.text === 'string') n += node.text.split(/\s+/).filter(Boolean).length
  })
  return n
}

const titleOf = (p: Page) => p.title.trim() || t('common.untitled')

/* ------------------------------------------------------------------ */
/* Collectors                                                          */
/* ------------------------------------------------------------------ */

function pagesCreated(q: MetricQuery): ChartData {
  const pages = livePages().filter((p) => !p.databaseId)
  const b = timeBuckets(q, { earliest: Math.min(...pages.map((p) => p.createdAt)) })
  const values = b.starts.map(() => 0)
  for (const p of pages) {
    const i = b.index(p.createdAt)
    if (i >= 0) values[i]++
  }
  return timeData(b, [{ name: t('charts.metric.pagesCreated.series'), values }])
}

const historyStore = () => (typeof indexedDB !== 'undefined' ? createStore('one-history', 'snapshots') : undefined)
let hStore: ReturnType<typeof historyStore> | null = null

function pagesEdited(q: MetricQuery, sync: boolean): ChartData | Promise<ChartData> {
  const pages = livePages().filter((p) => p.kind === 'page')
  const b = timeBuckets(q, { earliest: Math.min(...pages.map((p) => p.createdAt)) })
  const hits = b.starts.map(() => new Set<ID>())
  const add = (id: ID, at: number) => {
    const i = b.index(at)
    if (i >= 0) hits[i].add(id)
  }
  for (const p of pages) if (p.updatedAt > p.createdAt + 1000) add(p.id, p.updatedAt)
  const data = () => timeData(b, [{ name: t('charts.metric.pagesEdited.series'), values: hits.map((s) => s.size) }])
  hStore ??= historyStore()
  const store = hStore
  if (sync || !store) return data()
  return getMany<Array<{ at: number }> | undefined>(
    pages.map((p) => `idx:${p.id}`),
    store,
  )
    .then((lists) => lists.forEach((list, k) => list?.forEach((m) => typeof m?.at === 'number' && add(pages[k].id, m.at))))
    .catch(() => {
      /* no history on this device: page times only */
    })
    .then(data)
}

function rowsPerDatabase(): ChartData {
  const st = useWorkspace.getState()
  const live = livePages()
  const dbs = live.filter((p) => p.kind === 'database' && st.databases[p.id])
  const count = new Map<ID, number>()
  for (const p of live) if (p.databaseId) count.set(p.databaseId, (count.get(p.databaseId) ?? 0) + 1)
  const list = dbs.map((p) => ({ label: titleOf(p), value: count.get(p.id) ?? 0 })).sort((a, b) => b.value - a.value)
  const head = list.slice(0, 12)
  const rest = list.slice(12)
  if (rest.length) head.push({ label: t('charts.other'), value: rest.reduce((s, x) => s + x.value, 0) })
  return { labels: head.map((x) => x.label), series: [{ name: t('charts.metric.rowsPerDatabase.series'), values: head.map((x) => x.value) }], axis: 'category' }
}

function todos(): ChartData {
  let open = 0
  let done = 0
  for (const p of livePages())
    walk(p.content, (n) => {
      if (n.type !== 'taskItem') return
      if (n.attrs?.checked === true) done++
      else open++
    })
  return { labels: [t('charts.metric.todos.open'), t('charts.metric.todos.done')], series: [{ name: t('charts.metric.todos.series'), values: [open, done] }], axis: 'category' }
}

function wordsTopPages(): ChartData {
  const list = livePages()
    .filter((p) => p.kind === 'page' && p.content)
    .map((p) => ({ label: titleOf(p), value: wordsOf(p.content) }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)
  return { labels: list.map((x) => x.label), series: [{ name: t('charts.metric.wordsTopPages.series'), values: list.map((x) => x.value) }], axis: 'category' }
}

const fileCategory = (type: string, name: string): string => {
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  if (type === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf'
  if (type.startsWith('text/') || /word|sheet|excel|presentation|officedocument|opendocument|csv|markdown/.test(type)) return 'document'
  return 'other'
}
const FILE_KINDS = ['image', 'video', 'audio', 'pdf', 'document', 'other']

function storageByType(sync: boolean): ChartData | Promise<ChartData> {
  if (sync || typeof indexedDB === 'undefined') return { labels: [], series: [], error: t('charts.err.loading') }
  return idbValues<{ type?: string; name?: string; size?: number; blob?: Blob }>(createStore('one-files', 'files')).then(
    (records) => {
      const bytes = new Map<string, number>()
      for (const r of records) {
        if (!r || typeof r !== 'object') continue
        const size = typeof r.size === 'number' ? r.size : (r.blob?.size ?? 0)
        const cat = fileCategory(String(r.type ?? r.blob?.type ?? ''), String(r.name ?? ''))
        bytes.set(cat, (bytes.get(cat) ?? 0) + size)
      }
      const total = [...bytes.values()].reduce((a, x) => a + x, 0)
      const mb = total >= 1e6
      const kinds = FILE_KINDS.filter((k) => (bytes.get(k) ?? 0) > 0)
      return {
        labels: kinds.map((k) => t(`charts.file.${k}`)),
        series: [{ name: t('charts.metric.storageByType.series'), values: kinds.map((k) => Math.round(((bytes.get(k) ?? 0) / (mb ? 1e6 : 1e3)) * 100) / 100) }],
        unit: mb ? 'MB' : 'KB',
        axis: 'category' as const,
      }
    },
    () => ({ labels: [], series: [], error: t('charts.err.notAvailable') }),
  )
}

function remindersUpcoming(q: MetricQuery): ChartData {
  const st = useWorkspace.getState()
  const b = timeBuckets(q, { forward: true })
  const values = b.starts.map(() => 0)
  for (const r of collectReminders(st.pages, st.databases)) {
    const i = b.index(r.dueAt)
    if (i >= 0) values[i]++
  }
  return timeData(b, [{ name: t('charts.metric.remindersUpcoming.series'), values }])
}

function journalPerMonth(q: MetricQuery): ChartData {
  const st = useWorkspace.getState()
  const dbId = findJournalDatabase()
  if (!dbId) return { labels: [], series: [], error: t('charts.err.noJournal') }
  const db = st.databases[dbId]
  const dateProp = db?.properties.find((p) => p.type === 'date')
  const rows = livePages().filter((p) => p.databaseId === dbId)
  const when = (p: Page) => {
    const v = dateProp ? p.properties[dateProp.id] : null
    const start = v && typeof v === 'object' && 'start' in v && typeof v.start === 'string' ? Date.parse(v.start.length <= 10 ? `${v.start}T00:00:00` : v.start) : NaN
    return Number.isFinite(start) ? start : p.createdAt
  }
  const b = timeBuckets({ range: q.range, bucket: q.bucket ?? 'month' }, { earliest: Math.min(...rows.map(when)) })
  const values = b.starts.map(() => 0)
  for (const p of rows) {
    const i = b.index(when(p))
    if (i >= 0) values[i]++
  }
  return timeData(b, [{ name: t('charts.metric.journalPerMonth.series'), values }])
}

function activityByMember(q: MetricQuery): ChartData {
  if (!isTeam()) return { labels: [], series: [], error: t('charts.err.teamOnly') }
  const st = useWorkspace.getState()
  const b = q.range === 'all' ? null : timeBuckets(q)
  const inRange = (ms: number) => !b || b.index(ms) >= 0
  const created = new Map<string, number>()
  const edited = new Map<string, number>()
  for (const p of livePages()) {
    if (p.createdBy && inRange(p.createdAt)) created.set(p.createdBy, (created.get(p.createdBy) ?? 0) + 1)
    if (p.updatedBy && p.updatedAt > p.createdAt + 1000 && inRange(p.updatedAt)) edited.set(p.updatedBy, (edited.get(p.updatedBy) ?? 0) + 1)
  }
  const ids = [...new Set([...created.keys(), ...edited.keys()])].sort((a, b2) => (created.get(b2) ?? 0) + (edited.get(b2) ?? 0) - ((created.get(a) ?? 0) + (edited.get(a) ?? 0)))
  const nameOf = (id: string) => (id.startsWith('api:') ? t('database.actor.api') : id.startsWith('hook:') ? t('database.actor.webhook') : (st.people.find((p) => p.id === id)?.name ?? t('database.actor.unknown')))
  const colors: (ColorName | null)[] = ids.map((id) => st.people.find((p) => p.id === id)?.color ?? null)
  return {
    labels: ids.map(nameOf),
    labelColors: colors,
    series: [
      { name: t('charts.metric.activityByMember.created'), values: ids.map((id) => created.get(id) ?? 0) },
      { name: t('charts.metric.activityByMember.edited'), values: ids.map((id) => edited.get(id) ?? 0) },
    ],
    axis: 'category',
  }
}

/* ------------------------------------------------------------------ */
/* Entry points                                                        */
/* ------------------------------------------------------------------ */

function collect(metric: string, q: MetricQuery, sync: boolean): ChartData | Promise<ChartData> {
  switch (metric) {
    case 'pagesCreated':
      return pagesCreated(q)
    case 'pagesEdited':
      return pagesEdited(q, sync)
    case 'rowsPerDatabase':
      return rowsPerDatabase()
    case 'todos':
      return todos()
    case 'wordsTopPages':
      return wordsTopPages()
    case 'storageByType':
      return storageByType(sync)
    case 'remindersUpcoming':
      return remindersUpcoming(q)
    case 'journalPerMonth':
      return journalPerMonth(q)
    case 'activityByMember':
      return activityByMember(q)
    default:
      return { labels: [], series: [], error: t('charts.err.unknownMetric') }
  }
}

/** Full data (history snapshots and files from IndexedDB included). */
export async function systemData(metric: string, q: MetricQuery): Promise<ChartData> {
  try {
    return await collect(metric, q, false)
  } catch (err) {
    console.warn('[charts] metric failed', metric, err)
    return { labels: [], series: [], error: t('charts.err.notAvailable') }
  }
}

/** What can be known without IndexedDB (exports): edits from page times, files not at all. */
export function systemDataSync(metric: string, q: MetricQuery): ChartData {
  try {
    const out = collect(metric, q, true)
    return out instanceof Promise ? { labels: [], series: [], error: t('charts.err.loading') } : out
  } catch (err) {
    console.warn('[charts] metric failed', metric, err)
    return { labels: [], series: [], error: t('charts.err.notAvailable') }
  }
}
