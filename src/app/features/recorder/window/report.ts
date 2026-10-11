/**
 * The incident report (design §6.10): Markdown, generated on demand from a read window and a few facts read for it —
 * titles, schema names, writer labels, counts and times. Never values, never content; never stored, never written
 * into the workspace (the deck downloads it or puts it on the clipboard). Pure: the facts come in (window/facts.ts).
 */
import type { Lang, Translate } from '@/shared/i18n'
import { format } from 'date-fns'
import { de, enUS } from 'date-fns/locale'
import type { EjectRecord, PlaceKey, SchemaDelta } from '../model/types'
import type { ReadItem, ReadModel } from './read'

/** One writer of the span (a lane), from the span's ops. */
export interface WriterRow {
  label: string
  ops: number
  /** distinct places of its events in the window; null: more than the report reads ("…") */
  places: number | null
  first: number
  last: number
}

export interface ReportFacts {
  workspace: string
  /** the window's writer, as the plate names it ("Agent · Nordlicht-Spiegel") */
  writer: string
  seq?: number
  writers: WriterRow[]
  /** a place's title now ('' = untitled; null = private or not available on this device: counted, not named) */
  title(p: PlaceKey): string | null
  /** a row's key as its database shows it (its unique id), or null */
  rowKey(p: PlaceKey): string | null
  /** a database's title */
  dbTitle(db: string): string
  /** a property's name (now, else from the delta that named it) */
  propName(db: string, prop: string): string | null
}

export interface ReportOpts {
  t: Translate
  lang: Lang
  /** the time zone the times are in ("Europe/Berlin") */
  tz: string
  /** when the report is made */
  now: number
  eject?: EjectRecord
}

const two = (n: number) => String(n).padStart(2, '0')
const hm = (at: number) => {
  const d = new Date(at)
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}
const hms = (at: number) => `${hm(at)}:${two(new Date(at).getSeconds())}`
const num = (n: number, lang: Lang) => new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US').format(n)
const pl = (key: string, n: number) => (n === 1 ? `${key}.one` : key)

/** A table cell or a list line: one line, no Markdown that could break the report's structure. */
const cell = (s: string) => s.replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|').replace(/^#+\s*/, '').trim()

/** The file name: incident-<yyyy-mm-dd>-<hhmm>-<lane slug>.md (the window's start). */
export function reportFile(model: Pick<ReadModel, 'sel'>): string {
  const d = new Date(model.sel.a)
  const slug =
    model.sel.lane
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'writer'
  return `incident-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}-${slug}.md`
}

/** A schema delta as a line (names only). */
export function deltaLine(t: Translate, d: SchemaDelta): string {
  const prop = d.prop?.name ?? ''
  const opt = d.opt?.name ?? ''
  const view = d.view?.name ?? ''
  if (d.part === 'opt~' && d.opt?.prev && d.opt.prev !== d.opt.name) return t('features.recorder.read.x.optRenamed', { prop, opt, prev: d.opt.prev })
  if (d.part === 'order') return d.prop ? t('features.recorder.read.x.propOrder', { prop }) : t('features.recorder.read.x.order')
  return t(`features.recorder.read.x.${d.part}`, { prop, opt, view })
}

