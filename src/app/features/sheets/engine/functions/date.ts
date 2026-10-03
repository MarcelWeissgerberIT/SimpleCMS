/** Dates: serial numbers (days since 1899-12-30, time = fraction of a day), read in UTC. */
import type { FnSpec, Value } from '../types'
import { cellsOf, DAY, EPOCH, isMulti } from '../values'
import { arg, def, err, int, isErr, n, s } from './helpers'

const DATE_ARG = (name: string, opts?: { optional?: boolean; repeat?: boolean }) => arg(name, 'date', opts)

/** y-m-d → serial, overflowing months / days roll over (DATE(2026; 14; 1) = 2027-02-01). */
export function dateSerial(y: number, m: number, d: number): number {
  return Math.round((Date.UTC(y, m - 1, 1) + (d - 1) * DAY - EPOCH) / DAY)
}

export function ymd(serial: number): { y: number; m: number; d: number; wd: number } {
  const dt = new Date(EPOCH + Math.floor(serial) * DAY)
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), wd: dt.getUTCDay() }
}

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** A date argument as a serial (≥ 0). */
function serial(v: Value | undefined): number | ReturnType<typeof err> {
  const x = n(v)
  if (isErr(x)) return x
  return x < 0 ? err('#NUM!', 'dates before 1900 are not supported') : x
}

function addMonths(start: number, months: number): number {
  const { y, m, d } = ymd(start)
  const total = y * 12 + (m - 1) + months
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return dateSerial(ny, nm, Math.min(d, daysIn(ny, nm)))
}

