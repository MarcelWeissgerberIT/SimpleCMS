/**
 * One Script — the catalog of names for autocomplete, signature help and the reference: global
 * functions (the language's built-ins and One's library) and the members of each kind of value, with
 * what they give back (the editor's type inference follows a chain with it: db(@X).where(…) is still
 * a query of X, .rows its rows, .first one row of X …) and how their arguments read (inside where /
 * sort / group a row's properties are plain names; set / add take Property: value).
 * Descriptions: i18n `features.script.m.<kind>.<name>` (members), else `features.script.fn.<name>` (EN + DE).
 */
export type FnGroup = 'one' | 'ui' | 'effect' | 'text' | 'list' | 'number' | 'date' | 'other'

/**
 * What a call or member gives back:
 *  - self: the same kind (a query stays a query of its database, a list stays a list of the same items)
 *  - rows / row: rows of the receiver's database (a list) / one of them · elem: one item of a list
 *  - db: a database (from the first argument of db(…)) · records: a list of records (select) · groups: .group(…)
 *  - elem1 / elem2: an item of the 1st / 2nd argument (first(list), choose(text, options)) · same1: the 1st argument's kind
 *  - propval: the value of the property named in the first argument (min / max)
 */
export type Ret =
  | 'self'
  | 'rows'
  | 'row'
  | 'elem'
  | 'db'
  | 'records'
  | 'groups'
  | 'elem1'
  | 'elem2'
  | 'same1'
  | 'propval'
  | 'list'
  | 'texts'
  | 'people'
  | 'pages'
  | 'page'
  | 'person'
  | 'text'
  | 'number'
  | 'bool'
  | 'date'
  | 'duration'
  | 'record'
  | 'any'

/**
 * How the arguments read: 'item' = a row's properties / a record's fields are plain names (where, sort,
 * select, group, sum …; a lambda's parameter is the item) · 'set' = `Property: value` (set) · 'add' = a
 * title, then `Property: value` (add).
 */
export type ArgMode = 'item' | 'set' | 'add'

export interface FnInfo {
  name: string
  sig: string
  group: FnGroup
  /** a property (no parentheses) */
  prop?: boolean
  /** what it gives back (type inference) */
  ret?: Ret
  args?: ArgMode
  /** named parameters offered at the start of an argument (mail.send: to, subject …) */
  named?: string[]
}

