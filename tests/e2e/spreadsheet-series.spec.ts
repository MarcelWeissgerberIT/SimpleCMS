/**
 * Spreadsheet AutoFill + AutoComplete unit tests (pure TypeScript, run in Node by the Playwright
 * runner — no browser): series inference of the fill handle (numbers, dates, weekday / month
 * names EN + DE, numbered text, formulas, patterns) and the column entries AutoComplete and
 * "Pick from list" offer.
 */
import { test, expect } from '@playwright/test'
import { columnEntries, completeEntry, fillLine, pickEntries, type FillCell, type FillMode } from '../../src/app/features/sheets/engine'

type Lang = 'en' | 'de'

const seedOf = (vs: string[]): Array<FillCell | null> => vs.map((v) => (v ? { v } : null))

/** The next `count` values after the seed (vertical fill). */
function next(seed: string[], count: number, mode: FillMode = 'auto', lang: Lang = 'en'): string[] {
  const at = Array.from({ length: count }, (_, i) => seed.length + i)
  return fillLine(seedOf(seed), at, true, mode, lang).map((c) => c?.v ?? '')
}

/** The `count` values before the seed (filling up / left), nearest first. */
function before(seed: string[], count: number, mode: FillMode = 'auto', lang: Lang = 'en'): string[] {
  const at = Array.from({ length: count }, (_, i) => -1 - i)
  return fillLine(seedOf(seed), at, true, mode, lang).map((c) => c?.v ?? '')
}

test.describe('fill series: numbers', () => {
  test('one number is copied; Ctrl-drag and Fill series count up', () => {
    expect(next(['7'], 3)).toEqual(['7', '7', '7'])
    expect(next(['7'], 3, 'alt')).toEqual(['8', '9', '10'])
    expect(next(['7'], 2, 'series')).toEqual(['8', '9'])
  })

  test('two or more numbers follow their step (linear trend)', () => {
    expect(next(['1', '2'], 4)).toEqual(['3', '4', '5', '6'])
    expect(next(['10', '8'], 3)).toEqual(['6', '4', '2'])
    expect(next(['0.1', '0.2'], 2)).toEqual(['0.3', '0.4'])
    expect(next(['5', '10', '15'], 2)).toEqual(['20', '25'])
    // not evenly spaced: the best-fit line, like Excel (1, 2, 4 → 5.33, 6.83)
    const [a, b] = next(['1', '2', '4'], 2).map(Number)
    expect(a).toBeCloseTo(5.3333, 3)
    expect(b).toBeCloseTo(6.8333, 3)
    // percentages stay percentages
    expect(next(['10%', '20%'], 2)).toEqual(['30%', '40%'])
  })

  test('Ctrl-drag repeats a series instead; filling up continues backwards', () => {
    expect(next(['1', '2'], 3, 'alt')).toEqual(['1', '2', '1'])
    expect(before(['3', '4'], 3)).toEqual(['2', '1', '0'])
  })
})

test.describe('fill series: dates', () => {
  test('one date: +1 day; two dates: their step', () => {
    expect(next(['2026-10-03'], 3)).toEqual(['2026-10-04', '2026-10-05', '2026-10-06'])
    expect(next(['2026-10-01', '2026-10-08'], 2)).toEqual(['2026-10-15', '2026-10-22'])
    expect(before(['2026-03-01'], 1)).toEqual(['2026-02-28'])
    expect(next(['2026-10-03'], 2, 'alt')).toEqual(['2026-10-03', '2026-10-03'])
  })

  test('whole months and years, month-end aware', () => {
    expect(next(['2026-01-15', '2026-02-15'], 3)).toEqual(['2026-03-15', '2026-04-15', '2026-05-15'])
    expect(next(['2026-01-31', '2026-02-28'], 3)).toEqual(['2026-03-31', '2026-04-30', '2026-05-31'])
    expect(next(['2026-01-31', '2026-03-31'], 2)).toEqual(['2026-05-31', '2026-07-31'])
    expect(next(['2026-01-30', '2026-02-28', '2026-03-30'], 1)).toEqual(['2026-04-30'])
    expect(next(['2024-02-29', '2025-02-28'], 3)).toEqual(['2026-02-28', '2027-02-28', '2028-02-29'])
    expect(next(['2025-10-03', '2026-10-03'], 1)).toEqual(['2027-10-03'])
  })

  test('date-times keep their time step', () => {
    expect(next(['2026-10-03 08:00', '2026-10-03 12:00'], 2)).toEqual(['2026-10-03 16:00', '2026-10-03 20:00'])
  })

  test('a number formatted as a date counts days', () => {
    const out = fillLine([{ v: '46000', fmt: { type: 'date' } }], [1, 2], true)
    expect(out.map((c) => c?.v)).toEqual(['46001', '46002'])
    expect(out[0]?.fmt).toEqual({ type: 'date' })
  })
})

