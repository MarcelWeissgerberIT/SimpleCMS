/**
 * One Script — the catalog of names for autocomplete, signature help and the reference: global
 * functions (the language's built-ins and One's library) and the members of each kind of value.
 * Descriptions: i18n `features.script.fn.<name>` (EN + DE).
 */
export type FnGroup = 'one' | 'ui' | 'effect' | 'text' | 'list' | 'number' | 'date' | 'other'

export interface FnInfo {
  name: string
  sig: string
  group: FnGroup
  /** a property (no parentheses) */
  prop?: boolean
}

export const GLOBAL_FUNCTIONS: FnInfo[] = [
  // One
  { name: 'page', sig: 'page(@page | "Parent / Page" | "Title")', group: 'one' },
  { name: 'db', sig: 'db(@database | "Name")', group: 'one' },
  { name: 'create', sig: 'create.page(title: "…", parent: @page, markdown: "…")', group: 'one', prop: true },
  { name: 'trash', sig: 'trash(row | page | query)', group: 'one' },
  { name: 'person', sig: 'person("Name")', group: 'one' },
  { name: 'people', sig: 'people()', group: 'one' },
  { name: 'me', sig: 'me()', group: 'one' },
  // dialogs
  { name: 'modal', sig: 'modal(text, buttons: ["OK", "Cancel"])', group: 'ui' },
  { name: 'confirm', sig: 'confirm(text)', group: 'ui' },
  { name: 'ask', sig: 'ask(text, default: "")', group: 'ui' },
  { name: 'choose', sig: 'choose(text, options)', group: 'ui' },
  { name: 'notify', sig: 'notify(text)', group: 'ui' },
  { name: 'open', sig: 'open(@page)', group: 'ui' },
  { name: 'print', sig: 'print(value, …)', group: 'ui' },
  { name: 'log', sig: 'log(value, …)', group: 'ui' },
  // effects
  { name: 'mail', sig: 'mail.send(to: "…", subject: "…", body: "…", cc: "…")', group: 'effect', prop: true },
  { name: 'claude', sig: 'claude(prompt, context?)', group: 'effect' },
  { name: 'http', sig: 'http.post(url, data)', group: 'effect', prop: true },
  // text
  { name: 'upper', sig: 'upper(text)', group: 'text' },
  { name: 'lower', sig: 'lower(text)', group: 'text' },
  { name: 'trim', sig: 'trim(text)', group: 'text' },
  { name: 'split', sig: 'split(text, separator?)', group: 'text' },
  { name: 'join', sig: 'join(list, separator?)', group: 'text' },
  { name: 'replace', sig: 'replace(text, find, with)', group: 'text' },
  { name: 'contains', sig: 'contains(text | list, value)', group: 'text' },
  { name: 'starts_with', sig: 'starts_with(text, start)', group: 'text' },
  { name: 'ends_with', sig: 'ends_with(text, end)', group: 'text' },
  { name: 'slice', sig: 'slice(text, start, end?)', group: 'text' },
  { name: 'len', sig: 'len(value)', group: 'text' },
  { name: 'text', sig: 'text(value)', group: 'text' },
  { name: 'format', sig: 'format(value, pattern?)', group: 'text' },
  // numbers
  { name: 'round', sig: 'round(number, places?)', group: 'number' },
  { name: 'floor', sig: 'floor(number)', group: 'number' },
  { name: 'ceil', sig: 'ceil(number)', group: 'number' },
  { name: 'abs', sig: 'abs(number)', group: 'number' },
  { name: 'min', sig: 'min(a, b, … | list)', group: 'number' },
  { name: 'max', sig: 'max(a, b, … | list)', group: 'number' },
  { name: 'sum', sig: 'sum(list)', group: 'number' },
  { name: 'avg', sig: 'avg(list)', group: 'number' },
  { name: 'number', sig: 'number(value)', group: 'number' },
  // dates
  { name: 'today', sig: 'today()', group: 'date' },
  { name: 'now', sig: 'now()', group: 'date' },
  { name: 'date', sig: 'date("2026-10-05")', group: 'date' },
  { name: 'datetime', sig: 'datetime("2026-10-05 14:30")', group: 'date' },
  { name: 'days_between', sig: 'days_between(from, to)', group: 'date' },
  { name: 'add_days', sig: 'add_days(date, n)', group: 'date' },
  { name: 'add_months', sig: 'add_months(date, n)', group: 'date' },
  { name: 'weekday', sig: 'weekday(date)', group: 'date' },
  { name: 'days', sig: 'days(n)', group: 'date' },
  { name: 'hours', sig: 'hours(n)', group: 'date' },
  // lists and the rest
  { name: 'range', sig: 'range(from, to, step?)', group: 'list' },
  { name: 'sort', sig: 'sort(list, key?)', group: 'list' },
  { name: 'unique', sig: 'unique(list)', group: 'list' },
  { name: 'reverse', sig: 'reverse(list)', group: 'list' },
  { name: 'first', sig: 'first(list)', group: 'list' },
  { name: 'last', sig: 'last(list)', group: 'list' },
  { name: 'keys', sig: 'keys(record)', group: 'list' },
  { name: 'empty', sig: 'empty(value)', group: 'other' },
  { name: 'type', sig: 'type(value)', group: 'other' },
  { name: 'json', sig: 'json(value)', group: 'other' },
  { name: 'error', sig: 'error(message)', group: 'other' },
]

export type MemberKind = 'query' | 'row' | 'page' | 'text' | 'list' | 'date' | 'mail' | 'create' | 'http' | 'pagefn' | 'person'

