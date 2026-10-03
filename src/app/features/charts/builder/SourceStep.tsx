/** Step 01 — where the numbers come from: spreadsheet, database, workspace data or a typed table. */
import { useMemo, type ReactNode } from 'react'
import { Activity, Database as DatabaseIcon, Keyboard, Sheet } from 'lucide-react'
import type { Translate } from '@/shared/i18n'
import { useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { inTemplate, isEffectivelyTrashed } from '../../../store/selectors'
import type { ID } from '../../../store/types'
import { chartGroupable, chartMeasurable } from '../../../database'
import { CHART_AGGREGATES, DATE_BUCKETS, SYSTEM_BUCKETS, SYSTEM_RANGES, type ChartAggregate, type ChartSource, type ChartSourceKind, type DateBucket, type SystemBucket, type SystemRange } from '../types'
import { parseNumber } from '../table'
import { MANUAL_MAX_COLS, MANUAL_MAX_ROWS } from '../spec'
import { allSpreadsheets, datasetNames, sheetList, usedRange } from '../data/sheet'
import { availableMetrics, defaultBucket, metricDef } from '../data/system'
import { Field, Seg, Select } from './controls'
import { ManualGrid } from './ManualGrid'

export interface DbDraft {
  databaseId: ID
  viewId?: ID
  x: ID
  y?: ID
  aggregate: ChartAggregate
  series?: ID
  dateBucket?: DateBucket
}

export interface SourceDraft {
  kind: ChartSourceKind | null
  sheet: { pageId: ID; blockId: string; ref: string } | null
  database: DbDraft | null
  system: { metric: string; range: SystemRange; bucket?: SystemBucket }
  manual: string[][]
  inline: { ref: string }
}

const DATE_TYPES = new Set(['date', 'created_time', 'last_edited_time'])

/* ------------------------------------------------------------------ */
/* Defaults                                                            */
/* ------------------------------------------------------------------ */

function sampleGrid(t: Translate): string[][] {
  const lang = useWorkspace.getState().settings.language === 'de' ? 'de-DE' : 'en-GB'
  const month = (i: number) => new Intl.DateTimeFormat(lang, { month: 'short' }).format(new Date(2026, i, 1)).replace(/\.$/, '')
  const a = [12, 18, 15, 24, 21, 29]
  const b = [9, 11, 12, 14, 13, 15]
  return [[t('charts.manual.sample.label'), t('charts.manual.sample.series'), t('charts.manual.sample.series2')], ...a.map((v, i) => [month(i), String(v), String(b[i])])]
}

/** Live databases, those on `pageId` first, then the most recently edited. */
export function databaseChoices(pageId: ID | null): Array<{ id: ID; title: string }> {
  const st = useWorkspace.getState()
  const onPage = new Set<ID>()
  const content = pageId ? st.pages[pageId]?.content : null
  const walk = (n: { type?: string; attrs?: Record<string, unknown>; content?: unknown[] } | null | undefined) => {
    if (!n) return
    if (n.type === 'databaseBlock' && typeof n.attrs?.databaseId === 'string') onPage.add(n.attrs.databaseId)
    ;(n.content as typeof n[] | undefined)?.forEach(walk)
  }
  walk(content as never)
  return Object.values(st.pages)
    .filter((p) => p.kind === 'database' && st.databases[p.id] && !p.trashed && !isEffectivelyTrashed(st.pages, p.id) && !inTemplate(st.pages, p.id))
    .sort((a, b) => Number(onPage.has(b.id) || b.parentId === pageId) - Number(onPage.has(a.id) || a.parentId === pageId) || b.updatedAt - a.updatedAt)
    .map((p) => ({ id: p.id, title: p.title.trim() }))
}

/** Sensible first chart of a database: group by status (or a select, a date …), count rows. */
export function defaultDb(databaseId: ID): DbDraft | null {
  const db = useWorkspace.getState().databases[databaseId]
  if (!db) return null
  const props = db.properties.filter(chartGroupable)
  const x = props.find((p) => p.type === 'status') ?? props.find((p) => p.type === 'select') ?? props.find((p) => DATE_TYPES.has(p.type)) ?? props.find((p) => p.type === 'person') ?? props[0]
  return { databaseId, x: x?.id ?? '', aggregate: 'count', ...(x && DATE_TYPES.has(x.type) ? { dateBucket: 'month' as const } : {}) }
}

function defaultSheet(pageId: ID | null): SourceDraft['sheet'] {
  const list = allSpreadsheets()
  const pick = list.find((s) => s.pageId === pageId) ?? list[0]
  return pick ? { pageId: pick.pageId, blockId: pick.blockId, ref: '' } : null
}

export function initialDraft(source: ChartSource | null, allowed: ChartSourceKind[], pageId: ID | null, t: Translate): SourceDraft {
  const first = availableMetrics()[0]
  const draft: SourceDraft = {
    kind: allowed.length === 1 ? allowed[0] : null,
    sheet: null,
    database: null,
    system: { metric: first?.id ?? 'pagesCreated', range: first?.range ?? '30d' },
    manual: sampleGrid(t),
    inline: { ref: '' },
  }
  if (!source) return draft
  draft.kind = source.kind
  switch (source.kind) {
    case 'sheet':
      draft.sheet = { pageId: source.pageId, blockId: source.sheetBlockId, ref: source.ref }
      break
    case 'database': {
      const { kind: _k, ...rest } = source
      draft.database = rest
      break
    }
    case 'system':
      draft.system = { metric: source.metric, range: source.range, ...(source.bucket ? { bucket: source.bucket } : {}) }
      break
    case 'manual':
      draft.manual = source.rows.length ? source.rows.map((r) => r.map((c) => (c === null ? '' : String(c)))) : sampleGrid(t)
      break
    case 'inline':
      draft.inline = { ref: source.ref }
      break
  }
  return draft
}

/** The draft as a source (null while it misses something essential). */
export function sourceOf(d: SourceDraft): ChartSource | null {
  const lang = useWorkspace.getState().settings.language === 'de' ? 'de' : 'en'
  switch (d.kind) {
    case 'sheet':
      return d.sheet ? { kind: 'sheet', pageId: d.sheet.pageId, sheetBlockId: d.sheet.blockId, ref: d.sheet.ref } : null
    case 'database':
      return d.database && d.database.x ? { kind: 'database', ...d.database } : null
    case 'system':
      return { kind: 'system', metric: d.system.metric, range: d.system.range, ...(d.system.bucket ? { bucket: d.system.bucket } : {}) }
    case 'manual':
      // numbers typed in the grid are stored as numbers (read in the current language)
      return {
        kind: 'manual',
        rows: d.manual
          .slice(0, MANUAL_MAX_ROWS)
          .map((r, i) => r.slice(0, MANUAL_MAX_COLS).map((c) => (i > 0 && c.trim() && parseNumber(c, lang) && !/[€$£%]/.test(c) ? parseNumber(c, lang)!.value : c.trim() ? c : null))),
      }
    case 'inline':
      return { kind: 'inline', ref: d.inline.ref }
    default:
      return null
  }
}

/** Title the chart gets unless one is typed: the database / metric / spreadsheet name. */
export function autoTitle(d: SourceDraft, t: Translate): string {
  const st = useWorkspace.getState()
  switch (d.kind) {
    case 'database':
      return d.database ? st.pages[d.database.databaseId]?.title.trim() ?? '' : ''
    case 'system':
      return metricDef(d.system.metric) ? t(`charts.metric.${d.system.metric}`) : ''
    case 'sheet': {
      if (!d.sheet) return ''
      const s = allSpreadsheets().find((x) => x.blockId === d.sheet!.blockId)
      return s?.title ?? ''
    }
    default:
      return ''
  }
}

/* ------------------------------------------------------------------ */
/* UI                                                                  */
/* ------------------------------------------------------------------ */

const ICONS: Record<ChartSourceKind, ReactNode> = {
  sheet: <Sheet size={18} strokeWidth={1.6} />,
  database: <DatabaseIcon size={18} strokeWidth={1.6} />,
  system: <Activity size={18} strokeWidth={1.6} />,
  manual: <Keyboard size={18} strokeWidth={1.6} />,
  inline: <Sheet size={18} strokeWidth={1.6} />,
}

export function SourceStep({ draft, onChange, allowed, pageId }: { draft: SourceDraft; onChange: (d: SourceDraft) => void; allowed: ChartSourceKind[]; pageId: ID | null }) {
  const t = useT()
  const set = (patch: Partial<SourceDraft>) => onChange({ ...draft, ...patch })
  const pick = (kind: ChartSourceKind) => {
    const next: Partial<SourceDraft> = { kind }
    if (kind === 'database' && !draft.database) {
      const first = databaseChoices(pageId)[0]
      next.database = first ? defaultDb(first.id) : null
    }
    if (kind === 'sheet' && !draft.sheet) next.sheet = defaultSheet(pageId)
    set(next)
  }
  const cards = allowed.filter((k) => k !== 'inline')
  return (
    <div className="chb-source">
      {cards.length > 1 && (
        <div className="chb-cards" role="radiogroup" aria-label={t('charts.source.label')}>
          {cards.map((k, i) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={draft.kind === k}
              className="chb-card"
              onClick={() => pick(k)}
              data-source={k}
              data-autofocus={(draft.kind ? draft.kind === k : i === 0) || undefined}
            >
              <span className="chb-card__icon" aria-hidden>
                {ICONS[k]}
              </span>
              <span className="chb-card__name">{t(`charts.source.${k}`)}</span>
              <span className="chb-card__desc">{t(`charts.source.${k}.desc`)}</span>
              <span className={`led${draft.kind === k ? ' led--on' : ''}`} aria-hidden />
            </button>
          ))}
        </div>
      )}
      <div className="chb-config">
        {draft.kind === 'sheet' && <SheetConfig value={draft.sheet} onChange={(sheet) => set({ sheet })} />}
        {draft.kind === 'database' && <DatabaseConfig value={draft.database} pageId={pageId} onChange={(database) => set({ database })} />}
        {draft.kind === 'system' && <SystemConfig value={draft.system} onChange={(system) => set({ system })} />}
        {draft.kind === 'manual' && <ManualGrid rows={draft.manual} onChange={(manual) => set({ manual })} />}
        {draft.kind === 'inline' && (
          <Field label={t('charts.sheet.range')} hint={t('charts.sheet.rangeHint')} wide>
            {(id) => <input id={id} className="input chb-mono" value={draft.inline.ref} spellCheck={false} onChange={(e) => set({ inline: { ref: e.target.value } })} />}
          </Field>
        )}
      </div>
    </div>
  )
}