/** The report's Markdown and its file name. */
export function incidentReport(model: ReadModel, facts: ReportFacts, opts: ReportOpts): { md: string; file: string } {
  const { t, lang } = opts
  const k = (key: string, vars?: Record<string, string | number>) => t(`features.recorder.${key}`, vars)
  const n = (v: number) => num(v, lang)
  const day = format(model.sel.a, t('features.recorder.fmt.day'), { locale: lang === 'de' ? de : enUS })
  const out: string[] = []
  out.push(`# ${cell(k('report.title', { workspace: facts.workspace, day, from: hm(model.sel.a), to: hm(Math.max(model.sel.a, model.sel.b - 1000)) }))}`)
  out.push(k('report.made', { date: `${format(opts.now, 'yyyy-MM-dd')} ${hms(opts.now)}`, tz: opts.tz }))
  out.push('')

  // the window: who, how much
  const m = model.meters
  const p = m.places
  const parts: string[] = []
  if (p.rows) parts.push(`${k(pl('report.part.rows', p.rows), { n: n(p.rows) })}${p.newRows ? ` (${k('report.part.new', { n: n(p.newRows) })})` : ''}`)
  if (p.pages) parts.push(k(pl('report.part.pages', p.pages), { n: n(p.pages) }))
  if (p.schema) parts.push(k(pl('report.part.schema', p.schema), { n: n(p.schema) }))
  if (p.views) parts.push(k(pl('report.part.views', p.views), { n: n(p.views) }))
  const ops = k(pl('unit.ops', m.ops), { n: n(m.ops) })
  const places = k(pl('unit.places', p.all), { n: model.tooMany ? '…' : n(p.all) })
  out.push(`## ${k('report.window')}`)
  out.push(`- ${cell(k('report.writer', { writer: facts.seq ? k('report.run', { writer: facts.writer, n: facts.seq }) : facts.writer }))}`)
  out.push(`- ${k('report.meters', { ops, places, parts: parts.join(' · ') || '—', add: n(m.words[0]), del: n(m.words[1]) })}`)
  out.push('')

  // every writer of the span
  out.push(`## ${k('report.writers')}`)
  out.push(`| ${k('report.th.writer')} | ${k('report.th.ops')} | ${k('report.th.places')} | ${k('report.th.first')} | ${k('report.th.last')} |`)
  out.push('| --- | ---: | ---: | --- | --- |')
  for (const w of facts.writers) out.push(`| ${cell(w.label)} | ${n(w.ops)} | ${w.places === null ? '…' : n(w.places)} | ${hm(w.first)} | ${hm(w.last)} |`)
  out.push('')

  // what changed: schema names, pages, rows (names, counts and times only)
  out.push(`## ${k('report.changed')}`)
  const items = model.groups.flatMap((g) => g.items)
  let privates = 0
  const named = (it: ReadItem): string | null => {
    const title = facts.title(it.p)
    if (title === null) {
      privates++
      return null
    }
    return title || k('report.untitled')
  }
  const schema = items.filter((it) => it.pk === 'schema' || it.pk === 'view')
  if (schema.length) {
    out.push(`### ${k('report.schema')}`)
    for (const it of schema) {
      const w = model.data.places.get(it.p)
      const db = facts.dbTitle(it.db ?? it.p.slice(2))
      const lines = (w?.ownEvents ?? []).flatMap((e) => (e.x ?? []).map((d) => ({ d, at: e.at })))
      if (!lines.length) out.push(`- ${cell(db)} · ${hms(it.at)}`)
      for (const { d, at } of lines) out.push(`- ${cell(`${db} · ${deltaLine(t, d)}`)} · ${hms(at)}`)
    }
  }
  const pages = items.filter((it) => it.pk === 'page' || it.pk === 'db')
  const pageLines = pages.flatMap((it) => {
    const title = named(it)
    if (title === null) return []
    const key = it.text ? 'report.pageLine' : 'report.pageLineNoText'
    return [`- ${cell(k(key, { title, add: n(it.words[0]), del: n(it.words[1]), time: hm(it.at) }))}`]
  })
  if (pageLines.length) {
    out.push(`### ${k('report.pages')}`)
    out.push(...pageLines)
  }
  const rows = items.filter((it) => it.pk === 'row')
  const rowLines = rows.flatMap((it) => {
    const title = named(it)
    if (title === null) return []
    const key = facts.rowKey(it.p)
    const label = key && key !== title ? `${key} · ${title}` : title
    const w = model.data.places.get(it.p)
    const touched = new Set<string>()
    let all = false
    for (const g of w?.own ?? []) {
      if (g.touched === '*') all = true
      else for (const x of g.touched) touched.add(x)
    }
    const db = it.db ?? ''
    const names = all
      ? it.act === 'new'
        ? k('read.act.new')
        : '—'
      : [...touched]
          .map((x) => (x.startsWith('p:') ? facts.propName(db, x.slice(2)) : x === 't' ? k('report.title.row') : null))
          .filter((x): x is string => !!x)
          .join(', ') || '—'
    return [`| ${cell(label)} | ${cell(facts.dbTitle(db))} | ${cell(names)} | ${it.text ? k('report.yes') : '—'} | ${hm(it.at)} |`]
  })
  if (rowLines.length) {
    out.push(`### ${k('report.rows')}`)
    out.push(`| ${k('report.th.row')} | ${k('report.th.db')} | ${k('report.th.props')} | ${k('report.th.text')} | ${k('report.th.time')} |`)
    out.push('| --- | --- | --- | --- | --- |')
    out.push(...rowLines)
  }
  out.push('')

  // notes
  const notes: string[] = []
  if (model.incomplete) notes.push(k('report.note.incomplete'))
  if (model.partial.length) notes.push(k('report.note.partial', { places: k(pl('unit.places', model.partial.length), { n: n(model.partial.length) }) }))
  if (model.held.length) notes.push(k('report.note.held', { places: k(pl('unit.places', model.held.length), { n: n(model.held.length) }) }))
  if (model.tooMany) notes.push(k('report.note.tooMany', { n: n(5000), shown: n(2000) }))
  const hidden = privates + model.unavailable
  if (hidden) notes.push(k(pl('report.note.private', hidden), { n: n(hidden) }))
  if (model.sel.scope.startsWith('cloud:')) notes.push(k('deck.teamOnlySeen'))
  out.push(`## ${k('report.notes')}`)
  out.push(...(notes.length ? notes.map((x) => `- ${cell(x)}`) : [`- ${k('report.note.none')}`]))
  out.push('')
  return { md: out.join('\n'), file: reportFile(model) }
}
