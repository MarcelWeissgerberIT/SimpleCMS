/**
 * ⌘K query language — pure (no store, no DOM, no imports): words and filter tokens.
 *
 *   relaunch status:done tag:"key account" in:projects is:favorite @alex edited:7d has:owner -is:row by:sam
 *
 * - `<property>:<value>` any property by name (case- and accent-insensitive; spaces in names may be typed
 *   as `-` or `_`, or the name quoted: `"days left":>3`), values in quotes when they hold spaces;
 *   `>` `<` `>=` `<=` for numbers and dates
 * - `in:<database or page>` · `is:favorite|row|page|database|private` · `@<person>` (person properties) ·
 *   `by:<person|agent>` (who created / last edited a page) · `edited:` / `created:` dates (`today`,
 *   `yesterday`, `7d`, `+7d`, `week`, `month`, `2026-09-01`, `>2026-09-01` …) · `has:<property>` (not empty)
 * - German aliases: `ist:favorit|zeile|seite|datenbank|privat`, `geändert:heute|7t|30t`, `erstellt:`, `hat:`, `von:`
 * - a leading `-` negates a filter
 * - a quoted key is always a property (`"Created":2026` — a property named like a keyword)
 *
 * With a vocabulary (the workspace's property names) only known keys make filters: `Re:`, `foo:bar` and
 * "Projects: New entry" stay text. A `key:` with nothing after it is unfinished while it is typed and text
 * once a space follows. The palette turns a complete filter followed by a space into a chip (takeFilters);
 * the token being typed at the end stays in the input and counts already (live results), its suggestions
 * come from `partial`. What a filter matches is decided by filters.ts against the workspace.
 *
 * No RegExp is ever built from the input; values are compared with includes / startsWith on folded text.
 */

export type Cmp = '=' | '>' | '<' | '>=' | '<='

export type FilterKind = 'prop' | 'in' | 'is' | 'person' | 'date' | 'has' | 'by'

export interface Filter {
  kind: FilterKind
  /** the token as typed (chips, removal) */
  raw: string
  /** a leading "-": everything the filter does NOT match */
  neg: boolean
  /** prop / has: the property name as typed; date: 'edited' | 'created'; in / is / by: the keyword; person: '' */
  key: string
  /** the value as typed, without quotes (prop / in / is / person / date / by; has: '') */
  value: string
  /** the key was quoted: a property, never a keyword */
  quoted?: true
  /** the token being typed at the end of the input (no space after it yet) */
  open?: true
}

export interface PartialToken {
  /** the token as typed so far */
  raw: string
  /** where it starts in the input */
  start: number
  /** `key:` typed (value suggestions) — null for a bare word or `@…` */
  key: string | null
  /** the value part (after `key:` or `@`), or the bare word */
  value: string
  /** `@…` */
  person: boolean
  neg: boolean
  /** the key was quoted */
  quoted: boolean
}

export interface ParsedQuery {
  /** plain words (a quoted phrase stays one word; tokens that look like filters but are none stay as typed) */
  words: string[]
  /** words joined: the keyword query */
  text: string
  /** filter tokens, in order — the one being typed at the end too (`open`) */
  filters: Filter[]
  /** the token at the end of the input while it is typed (no space after it yet) */
  partial: PartialToken | null
  /** words and filters in the order they were typed */
  items: Array<string | Filter>
}

/** Which keys are property names (exact, folded) — a query without one parses every `key:` as a filter. */
export interface QueryVocab {
  isProp(key: string): boolean
}

/** Longer tokens are never filters. */
export const MAX_TOKEN = 200
/** At most this many chips. */
export const MAX_CHIPS = 12

interface Token {
  raw: string
  start: number
  end: number
  /** every quote it opened is closed */
  closed: boolean
}

const QUOTES = new Set(['"', '“', '”', '„'])
const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ' '

