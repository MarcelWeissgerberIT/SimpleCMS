/** Natural-language date parsing for @-mentions (EN + DE), no external services. */
import { addDays, addMonths, addWeeks, format, isValid, nextDay, parse, startOfDay, type Day } from 'date-fns'
import { de, enUS } from 'date-fns/locale'
import type { Lang } from '@/shared/i18n'

const WEEKDAYS: Array<[RegExp, Day]> = [
  [/^(sun|sunday|so|sonntag)$/, 0],
  [/^(mon|monday|mo|montag)$/, 1],
  [/^(tue|tues|tuesday|di|dienstag)$/, 2],
  [/^(wed|wednesday|mi|mittwoch)$/, 3],
  [/^(thu|thur|thursday|do|donnerstag)$/, 4],
  [/^(fri|friday|fr|freitag)$/, 5],
  [/^(sat|saturday|sa|samstag)$/, 6],
]

function weekday(word: string): Day | null {
  for (const [re, d] of WEEKDAYS) if (re.test(word)) return d
  return null
}

const iso = (d: Date) => format(d, 'yyyy-MM-dd')

/** Parse a query into a date (or null). */
export function parseDateQuery(raw: string, now = new Date()): Date | null {
  const q = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!q) return null
  const today = startOfDay(now)
  if (/^(today|heute|now|jetzt)$/.test(q)) return today
  if (/^(tomorrow|morgen)$/.test(q)) return addDays(today, 1)
  if (/^(yesterday|gestern)$/.test(q)) return addDays(today, -1)
  if (/^(übermorgen|uebermorgen|day after tomorrow)$/.test(q)) return addDays(today, 2)
  let m = q.match(/^(?:in )?(\d{1,3}) ?(d|day|days|tag|tagen|tage|w|week|weeks|woche|wochen|m|month|months|monat|monaten)$/)
  if (m) {
    const n = Number(m[1])
    const u = m[2]
    if (/^(w|week|weeks|woche|wochen)$/.test(u)) return addWeeks(today, n)
    if (/^(m|month|months|monat|monaten)$/.test(u)) return addMonths(today, n)
    return addDays(today, n)
  }
  m = q.match(/^(?:next|nächsten|nächster|nächstes|naechsten|kommenden|this|diesen) (\S+)$/)
  if (m) {
    if (/^(week|woche)$/.test(m[1])) return addWeeks(today, 1)
    if (/^(month|monat)$/.test(m[1])) return addMonths(today, 1)
    const wd = weekday(m[1])
    if (wd !== null) return nextDay(today, wd)
  }
  const wd = weekday(q)
  if (wd !== null) return nextDay(today, wd)
  // explicit formats
  const formats = ['yyyy-MM-dd', 'd.M.yyyy', 'd.M.yy', 'd.M.', 'M/d/yyyy', 'M/d', 'MMM d', 'MMMM d', 'd MMM', 'd MMMM', 'MMM d yyyy', 'MMMM d yyyy', 'd. MMMM', 'd. MMMM yyyy']
  for (const f of formats) {
    for (const locale of [enUS, de]) {
      const d = parse(q.replace(/,/g, ''), f, today, { locale })
      if (isValid(d)) return d
    }
  }
  return null
}

export function dateMentionLabel(d: Date, lang: Lang, withTime = false): string {
  const day = format(d, lang === 'de' ? 'd. MMMM yyyy' : 'MMMM d, yyyy', { locale: lang === 'de' ? de : enUS })
  return withTime ? `${day}, ${timeLabel(d, lang)}` : day
}

export function dateMentionAttrs(d: Date, lang: Lang) {
  return { id: iso(d), label: dateMentionLabel(d, lang), kind: 'date' as const }
}

const STORED = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?$/

/** A stored date mention id ("2026-10-05" or "2026-10-05T14:30", local time) → Date, or null. */
export function parseMentionDate(id: string): Date | null {
  const m = STORED.exec(id)
  if (!m) return null
  const d = parse(m[1], 'yyyy-MM-dd', new Date())
  if (!isValid(d)) return null
  if (m[2]) d.setHours(Number(m[2]), Number(m[3]), 0, 0)
  return d
}

export const mentionHasTime = (id: string): boolean => !!STORED.exec(id)?.[2]

/** The `label` attr of a stored date mention id (export, plain text, search). */
export function mentionDateLabel(id: string, lang: Lang): string {
  const d = parseMentionDate(id)
  return d ? dateMentionLabel(d, lang, mentionHasTime(id)) : id
}

/** "14:30" (de) / "2:30 PM" (en). */
function timeLabel(d: Date, lang: Lang): string {
  return format(d, lang === 'de' ? 'HH:mm' : 'h:mm a', { locale: lang === 'de' ? de : enUS })
}

/** Relative display for a stored date mention ("Today", "Tomorrow 14:30", else formatted). */
export function relativeDateLabel(isoDate: string, lang: Lang, words: { today: string; tomorrow: string; yesterday: string }): string {
  const d = parseMentionDate(isoDate)
  if (!d) return isoDate
  const timed = mentionHasTime(isoDate)
  const diff = Math.round((startOfDay(d).getTime() - startOfDay(new Date()).getTime()) / 86400000)
  const word = diff === 0 ? words.today : diff === 1 ? words.tomorrow : diff === -1 ? words.yesterday : null
  if (!word) return dateMentionLabel(d, lang, timed)
  return timed ? `${word} ${timeLabel(d, lang)}` : word
}
