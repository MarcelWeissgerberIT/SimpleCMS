/**
 * ⌘K filters and suggestions (shell/palette/filters.ts + suggest.ts) — pure, run in Node by the
 * Playwright runner over a synthetic workspace and a stub FilterEnv: per-database option and status-group
 * resolution, the negation domain, record types, has:, in: ancestry, is:private only in a team, dates with
 * a fixed now, percent numbers, unique ids, mixed types, computed values, validation hints, the values a
 * row shows, suggestion order and dedupe — and a budget for 20,000 rows.
 */
import { test, expect } from '@playwright/test'
import type { Database, Page, Person, PropertyDef, SelectOption } from '../../src/app/store/types'
import type { Translate } from '../../src/shared/i18n'
import { fold, MAX_CHIPS, parseQuery, type Filter } from '../../src/app/shell/palette/query'
import { applyFilters, filterIndexOf, filterKey, groupKey, matchedValues, takeChips, validate, chipLabel, type FilterEnv } from '../../src/app/shell/palette/filters'
import { suggest } from '../../src/app/shell/palette/suggest'

const NOW = new Date(2026, 9, 8, 12, 0).getTime()
const DAY = 86_400_000
const iso = (offset: number) => {
  const d = new Date(NOW + offset * DAY)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const t = ((key: string, vars?: Record<string, unknown>) => (vars ? `${key}${JSON.stringify(vars)}` : key)) as unknown as Translate

const opt = (id: string, name: string, color: SelectOption['color'], group?: SelectOption['group']): SelectOption => ({ id, name, color, ...(group ? { group } : {}) })

function page(p: Partial<Page> & { id: string; title: string }): Page {
  return {
    kind: 'page',
    parentId: null,
    databaseId: null,
    properties: {},
    favorite: false,
    trashed: false,
    createdAt: NOW - 40 * DAY,
    updatedAt: NOW - 20 * DAY,
    order: 0,
    icon: null,
    cover: null,
    content: null,
    contentRev: 0,
    settings: {},
    ...p,
  } as unknown as Page
}

function db(id: string, properties: PropertyDef[]): Database {
  return { id, properties, views: [], nextUniqueId: 1 } as unknown as Database
}

/* ---------- the workspace ---------- */
const people: Person[] = [
  { id: 'p-you', name: 'You', color: 'gray' },
  { id: 'p-alex', name: 'Alex', color: 'blue' },
  { id: 'p-sam', name: 'Sam Lee', color: 'green' },
] as Person[]

const projectStatus = [opt('ps1', 'Backlog', 'gray', 'todo'), opt('ps2', 'In progress', 'blue', 'in_progress'), opt('ps3', 'Review', 'purple', 'in_progress'), opt('ps4', 'Done', 'green', 'done')]
const projects = db('db-p', [
  { id: 'p-name', name: 'Project', type: 'title' },
  { id: 'p-status', name: 'Status', type: 'status', options: projectStatus },
  { id: 'p-owner', name: 'Owner', type: 'person' },
  { id: 'p-budget', name: 'Budget', type: 'number', numberFormat: 'euro' },
  { id: 'p-progress', name: 'Progress', type: 'number', numberFormat: 'percent' },
  { id: 'p-tags', name: 'Tags', type: 'multi_select', options: [opt('t1', 'Web', 'blue'), opt('t2', 'Key account', 'pink')] },
  { id: 'p-time', name: 'Timeline', type: 'date' },
  { id: 'p-score', name: 'Score', type: 'formula', formula: 'prop("Budget") / 1000' },
  { id: 'p-id', name: 'ID', type: 'unique_id', idPrefix: 'PRJ' },
  { id: 'p-notes', name: 'Notes', type: 'text' },
  { id: 'p-rel', name: 'Related', type: 'relation', relationDatabaseId: 'db-r' },
  { id: 'p-prio', name: 'Priority', type: 'select', options: [opt('pr1', 'High', 'red'), opt('pr2', 'Low', 'gray')] },
])
const reading = db('db-r', [
  { id: 'r-title', name: 'Title', type: 'title' },
  { id: 'r-status', name: 'Status', type: 'status', options: [opt('rs1', 'To read', 'gray', 'todo'), opt('rs2', 'Reading', 'yellow', 'in_progress'), opt('rs3', 'Finished', 'green', 'done')] },
  { id: 'r-type', name: 'Type', type: 'select', options: [opt('rt1', 'Book', 'brown'), opt('rt2', 'Article', 'blue')] },
  { id: 'r-prio', name: 'Priority', type: 'number' },
])
const shipping = db('db-s', [
  { id: 's-title', name: 'Name', type: 'title' },
  { id: 's-status', name: 'Status', type: 'status', options: [opt('ss1', 'Queued', 'gray', 'todo'), opt('ss2', 'Shipped', 'green', 'done')] },
])
const leads = db('db-l', [
  { id: 'l-title', name: 'Name', type: 'title' },
  { id: 'l-company', name: 'Company', type: 'text', fromType: { id: 'rt-lead', prop: 'x' } },
])
const databases: Record<string, Database> = { 'db-p': projects, 'db-r': reading, 'db-s': shipping, 'db-l': leads }

const list: Page[] = [
  page({ id: 'db-p', title: 'Projects', kind: 'database', favorite: true }),
  page({ id: 'db-r', title: 'Reading list', kind: 'database' }),
  page({ id: 'db-s', title: 'Shipments', kind: 'database' }),
  page({ id: 'db-l', title: 'Leads', kind: 'database' }),
  page({ id: 'w1', title: 'Website relaunch', parentId: 'db-p', databaseId: 'db-p', updatedAt: NOW - 1 * DAY, properties: { 'p-status': 'ps2', 'p-owner': ['p-alex'], 'p-budget': 18000, 'p-progress': 0.6, 'p-tags': ['t1', 't2'], 'p-time': { start: iso(-10), end: iso(14) }, 'p-id': 1, 'p-notes': 'Großer Relaunch', 'p-rel': ['b1'], 'p-prio': 'pr1' } }),
  page({ id: 'w2', title: 'Import Notion', parentId: 'db-p', databaseId: 'db-p', createdAt: new Date(2026, 8, 20).getTime(), properties: { 'p-status': 'ps4', 'p-owner': ['p-you'], 'p-budget': 0, 'p-progress': 1, 'p-id': 2 } }),
  page({ id: 'w3', title: 'Q4 content', parentId: 'db-p', databaseId: 'db-p', properties: { 'p-status': 'ps3', 'p-owner': ['p-sam'], 'p-budget': 4000, 'p-progress': 0.8, 'p-id': 3, 'p-time': { start: iso(5) } } }),
  page({ id: 'w4', title: 'Pricing experiment', parentId: 'db-p', databaseId: 'db-p', properties: { 'p-status': 'ps1', 'p-owner': ['p-alex'], 'p-budget': 1500, 'p-progress': 0, 'p-id': 4 } }),
  page({ id: 'w5', title: 'Brand refresh', parentId: 'db-p', databaseId: 'db-p', createdAt: new Date(2026, 7, 1).getTime(), properties: { 'p-status': 'ps4', 'p-owner': [], 'p-budget': 12000, 'p-progress': 1, 'p-id': 5 } }),
  page({ id: 'b1', title: 'Less, but better', parentId: 'db-r', databaseId: 'db-r', properties: { 'r-status': 'rs3', 'r-type': 'rt1', 'r-prio': 3 } }),
  page({ id: 'b2', title: 'Shape Up', parentId: 'db-r', databaseId: 'db-r', properties: { 'r-status': 'rs2', 'r-type': 'rt1' } }),
  page({ id: 'b3', title: 'Local-first', parentId: 'db-r', databaseId: 'db-r', properties: { 'r-status': 'rs1', 'r-type': 'rt2' } }),
  page({ id: 's1', title: 'Order 1', parentId: 'db-s', databaseId: 'db-s', properties: { 's-status': 'ss2' } }),
  page({ id: 's2', title: 'Order 2', parentId: 'db-s', databaseId: 'db-s', properties: { 's-status': 'ss1' } }),
  page({ id: 'l1', title: 'Acme lead', parentId: 'db-l', databaseId: 'db-l', recordType: 'rt-lead', properties: { 'l-company': 'Acme' } }),
  page({ id: 'l2', title: 'Acme partner', parentId: 'db-l', databaseId: 'db-l', recordType: 'rt-partner', properties: { 'l-company': 'Acme' } }),
  page({ id: 'n1', title: 'Project notes', updatedAt: NOW - 2 * DAY, favorite: true }),
  page({ id: 'n2', title: 'Launch checklist', parentId: 'w1', updatedAt: NOW - 3 * 3600_000 }),
  page({ id: 'n3', title: 'Secret plan', private: true }),
]
const pages = Object.fromEntries(list.map((p) => [p.id, p]))

const computed: Record<string, unknown> = { 'w1:p-score': 18, 'w2:p-score': 0, 'w3:p-score': 4, 'w4:p-score': 1.5, 'w5:p-score': 12 }

function envOf(over: Partial<FilterEnv> = {}): FilterEnv {
  return {
    now: NOW,
    lang: 'en',
    team: false,
    pages,
    databases,
    people,
    agents: [{ id: 'ag1', name: 'Tidy bot' }],
    meId: null,
    me: () => 'p-you',
    computed: (_db, prop, row) => computed[`${row.id}:${prop.id}`] ?? null,
    text: (d, prop, row) => {
      const v = row.properties[prop.id]
      if (prop.options) return prop.options.filter((o) => (Array.isArray(v) ? v.includes(o.id) : v === o.id)).map((o) => o.name).join(', ')
      if (prop.type === 'person') return people.filter((p) => (v as string[] | undefined)?.includes(p.id)).map((p) => p.name).join(', ')
      return v === undefined || v === null ? '' : String(v)
    },
    ...over,
  }
}

const fx = filterIndexOf(list, databases)
const vocab = { isProp: (k: string) => fx.propsByName.has(fold(k)) }
/** The ids a query's filters match (all of them treated as finished). */
function ids(query: string, env = envOf()): string[] {
  const filters = parseQuery(`${query} `, vocab).filters
  expect(filters.length, `filters in "${query}"`).toBeGreaterThan(0)
  for (const f of filters) expect(validate(fx, f, env), `valid: ${f.raw}`).toBe(true)
  return applyFilters(fx, filters, env)
    .map((p) => p.id)
    .sort()
}
const one = (query: string): Filter => parseQuery(`${query} `, vocab).filters[0]

test.describe('⌘K filters', () => {
  test('status:done — per database: the option, the done group, never plain pages', () => {
    expect(ids('status:done')).toEqual(['b1', 's1', 'w2', 'w5'])
    expect(ids('status:fin')).toEqual(['b1'])
    expect(ids('status:shipped')).toEqual(['s1'])
    // the in-progress group: "In progress" AND "Review" (not only the option named like the group)
    expect(ids('status:in-progress')).toEqual(['b2', 'w1', 'w3'])
    expect(ids('status:doing')).toEqual(['b2', 'w1', 'w3'])
    expect(ids('status:review')).toEqual(['w3'])
  })

  test('negation keeps to databases that have the property; the same filter twice is either; different ones all apply', () => {
    expect(ids('-status:done')).toEqual(['b2', 'b3', 's2', 'w1', 'w3', 'w4'])
    expect(ids('status:done status:review')).toEqual(['b1', 's1', 'w2', 'w3', 'w5'])
    expect(ids('status:done status:review in:projects')).toEqual(['w2', 'w3', 'w5'])
    expect(ids('-status:done -status:backlog in:projects')).toEqual(['w1', 'w3'])
  })

  test('people: @alex, @me, owner:me, owner:sam (a word of the name)', () => {
    expect(ids('@alex')).toEqual(['w1', 'w4'])
    expect(ids('@me')).toEqual(['w2'])
    expect(ids('owner:me')).toEqual(['w2'])
    expect(ids('owner:lee')).toEqual(['w3'])
    // negated @: every live page that does not have Alex
    expect(ids('-@alex')).not.toContain('w1')
    expect(ids('-@alex')).toContain('n1')
  })

  test('numbers: euro, percent (60%, >50, >0.5 the same), German thousands, unique ids, mixed types', () => {
    expect(ids('budget:>5000')).toEqual(['w1', 'w5'])
    expect(ids('budget:>=4000')).toEqual(['w1', 'w3', 'w5'])
    expect(ids('budget:>5.000', envOf({ lang: 'de' }))).toEqual(['w1', 'w5'])
    expect(ids('progress:>50%')).toEqual(['w2', 'w3', 'w5', 'w1'].sort())
    expect(ids('progress:>50')).toEqual(ids('progress:>50%'))
    expect(ids('progress:>0.5')).toEqual(ids('progress:>50%'))
    expect(ids('id:PRJ-2')).toEqual(['w2'])
    expect(ids('id:<3')).toEqual(['w1', 'w2'])
    // Priority: a select in Projects, a number in Reading — each database by its own definition
    expect(ids('priority:high')).toEqual(['w1'])
    expect(ids('priority:3')).toEqual(['b1'])
  })

  test('dates: a range property, created / edited windows', () => {
    expect(ids('timeline:today')).toEqual(['w1'])
    expect(ids('timeline:+7d')).toEqual(['w1', 'w3'])
    expect(ids('edited:7d')).toEqual(['n1', 'n2', 'w1'])
    expect(ids('created:>2026-09-01')).toEqual(['w2'])
    expect(ids('edited:>30d')).toEqual([])
  })

  test('has:, text, multi-select, relation, computed', () => {
    expect(ids('has:owner')).toEqual(['w1', 'w2', 'w3', 'w4'])
    expect(ids('-has:owner')).toEqual(['w5'])
    expect(ids('notes:grosser')).toEqual(['w1'])
    expect(ids('tags:"key account"')).toEqual(['w1'])
    expect(ids('related:less')).toEqual(['w1'])
    expect(ids('score:>10')).toEqual(['w1', 'w5'])
    expect(ids('has:score')).toEqual(['w1', 'w2', 'w3', 'w4', 'w5'])
  })

  test('is: and in:', () => {
    expect(ids('is:database')).toEqual(['db-l', 'db-p', 'db-r', 'db-s'])
    expect(ids('is:favorite')).toEqual(['db-p', 'n1'])
    expect(ids('is:page')).toEqual(['n1', 'n2', 'n3'])
    expect(ids('is:row')).toHaveLength(12)
    // in: a database's entries and their sub-pages — not the database itself
    expect(ids('in:projects')).toEqual(['n2', 'w1', 'w2', 'w3', 'w4', 'w5'])
    // is:private only in a team workspace
    expect(validate(fx, one('is:private'), envOf())).not.toBe(true)
    expect(ids('is:private', envOf({ team: true }))).toEqual(['n3'])
  })

  test('in: twice means either (any order), -in: twice excludes both — each in: keeps its own ancestry answers', () => {
    const projectsAndBooks = ['b1', 'b2', 'b3', 'n2', 'w1', 'w2', 'w3', 'w4', 'w5']
    expect(ids('in:projects in:reading')).toEqual(projectsAndBooks)
    expect(ids('in:reading in:projects')).toEqual(projectsAndBooks)
    expect(ids('-in:projects -in:reading')).toEqual(['db-l', 'db-p', 'db-r', 'db-s', 'l1', 'l2', 'n1', 'n3', 's1', 's2'])
    expect(ids('-in:reading -in:projects')).toEqual(ids('-in:projects -in:reading'))
  })

  test('English and German keywords are one filter: is: = ist:, by: = von: (either-or, one chip)', () => {
    expect(ids('is:favorite ist:zeile')).toEqual(ids('is:favorite is:row'))
    expect(ids('is:favorite ist:zeile')).toHaveLength(14)
    expect(groupKey(one('is:favorite'))).toBe(groupKey(one('ist:zeile')))
    expect(filterKey(one('is:favorite'))).toBe(filterKey(one('ist:favorit')))
    expect(filterKey(one('is:fav'))).toBe(filterKey(one('is:favorite')))
    expect(filterKey(one('by:me'))).toBe(filterKey(one('von:ich')))
    expect(filterKey(one('edited:7d'))).toBe(filterKey(one('geändert:7t')))
    expect(filterKey(one('is:favorite'))).not.toBe(filterKey(one('is:row')))
    // the same filter typed twice in both languages: one chip
    expect(takeChips(fx, 'is:favorite ist:favorit ', [], envOf(), vocab).chips).toHaveLength(1)
  })

  test('chips: at most MAX_CHIPS — a filter past the cap stays in the input as typed; one that is a chip already only leaves', () => {
    const env = envOf()
    const twelve = 'status:done status:review status:backlog status:queued status:shipped status:reading type:book type:article tags:web tags:"key account" priority:high priority:low '
    const full = takeChips(fx, twelve, [], env, vocab)
    expect(full.chips).toHaveLength(MAX_CHIPS)
    expect(full.q).toBe('')
    // a 13th finished filter: no chip, and it is not swallowed either
    const over = takeChips(fx, 'brand status:to-read ', full.chips, env, vocab)
    expect(over.chips).toBe(full.chips)
    expect(over.q).toBe('brand status:to-read ')
    // typed all at once: the first twelve become chips, the rest stays
    const once = takeChips(fx, `${twelve}status:to-read `, [], env, vocab)
    expect(once.chips).toHaveLength(MAX_CHIPS)
    expect(once.q).toBe('status:to-read ')
    // a filter that already is a chip leaves the input without a second chip (the same list: nothing to re-select)
    const eleven = full.chips.slice(0, 11)
    const dup = takeChips(fx, 'status:done brand', eleven, env, vocab)
    expect(dup.chips).toBe(eleven)
    expect(dup.q).toBe('brand')
  })

  test('record types: a property of another type is not that row’s', () => {
    expect(ids('company:acme')).toEqual(['l1'])
    expect(ids('-company:acme')).toEqual([])
  })

  test('by: who created / last edited (team: members, both: agents)', () => {
    const team = { ...pages, w4: { ...pages.w4, createdBy: 'p-sam', updatedBy: 'p-alex' }, w3: { ...pages.w3, updatedBy: 'agent:ag1' } }
    const teamList = list.map((p) => team[p.id])
    const tfx = filterIndexOf(teamList, databases)
    const env = envOf({ team: true, meId: 'p-alex', pages: team })
    const run = (q: string) => applyFilters(tfx, parseQuery(`${q} `).filters, env).map((p) => p.id)
    expect(run('by:sam')).toEqual(['w4'])
    expect(run('by:me')).toEqual(['w4'])
    expect(run('by:"tidy bot"')).toEqual(['w3'])
    // @x is about person properties only: Alex edited w4, but @sam does not find it
    expect(run('@sam')).toEqual(['w3'])
  })

  test('by:me is never an agent whose name starts with "me" / "ich" (team and local)', () => {
    const agents = [
      { id: 'ag1', name: 'Tidy bot' },
      { id: 'ag2', name: 'Meeting summariser' },
      { id: 'ag3', name: 'Ich-Erzähler' },
    ]
    const stamped = { ...pages, w4: { ...pages.w4, createdBy: 'p-sam', updatedBy: 'p-alex' }, w5: { ...pages.w5, createdBy: 'agent:ag2', updatedBy: 'agent:ag2' }, w3: { ...pages.w3, createdBy: 'agent:ag3', updatedBy: 'agent:ag3' } }
    const sfx = filterIndexOf(list.map((p) => stamped[p.id]), databases)
    const run = (q: string, env: FilterEnv) => applyFilters(sfx, parseQuery(`${q} `).filters, env).map((p) => p.id)
    const team = envOf({ team: true, meId: 'p-alex', pages: stamped, agents })
    expect(run('by:me', team)).toEqual(['w4'])
    expect(run('von:ich', team)).toEqual(['w4'])
    // a team without a signed-in member: "me" is nobody (never an agent), so it tells why
    expect(validate(sfx, one('by:me'), { ...team, meId: null })).not.toBe(true)
    // locally "me" = every change no agent made
    const local = envOf({ pages: stamped, agents })
    const mine = run('by:me', local)
    expect(mine).not.toContain('w5')
    expect(mine).toContain('w4')
    expect(run('von:ich', local)).not.toContain('w3')
    // the agents themselves still answer by name
    expect(run('by:meeting', local)).toEqual(['w5'])
  })

  test('validation tells why a value matches nothing', () => {
    expect(validate(fx, one('is:foo'), envOf())).toMatchObject({ hint: 'shell.palette.hint.is' })
    expect(validate(fx, one('status:nope'), envOf())).toEqual({ hint: 'shell.palette.hint.bad', vars: { key: 'Status', value: 'nope' } })
    expect(validate(fx, one('@nobody'), envOf())).toMatchObject({ hint: 'shell.palette.hint.unknownPerson' })
    expect(validate(fx, one('budget:lots'), envOf())).toMatchObject({ hint: 'shell.palette.hint.number' })
    expect(validate(fx, one('in:nowhere'), envOf())).toMatchObject({ hint: 'shell.palette.hint.noPage' })
    expect(validate(fx, parseQuery('nothing:x ').filters[0], envOf())).toMatchObject({ hint: 'shell.palette.hint.unknownKey' })
    expect(validate(fx, one('@me'), envOf({ me: () => null }))).toEqual({ hint: 'shell.palette.hint.noMe' })
    // locally every change is the one person's: by:<person> explains, by:<agent> / by:me work
    expect(validate(fx, one('by:alex'), envOf())).toEqual({ hint: 'shell.palette.hint.byLocal' })
    expect(validate(fx, one('by:tidy'), envOf())).toBe(true)
    expect(validate(fx, one('by:me'), envOf())).toBe(true)
  })

  test('a row shows the values it was found by; a chip reads like the workspace', () => {
    const env = envOf()
    expect(matchedValues(fx, [one('status:done')], pages.w2, env, t)).toEqual([{ name: 'Status', text: 'Done', color: 'green' }])
    expect(matchedValues(fx, [one('status:done'), one('@me'), one('budget:<1')], pages.w2, env, t)).toEqual([
      { name: 'Status', text: 'Done', color: 'green' },
      { name: 'Owner', text: 'You' },
      { name: 'Budget', text: '0' },
    ])
    expect(chipLabel(fx, one('status:done'), env, t)).toEqual({ key: 'Status', value: 'Done', color: 'green', neg: false })
    expect(chipLabel(fx, one('status:in-progress'), env, t)).toEqual({ key: 'Status', value: 'In progress', color: 'blue', neg: false })
    expect(chipLabel(fx, one('-status:fin'), env, t)).toEqual({ key: 'Status', value: 'Finished', color: 'green', neg: true })
    expect(chipLabel(fx, one('@al'), env, t)).toEqual({ key: '@', value: 'Alex', neg: false })
    expect(chipLabel(fx, one('is:fav'), env, t)).toEqual({ key: 'shell.palette.kw.is', value: 'shell.palette.is.favorite', neg: false })
  })
})

test.describe('⌘K suggestions', () => {
  const sug = (q: string, env = envOf()) => suggest(parseQuery(q, vocab).partial, fx, env, t)

  test('status: groups first, then the options (one per name, coloured, counted)', () => {
    const s = sug('status:')
    expect(s.place).toBe('top')
    expect(s.head).toBe('Status')
    expect(s.items.slice(0, 3).map((i) => [i.kind, i.insert])).toEqual([
      ['group', 'status:done'],
      ['group', 'status:in-progress'],
      ['group', 'status:todo'],
    ])
    // "Done" and "In progress" are the groups' own words: one row each (cmdk values stay unique)
    const inserts = s.items.map((i) => i.insert.toLowerCase())
    expect(new Set(inserts).size).toBe(inserts.length)
    expect(inserts).not.toContain('status:"in progress"')
    expect(s.items.find((i) => i.label === 'Backlog')).toMatchObject({ kind: 'option', color: 'gray', hint: 'shell.palette.row', complete: true })
    expect(s.items.length).toBeLessThanOrEqual(8)
    expect(sug('status:fin').items.map((i) => i.label)).toEqual(['Finished'])
    // nothing fits: every option, and a hint
    const bad = sug('status:zzz')
    expect(bad.items.length).toBeGreaterThan(0)
    expect(bad.hint).toBe('shell.palette.hint.bad{"key":"Status","value":"zzz"}')
  })

  test('@a → Alex (Me only when it fits), in:pro → the database first, is: values, a bare word → keys under the results', () => {
    expect(sug('@a').items.map((i) => i.label)).toEqual(['Alex'])
    expect(sug('@').items[0]).toMatchObject({ id: 'me', insert: '@me' })
    expect(sug('@m').items[0]).toMatchObject({ id: 'me' })
    expect(sug('@lee').items.map((i) => i.insert)).toEqual(['@"Sam Lee"'])
    const inPro = sug('in:pro')
    expect(inPro.items[0]).toMatchObject({ kind: 'database', label: 'Projects', insert: 'in:Projects', complete: true })
    expect(inPro.items.map((i) => i.label)).toContain('Project notes')
    expect(sug('is:').items.map((i) => i.id)).toEqual(['is:favorite', 'is:page', 'is:database', 'is:row'])
    expect(sug('is:', envOf({ team: true })).items.map((i) => i.id)).toContain('is:private')
    const bare = sug('sta')
    expect(bare.place).toBe('bottom')
    expect(bare.items[0]).toMatchObject({ kind: 'key', insert: 'status:', complete: false, type: 'status' })
    expect(sug('budget:').hint).toBe('shell.palette.hint.number{"key":"Budget"}')
    expect(sug('notes:').hint).toBe('shell.palette.hint.text{"key":"Notes"}')
    expect(sug('edited:').items.map((i) => i.hint)).toEqual(['today', 'yesterday', '7d', '30d', '>30d', 'month'])
  })

  test('a typed beginning of several property names offers the names, never one name’s values under another’s key', () => {
    const pr = sug('pr:')
    expect(pr.place).toBe('top')
    expect(pr.head).toBe('shell.palette.properties')
    expect(pr.items.map((i) => [i.kind, i.insert, i.complete])).toEqual([
      ['key', 'priority:', false],
      ['key', 'progress:', false],
      ['key', 'project:', false],
    ])
    expect(sug('ti:').items.map((i) => i.insert)).toEqual(['timeline:', 'title:'])
    // a value typed already stays with the key that is picked
    expect(sug('pr:hi').items.map((i) => i.insert)).toEqual(['priority:hi', 'progress:hi', 'project:hi'])
    // one name fits: its values under the whole key, its own counts and hint
    const sta = sug('sta:')
    expect(sta.head).toBe('Status')
    expect(sta.items[0]).toMatchObject({ kind: 'group', insert: 'status:done' })
    expect(sug('stat:zzz').hint).toBe('shell.palette.hint.bad{"key":"Status","value":"zzz"}')
    expect(sug('prio:').items.find((i) => i.label === 'High')).toMatchObject({ insert: 'priority:High', hint: 'shell.palette.row' })
  })

  test('by: in a local workspace offers Me and the agents — the people only in a team; nothing fitting says why', () => {
    expect(sug('by:').items.map((i) => i.insert)).toEqual(['by:me', 'by:"Tidy bot"'])
    const al = sug('by:al')
    expect(al.items).toEqual([])
    expect(al.hint).toMatch(/^shell\.palette\.hint\.byLocal/)
    expect(sug('by:', envOf({ team: true })).items.map((i) => i.insert)).toEqual(['by:me', 'by:You', 'by:Alex', 'by:"Sam Lee"', 'by:"Tidy bot"'])
    // Created by alone: the same rule; a key that is also a person property elsewhere keeps the people
    const audit = db('db-a', [
      { id: 'a-t', name: 'Name', type: 'title' },
      { id: 'a-by', name: 'Created by', type: 'created_by' },
      { id: 'a-ok', name: 'Approved', type: 'checkbox' },
    ])
    const crew = db('db-c', [
      { id: 'c-t', name: 'Name', type: 'title' },
      { id: 'c-who', name: 'Who', type: 'person' },
    ])
    const audit2 = db('db-a2', [
      { id: 'a2-t', name: 'Name', type: 'title' },
      { id: 'a2-who', name: 'Who', type: 'last_edited_by' },
    ])
    const afx = filterIndexOf([page({ id: 'db-a', title: 'Audit', kind: 'database' }), page({ id: 'db-c', title: 'Crew', kind: 'database' }), page({ id: 'db-a2', title: 'Audit 2', kind: 'database' })], { 'db-a': audit, 'db-c': crew, 'db-a2': audit2 })
    const asug = (q: string, env = envOf()) => suggest(parseQuery(q).partial, afx, env, t)
    expect(asug('created-by:').items.map((i) => i.insert)).toEqual(['created-by:me', 'created-by:"Tidy bot"'])
    const bad = asug('created-by:al')
    expect(bad.items).toEqual([])
    expect(bad.hint).toBe('shell.palette.hint.actorLocal{"key":"Created by"}')
    expect(asug('created-by:', envOf({ team: true })).items.map((i) => i.insert)).toContain('created-by:Alex')
    expect(asug('who:').items.map((i) => i.insert)).toEqual(['who:me', 'who:You', 'who:Alex', 'who:"Sam Lee"', 'who:"Tidy bot"'])
    // a checkbox value that fits nothing: both values below the hint ("pick one below")
    const maybe = asug('approved:maybe')
    expect(maybe.items.map((i) => i.label)).toEqual(['database.yes', 'database.no'])
    expect(maybe.hint).toBe('shell.palette.hint.bad{"key":"Approved","value":"maybe"}')
    expect(asug('approved:y').items.map((i) => i.label)).toEqual(['database.yes'])
  })

  test('is: a value that fits nothing lists every value under the hint', () => {
    const bad = sug('is:xyz')
    expect(bad.items.map((i) => i.id)).toEqual(['is:favorite', 'is:page', 'is:database', 'is:row'])
    expect(bad.hint).toBe('shell.palette.hint.is{"key":"is","value":"xyz"}')
    // is:private outside a team: the values there are (no private), and the hint
    expect(sug('is:priv').items.map((i) => i.id)).not.toContain('is:private')
    expect(sug('is:priv').hint).toBe('shell.palette.hint.is{"key":"is","value":"priv"}')
    expect(sug('is:fav').hint).toBeUndefined()
    expect(sug('is:fav').items.map((i) => i.id)).toEqual(['is:favorite'])
  })

  test('German: keywords and date presets', () => {
    const de = envOf({ lang: 'de' })
    expect(sug('is', de).items.map((i) => i.insert)).toEqual(['ist:'])
    expect(sug('geändert:', de).items.map((i) => i.hint)).toEqual(['heute', 'gestern', '7t', '30t', '>30t', 'monat'])
    expect(sug('status:', de).items[0].insert).toBe('status:erledigt')
  })
})

test('budget: 25 databases × 800 rows, three filters', () => {
  const big: Page[] = []
  const dbs: Record<string, Database> = {}
  for (let d = 0; d < 25; d++) {
    const id = `big-${d}`
    dbs[id] = db(id, [
      { id: `${id}-t`, name: 'Name', type: 'title' },
      { id: `${id}-s`, name: 'Status', type: 'status', options: [opt(`${id}-s1`, 'Not started', 'gray', 'todo'), opt(`${id}-s2`, 'In progress', 'blue', 'in_progress'), opt(`${id}-s3`, 'Done', 'green', 'done')] },
      { id: `${id}-o`, name: 'Owner', type: 'person' },
      { id: `${id}-e`, name: 'Estimate', type: 'number' },
    ])
    big.push(page({ id, title: `Tasks ${d}`, kind: 'database' }))
    for (let r = 0; r < 800; r++)
      big.push(page({ id: `${id}-r${r}`, title: `Row ${r}`, parentId: id, databaseId: id, properties: { [`${id}-s`]: `${id}-s${(r % 3) + 1}`, [`${id}-o`]: [people[r % 2].id], [`${id}-e`]: r % 20 } }))
  }
  const bfx = filterIndexOf(big, dbs)
  const env = envOf({ databases: dbs, pages: Object.fromEntries(big.map((p) => [p.id, p])) })
  const filters = parseQuery('status:done owner:alex estimate:>10 ').filters
  expect(filters).toHaveLength(3)
  applyFilters(bfx, filters, env)
  const t0 = performance.now()
  const out = applyFilters(bfx, filters, env)
  const ms = performance.now() - t0
  expect(out.length).toBeGreaterThan(0)
  expect(ms, `applyFilters over ${big.length} pages`).toBeLessThan(50)
})
