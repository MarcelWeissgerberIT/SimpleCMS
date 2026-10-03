/**
 * iCalendar (.ics, RFC 5545) export of a calendar / timeline view.
 * One VEVENT per row with a value in the view's date property (rows the view's filters hide
 * are left out). All-day events use VALUE=DATE with an exclusive DTEND; timed events are
 * written in UTC. Content lines end in CRLF and are folded at 75 octets.
 */
import type { Database, ID, Page, PropertyDef, View } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { t } from '../../i18n'
import { Resolver } from './resolve'
import { isDateValue, parseLocal } from './format'
import { isDate, runFormula } from '../formula'
import { sortRows, testGroup } from './query'
import { parentIdOf, subItemsOf } from './hierarchy'

const CRLF = '\r\n'

/**
 * TEXT value escaping: backslash, semicolon, comma, newlines. Other control characters
 * (U+0000–U+001F except tab, and U+007F) are not allowed in a content line and are dropped.
 */
export function escapeText(s: string): string {
  return (
    s
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r\n|\r|\n/g, '\\n')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000a-\u001f\u007f]/g, '')
  )
}

const utf8Len = (cp: number) => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4)

/** Fold a content line: at most 75 octets per line, continuation lines start with one space. */
export function foldLine(line: string): string {
  const out: string[] = []
  let cur = ''
  let bytes = 0
  let limit = 75
  for (const ch of line) {
    // iterating a string walks code points, so a multi-octet character is never split
    const n = utf8Len(ch.codePointAt(0)!)
    if (bytes + n > limit) {
      out.push(cur)
      cur = ''
      bytes = 0
      limit = 74 // the leading space counts
    }
    cur += ch
    bytes += n
  }
  out.push(cur)
  return out.join(`${CRLF} `)
}

const pad = (n: number) => String(n).padStart(2, '0')
const dateStamp = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
const utcStamp = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
const nextDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)

interface Span {
  start: Date
  end: Date | null
  allDay: boolean
}

const isMidnight = (d: Date) => d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0

/** End of a date range a formula passed through (prop("Timeline") → its start, dateEnd() → its end). */
function rangeEndOf(d: Date): Date | null {
  const end = runFormula('dateEnd(prop("d"))', { prop: () => d, now: Date.now(), lang: 'en' })
  return isDate(end) && end !== d && end.getTime() !== d.getTime() ? end : null
}

function spanOf(r: Resolver, db: Database, prop: PropertyDef, row: Page): Span | null {
  const v = r.value(db, prop, row)
  if (isDateValue(v)) {
    const start = parseLocal(v.start)
    if (!start) return null
    const end = parseLocal(v.end ?? null)
    return { start, end: end && end >= start ? end : null, allDay: !v.includeTime && !v.start.includes('T') }
  }
  if (isDate(v)) {
    if (Number.isNaN(v.getTime())) return null
    const end = prop.type === 'formula' || prop.type === 'rollup' ? rangeEndOf(v) : null
    // a computed date at local midnight (dateAdd(prop("Due"), 1, "days"), earliest_date …) is a day, not 00:00
    const allDay = (prop.type === 'formula' || prop.type === 'rollup') && isMidnight(v) && (!end || isMidnight(end))
    return { start: v, end: end && end >= v ? end : null, allDay }
  }
  return null
}

/** Rows of a view as it shows them: its filters, then its sorts (search is a momentary lens and is ignored). */
export function viewRows(r: Resolver, db: Database, view: View, rows: Page[]): Page[] {
  const props = new Map(db.properties.map((p) => [p.id, p]))
  // "Parents only" hides sub-items everywhere the view is shown (calendar export, published sites)
  const pair = view.subItems === 'parents' ? subItemsOf(db) : null
  const visible = pair ? rows.filter((row) => !parentIdOf(r.ctx.pages, pair, row)) : rows
  return sortRows(r, db, filteredRows(r, db, view, visible, props), Array.isArray(view.sorts) ? view.sorts : [], props)
}

