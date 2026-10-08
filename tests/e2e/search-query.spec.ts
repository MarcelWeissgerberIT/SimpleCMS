/**
 * ⌘K query language (shell/palette/query.ts) — pure, run in Node by the Playwright runner (no browser):
 * words vs filters, the vocabulary (only known property names make filters), quoted keys, chips taken
 * out of the input, numbers in both languages, checkbox / is: values and date ranges.
 */
import { test, expect } from '@playwright/test'
import {
  dateRange,
  fold,
  isMe,
  keyText,
  MAX_TOKEN,
  parseBool,
  parseIs,
  parseNumber,
  parseQuery,
  splitCmp,
  statusGroupOf,
  takeFilters,
  tokenText,
  type QueryVocab,
} from '../../src/app/shell/palette/query'

const vocab = (...names: string[]): QueryVocab => ({ isProp: (k) => names.some((n) => fold(n) === fold(k)) })
const pick = (f: { kind: string; neg: boolean; key: string; value: string }) => ({ kind: f.kind, neg: f.neg, key: f.key, value: f.value })

test.describe('⌘K query parser', () => {
  test('the example query: words and eight filters', () => {
    const q = parseQuery('relaunch status:done tag:"key account" in:projects is:favorite @alex edited:7d has:owner -is:row ')
    expect(q.words).toEqual(['relaunch'])
    expect(q.partial).toBeNull()
    expect(q.filters.map(pick)).toEqual([
      { kind: 'prop', neg: false, key: 'status', value: 'done' },
      { kind: 'prop', neg: false, key: 'tag', value: 'key account' },
      { kind: 'in', neg: false, key: 'in', value: 'projects' },
      { kind: 'is', neg: false, key: 'is', value: 'favorite' },
      { kind: 'person', neg: false, key: '', value: 'alex' },
      { kind: 'date', neg: false, key: 'edited', value: '7d' },
      { kind: 'has', neg: false, key: 'owner', value: '' },
      { kind: 'is', neg: true, key: 'is', value: 'row' },
    ])
  })

  test('a partial token only without a trailing space; the one being typed is marked open', () => {
    const typing = parseQuery('brand status:do')
    expect(typing.partial).toMatchObject({ key: 'status', value: 'do', start: 6, person: false })
    expect(typing.filters.map((f) => f.open)).toEqual([true])
    expect(parseQuery('brand status:do ').partial).toBeNull()
    expect(parseQuery('@al').partial).toMatchObject({ person: true, value: 'al', key: null })
    expect(parseQuery('-sta').partial).toMatchObject({ key: null, value: 'sta', neg: true })
  })

  test('the vocabulary: unknown keys stay text, a key with nothing after it is text once a space follows', () => {
    const none = vocab()
    expect(parseQuery('note:x ', none).words).toEqual(['note:x'])
    expect(parseQuery('Re: budget', none).text).toBe('Re: budget')
    expect(parseQuery('https://a.b/c ', none).words).toEqual(['https://a.b/c'])
    expect(parseQuery('10:30 ', none).words).toEqual(['10:30'])
    expect(parseQuery('mailto:x ', none).words).toEqual(['mailto:x'])
    // a known key without a value while it is typed: neither a filter nor a word
    const st = parseQuery('status:', vocab('Status'))
    expect(st.filters).toEqual([])
    expect(st.words).toEqual([])
    // … and text once a space follows ("Status: Q3 report" — a title, not a filter)
    expect(parseQuery('Status: Q3 report', vocab('Status')).text).toBe('Status: Q3 report')
    // prefix matching never makes a filter: "Re:" stays text next to a "Revenue" property
    expect(parseQuery('Re: budget', vocab('Revenue')).text).toBe('Re: budget')
    expect(parseQuery('Re: budget', vocab('Revenue')).filters).toEqual([])
    expect(parseQuery('Projects: New entry', vocab('Status')).text).toBe('Projects: New entry')
    // has: an unknown property is text too
    expect(parseQuery('has:nothing ', vocab('Owner')).words).toEqual(['has:nothing'])
    expect(parseQuery('has:owner ', vocab('Owner')).filters.map(pick)).toEqual([{ kind: 'has', neg: false, key: 'owner', value: '' }])
    // keys with spaces: dashes or quotes
    expect(parseQuery('days-left:>3 ', vocab('Days left')).filters.map(pick)).toEqual([{ kind: 'prop', neg: false, key: 'days-left', value: '>3' }])
  })

  test('quoted keys are properties, never keywords — also with emoji', () => {
    const a = parseQuery('"days left":>3 "in":x "Created":2026 ', vocab('Days left', 'In', 'Created'))
    expect(a.filters.map((f) => ({ ...pick(f), quoted: f.quoted }))).toEqual([
      { kind: 'prop', neg: false, key: 'days left', value: '>3', quoted: true },
      { kind: 'prop', neg: false, key: 'in', value: 'x', quoted: true },
      { kind: 'prop', neg: false, key: 'Created', value: '2026', quoted: true },
    ])
    const rocket = parseQuery('"🚀 Launch":soon ', vocab('🚀 Launch'))
    expect(rocket.filters.map(pick)).toEqual([{ kind: 'prop', neg: false, key: '🚀 Launch', value: 'soon' }])
    expect(parseQuery('„Tage übrig“:>3 ', vocab('Tage übrig')).filters.map(pick)).toEqual([{ kind: 'prop', neg: false, key: 'Tage übrig', value: '>3' }])
  })

  test('German keywords and by: / von: (a property of that name wins)', () => {
    const q = parseQuery('ist:favorit hat:verantwortlich geändert:7t erstellt:heute von:sam ', vocab('Verantwortlich'))
    expect(q.filters.map(pick)).toEqual([
      { kind: 'is', neg: false, key: 'ist', value: 'favorit' },
      { kind: 'has', neg: false, key: 'verantwortlich', value: '' },
      { kind: 'date', neg: false, key: 'edited', value: '7t' },
      { kind: 'date', neg: false, key: 'created', value: 'heute' },
      { kind: 'by', neg: false, key: 'von', value: 'sam' },
    ])
    // the German Mails database has a "Von" property: then von: is that property
    expect(parseQuery('von:anna ', vocab('Von')).filters.map(pick)).toEqual([{ kind: 'prop', neg: false, key: 'von', value: 'anna' }])
  })

  test('takeFilters moves only accepted, complete filters followed by a space', () => {
    expect(takeFilters('brand status:done ', () => true)).toEqual({ filters: [expect.objectContaining({ kind: 'prop', key: 'status', value: 'done' })], rest: 'brand ' })
    // the token at the end without a space stays (it is still being typed)
    expect(takeFilters('status:done @al').rest).toBe('@al')
    expect(takeFilters('status:done @al').filters).toHaveLength(1)
    // an unclosed quote stays
    expect(takeFilters('tag:"key acc ').filters).toEqual([])
    // the predicate decides
    expect(takeFilters('status:nope owner:me ', (f) => f.value !== 'nope')).toEqual({ filters: [expect.objectContaining({ key: 'owner', value: 'me' })], rest: 'status:nope ' })
    // words around keep their order, one space between
    expect(takeFilters('a  status:done   b ').rest).toBe('a b ')
    // with a vocabulary, unknown keys never leave the input
    expect(takeFilters('foo:bar ', () => true, vocab('Status'))).toEqual({ filters: [], rest: 'foo:bar ' })
  })

  test('tokenText quotes values with spaces; keyText makes typeable keys', () => {
    expect(tokenText('status', 'In progress')).toBe('status:"In progress"')
    expect(tokenText('@', 'Anna Lee')).toBe('@"Anna Lee"')
    expect(tokenText('status', 'Done')).toBe('status:Done')
    expect(keyText('Publish date')).toBe('publish-date')
    expect(keyText('In')).toBe('"In"')
    expect(keyText('Autor:in')).toBe('autorin')
    expect(fold('Autor:in')).toBe(fold('autorin'))
  })

  test('splitCmp, parseNumber (both languages), parseBool, parseIs', () => {
    expect(splitCmp('>=5')).toEqual(['>=', '5'])
    expect(splitCmp('=>5')).toEqual(['>=', '5'])
    expect(splitCmp('<3')).toEqual(['<', '3'])
    expect(splitCmp('7')).toEqual(['=', '7'])
    expect(parseNumber('18,000', 'en')).toEqual({ n: 18000, percent: false })
    expect(parseNumber('18.000', 'de')).toEqual({ n: 18000, percent: false })
    expect(parseNumber('1.250.000', 'de')!.n).toBe(1250000)
    expect(parseNumber('18.000', 'en')!.n).toBe(18)
    expect(parseNumber('1,5')!.n).toBe(1.5)
    expect(parseNumber('1,5', 'de')!.n).toBe(1.5)
    expect(parseNumber('60%')).toEqual({ n: 60, percent: true })
    expect(parseNumber('€ 4.000', 'de')!.n).toBe(4000)
    expect(parseNumber('abc')).toBeNull()
    expect(parseNumber('')).toBeNull()
    for (const v of ['yes', 'ja', 'done', 'erledigt']) expect(parseBool(v)).toBe(true)
    for (const v of ['no', 'nein', 'offen']) expect(parseBool(v)).toBe(false)
    expect(parseBool('maybe')).toBeNull()
    expect(parseIs('fav')).toBe('favorite')
    expect(parseIs('zeile')).toBe('row')
    expect(parseIs('privat')).toBe('private')
    expect(parseIs('x')).toBeNull()
  })

  test('date ranges against a fixed now (2026-10-08 12:00 local)', () => {
    const now = new Date(2026, 9, 8, 12, 0).getTime()
    const day = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime()
    expect(dateRange('today', now)).toEqual({ from: day(2026, 10, 8), to: day(2026, 10, 9) })
    expect(dateRange('heute', now)).toEqual({ from: day(2026, 10, 8), to: day(2026, 10, 9) })
    expect(dateRange('yesterday', now)).toEqual({ from: day(2026, 10, 7), to: day(2026, 10, 8) })
    expect(dateRange('7d', now)).toEqual({ from: day(2026, 10, 1), to: Infinity })
    expect(dateRange('7t', now)).toEqual({ from: day(2026, 10, 1), to: Infinity })
    expect(dateRange('>30d', now)).toEqual({ from: -Infinity, to: day(2026, 9, 8) })
    expect(dateRange('+7d', now)).toEqual({ from: day(2026, 10, 8), to: day(2026, 10, 16) })
    expect(dateRange('2026-09', now)).toEqual({ from: day(2026, 9, 1), to: day(2026, 10, 1) })
    expect(dateRange('1.9.2026', now)).toEqual({ from: day(2026, 9, 1), to: day(2026, 9, 2) })
    expect(dateRange('>2026-09-01', now)).toEqual({ from: day(2026, 9, 2), to: Infinity })
    expect(dateRange('<=2026-09', now)).toEqual({ from: -Infinity, to: day(2026, 10, 1) })
    // 2026-10-08 is a Thursday: the week runs Monday 5th to Sunday 11th
    expect(dateRange('week', now)).toEqual({ from: day(2026, 10, 5), to: day(2026, 10, 12) })
    expect(dateRange('month', now)).toEqual({ from: day(2026, 10, 1), to: day(2026, 11, 1) })
    expect(dateRange('jahr', now)).toEqual({ from: day(2026, 1, 1), to: day(2027, 1, 1) })
    expect(dateRange('2026-13', now)).toBeNull()
    expect(dateRange('soon', now)).toBeNull()
  })

  test('fold, statusGroupOf, isMe, NBSP and token length', () => {
    expect(fold('Geändert ß')).toBe('geandertss')
    expect(fold('Days left')).toBe(fold('days-left'))
    expect(statusGroupOf('erledigt')).toBe('done')
    expect(statusGroupOf('in-progress')).toBe('in_progress')
    expect(statusGroupOf('läuft')).toBe('in_progress')
    expect(statusGroupOf('Backlog')).toBe('todo')
    expect(statusGroupOf('review')).toBeNull()
    expect(isMe('ich')).toBe(true)
    expect(isMe('Me')).toBe(true)
    expect(isMe('mira')).toBe(false)
    // a no-break space separates tokens like a space
    expect(parseQuery('brand status:done ', vocab('Status')).words).toEqual(['brand'])
    // overlong tokens are words
    const long = `status:${'x'.repeat(MAX_TOKEN)}`
    expect(parseQuery(`${long} `).filters).toEqual([])
    expect(parseQuery(`${long} `).words).toEqual([long])
  })
})
