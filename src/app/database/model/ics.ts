/**
 * iCalendar (.ics, RFC 5545) export of a calendar / timeline view.
 * One VEVENT per row with a value in the view's date property (rows the view's filters hide
 * are left out). All-day events use VALUE=DATE with an exclusive DTEND; timed events are
 * written in UTC. Content lines end in CRLF and are folded at 75 octets.
 */
import type { Database, Page, PropertyDef, View } from '../../store/types'
import type { Resolver } from './resolve'
import { isDateValue, parseLocal } from './format'
import { isDate } from '../formula'
import { testGroup } from './query'

const CRLF = '\r\n'

/** TEXT value escaping: backslash, semicolon, comma, newlines. */
export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n')
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

function spanOf(r: Resolver, db: Database, prop: PropertyDef, row: Page): Span | null {
  const v = r.value(db, prop, row)
  if (isDateValue(v)) {
    const start = parseLocal(v.start)
    if (!start) return null
    const end = parseLocal(v.end ?? null)
    return { start, end: end && end >= start ? end : null, allDay: !v.includeTime && !v.start.includes('T') }
  }
  if (isDate(v)) return { start: v, end: null, allDay: false }
  return null
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