export const dateFunctions: FnSpec[] = [
  def('TODAY', 'date', [], "Today's date.", 'Das heutige Datum.', '=TODAY()', (_a, ctx) => dateSerial(ctx.now.getFullYear(), ctx.now.getMonth() + 1, ctx.now.getDate()), { keywords: 'HEUTE now date heute', returns: 'date', volatile: true }),
  def('NOW', 'date', [], 'The current date and time.', 'Aktuelles Datum und Uhrzeit.', '=NOW()', (_a, ctx) => {
    const t = ctx.now
    return dateSerial(t.getFullYear(), t.getMonth() + 1, t.getDate()) + (t.getHours() * 3600 + t.getMinutes() * 60 + t.getSeconds()) / 86400
  }, { keywords: 'JETZT time zeit uhrzeit', returns: 'datetime', volatile: true }),
  def('DATE', 'date', [arg('year', 'number'), arg('month', 'number'), arg('day', 'number')], 'A date from year, month and day (overflow rolls over).', 'Ein Datum aus Jahr, Monat und Tag (Überlauf wird übertragen).', '=DATE(2026; 10; 3)', (a) => {
    let y = int(a[0])
    const m = int(a[1])
    const d = int(a[2])
    if (isErr(y)) return y
    if (isErr(m)) return m
    if (isErr(d)) return d
    if (y >= 0 && y < 1900) y += 1900
    if (y < 0 || y > 9999) return err('#NUM!', 'year out of range')
    const out = dateSerial(y, m, d)
    return out < 0 ? err('#NUM!') : out
  }, { keywords: 'DATUM', returns: 'date' }),
  def('YEAR', 'date', [DATE_ARG('date')], 'The year of a date.', 'Das Jahr eines Datums.', '=YEAR(A1)', (a) => {
    const x = serial(a[0])
    return isErr(x) ? x : ymd(x).y
  }, { keywords: 'JAHR' }),
  def('MONTH', 'date', [DATE_ARG('date')], 'The month of a date (1–12).', 'Der Monat eines Datums (1–12).', '=MONTH(A1)', (a) => {
    const x = serial(a[0])
    return isErr(x) ? x : ymd(x).m
  }, { keywords: 'MONAT' }),
  def('DAY', 'date', [DATE_ARG('date')], 'The day of the month (1–31).', 'Der Tag im Monat (1–31).', '=DAY(A1)', (a) => {
    const x = serial(a[0])
    return isErr(x) ? x : ymd(x).d
  }, { keywords: 'TAG' }),
  def('WEEKDAY', 'date', [DATE_ARG('date'), arg('type', 'number', { optional: true })], 'Day of the week: type 1 = Sunday 1 … Saturday 7, 2 = Monday 1 … Sunday 7, 3 = Monday 0 … Sunday 6.', 'Wochentag: Typ 1 = Sonntag 1 … Samstag 7, 2 = Montag 1 … Sonntag 7, 3 = Montag 0 … Sonntag 6.', '=WEEKDAY(A1; 2)', (a) => {
    const x = serial(a[0])
    const t = int(a[1], 1)
    if (isErr(x)) return x
    if (isErr(t)) return t
    const wd = ymd(x).wd
    if (t === 1) return wd + 1
    if (t === 2) return ((wd + 6) % 7) + 1
    if (t === 3) return (wd + 6) % 7
    return err('#NUM!', 'type must be 1, 2 or 3')
  }, { keywords: 'WOCHENTAG weekday day of week' }),
  def('EDATE', 'date', [DATE_ARG('start_date'), arg('months', 'number')], 'The same day a number of months later (or earlier).', 'Derselbe Tag einige Monate später (oder früher).', '=EDATE(A1; 3)', (a) => {
    const x = serial(a[0])
    const m = int(a[1])
    if (isErr(x)) return x
    if (isErr(m)) return m
    return addMonths(x, m)
  }, { keywords: 'EDATUM months monate', returns: 'date' }),
  def('EOMONTH', 'date', [DATE_ARG('start_date'), arg('months', 'number')], 'The last day of the month, a number of months away.', 'Der letzte Tag des Monats, einige Monate entfernt.', '=EOMONTH(A1; 0)', (a) => {
    const x = serial(a[0])
    const m = int(a[1])
    if (isErr(x)) return x
    if (isErr(m)) return m
    const { y, m: mo } = ymd(x)
    const total = y * 12 + (mo - 1) + m
    const ny = Math.floor(total / 12)
    const nm = (total % 12) + 1
    return dateSerial(ny, nm, daysIn(ny, nm))
  }, { keywords: 'MONATSENDE end of month', returns: 'date' }),
  def('DATEDIF', 'date', [DATE_ARG('start_date'), DATE_ARG('end_date'), arg('unit', 'text')], 'Difference between two dates: "Y", "M", "D", "MD", "YM" or "YD".', 'Abstand zweier Daten: "Y", "M", "D", "MD", "YM" oder "YD".', '=DATEDIF(A1; B1; "M")', (a) => {
    const x = serial(a[0])
    const y = serial(a[1])
    const u = s(a[2])
    if (isErr(x)) return x
    if (isErr(y)) return y
    if (isErr(u)) return u
    if (x > y) return err('#NUM!', 'the start date is after the end date')
    const p = ymd(x)
    const q = ymd(y)
    let months = (q.y - p.y) * 12 + (q.m - p.m)
    if (q.d < p.d) months--
    switch (u.toUpperCase()) {
      case 'Y':
        return Math.floor(months / 12)
      case 'M':
        return months
      case 'D':
        return Math.floor(y) - Math.floor(x)
      case 'MD': {
        if (q.d >= p.d) return q.d - p.d
        const pm = q.m === 1 ? 12 : q.m - 1
        const py = q.m === 1 ? q.y - 1 : q.y
        return daysIn(py, pm) - p.d + q.d
      }
      case 'YM':
        return months % 12
      case 'YD': {
        let start = dateSerial(q.y, p.m, Math.min(p.d, daysIn(q.y, p.m)))
        if (start > Math.floor(y)) start = dateSerial(q.y - 1, p.m, Math.min(p.d, daysIn(q.y - 1, p.m)))
        return Math.floor(y) - start
      }
    }
    return err('#NUM!', 'unit must be Y, M, D, MD, YM or YD')
  }, { keywords: 'difference abstand alter age dauer' }),
  def('NETWORKDAYS', 'date', [DATE_ARG('start_date'), DATE_ARG('end_date'), arg('holidays', 'range', { optional: true })], 'Working days (Monday–Friday) between two dates, both included, minus holidays.', 'Arbeitstage (Montag–Freitag) zwischen zwei Daten, beide eingeschlossen, abzüglich Feiertagen.', '=NETWORKDAYS(A1; B1)', (a, ctx) => {
    const x = serial(a[0])
    const y = serial(a[1])
    if (isErr(x)) return x
    if (isErr(y)) return y
    const holidays = new Set<number>()
    if (a[2] !== undefined) {
      for (const c of isMulti(a[2]) ? cellsOf(a[2]) : [a[2] as never]) {
        if (isErr(c)) return c
        if (typeof c === 'number') holidays.add(Math.floor(c))
      }
    }
    const from = Math.floor(Math.min(x, y))
    const to = Math.floor(Math.max(x, y))
    if (to - from > 100_000) return err('#NUM!', 'range too long')
    ctx.tick((to - from) >> 4)
    let count = 0
    for (let d = from; d <= to; d++) {
      const wd = new Date(EPOCH + d * DAY).getUTCDay()
      if (wd !== 0 && wd !== 6 && !holidays.has(d)) count++
    }
    return x > y ? -count : count
  }, { keywords: 'NETTOARBEITSTAGE workdays arbeitstage business days' }),
]
