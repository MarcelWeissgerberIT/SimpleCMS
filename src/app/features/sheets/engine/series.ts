/**
 * AutoFill (fill handle, "Fill series"): what the cells after — or before — a seed continue with.
 *
 *  - numbers: one is copied (the alternate mode, Ctrl-drag, counts up by 1), several follow their
 *    linear trend (1, 2 → 3, 4 …; 1, 2, 4 → the best-fit line, like Excel)
 *  - dates: +1 day; several follow their step — whole months / years month-end aware
 *    (Jan 31, Feb 28 → Mar 31), anything else in days
 *  - weekday and month names, English and German, short and long ("Mon", "Montag", "Jan",
 *    "Januar") cycle on, keeping the case ("MON" → "TUE")
 *  - text ending in a number ("Item 1", "Q1", "Room 007") counts up, keeping zero padding
 *  - formulas: copied with relative references shifted by the distance (absolute ones kept)
 *  - other text, booleans, blanks: repeated
 *
 * A seed mixing kinds repeats as a pattern (formulas shifted; names and numbered text advance
 * one step per round). Pure: raw inputs in, raw inputs out — formats travel with their cell.
 */
import type { CellFormat } from './format'
import { literal } from './input'
import { shiftFormula } from './adjust'
import { DAY, EPOCH, numberText } from './values'

/** Anything with a raw input and a format (the block's SheetCell). */
export interface FillCell {
  v?: string
  fmt?: CellFormat
}

/**
 * auto: the fill handle · alt: Ctrl / ⌥-drag (one number counts up; series are copied instead)
 * · series: "Fill series" (one number counts up, everything else as auto)
 */
export type FillMode = 'auto' | 'alt' | 'series'

/* ------------------------------------------------------------------ */
/* Name lists                                                          */
/* ------------------------------------------------------------------ */

const NAME_LISTS: Record<'en' | 'de', string[][]> = {
  en: [
    ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  ],
  de: [
    ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'],
    ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
    ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
    ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'],
  ],
}

/** The lists in lookup order: the UI language first ("Jan" → "Feb" → "Mär" in German). */
const listsFor = (lang: 'en' | 'de'): string[][] => (lang === 'de' ? [...NAME_LISTS.de, ...NAME_LISTS.en] : [...NAME_LISTS.en, ...NAME_LISTS.de])

type Case = 'upper' | 'lower' | 'as-is'

function caseOf(s: string): Case {
  if (s.length > 1 && s === s.toLocaleUpperCase() && s !== s.toLocaleLowerCase()) return 'upper'
  if (s === s.toLocaleLowerCase() && s !== s.toLocaleUpperCase()) return 'lower'
  return 'as-is'
}

const applyCase = (s: string, c: Case) => (c === 'upper' ? s.toLocaleUpperCase() : c === 'lower' ? s.toLocaleLowerCase() : s)

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

type Kind =
  | { k: 'empty' }
  | { k: 'formula'; raw: string }
  | { k: 'num'; x: number; pct: boolean }
  | { k: 'date'; x: number; time: boolean; iso: boolean }
  | { k: 'name'; text: string; case: Case }
  | { k: 'textnum'; apos: boolean; head: string; num: number; width: number }
  | { k: 'other' }

const NAME_TEXT = /^\p{L}{2,10}$/u
const TEXT_NUM = /^(.*?)(\d{1,15})$/s

function classify(cell: FillCell | null): Kind {
  const raw = cell?.v ?? ''
  if (!raw) return { k: 'empty' }
  if (raw[0] === '=' && raw.length > 1) return { k: 'formula', raw }
  const lit = literal(raw, cell?.fmt?.type)
  const v = lit.value
  if (typeof v === 'number') {
    if (lit.hint === 'date' || lit.hint === 'datetime') return { k: 'date', x: v, time: lit.hint === 'datetime', iso: true }
    if (cell?.fmt?.type === 'date') return { k: 'date', x: v, time: v % 1 !== 0, iso: false }
    return { k: 'num', x: v, pct: lit.hint === 'percent' }
  }
  if (typeof v !== 'string' || !v) return { k: 'other' }
  const t = v.trim()
  if (NAME_TEXT.test(t)) return { k: 'name', text: t, case: caseOf(t) }
  const m = TEXT_NUM.exec(v)
  // a number kept as text ("007" in a text cell, "'007") counts up too, padding kept
  if (m) return { k: 'textnum', apos: raw[0] === "'", head: m[1], num: Number(m[2]), width: m[2].length }
  return { k: 'other' }
}