test.describe('fill series: names', () => {
  test('weekdays EN + DE, short and long, cycle on keeping the case', () => {
    expect(next(['Mon'], 3)).toEqual(['Tue', 'Wed', 'Thu'])
    expect(next(['Sat'], 3)).toEqual(['Sun', 'Mon', 'Tue'])
    expect(next(['MON'], 2)).toEqual(['TUE', 'WED'])
    expect(next(['monday'], 1)).toEqual(['tuesday'])
    expect(next(['Montag'], 2)).toEqual(['Dienstag', 'Mittwoch'])
    expect(next(['So'], 2, 'auto', 'de')).toEqual(['Mo', 'Di'])
    expect(next(['Mon', 'Wed'], 2)).toEqual(['Fri', 'Sun'])
    expect(before(['Mon'], 1)).toEqual(['Sun'])
  })

  test('months EN + DE; the UI language decides short names both share', () => {
    expect(next(['Januar'], 2)).toEqual(['Februar', 'März'])
    expect(next(['December'], 2)).toEqual(['January', 'February'])
    expect(next(['Jan'], 2, 'auto', 'en')).toEqual(['Feb', 'Mar'])
    expect(next(['Jan'], 2, 'auto', 'de')).toEqual(['Feb', 'Mär'])
    expect(next(['Dez'], 1, 'auto', 'en')).toEqual(['Jan'])
    expect(next(['Mai'], 1, 'auto', 'en')).toEqual(['Juni'])
    expect(next(['Jan', 'Apr'], 2)).toEqual(['Jul', 'Oct'])
    expect(next(['Mon'], 2, 'alt')).toEqual(['Mon', 'Mon'])
  })

  test('words that are no names are copied', () => {
    expect(next(['Hello'], 2)).toEqual(['Hello', 'Hello'])
  })
})

test.describe('fill series: text, numbered text, patterns', () => {
  test('text ending in a number counts up, padding kept', () => {
    expect(next(['Item 1'], 3)).toEqual(['Item 2', 'Item 3', 'Item 4'])
    expect(next(['Q1'], 2)).toEqual(['Q2', 'Q3'])
    expect(next(['Item 1', 'Item 3'], 2)).toEqual(['Item 5', 'Item 7'])
    expect(next(['Room 007'], 2)).toEqual(['Room 008', 'Room 009'])
    expect(next(["'007"], 1)).toEqual(["'008"])
    expect(next(['Item 1'], 2, 'alt')).toEqual(['Item 1', 'Item 1'])
    expect(before(['Item 2'], 3)).toEqual(['Item 1', 'Item 0', 'Item 1'])
  })

  test('other text and booleans repeat; mixed seeds repeat as a pattern', () => {
    expect(next(['Website relaunch'], 2)).toEqual(['Website relaunch', 'Website relaunch'])
    expect(next(['a', 'b'], 3)).toEqual(['a', 'b', 'a'])
    expect(next(['TRUE'], 1)).toEqual(['TRUE'])
    expect(next(['Item 1', 'x'], 4)).toEqual(['Item 2', 'x', 'Item 3', 'x'])
    expect(next(['1', 'x'], 4)).toEqual(['1', 'x', '1', 'x'])
    expect(next(['a', ''], 3)).toEqual(['a', '', 'a'])
  })

  test('formats travel with the cell they repeat', () => {
    const out = fillLine([{ v: '1', fmt: { type: 'currency', currency: 'EUR' }, b: true } as FillCell & { b: boolean }], [1, 2], true, 'alt')
    expect(out[1]).toEqual({ v: '3', fmt: { type: 'currency', currency: 'EUR' }, b: true })
  })
})

