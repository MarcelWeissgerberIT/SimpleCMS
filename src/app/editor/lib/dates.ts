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

export function dateMentionLabel(d: Date, lang: Lang): string {
  return format(d, lang === 'de' ? 'd. MMMM yyyy' : 'MMMM d, yyyy', { locale: lang === 'de' ? de : enUS })
}

export function dateMentionAttrs(d: Date, lang: Lang) {
  return { id: iso(d), label: dateMentionLabel(d, lang), kind: 'date' as const }
}

/** Relative display for a stored ISO date mention ("Today", "Tomorrow", else formatted). */
export function relativeDateLabel(isoDate: string, lang: Lang, words: { today: string; tomorrow: string; yesterday: string }): string {
  const d = parse(isoDate, 'yyyy-MM-dd', new Date())
  if (!isValid(d)) return isoDate
  const diff = Math.round((startOfDay(d).getTime() - startOfDay(new Date()).getTime()) / 86400000)
  if (diff === 0) return words.today
  if (diff === 1) return words.tomorrow
  if (diff === -1) return words.yesterday
  return dateMentionLabel(d, lang)
}