function tokenize(input: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < input.length) {
    while (i < input.length && isSpace(input[i])) i++
    if (i >= input.length) break
    const start = i
    let inQuote = false
    while (i < input.length && (inQuote || !isSpace(input[i]))) {
      if (QUOTES.has(input[i])) inQuote = !inQuote
      i++
    }
    out.push({ raw: input.slice(start, i), start, end: i, closed: !inQuote })
  }
  return out
}

const unquote = (s: string) => {
  let v = s
  if (v && QUOTES.has(v[0])) v = v.slice(1)
  if (v && QUOTES.has(v[v.length - 1])) v = v.slice(0, -1)
  return v.trim()
}

/** Lower-case, no spaces / dashes / underscores: how keywords are compared. */
export const normKey = (s: string) => s.toLowerCase().replace(/[\s_\-.]+/g, '')

/**
 * How names and values are compared: lower case, no accents (ä → a, ß → ss), no spaces, dashes,
 * underscores, dots, colons or quotes — "Days left", `days-left` and `"days left"` are the same key.
 */
export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[\s_\-.:"“”„']+/g, '')

/** Keywords (normalized) → filter kind; everything else before a colon is a property name. */
const KEYWORDS: Record<string, 'in' | 'is' | 'has' | 'edited' | 'created' | 'by'> = {
  in: 'in',
  is: 'is',
  ist: 'is',
  has: 'has',
  hat: 'has',
  edited: 'edited',
  updated: 'edited',
  changed: 'edited',
  modified: 'edited',
  geändert: 'edited',
  geaendert: 'edited',
  bearbeitet: 'edited',
  created: 'created',
  erstellt: 'created',
  angelegt: 'created',
  by: 'by',
  von: 'by',
}

export const keywordOf = (key: string) => KEYWORDS[normKey(key)] ?? null

/** The keyword spellings offered as suggestions, per language. */
export const KEYWORD_NAMES: Record<'en' | 'de', Array<{ key: string; kind: 'in' | 'is' | 'has' | 'edited' | 'created' | 'by' }>> = {
  en: [
    { key: 'in', kind: 'in' },
    { key: 'is', kind: 'is' },
    { key: 'has', kind: 'has' },
    { key: 'edited', kind: 'edited' },
    { key: 'created', kind: 'created' },
    { key: 'by', kind: 'by' },
  ],
  de: [
    { key: 'in', kind: 'in' },
    { key: 'ist', kind: 'is' },
    { key: 'hat', kind: 'has' },
    { key: 'geändert', kind: 'edited' },
    { key: 'erstellt', kind: 'created' },
    { key: 'von', kind: 'by' },
  ],
}

/** `key:` — a letter first; a quoted key may hold spaces. */
const KEY_RE = /^[\p{L}_][\p{L}\p{N}_\-.]*$/u

interface Parts {
  neg: boolean
  key: string | null
  value: string
  person: boolean
  quoted: boolean
}

/** Split a token into `-`, key and value — null when it is no filter form (a plain word). */
function splitFilter(raw: string): Parts | null {
  if (raw.length > MAX_TOKEN) return null
  let s = raw
  let neg = false
  if (s.length > 1 && s[0] === '-' && (s[1] === '@' || /[\p{L}"“„_]/u.test(s[1]))) {
    neg = true
    s = s.slice(1)
  }
  if (s[0] === '@') return { neg, key: null, value: unquote(s.slice(1)), person: true, quoted: false }
  let key: string
  let rest: string
  let quoted = false
  if (QUOTES.has(s[0])) {
    // "days left":>3 — the closing quote by code unit (a key may hold emoji: surrogate pairs)
    let close = -1
    for (let i = 1; i < s.length; i++)
      if (QUOTES.has(s[i])) {
        close = i
        break
      }
    if (close < 0 || s[close + 1] !== ':') return null
    key = s.slice(1, close).trim()
    rest = s.slice(close + 2)
    if (!key) return null
    quoted = true
  } else {
    const colon = s.indexOf(':')
    if (colon <= 0) return null
    key = s.slice(0, colon)
    rest = s.slice(colon + 1)
    if (!KEY_RE.test(key)) return null
  }
  // https://… and friends are words
  if (rest.startsWith('//')) return null
  return { neg, key, value: unquote(rest), person: false, quoted }
}

/** A filter, 'word' (looks like one but is text), or null (unfinished: `status:`, `@` while typed). */
function toFilter(raw: string, parts: Parts, vocab: QueryVocab | undefined): Filter | 'word' | null {
  if (parts.person) return parts.value ? { kind: 'person', raw, neg: parts.neg, key: '', value: parts.value } : null
  const key = parts.key ?? ''
  const known = (k: string) => !vocab || vocab.isProp(k)
  let kw = parts.quoted ? null : keywordOf(key)
  // by: / von: — a property of that name wins (the German Mails database has "Von")
  if (kw === 'by' && vocab?.isProp(key)) kw = null
  if (kw === 'has') {
    if (!parts.value) return null
    return known(parts.value) ? { kind: 'has', raw, neg: parts.neg, key: parts.value, value: '' } : 'word'
  }
  if (!kw && !known(key)) return 'word'
  if (!parts.value) return null
  const quoted = parts.quoted ? ({ quoted: true } as const) : {}
  if (kw === 'edited' || kw === 'created') return { kind: 'date', raw, neg: parts.neg, key: kw, value: parts.value }
  if (kw === 'in' || kw === 'is' || kw === 'by') return { kind: kw, raw, neg: parts.neg, key, value: parts.value }
  return { kind: 'prop', raw, neg: parts.neg, key, value: parts.value, ...quoted }
}

/** Parse the whole input: words, filters, and the token being typed at the end. */
export function parseQuery(input: string, vocab?: QueryVocab): ParsedQuery {
  const tokens = tokenize(input)
  const words: string[] = []
  const filters: Filter[] = []
  const items: Array<string | Filter> = []
  const word = (w: string) => {
    words.push(w)
    items.push(w)
  }
  let partial: PartialToken | null = null
  const endsOpen = input.length > 0 && !isSpace(input[input.length - 1])
  tokens.forEach((tok, i) => {
    // still typing: no space after it yet, or inside a quote
    const last = i === tokens.length - 1 && (endsOpen || !tok.closed)
    const parts = splitFilter(tok.raw)
    if (last) {
      partial = parts
        ? { raw: tok.raw, start: tok.start, key: parts.person ? null : parts.key, value: parts.value, person: parts.person, neg: parts.neg, quoted: parts.quoted }
        : tok.raw.length > 1 && tok.raw[0] === '-'
          ? { raw: tok.raw, start: tok.start, key: null, value: unquote(tok.raw.slice(1)), person: false, neg: true, quoted: false }
          : { raw: tok.raw, start: tok.start, key: null, value: unquote(tok.raw), person: false, neg: false, quoted: false }
    }
    if (!parts) {
      const w = unquote(tok.raw)
      if (w) word(w)
      return
    }
    const f = toFilter(tok.raw, parts, vocab)
    if (f === 'word') word(tok.raw)
    else if (f) {
      const filter: Filter = last ? { ...f, open: true } : f
      filters.push(filter)
      items.push(filter)
    }
    // unfinished ("status:" / "@"): neither while it is typed, text once a space follows ("Status: Q3 report")
    else if (!last) word(tok.raw)
  })
  return { words, text: words.join(' '), filters, partial, items }
}

/**
 * The complete filters that are followed by a space (finished typing) and that `accept` takes leave the
 * input as chips; the rest of the input stays as typed, minus those tokens.
 */
export function takeFilters(input: string, accept: (f: Filter) => boolean = () => true, vocab?: QueryVocab): { filters: Filter[]; rest: string } {
  const tokens = tokenize(input)
  const endsOpen = input.length > 0 && !isSpace(input[input.length - 1])
  const filters: Filter[] = []
  const cut: Array<[number, number]> = []
  tokens.forEach((tok, i) => {
    if ((i === tokens.length - 1 && endsOpen) || !tok.closed) return
    const parts = splitFilter(tok.raw)
    const f = parts && toFilter(tok.raw, parts, vocab)
    if (!f || f === 'word' || !accept(f)) return
    filters.push(f)
    cut.push([tok.start, tok.end])
  })
  if (!cut.length) return { filters, rest: input }
  let rest = ''
  let pos = 0
  for (const [a, b] of cut) {
    rest += input.slice(pos, a)
    pos = b
  }
  rest += input.slice(pos)
  // one space between what is left; nothing in front
  rest = rest.replace(/\s{2,}/g, ' ').replace(/^\s+/, '')
  return { filters, rest }
}

/** A token for the input: `key:value`, the value quoted when it holds a space or a quote. */
export function tokenText(key: string, value: string): string {
  const v = /[\s"“”„]/.test(value) ? `"${value.replace(/["“”„]/g, '')}"` : value
  return key === '@' ? `@${v}` : `${key}:${v}`
}

/** A property name as a key one can type: lower case, spaces → "-". */
export const keyFor = (name: string) => name.trim().toLowerCase().replace(/\s+/g, '-').replace(/["“”„:]/g, '')

/** The key to insert for a property: `publish-date`, or `"Name"` quoted when it cannot be typed bare. */
export function keyText(name: string): string {
  const k = keyFor(name)
  if (k && KEY_RE.test(k) && !keywordOf(k)) return k
  return `"${name.replace(/["“”„]/g, '').trim()}"`
}

/** "me" in both languages (`@me`, `owner:ich`). */
export const isMe = (value: string) => ['me', 'ich', 'mich', 'mir'].includes(value.trim().toLowerCase())

const GROUP_ALIASES: Array<['todo' | 'in_progress' | 'done', string[]]> = [
  ['done', ['done', 'complete', 'completed', 'finished', 'closed', 'erledigt', 'abgeschlossen', 'fertig']],
  ['in_progress', ['inprogress', 'doing', 'started', 'active', 'wip', 'inarbeit', 'lauft', 'begonnen']],
  ['todo', ['todo', 'open', 'notstarted', 'backlog', 'offen', 'zuerledigen', 'geplant']],
]

/** A status group by one of its names (both languages): `done`, `in-progress`, `todo`, `erledigt` … */
export function statusGroupOf(value: string): 'todo' | 'in_progress' | 'done' | null {
  const v = fold(value)
  if (!v) return null
  for (const [group, names] of GROUP_ALIASES) if (names.includes(v)) return group
  return null
}

/* ------------------------------------------------------------------ */
/* Values                                                              */
/* ------------------------------------------------------------------ */

/** Split a leading comparison off a value: ">=5" → ['>=', '5']. */
export function splitCmp(value: string): [Cmp, string] {
  const m = value.match(/^(>=|<=|=>|=<|>|<|=)\s*(.*)$/)
  if (!m) return ['=', value.trim()]
  const op = m[1] === '=>' ? '>=' : m[1] === '=<' ? '<=' : (m[1] as Cmp)
  return [op, m[2].trim()]
}

/**
 * A number as typed: "18000", "18,000", "1,5", "60%", "€ 4.000" → { n, percent }.
 * - `lang` 'de': "." followed by exactly three digits (one or more groups) separates thousands
 *   ("18.000", "1.250.000"), "," is the decimal mark; 'en': "," thousands, "." decimal.
 * - no `lang` (or marks that do not fit the language): both marks present → the later one is the decimal
 *   mark; "18,000" (groups of three after commas) is 18000, "1,5" is 1.5; a dot is a decimal mark unless
 *   two or more groups follow it ("1.250.000") — so "18.000" is 18 here.
 */
export function parseNumber(value: string, lang?: 'en' | 'de'): { n: number; percent: boolean } | null {
  let s = value.replace(/[\s€$£ ]/g, '')
  const percent = s.endsWith('%')
  if (percent) s = s.slice(0, -1)
  if (!s || !/^[+-]?[\d.,]+$/.test(s)) return null
  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  // the language's own marks first; something else ("1,5" in English, "18.5" in German): the heuristics
  if (lang === 'de' && (lastDot < 0 || /^[+-]?\d{1,3}(\.\d{3})+(,\d*)?$/.test(s))) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (lang === 'en' && (lastComma < 0 || /^[+-]?\d{1,3}(,\d{3})+(\.\d*)?$/.test(s))) {
    s = s.replace(/,/g, '')
  } else if (lastDot >= 0 && lastComma >= 0) {
    // the later one is the decimal mark
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (lastComma >= 0) {
    s = /^[+-]?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.')
  } else if (lastDot >= 0 && /^[+-]?\d{1,3}(\.\d{3}){2,}$/.test(s)) {
    s = s.replace(/\./g, '')
  }
  if ((s.match(/\./g) ?? []).length > 1) return null
  const n = Number(s)
  return Number.isFinite(n) ? { n, percent } : null
}

/** Compare with an operator. */
export function compare(a: number, cmp: Cmp, b: number): boolean {
  switch (cmp) {
    case '>':
      return a > b
    case '<':
      return a < b
    case '>=':
      return a >= b
    case '<=':
      return a <= b
    default:
      return a === b
  }
}

const TRUE = new Set(['yes', 'y', 'true', '1', 'x', 'checked', 'done', 'on', '✓', '✔', 'ja', 'j', 'an', 'erledigt', 'wahr', 'abgehakt'])
const FALSE = new Set(['no', 'n', 'false', '0', 'unchecked', 'open', 'off', 'nein', 'aus', 'offen', 'falsch'])

/** A checkbox value as typed (both languages), null when it is neither. */
export function parseBool(value: string): boolean | null {
  const v = value.trim().toLowerCase()
  if (TRUE.has(v)) return true
  if (FALSE.has(v)) return false
  return null
}

export type IsValue = 'favorite' | 'row' | 'page' | 'database' | 'private'

const IS_ALIASES: Array<[IsValue, string[]]> = [
  ['favorite', ['favorite', 'favourite', 'favorites', 'favourites', 'fav', 'starred', 'star', 'favorit', 'favoriten']],
  ['row', ['row', 'rows', 'entry', 'entries', 'zeile', 'zeilen', 'eintrag', 'einträge', 'eintraege']],
  ['page', ['page', 'pages', 'seite', 'seiten']],
  ['database', ['database', 'databases', 'db', 'datenbank', 'datenbanken']],
  ['private', ['private', 'privat']],
]

/** `is:` values (prefix of an alias, 2+ letters), null when unknown. */
export function parseIs(value: string): IsValue | null {
  const v = value.trim().toLowerCase()
  if (!v) return null
  for (const [kind, names] of IS_ALIASES) if (names.includes(v)) return kind
  if (v.length < 2) return null
  for (const [kind, names] of IS_ALIASES) if (names.some((n) => n.startsWith(v))) return kind
  return null
}

/** The `is:` values offered as suggestions, per language (private: team workspaces only — suggest.ts). */
export const IS_NAMES: Record<'en' | 'de', Array<[IsValue, string]>> = {
  en: [
    ['favorite', 'favorite'],
    ['page', 'page'],
    ['database', 'database'],
    ['row', 'row'],
    ['private', 'private'],
  ],
  de: [
    ['favorite', 'favorit'],
    ['page', 'seite'],
    ['database', 'datenbank'],
    ['row', 'zeile'],
    ['private', 'privat'],
  ],
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

export interface DateRange {
  /** inclusive, ms (local time) */
  from: number
  /** exclusive, ms */
  to: number
}

const DAY = 86_400_000

const startOfDay = (ms: number) => {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
/** `days` calendar days after the day of `ms` (local time, DST-safe). */
const addDays = (ms: number, days: number) => {
  const d = new Date(startOfDay(ms))
  d.setDate(d.getDate() + days)
  return d.getTime()
}

const UNIT_DAYS: Record<string, number> = { d: 1, t: 1, w: 7, m: 30, y: 365, j: 365 }

/** A window and what `>` / `<` mean for it. */
interface Window {
  start: number
  end: number
  /** a "last N days" window: `>` = longer ago than that */
  past?: boolean
}

function windowOf(v: string, now: number): Window | null {
  const s = v.trim().toLowerCase()
  const today = startOfDay(now)
  if (s === 'today' || s === 'heute') return { start: today, end: addDays(today, 1) }
  if (s === 'yesterday' || s === 'gestern') return { start: addDays(today, -1), end: today }
  if (s === 'tomorrow' || s === 'morgen') return { start: addDays(today, 1), end: addDays(today, 2) }
  if (s === 'week' || s === 'woche') {
    // this ISO week: Monday to Sunday
    const back = (new Date(today).getDay() + 6) % 7
    const monday = addDays(today, -back)
    return { start: monday, end: addDays(monday, 7) }
  }
  if (s === 'month' || s === 'monat') {
    const d = new Date(today)
    return { start: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), end: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() }
  }
  if (s === 'year' || s === 'jahr') {
    const y = new Date(today).getFullYear()
    return { start: new Date(y, 0, 1).getTime(), end: new Date(y + 1, 0, 1).getTime() }
  }
  const rel = s.match(/^([+-]?)(\d{1,4})\s*([dtwmyj])$/)
  if (rel) {
    const days = Number(rel[2]) * UNIT_DAYS[rel[3]]
    if (rel[1] === '+') return { start: today, end: addDays(today, days + 1) }
    return { start: addDays(today, -days), end: addDays(today, 1), past: true }
  }
  let y: number
  let mo: number | null = null
  let d: number | null = null
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  else if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/))) [y, mo, d] = [Number(m[3]), Number(m[2]), Number(m[1])]
  else if ((m = s.match(/^(\d{4})-(\d{1,2})$/))) [y, mo] = [Number(m[1]), Number(m[2])]
  else if ((m = s.match(/^(\d{4})$/))) y = Number(m[1])
  else return null
  if (mo !== null && (mo < 1 || mo > 12)) return null
  if (d !== null && (d < 1 || d > 31)) return null
  const start = new Date(y, (mo ?? 1) - 1, d ?? 1).getTime()
  const end = d !== null ? new Date(y, mo! - 1, d + 1).getTime() : mo !== null ? new Date(y, mo, 1).getTime() : new Date(y + 1, 0, 1).getTime()
  return { start, end }
}

/**
 * A date filter value → the time range it stands for (null: not a date). `today`, `yesterday`,
 * `tomorrow` (heute, gestern, morgen) · `week` / `month` / `year` (woche, monat, jahr: the current one,
 * weeks start on Monday) · `7d` / `7t` = the last 7 days, `+7d` = the next 7 (w weeks, m months, y years) ·
 * `2026-09-01`, `1.9.2026`, `2026-09`, `2026` · with `>` / `<` / `>=` / `<=`: after / before that day,
 * month or year; for "the last N days" `>` means longer ago than that.
 */
export function dateRange(value: string, now = Date.now()): DateRange | null {
  const [cmp, v] = splitCmp(value)
  const w = windowOf(v, now)
  if (!w) return null
  const ALL = { from: -Infinity, to: Infinity }
  if (w.past) {
    // "edited:>30d": not touched for more than 30 days
    if (cmp === '>' || cmp === '>=') return { ...ALL, to: w.start }
    return { from: w.start, to: Infinity }
  }
  switch (cmp) {
    case '>':
      return { ...ALL, from: w.end }
    case '>=':
      return { ...ALL, from: w.start }
    case '<':
      return { ...ALL, to: w.start }
    case '<=':
      return { ...ALL, to: w.end }
    default:
      return { from: w.start, to: w.end }
  }
}

/** A day "yyyy-mm-dd" or "yyyy-mm-ddTHH:mm" (local) → ms, null when it is not one. */
export function dayMs(iso: string | null | undefined): number | null {
  if (!iso) return null
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0)).getTime()
}

/** Does the span [start, end] (ms; end inclusive, a day's end when it is a day) touch the range? */
export function overlaps(r: DateRange, start: number, end = start): boolean {
  return start < r.to && end >= r.from
}

export { DAY }