/* ---------------- spreadsheet ---------------- */

function SheetConfig({ value, onChange }: { value: SourceDraft['sheet']; onChange: (v: SourceDraft['sheet']) => void }) {
  const t = useT()
  const pages = useWorkspace((s) => s.pages)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const list = useMemo(() => allSpreadsheets(), [pages])
  if (!list.length) return <p className="chb-empty">{t('charts.sheet.none')}</p>
  const current = value ? list.find((s) => s.blockId === value.blockId && s.pageId === value.pageId) : undefined
  return (
    <div className="chb-grid2">
      <Field label={t('charts.sheet.pick')} wide>
        {(id) => (
          <Select
            id={id}
            value={current ? `${current.pageId}/${current.blockId}` : ''}
            onChange={(v) => {
              const [pageId, blockId] = v.split('/')
              onChange({ pageId, blockId, ref: '' })
            }}
            options={[
              ...(current ? [] : [{ value: '', label: '—' }]),
              ...list.map((s) => ({ value: `${s.pageId}/${s.blockId}`, label: `${s.title || t('charts.sheet.untitled')} · ${t('charts.sheet.onPage', { page: pages[s.pageId]?.title.trim() || t('common.untitled') })}` })),
            ]}
          />
        )}
      </Field>
      {current && (
        <>
          {current.sheets.length > 1 && (
            <Field label={t('charts.sheet.sheet')} wide>
              {() => (
                <div className="chb-chips">
                  {sheetList(current.attrs).map((sh) => {
                    const ref = usedRange(current.attrs, sh.id)
                    return (
                      <button key={sh.id} type="button" className="chb-chip" aria-pressed={value?.ref === ref} onClick={() => onChange({ ...value!, ref })}>
                        {sh.name}
                      </button>
                    )
                  })}
                </div>
              )}
            </Field>
          )}
          {datasetNames(current.attrs).length > 0 && (
            <Field label={t('charts.sheet.datasets')} wide>
              {() => (
                <div className="chb-chips">
                  {datasetNames(current.attrs).map((n) => (
                    <button key={n} type="button" className="chb-chip chb-mono" aria-pressed={value?.ref === `DS(${n})`} onClick={() => onChange({ ...value!, ref: `DS(${n})` })}>
                      DS({n})
                    </button>
                  ))}
                </div>
              )}
            </Field>
          )}
          <Field label={t('charts.sheet.range')} hint={t('charts.sheet.rangeHint')} wide>
            {(id) => <input id={id} className="input chb-mono" value={value?.ref ?? ''} placeholder={usedRange(current.attrs)} spellCheck={false} onChange={(e) => onChange({ ...value!, ref: e.target.value })} />}
          </Field>
        </>
      )}
    </div>
  )
}