export const GLOBAL_FUNCTIONS: FnInfo[] = [
  // One
  { name: 'page', sig: 'page(@page | "Parent / Page" | "Title")', group: 'one', ret: 'page' },
  { name: 'db', sig: 'db(@database | "Name")', group: 'one', ret: 'db' },
  { name: 'create', sig: 'create.page(title: "…", parent: @page, markdown: "…")', group: 'one', prop: true },
  { name: 'trash', sig: 'trash(row | page | query)', group: 'one', ret: 'number' },
  { name: 'person', sig: 'person("Name")', group: 'one', ret: 'person' },
  { name: 'people', sig: 'people()', group: 'one', ret: 'people' },
  { name: 'me', sig: 'me()', group: 'one', ret: 'person' },
  { name: 'md_table', sig: 'md_table(rows, columns?)', group: 'one', ret: 'text' },
  { name: 'md_chart', sig: 'md_chart(data, kind?, title?)', group: 'one', ret: 'text', named: ['kind', 'title'] },
  // dialogs
  { name: 'modal', sig: 'modal(text, buttons: ["OK", "Cancel"])', group: 'ui', ret: 'text', named: ['buttons'] },
  { name: 'confirm', sig: 'confirm(text)', group: 'ui', ret: 'bool' },
  { name: 'ask', sig: 'ask(text, default: "")', group: 'ui', ret: 'text', named: ['default'] },
  { name: 'choose', sig: 'choose(text, options)', group: 'ui', ret: 'elem2' },
  { name: 'notify', sig: 'notify(text)', group: 'ui' },
  { name: 'open', sig: 'open(@page)', group: 'ui' },
  { name: 'print', sig: 'print(value, …)', group: 'ui' },
  { name: 'log', sig: 'log(value, …)', group: 'ui' },
  // effects
  { name: 'mail', sig: 'mail.send(to: "…", subject: "…", body: "…", cc: "…")', group: 'effect', prop: true },
  { name: 'claude', sig: 'claude(prompt, context?)', group: 'effect', ret: 'text' },
  { name: 'http', sig: 'http.post(url, data)', group: 'effect', prop: true },
  // text
  { name: 'upper', sig: 'upper(text)', group: 'text', ret: 'text' },
  { name: 'lower', sig: 'lower(text)', group: 'text', ret: 'text' },
  { name: 'trim', sig: 'trim(text)', group: 'text', ret: 'text' },
  { name: 'split', sig: 'split(text, separator?)', group: 'text', ret: 'texts' },
  { name: 'join', sig: 'join(list, separator?)', group: 'text', ret: 'text' },
  { name: 'replace', sig: 'replace(text, find, with)', group: 'text', ret: 'text' },
  { name: 'contains', sig: 'contains(text | list, value)', group: 'text', ret: 'bool' },
  { name: 'starts_with', sig: 'starts_with(text, start)', group: 'text', ret: 'bool' },
  { name: 'ends_with', sig: 'ends_with(text, end)', group: 'text', ret: 'bool' },
  { name: 'slice', sig: 'slice(text, start, end?)', group: 'text', ret: 'text' },
  { name: 'lines', sig: 'lines(text)', group: 'text', ret: 'texts' },
  { name: 'len', sig: 'len(value)', group: 'text', ret: 'number' },
  { name: 'text', sig: 'text(value)', group: 'text', ret: 'text' },
  { name: 'format', sig: 'format(value, pattern?)', group: 'text', ret: 'text' },
  // numbers
  { name: 'round', sig: 'round(number, places?)', group: 'number', ret: 'number' },
  { name: 'floor', sig: 'floor(number)', group: 'number', ret: 'number' },
  { name: 'ceil', sig: 'ceil(number)', group: 'number', ret: 'number' },
  { name: 'abs', sig: 'abs(number)', group: 'number', ret: 'number' },
  { name: 'min', sig: 'min(a, b, … | list)', group: 'number', ret: 'any' },
  { name: 'max', sig: 'max(a, b, … | list)', group: 'number', ret: 'any' },
  { name: 'sum', sig: 'sum(list)', group: 'number', ret: 'number' },
  { name: 'avg', sig: 'avg(list)', group: 'number', ret: 'number' },
  { name: 'number', sig: 'number(value)', group: 'number', ret: 'number' },
  // dates
  { name: 'today', sig: 'today()', group: 'date', ret: 'date' },
  { name: 'now', sig: 'now()', group: 'date', ret: 'date' },
  { name: 'date', sig: 'date("2026-10-05")', group: 'date', ret: 'date' },
  { name: 'datetime', sig: 'datetime("2026-10-05 14:30")', group: 'date', ret: 'date' },
  { name: 'days_between', sig: 'days_between(from, to)', group: 'date', ret: 'number' },
  { name: 'add_days', sig: 'add_days(date, n)', group: 'date', ret: 'date' },
  { name: 'add_months', sig: 'add_months(date, n)', group: 'date', ret: 'date' },
  { name: 'weekday', sig: 'weekday(date)', group: 'date', ret: 'number' },
  { name: 'days', sig: 'days(n)', group: 'date', ret: 'duration' },
  { name: 'hours', sig: 'hours(n)', group: 'date', ret: 'duration' },
  { name: 'weeks', sig: 'weeks(n)', group: 'date', ret: 'duration' },
  { name: 'minutes', sig: 'minutes(n)', group: 'date', ret: 'duration' },
  // lists and the rest
  { name: 'range', sig: 'range(from, to, step?)', group: 'list', ret: 'list' },
  { name: 'sort', sig: 'sort(list, key?)', group: 'list', ret: 'same1' },
  { name: 'unique', sig: 'unique(list)', group: 'list', ret: 'same1' },
  { name: 'reverse', sig: 'reverse(list)', group: 'list', ret: 'same1' },
  { name: 'first', sig: 'first(list)', group: 'list', ret: 'elem1' },
  { name: 'last', sig: 'last(list)', group: 'list', ret: 'elem1' },
  { name: 'keys', sig: 'keys(record)', group: 'list', ret: 'texts' },
  { name: 'values', sig: 'values(record)', group: 'list', ret: 'list' },
  { name: 'empty', sig: 'empty(value)', group: 'other', ret: 'bool' },
  { name: 'type', sig: 'type(value)', group: 'other', ret: 'text' },
  { name: 'json', sig: 'json(value)', group: 'other', ret: 'text' },
  { name: 'error', sig: 'error(message)', group: 'other' },
]