/**
 * The same outside React (website export): resolves against the current workspace.
 * `viewId` null / unknown → the database's first view.
 */
export function rowsOfView(dbId: ID, viewId: ID | null, rows: Page[]): { view: View | null; rows: Page[] } {
  const s = useWorkspace.getState()
  const db = s.databases[dbId]
  const view = db ? (db.views.find((v) => v.id === viewId) ?? db.views[0] ?? null) : null
  if (!db || !view) return { view, rows }
  const r = new Resolver({
    pages: s.pages,
    databases: s.databases,
    people: s.people,
    lang: s.settings.language,
    now: Date.now(),
    labels: {
      today: t('database.date.today'),
      tomorrow: t('database.date.tomorrow'),
      yesterday: t('database.date.yesterday'),
      untitled: t('common.untitled'),
      yes: t('database.yes'),
      no: t('database.no'),
    },
  })
  try {
    return { view, rows: viewRows(r, db, view, rows) }
  } catch {
    return { view, rows }
  }
}

export interface IcsOptions {
  r: Resolver
  db: Database
  view: View
  rows: Page[]
  calendarName: string
  /** App URL without the hash, e.g. https://x.github.io/SimpleCMS/app/ */
  appUrl: string
  untitled: string
  now?: Date
}

/** Rows of the view that pass its filters (search is a momentary lens and is ignored). */
export function filteredRows(r: Resolver, db: Database, view: View, rows: Page[], props: Map<string, PropertyDef>): Page[] {
  const f = view.filter
  return f && f.items.length ? rows.filter((row) => testGroup(r, db, f, row, props)) : rows
}

export function buildIcs({ r, db, view, rows, calendarName, appUrl, untitled, now = new Date() }: IcsOptions): { text: string; count: number } {
  const prop = view.dateProperty ? db.properties.find((p) => p.id === view.dateProperty) : undefined
  const textProps = db.properties.filter((p) => p.type === 'text')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SimpleCMS One//Database export//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escapeText(calendarName)}`]
  let count = 0
  if (prop) {
    for (const row of rows) {
      const span = spanOf(r, db, prop, row)
      if (!span) continue
      count++
      lines.push('BEGIN:VEVENT', `UID:${row.id}@simplecms-one`, `DTSTAMP:${utcStamp(now)}`)
      if (span.allDay) {
        // DTEND of an all-day event is exclusive: the day after the last day
        lines.push(`DTSTART;VALUE=DATE:${dateStamp(span.start)}`, `DTEND;VALUE=DATE:${dateStamp(nextDay(span.end ?? span.start))}`)
      } else {
        const end = span.end && span.end > span.start ? span.end : new Date(span.start.getTime() + 60 * 60 * 1000)
        lines.push(`DTSTART:${utcStamp(span.start)}`, `DTEND:${utcStamp(end)}`)
      }
      lines.push(`SUMMARY:${escapeText(row.title.trim() || untitled)}`)
      const desc = textProps
        .map((p) => {
          const v = row.properties[p.id]
          return typeof v === 'string' && v.trim() ? `${p.name}: ${v.trim()}` : ''
        })
        .filter(Boolean)
        .join('\n')
      if (desc) lines.push(`DESCRIPTION:${escapeText(desc)}`)
      lines.push(`URL:${appUrl}#/p/${row.id}`, `CREATED:${utcStamp(new Date(row.createdAt))}`, `LAST-MODIFIED:${utcStamp(new Date(row.updatedAt))}`, 'END:VEVENT')
    }
  }
  lines.push('END:VCALENDAR')
  return { text: lines.map(foldLine).join(CRLF) + CRLF, count }
}

export function downloadIcs(text: string, name: string): void {
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(name || 'calendar').replace(/[\\/:*?"<>|]+/g, '-')}.ics`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