/* ---------------- database ---------------- */

function DatabaseConfig({ value, pageId, onChange }: { value: DbDraft | null; pageId: ID | null; onChange: (v: DbDraft | null) => void }) {
  const t = useT()
  const databases = useWorkspace((s) => s.databases)
  const pages = useWorkspace((s) => s.pages)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const choices = useMemo(() => databaseChoices(pageId), [databases, pageId])
  if (!choices.length) return <p className="chb-empty">{t('charts.db.none')}</p>
  const db = value ? databases[value.databaseId] : undefined
  const groupable = db?.properties.filter(chartGroupable) ?? []
  const numeric = db?.properties.filter(chartMeasurable) ?? []
  const xProp = groupable.find((p) => p.id === value?.x)
  const up = (patch: Partial<DbDraft>) => value && onChange({ ...value, ...patch })
  return (
    <div className="chb-grid2">
      <Field label={t('charts.db.pick')}>
        {(id) => (
          <Select
            id={id}
            value={value?.databaseId ?? ''}
            onChange={(v) => onChange(defaultDb(v))}
            options={[...(value ? [] : [{ value: '', label: '—' }]), ...choices.map((c) => ({ value: c.id, label: c.title || pages[c.id]?.title || t('common.untitled') }))]}
          />
        )}
      </Field>
      {db && value && (
        <>
          <Field label={t('charts.db.view')}>
            {(id) => (
              <Select
                id={id}
                value={value.viewId ?? ''}
                onChange={(v) => up({ viewId: v || undefined })}
                options={[{ value: '', label: t('charts.db.allRows') }, ...db.views.map((v) => ({ value: v.id, label: t('charts.db.viewRows', { view: v.name }) }))]}
              />
            )}
          </Field>
          <Field label={t('charts.db.x')}>
            {(id) => (
              <Select
                id={id}
                value={value.x}
                onChange={(x) => {
                  const p = groupable.find((g) => g.id === x)
                  up({ x, dateBucket: p && DATE_TYPES.has(p.type) ? (value.dateBucket ?? 'month') : undefined, series: value.series === x ? undefined : value.series })
                }}
                options={[...(xProp ? [] : [{ value: '', label: '—' }]), ...groupable.map((p) => ({ value: p.id, label: p.name }))]}
              />
            )}
          </Field>
          <Field label={t('charts.db.series')}>
            {(id) => (
              <Select
                id={id}
                value={value.series ?? ''}
                onChange={(v) => up({ series: v || undefined })}
                options={[{ value: '', label: t('charts.db.noSplit') }, ...groupable.filter((p) => p.id !== value.x).map((p) => ({ value: p.id, label: p.name }))]}
              />
            )}
          </Field>
          <Field label={t('charts.db.measure')} wide hint={!numeric.length ? t('charts.db.noNumbers') : undefined}>
            {() => (
              <Seg
                label={t('charts.db.measure')}
                value={value.aggregate}
                items={CHART_AGGREGATES.map((a) => ({ value: a, label: t(`charts.agg.${a}`), disabled: a !== 'count' && !numeric.length }))}
                onChange={(aggregate) => up({ aggregate, y: aggregate === 'count' ? value.y : (value.y ?? numeric[0]?.id) })}
              />
            )}
          </Field>
          {value.aggregate !== 'count' && numeric.length > 0 && (
            <Field label={t('charts.db.y')}>
              {(id) => <Select id={id} value={value.y ?? ''} onChange={(y) => up({ y: y || undefined })} options={numeric.map((p) => ({ value: p.id, label: p.name }))} />}
            </Field>
          )}
          {xProp && DATE_TYPES.has(xProp.type) && (
            <Field label={t('charts.db.bucket')} wide>
              {() => <Seg label={t('charts.db.bucket')} value={value.dateBucket ?? 'month'} items={DATE_BUCKETS.map((b) => ({ value: b, label: t(`charts.bucket.${b}`) }))} onChange={(dateBucket) => up({ dateBucket })} />}
            </Field>
          )}
        </>
      )}
    </div>
  )
}