/** Kinds of values with members (`MEMBERS[kind]`). 'query' = a database or a query on it. */
export type MemberKind = 'query' | 'row' | 'page' | 'text' | 'number' | 'list' | 'date' | 'duration' | 'record' | 'group' | 'mail' | 'create' | 'http' | 'pagefn' | 'person' | 'agent' | 'script'

const m = (name: string, sig: string, ret: Ret | undefined, opts: Partial<FnInfo> = {}): FnInfo => ({ name, sig, group: 'one', ret, ...opts })
const p = (name: string, ret: Ret): FnInfo => ({ name, sig: `.${name}`, group: 'one', prop: true, ret })

/** Members both pages and rows have. */
const PAGE_MEMBERS: FnInfo[] = [
  p('title', 'text'),
  p('markdown', 'text'),
  p('text', 'text'),
  m('append', '.append(markdown)', 'self'),
  m('prepend', '.prepend(markdown)', 'self'),
  m('replace', '.replace(markdown)', 'self'),
  p('url', 'text'),
  p('id', 'text'),
  p('children', 'pages'),
  p('parent', 'page'),
  p('created', 'date'),
  p('edited', 'date'),
  p('kind', 'text'),
  p('icon', 'text'),
  m('open', '.open()', 'self', { group: 'ui' }),
  m('trash', '.trash()', 'bool'),
]