/** The list holding every name (case-insensitive), the UI language's lists first. */
function nameList(names: string[], lang: 'en' | 'de'): string[] | null {
  const lower = names.map((n) => n.toLocaleLowerCase())
  return listsFor(lang).find((list) => lower.every((n) => list.some((x) => x.toLocaleLowerCase() === n))) ?? null
}

const indexIn = (list: string[], name: string) => list.findIndex((x) => x.toLocaleLowerCase() === name.toLocaleLowerCase())

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

const mod = (a: number, n: number) => ((a % n) + n) % n
/** Float noise off (0.1 + 0.2 → 0.3). */
const clean = (x: number) => Number(x.toPrecision(15))

/** Least-squares line through (0, y0), (1, y1) … → value at position p. */
function trend(ys: number[]): (p: number) => number {
  const n = ys.length
  const mx = (n - 1) / 2
  const my = ys.reduce((s, y) => s + y, 0) / n
  let sxy = 0
  let sxx = 0
  ys.forEach((y, x) => {
    sxy += (x - mx) * (y - my)
    sxx += (x - mx) ** 2
  })
  const slope = sxx ? sxy / sxx : 0
  return (p) => clean(my + slope * (p - mx))
}

/** The common difference of a sequence, or null when the steps differ. */
function stepOf(xs: number[]): number | null {
  const d = clean(xs[1] - xs[0])
  for (let i = 2; i < xs.length; i++) if (clean(xs[i] - xs[i - 1]) !== d) return null
  return d
}

/* dates */

function ymd(serial: number) {
  const dt = new Date(EPOCH + Math.floor(serial) * DAY)
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() }
}
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const serial = (y: number, m: number, d: number) => Math.round((Date.UTC(y, m - 1, d) - EPOCH) / DAY)
const isMonthEnd = (s: number) => {
  const p = ymd(s)
  return p.d === daysIn(p.y, p.m)
}

/** `start` moved by whole months; month ends stay month ends when `ends`, else the day is clipped. */
function addMonths(start: number, months: number, ends: boolean): number {
  const { y, m, d } = ymd(start)
  const total = y * 12 + (m - 1) + months
  const ny = Math.floor(total / 12)
  const nm = mod(total, 12) + 1
  const last = daysIn(ny, nm)
  return serial(ny, nm, ends ? last : Math.min(d, last)) + (start - Math.floor(start))
}

/** Calendar months from a to b (the days ignored). */
function monthDiff(a: number, b: number): number {
  const p = ymd(a)
  const q = ymd(b)
  return (q.y - p.y) * 12 + (q.m - p.m)
}

/**
 * Date series: whole months / years when every date is the first one moved by a multiple of
 * the step (days clipped to short months; month ends kept when every seed is one), else days.
 */
function dateSeries(xs: number[]): (p: number) => number {
  const m = monthDiff(xs[0], xs[1])
  if (m !== 0) {
    const ends = xs.every(isMonthEnd)
    if (xs.every((x, i) => Math.abs(addMonths(xs[0], m * i, ends) - x) < 1e-9)) return (p) => addMonths(xs[0], m * p, ends)
  }
  const step = stepOf(xs)
  if (step !== null) return (p) => clean(xs[0] + step * p)
  const line = trend(xs)
  const whole = xs.every((x) => x % 1 === 0)
  return (p) => (whole ? Math.round(line(p)) : line(p))
}

/* ------------------------------------------------------------------ */
/* Output                                                              */
/* ------------------------------------------------------------------ */

const pad2 = (n: number) => String(n).padStart(2, '0')

function dateRaw(x: number, time: boolean, iso: boolean): string {
  if (!iso) return numberText(clean(x))
  const { y, m, d } = ymd(x)
  if (y < 1 || y > 9999) return numberText(clean(x))
  const date = `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`
  if (!time) return date
  const mins = Math.round((x - Math.floor(x)) * 1440)
  return `${date} ${pad2(Math.floor(mins / 60) % 24)}:${pad2(mins % 60)}`
}

const numRaw = (x: number, pct: boolean) => (pct ? `${numberText(clean(x * 100))}%` : numberText(clean(x)))