test.describe('fill series: formulas', () => {
  test('relative references shift by the distance, absolute ones stay', () => {
    expect(next(['=A1*2'], 2)).toEqual(['=A2*2', '=A3*2'])
    expect(next(['=$A$1+A1'], 1)).toEqual(['=$A$1+A2'])
    expect(next(['=A$1+$B2'], 1)).toEqual(['=A$1+$B3'])
    expect(before(['=A5'], 1)).toEqual(['=A4'])
    expect(before(['=A1'], 1)).toEqual(['=#REF!'])
    // a seed of two formulas repeats, each shifted from its own cell
    expect(next(['=A1', '=B1'], 2)).toEqual(['=A3', '=B3'])
    // horizontally the columns shift
    expect(fillLine([{ v: '=A1+$A1' }], [1, 2], false).map((c) => c?.v)).toEqual(['=B1+$A1', '=C1+$A1'])
  })
})

test.describe('AutoComplete entries', () => {
  const col = (vs: Record<number, string>, rows = 12) => ({ rows, cells: Object.fromEntries(Object.entries(vs).map(([r, v]) => [`A${Number(r) + 1}`, { v }])) })

  test('the contiguous region around the cell, nearest first, texts only', () => {
    const s = col({ 0: 'Task', 1: 'Website relaunch', 2: 'Webinar', 3: 'Design', 5: 'Web shop', 6: '42', 7: '2026-10-03', 8: '=A1', 9: 'TRUE', 10: 'website RELAUNCH' })
    // A5 (row 4): up Design, Webinar, Website relaunch, Task; down Web shop … (numbers, dates, formulas, booleans skipped)
    expect(columnEntries(s, 4, 0)).toEqual(['Design', 'Web shop', 'Webinar', 'Website relaunch', 'Task'])
    // a blank row ends the region: A13 is not reached from A2
    const t = col({ 0: 'Alpha', 1: 'Beta', 3: 'Gamma' })
    expect(columnEntries(t, 2, 0)).toEqual(['Beta', 'Gamma', 'Alpha'])
    expect(columnEntries(t, 6, 0)).toEqual([])
  })

  test('completion: nearest prefix match, case-insensitive; never numbers, formulas or exact entries', () => {
    const e = ['Design', 'Web shop', 'Webinar', 'Website relaunch', 'Task']
    expect(completeEntry(e, 'Web', 'en')).toBe('Web shop')
    expect(completeEntry(e, 'webs', 'en')).toBe('Website relaunch')
    expect(completeEntry(e, 'D', 'en')).toBe('Design')
    expect(completeEntry(e, '', 'en')).toBeNull()
    expect(completeEntry(e, 'x', 'en')).toBeNull()
    expect(completeEntry(e, '=W', 'en')).toBeNull()
    expect(completeEntry(e, "'W", 'en')).toBeNull()
    expect(completeEntry(['12 apples'], '12', 'en')).toBeNull()
    expect(completeEntry(['2026 plan'], '2026', 'en')).toBeNull()
    expect(completeEntry(['Web', 'Website'], 'web', 'en')).toBeNull()
    expect(completeEntry(['Design'], 'design', 'en')).toBeNull()
  })

  test('pick list: distinct, sorted, the whole column when the region is empty', () => {
    const s = col({ 0: 'beta', 1: 'Alpha', 2: 'alpha', 3: '7', 4: 'Gamma' })
    // the nearest spelling of a duplicate wins; the whole-column fallback reads top-down
    expect(pickEntries(s, 5, 0, 'en')).toEqual(['alpha', 'beta', 'Gamma'])
    expect(pickEntries(s, 9, 0, 'en')).toEqual(['Alpha', 'beta', 'Gamma'])
    const de = col({ 0: 'Zebra', 1: 'Äpfel', 2: 'Birne' })
    expect(pickEntries(de, 3, 0, 'de')).toEqual(['Äpfel', 'Birne', 'Zebra'])
  })
})