export const MEMBERS: Record<MemberKind, FnInfo[]> = {
  query: [
    { name: 'where', sig: '.where(Status = "Open", Due < today() + 3d)', group: 'one' },
    { name: 'sort', sig: '.sort(Due desc, Name)', group: 'one' },
    { name: 'limit', sig: '.limit(n)', group: 'one' },
    { name: 'select', sig: '.select(Name, Status)', group: 'one' },
    { name: 'count', sig: '.count', group: 'one', prop: true },
    { name: 'rows', sig: '.rows', group: 'one', prop: true },
    { name: 'first', sig: '.first', group: 'one', prop: true },
    { name: 'sum', sig: '.sum(Budget)', group: 'number' },
    { name: 'avg', sig: '.avg(Budget)', group: 'number' },
    { name: 'min', sig: '.min(Due)', group: 'number' },
    { name: 'max', sig: '.max(Due)', group: 'number' },
    { name: 'group', sig: '.group(Status)', group: 'one' },
    { name: 'add', sig: '.add("Title", Status: "Open")', group: 'one' },
    { name: 'schema', sig: '.schema', group: 'one', prop: true },
    { name: 'title', sig: '.title', group: 'one', prop: true },
    { name: 'url', sig: '.url', group: 'one', prop: true },
    { name: 'open', sig: '.open()', group: 'ui' },
  ],
  row: [
    { name: 'set', sig: '.set(Status: "Done", Due: today())', group: 'one' },
    { name: 'title', sig: '.title', group: 'one', prop: true },
    { name: 'markdown', sig: '.markdown', group: 'one', prop: true },
    { name: 'text', sig: '.text', group: 'one', prop: true },
    { name: 'props', sig: '.props', group: 'one', prop: true },
    { name: 'append', sig: '.append(markdown)', group: 'one' },
    { name: 'prepend', sig: '.prepend(markdown)', group: 'one' },
    { name: 'replace', sig: '.replace(markdown)', group: 'one' },
    { name: 'url', sig: '.url', group: 'one', prop: true },
    { name: 'id', sig: '.id', group: 'one', prop: true },
    { name: 'open', sig: '.open()', group: 'ui' },
    { name: 'trash', sig: '.trash()', group: 'one' },
  ],
  page: [
    { name: 'title', sig: '.title', group: 'one', prop: true },
    { name: 'markdown', sig: '.markdown', group: 'one', prop: true },
    { name: 'text', sig: '.text', group: 'one', prop: true },
    { name: 'children', sig: '.children', group: 'one', prop: true },
    { name: 'parent', sig: '.parent', group: 'one', prop: true },
    { name: 'append', sig: '.append(markdown)', group: 'one' },
    { name: 'prepend', sig: '.prepend(markdown)', group: 'one' },
    { name: 'replace', sig: '.replace(markdown)', group: 'one' },
    { name: 'set', sig: '.set(title: "…")', group: 'one' },
    { name: 'url', sig: '.url', group: 'one', prop: true },
    { name: 'open', sig: '.open()', group: 'ui' },
    { name: 'trash', sig: '.trash()', group: 'one' },
  ],
  text: ['upper', 'lower', 'trim', 'contains', 'starts_with', 'ends_with', 'split', 'replace', 'slice', 'length', 'number', 'date'].map((n) => ({ name: n, sig: `.${n}${n === 'length' ? '' : '()'}`, group: 'text' as const, prop: n === 'length' })),
  list: ['count', 'first', 'last', 'where', 'map', 'sort', 'select', 'group', 'sum', 'avg', 'min', 'max', 'limit', 'join', 'contains', 'find', 'any', 'all', 'unique', 'reverse', 'push'].map((n) => ({
    name: n,
    sig: `.${n}${['count', 'first', 'last'].includes(n) ? '' : '()'}`,
    group: 'list' as const,
    prop: ['count', 'first', 'last'].includes(n),
  })),
  date: ['year', 'month', 'day', 'weekday', 'hour', 'minute', 'format'].map((n) => ({ name: n, sig: n === 'format' ? '.format("dd.MM.yyyy")' : `.${n}`, group: 'date' as const, prop: n !== 'format' })),
  mail: [{ name: 'send', sig: 'mail.send(to: "…", subject: "…", body: "…", cc: "…")', group: 'effect' }],
  create: [{ name: 'page', sig: 'create.page(title: "…", parent: @page, markdown: "…")', group: 'one' }],
  http: [{ name: 'post', sig: 'http.post(url, data)', group: 'effect' }],
  pagefn: [{ name: 'current', sig: 'page.current', group: 'one', prop: true }],
  person: [
    { name: 'name', sig: '.name', group: 'one', prop: true },
    { name: 'id', sig: '.id', group: 'one', prop: true },
  ],
}

/** The signature of a function or method by name (signature help). */
export function signatureOf(name: string, member: boolean): FnInfo | null {
  const n = name.toLowerCase()
  if (member) {
    for (const list of Object.values(MEMBERS)) {
      const hit = list.find((f) => f.name === n && !f.prop)
      if (hit) return hit
    }
  }
  return GLOBAL_FUNCTIONS.find((f) => f.name === n && !f.prop) ?? null
}

/** Methods whose arguments name the database's properties (where, sort, select, group, sum …). */
export const PROP_ARG_METHODS = new Set(['where', 'filter', 'sort', 'select', 'group', 'sum', 'avg', 'min', 'max', 'count', 'find', 'map', 'set', 'add'])