const textNumRaw = (t: Extract<Kind, { k: 'textnum' }>, n: number) => `${t.apos ? "'" : ''}${t.head}${String(Math.abs(n)).padStart(t.width, '0')}`

/* ------------------------------------------------------------------ */
/* Lines                                                               */
/* ------------------------------------------------------------------ */

/**
 * One line of a fill: a column filled down / up or a row filled right / left.
 *
 * `seed`: the source cells in line order. `at`: the positions to produce, relative to the seed's
 * first cell (n, n + 1 … forward; -1, -2 … backward). `vertical`: formulas shift rows (else
 * columns) by the distance from the seed cell they repeat. Returns one cell (or null = blank)
 * per position; formats come from the seed cell repeated there.
 */
export function fillLine<T extends FillCell>(seed: Array<T | null>, at: number[], vertical: boolean, mode: FillMode = 'auto', lang: 'en' | 'de' = 'en'): Array<T | null> {
  const n = seed.length
  if (!n) return at.map(() => null)
  const kinds = seed.map(classify)
  const same = kinds.every((k) => k.k === kinds[0].k)
  const first = kinds[0]
  const withV = (src: T | null, v: string): T | null => (src ? ({ ...src, v } as T) : null)
  /** the seed cell repeating at position p */
  const srcAt = (p: number) => mod(p, n)

  // one kind throughout: a real series (Ctrl-drag copies, except a single number: that counts up)
  let value: ((p: number) => string) | null = null
  if (same && (mode !== 'alt' || (n === 1 && first.k === 'num'))) {
    if (first.k === 'num') {
      const xs = kinds.map((k) => (k as Extract<Kind, { k: 'num' }>).x)
      const pct = (kinds as Array<Extract<Kind, { k: 'num' }>>).every((k) => k.pct)
      if (n === 1) {
        if (mode !== 'auto') value = (p) => numRaw(xs[0] + (pct ? 0.01 : 1) * p, pct)
      } else {
        const line = trend(xs)
        value = (p) => numRaw(line(p), pct)
      }
    } else if (first.k === 'date') {
      const ds = kinds as Array<Extract<Kind, { k: 'date' }>>
      const series = n === 1 ? (p: number) => ds[0].x + p : dateSeries(ds.map((d) => d.x))
      value = (p) => dateRaw(series(p), ds[0].time, ds[0].iso)
    } else if (first.k === 'name') {
      const names = kinds as Array<Extract<Kind, { k: 'name' }>>
      const list = nameList(names.map((x) => x.text), lang)
      if (list) {
        const idx = names.map((x) => indexIn(list, x.text))
        const steps = idx.slice(1).map((x, i) => mod(x - idx[i], list.length))
        const step = n === 1 ? 1 : steps.every((s) => s === steps[0]) && steps[0] !== 0 ? steps[0] : null
        const c = names[n - 1].case
        if (step !== null) value = (p) => applyCase(list[mod(idx[0] + step * p, list.length)], c)
      }
    } else if (first.k === 'textnum') {
      const tn = kinds as Array<Extract<Kind, { k: 'textnum' }>>
      if (tn.every((x) => x.head === tn[0].head)) {
        const nums = tn.map((x) => x.num)
        const step = n === 1 ? 1 : stepOf(nums)
        const line = step === null ? trend(nums) : null
        value = (p) => textNumRaw(tn[n - 1], step !== null ? nums[0] + step * p : Math.round(line!(p)))
      }
    }
  }
  if (value) {
    const fn = value
    return at.map((p) => withV(seed[srcAt(p)] ?? ({} as T), fn(p)))
  }

  // a pattern: repeat the seed; formulas shift, names and numbered text advance a step per round
  return at.map((p) => {
    const j = srcAt(p)
    const src = seed[j]
    const k = kinds[j]
    if (!src) return null
    const round = Math.floor(p / n)
    if (k.k === 'formula') return withV(src, vertical ? shiftFormula(k.raw, p - j, 0) : shiftFormula(k.raw, 0, p - j))
    if (mode === 'alt') return { ...src }
    if (k.k === 'textnum') return withV(src, textNumRaw(k, k.num + round))
    if (k.k === 'name' && !same) {
      const list = nameList([k.text], lang)
      if (list) return withV(src, applyCase(list[mod(indexIn(list, k.text) + round, list.length)], k.case))
    }
    return { ...src }
  })
}