export const MEMBERS: Record<MemberKind, FnInfo[]> = {
  query: [
    m('where', '.where(condition, …)', 'self', { args: 'item' }),
    m('sort', '.sort(property desc?, …)', 'self', { args: 'item' }),
    m('limit', '.limit(n)', 'self'),
    m('skip', '.skip(n)', 'self'),
    m('select', '.select(property, …)', 'records', { args: 'item' }),
    p('count', 'number'),
    p('rows', 'rows'),
    p('first', 'row'),
    p('last', 'row'),
    m('find', '.find(condition)', 'row', { args: 'item' }),
    m('map', '.map(row => value)', 'list', { args: 'item' }),
    m('sum', '.sum(property)', 'number', { group: 'number', args: 'item' }),
    m('avg', '.avg(property)', 'number', { group: 'number', args: 'item' }),
    m('min', '.min(property)', 'propval', { group: 'number', args: 'item' }),
    m('max', '.max(property)', 'propval', { group: 'number', args: 'item' }),
    m('group', '.group(property)', 'groups', { args: 'item' }),
    m('add', '.add(title, Property: value, …)', 'row', { args: 'add' }),
    p('schema', 'list'),
    p('title', 'text'),
    p('url', 'text'),
    p('id', 'text'),
    p('page', 'page'),
    m('open', '.open()', 'self', { group: 'ui' }),
  ],
  row: [m('set', '.set(Property: value, …)', 'self', { args: 'set' }), p('props', 'record'), p('database', 'db'), ...PAGE_MEMBERS],
  page: [m('set', '.set(title: "…")', 'self', { args: 'set' }), ...PAGE_MEMBERS],
  text: [
    m('upper', '.upper()', 'text', { group: 'text' }),
    m('lower', '.lower()', 'text', { group: 'text' }),
    m('trim', '.trim()', 'text', { group: 'text' }),
    m('contains', '.contains(text)', 'bool', { group: 'text' }),
    m('starts_with', '.starts_with(text)', 'bool', { group: 'text' }),
    m('ends_with', '.ends_with(text)', 'bool', { group: 'text' }),
    m('split', '.split(separator?)', 'texts', { group: 'text' }),
    m('replace', '.replace(find, with)', 'text', { group: 'text' }),
    m('slice', '.slice(start, end?)', 'text', { group: 'text' }),
    m('repeat', '.repeat(n)', 'text', { group: 'text' }),
    { ...p('length', 'number'), group: 'text' },
    m('lines', '.lines()', 'texts', { group: 'text' }),
    m('number', '.number()', 'number', { group: 'text' }),
    m('date', '.date()', 'date', { group: 'text' }),
  ],
  number: [
    m('round', '.round(places?)', 'number', { group: 'number' }),
    m('floor', '.floor()', 'number', { group: 'number' }),
    m('ceil', '.ceil()', 'number', { group: 'number' }),
    m('abs', '.abs()', 'number', { group: 'number' }),
    m('format', '.format(places?)', 'text', { group: 'number' }),
  ],
  list: [
    { ...p('count', 'number'), group: 'list' },
    { ...p('first', 'elem'), group: 'list' },
    { ...p('last', 'elem'), group: 'list' },
    m('where', '.where(condition, …)', 'self', { group: 'list', args: 'item' }),
    m('map', '.map(item => value)', 'list', { group: 'list', args: 'item' }),
    m('sort', '.sort(key desc?, …)', 'self', { group: 'list', args: 'item' }),
    m('select', '.select(field, …)', 'records', { group: 'list', args: 'item' }),
    m('group', '.group(key)', 'groups', { group: 'list', args: 'item' }),
    m('find', '.find(condition)', 'elem', { group: 'list', args: 'item' }),
    m('any', '.any(condition)', 'bool', { group: 'list', args: 'item' }),
    m('all', '.all(condition)', 'bool', { group: 'list', args: 'item' }),
    m('sum', '.sum(key?)', 'number', { group: 'list', args: 'item' }),
    m('avg', '.avg(key?)', 'number', { group: 'list', args: 'item' }),
    m('min', '.min(key?)', 'propval', { group: 'list', args: 'item' }),
    m('max', '.max(key?)', 'propval', { group: 'list', args: 'item' }),
    m('limit', '.limit(n)', 'self', { group: 'list' }),
    m('skip', '.skip(n)', 'self', { group: 'list' }),
    m('join', '.join(separator?)', 'text', { group: 'list' }),
    m('contains', '.contains(value)', 'bool', { group: 'list' }),
    m('unique', '.unique()', 'self', { group: 'list' }),
    m('reverse', '.reverse()', 'self', { group: 'list' }),
    m('push', '.push(value, …)', 'self', { group: 'list' }),
  ],
  date: [
    { ...p('year', 'number'), group: 'date' },
    { ...p('month', 'number'), group: 'date' },
    { ...p('day', 'number'), group: 'date' },
    { ...p('weekday', 'number'), group: 'date' },
    { ...p('hour', 'number'), group: 'date' },
    { ...p('minute', 'number'), group: 'date' },
    { ...p('start', 'date'), group: 'date' },
    { ...p('end', 'date'), group: 'date' },
    m('format', '.format("dd.MM.yyyy")', 'text', { group: 'date' }),
  ],
  duration: [
    { ...p('days', 'number'), group: 'date' },
    { ...p('hours', 'number'), group: 'date' },
    { ...p('minutes', 'number'), group: 'date' },
  ],
  record: [{ ...p('keys', 'texts'), group: 'other' }, { ...p('values', 'list'), group: 'other' }, { ...p('count', 'number'), group: 'other' }, m('get', '.get(name, default?)', 'any', { group: 'other' }), m('has', '.has(name)', 'bool', { group: 'other' })],
  group: [p('key', 'any'), p('rows', 'list'), p('count', 'number')],
  mail: [m('send', 'mail.send(to: "…", subject: "…", body: "…", cc: "…")', 'record', { group: 'effect', named: ['to', 'subject', 'body', 'cc', 'bcc'] })],
  create: [m('page', 'create.page(title: "…", parent: @page, markdown: "…")', 'page', { named: ['title', 'parent', 'markdown'] })],
  http: [m('post', 'http.post(url, data)', 'record', { group: 'effect' })],
  pagefn: [p('current', 'page'), p('here', 'page')],
  person: [p('name', 'text'), p('id', 'text')],
  agent: [p('name', 'text'), p('id', 'text'), p('enabled', 'bool')],
  script: [p('name', 'text'), p('id', 'text'), p('kind', 'text')],
}

/** The signature of a function or method by name (signature help without a known receiver). */
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
export const PROP_ARG_METHODS = new Set(['where', 'filter', 'sort', 'select', 'group', 'sum', 'avg', 'min', 'max', 'count', 'find', 'map', 'set', 'add', 'any', 'all'])

/** The i18n key of a member's one-line description (members of one kind first, then the function's). */
export const memberDocKeys = (kind: MemberKind, name: string): string[] => [`features.script.m.${kind}.${name}`, ...(kind === 'row' ? [`features.script.m.page.${name}`] : []), `features.script.fn.${name}`]