/* ---------------- workspace metrics ---------------- */

function SystemConfig({ value, onChange }: { value: SourceDraft['system']; onChange: (v: SourceDraft['system']) => void }) {
  const t = useT()
  const metrics = availableMetrics()
  const def = metricDef(value.metric)
  return (
    <div className="chb-sys">
      <div className="chb-metrics" role="radiogroup" aria-label={t('charts.sys.metric')}>
        {metrics.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={value.metric === m.id}
            className="chb-metric"
            onClick={() => onChange({ metric: m.id, range: m.time ? (metricDef(value.metric)?.time ? value.range : m.range) : m.range })}
          >
            <span className={`led${value.metric === m.id ? ' led--on' : ''}`} aria-hidden />
            <span className="chb-metric__name">{t(`charts.metric.${m.id}`)}</span>
            <span className="chb-metric__desc">{t(`charts.metric.${m.id}.desc`)}</span>
          </button>
        ))}
      </div>
      {def?.time && (
        <div className="chb-grid2">
          <Field label={t('charts.sys.range')} wide>
            {() => (
              <Seg
                label={t('charts.sys.range')}
                size="sm"
                value={value.range}
                items={SYSTEM_RANGES.filter((r) => !def.forward || r !== 'all').map((r) => ({ value: r, label: t(def.forward ? `charts.range.next.${r}` : `charts.range.${r}`) }))}
                onChange={(range) => onChange({ ...value, range, bucket: undefined })}
              />
            )}
          </Field>
          <Field label={t('charts.sys.bucket')} wide>
            {() => <Seg label={t('charts.sys.bucket')} size="sm" value={value.bucket ?? defaultBucket(value.range)} items={SYSTEM_BUCKETS.map((b) => ({ value: b, label: t(`charts.bucket.${b}`) }))} onChange={(bucket) => onChange({ ...value, bucket })} />}
          </Field>
        </div>
      )}
    </div>
  )
}
