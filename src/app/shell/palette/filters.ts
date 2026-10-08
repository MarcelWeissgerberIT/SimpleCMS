/**
 * ⌘K filters — what `status:done`, `@alex`, `in:projects`, `is:favorite`, `edited:7d`, `has:owner`, `by:sam`
 * match (the tokens come from query.ts). Pure: no store, no DOM — the workspace and the database's
 * computed values come in through a FilterEnv (palette/env.ts builds the real one), so this runs in
 * Node tests too.
 *
 * - Properties are found by name in every database (folded: case, accents, spaces), each database
 *   with its own definition: `status:done` is the option "Done" where there is one, the done group's
 *   options of every status property, else the options starting with "done".
 * - The same filter twice means either (`status:review status:done`), different filters all apply,
 *   `-` negates. A negated property filter keeps only entries of databases that have the property —
 *   plain pages never answer a property question.
 * - Runs over the search index's array of live pages (never the page map: the perf budget counts walks
 *   of it); folded titles and values are cached per page object.
 */
import type { ColorName, Database, ID, Page, Person, PropertyDef, PropertyType } from '../../store/types'
import { COLOR_NAMES } from '../../store/types'
import type { Translate } from '@/shared/i18n'
import { compare, dateRange, DAY, dayMs, fold, isMe, overlaps, parseBool, parseIs, parseNumber, splitCmp, statusGroupOf, type Filter } from './query'

export interface FilterEnv {
  now: number
  lang: 'en' | 'de'
  /** a team workspace (is:private, created / edited by stamps) */
  team: boolean
  pages: Record<ID, Page>
  databases: Record<ID, Database>
  people: Person[]
  /** custom agents (by:<agent>, Created by an agent) — names only */
  agents: Array<{ id: ID; name: string }>
  /** the signed-in member's account id (team), null locally */
  meId: string | null
  /** "Me" on a person property (database meFor) — null: nobody */
  me(prop: PropertyDef): string | null
  /** computed value (database propertyFormulaValue): formula, rollup, files, relation titles */
  computed(db: Database, prop: PropertyDef, row: Page): unknown
  /** display text (database propertyValueToText) */
  text(db: Database, prop: PropertyDef, row: Page): string
}

export interface PropRef {
  db: Database
  prop: PropertyDef
}

export interface FilterIndex {
  /** live pages, search-index order */
  pages: readonly Page[]
  rowsByDb: Map<ID, Page[]>
  /** live database pages */
  dbPages: Page[]
  /** fold(property name) → the properties of that name, one per database */
  propsByName: Map<string, PropRef[]>
  /** property names for suggestions: how many databases have one, which types */
  names: Array<{ name: string; norm: string; dbs: number; types: PropertyType[] }>
  /** per index: propsForKey answers, option row counts per key */
  memo: { keys: Map<string, PropRef[]>; counts: Map<string, Map<string, number>> }
}

/** What a shown result carries under its title: the values a filter looked at. */
export interface ShownValue {
  name: string
  text: string
  color?: ColorName
}

export type Invalid = { hint: string; vars?: Record<string, string> }

const OPTION_TYPES: ReadonlySet<PropertyType> = new Set(['select', 'status', 'multi_select'])
const NUMBER_TYPES: ReadonlySet<PropertyType> = new Set(['number', 'rating', 'unique_id'])
const DATE_TYPES: ReadonlySet<PropertyType> = new Set(['date', 'created_time', 'last_edited_time'])
const ACTOR_TYPES: ReadonlySet<PropertyType> = new Set(['created_by', 'last_edited_by'])
/** has:<property> asks the database for these (computed, never stored) */
const COMPUTED_TYPES: ReadonlySet<PropertyType> = new Set(['formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by'])
const COLORS: ReadonlySet<string> = new Set(COLOR_NAMES)
/** a person property, for "who is me" questions that are not about one property */
const PERSON_PROP: PropertyDef = { id: '__person__', name: '', type: 'person' }

export const isOptionType = (t: PropertyType) => OPTION_TYPES.has(t)
export const isNumberType = (t: PropertyType) => NUMBER_TYPES.has(t)
export const isDateType = (t: PropertyType) => DATE_TYPES.has(t)
export const isPersonType = (t: PropertyType) => t === 'person' || ACTOR_TYPES.has(t)
export const safeColor = (c: unknown): ColorName | undefined => (typeof c === 'string' && COLORS.has(c) && c !== 'default' ? (c as ColorName) : undefined)

/* ------------------------------------------------------------------ */
/* Folded text, cached per page object                                  */
/* ------------------------------------------------------------------ */

const titleCache = new WeakMap<Page, string>()
/** A page's title, folded (once per page version: an edited page is a new object). */
export function foldedTitle(p: Page): string {
  let v = titleCache.get(p)
  if (v === undefined) {
    v = fold(p.title || '')
    titleCache.set(p, v)
  }
  return v
}

const valueCache = new WeakMap<Page, Map<ID, string>>()
function foldedValue(row: Page, propId: ID): string {
  let m = valueCache.get(row)
  if (!m) valueCache.set(row, (m = new Map()))
  let v = m.get(propId)
  if (v === undefined) {
    const raw = row.properties?.[propId]
    v = fold(typeof raw === 'string' ? raw : typeof raw === 'number' ? String(raw) : '')
    m.set(propId, v)
  }
  return v
}

const nameCache = new Map<string, string>()
/** Option / person / agent names are few: folded once per name. */
function foldName(s: string): string {
  let v = nameCache.get(s)
  if (v === undefined) {
    if (nameCache.size > 5000) nameCache.clear()
    v = fold(s)
    nameCache.set(s, v)
  }
  return v
}

/* ------------------------------------------------------------------ */
/* The index                                                            */
/* ------------------------------------------------------------------ */

const indexCache = new WeakMap<readonly Page[], { databases: Record<ID, Database>; fx: FilterIndex }>()

/** The filter index of the search index's live pages (built once per pages array + databases map). */
export function filterIndexOf(pages: readonly Page[], databases: Record<ID, Database>): FilterIndex {
  const hit = indexCache.get(pages)
  if (hit && hit.databases === databases) return hit.fx
  const rowsByDb = new Map<ID, Page[]>()
  const dbPages: Page[] = []
  for (const p of pages) {
    if (p.kind === 'database' && databases[p.id]) dbPages.push(p)
    if (p.databaseId) {
      let list = rowsByDb.get(p.databaseId)
      if (!list) rowsByDb.set(p.databaseId, (list = []))
      list.push(p)
    }
  }
  const propsByName = new Map<string, PropRef[]>()
  const names = new Map<string, { name: string; norm: string; dbs: number; types: PropertyType[] }>()
  for (const dp of dbPages) {
    const db = databases[dp.id]
    for (const prop of db.properties ?? []) {
      const norm = foldName(prop.name || '')
      if (!norm) continue
      let refs = propsByName.get(norm)
      if (!refs) propsByName.set(norm, (refs = []))
      refs.push({ db, prop })
      const n = names.get(norm)
      if (n) {
        n.dbs++
        if (!n.types.includes(prop.type)) n.types.push(prop.type)
      } else names.set(norm, { name: prop.name.trim(), norm, dbs: 1, types: [prop.type] })
    }
  }
  const fx: FilterIndex = {
    pages,
    rowsByDb,
    dbPages,
    propsByName,
    names: [...names.values()].sort((a, b) => b.dbs - a.dbs || a.name.localeCompare(b.name)),
    memo: { keys: new Map(), counts: new Map() },
  }
  indexCache.set(pages, { databases, fx })
  return fx
}

/** The properties a key names: exact (folded) — with `prefix`, else every name starting with it (2+ characters). */
export function propsForKey(fx: FilterIndex, key: string, prefix = false): PropRef[] {
  const k = fold(key)
  if (!k) return []
  const exact = fx.propsByName.get(k)
  if (exact || !prefix) return exact ?? []
  if (k.length < 2) return []
  const memoKey = `^${k}`
  const hit = fx.memo.keys.get(memoKey)
  if (hit) return hit
  const out: PropRef[] = []
  for (const [norm, refs] of fx.propsByName) if (norm.startsWith(k)) out.push(...refs)
  fx.memo.keys.set(memoKey, out)
  return out
}

/** A property of a record type shown on a row of another type is not that row's (database/model/recordTypes foreignTo). */
const foreignTo = (prop: PropertyDef, row: Page) => !!prop.fromType && prop.fromType.id !== (row.recordType ?? null)

/* ------------------------------------------------------------------ */
/* Values                                                               */
/* ------------------------------------------------------------------ */

/** The options of one property a value names: exact name, a status group (with the exact ones), else a prefix. */
export function optionsFor(prop: PropertyDef, value: string): Set<ID> {
  const out = new Set<ID>()
  const opts = prop.options ?? []
  const v = fold(value)
  if (!v) return out
  for (const o of opts) if (foldName(o.name) === v) out.add(o.id)
  const group = prop.type === 'status' ? statusGroupOf(value) : null
  if (group) for (const o of opts) if (o.group === group) out.add(o.id)
  if (!out.size) for (const o of opts) if (foldName(o.name).startsWith(v)) out.add(o.id)
  return out
}

/** People a value names: "me", the exact name, else a name or a word of it starting with the value. */
function peopleFor(value: string, people: Person[]): string[] {
  const v = fold(value)
  if (!v) return []
  const exact = people.filter((p) => foldName(p.name) === v)
  if (exact.length) return exact.map((p) => p.id)
  return people.filter((p) => foldName(p.name).startsWith(v) || p.name.split(/\s+/).some((w) => foldName(w).startsWith(v))).map((p) => p.id)
}

function agentsFor(value: string, agents: FilterEnv['agents']): string[] {
  const v = fold(value)
  if (!v) return []
  const exact = agents.filter((a) => foldName(a.name) === v)
  return (exact.length ? exact : agents.filter((a) => foldName(a.name).startsWith(v))).map((a) => `agent:${a.id}`)
}

/** Who a person value means on a property (null: nobody). */
function personIds(prop: PropertyDef, value: string, env: FilterEnv): string[] {
  if (isMe(value)) {
    const me = env.me(prop)
    return me ? [me] : []
  }
  return peopleFor(value, env.people)
}

/** created_by / last_edited_by: who a value means — `me`, a member (team), an agent. */
interface ActorQuery {
  ids: Set<string>
  /** local workspace: "me" = every change not stamped by an agent */
  localMe: boolean
}
function actorQuery(value: string, env: FilterEnv): ActorQuery {
  const ids = new Set<string>(agentsFor(value, env.agents))
  let localMe = false
  if (isMe(value)) {
    if (env.team && env.meId) ids.add(env.meId)
    if (!env.team) localMe = true
  } else if (env.team) for (const id of peopleFor(value, env.people)) ids.add(id)
  return { ids, localMe }
}
const actorHits = (q: ActorQuery, stamp: unknown) =>
  (typeof stamp === 'string' && q.ids.has(stamp)) || (q.localMe && !(typeof stamp === 'string' && stamp.startsWith('agent:')))
const actorValid = (q: ActorQuery) => q.ids.size > 0 || q.localMe

/** A number filter value against one property (percent properties: a typed % or a magnitude above 1 is n / 100). */
function numberTarget(prop: PropertyDef, value: string, lang: FilterEnv['lang']): { cmp: ReturnType<typeof splitCmp>[0]; n: number } | null {
  const [cmp, rest] = splitCmp(value)
  let v = rest
  if (prop.type === 'unique_id') {
    const pre = (prop.idPrefix ?? '').trim().toLowerCase()
    if (pre && v.toLowerCase().startsWith(`${pre}-`)) v = v.slice(pre.length + 1)
  }
  const num = parseNumber(v, lang)
  if (!num) return null
  const fraction = prop.type === 'number' ? prop.numberFormat === 'percent' : prop.type === 'rollup' ? (prop.rollup?.fn ?? '').startsWith('percent_') : false
  const n = num.percent || (fraction && Math.abs(num.n) > 1) ? num.n / 100 : num.n
  return { cmp, n }
}

/** A date value's span in ms (a day without a time lasts the whole day). */
function dateSpan(v: unknown): [number, number] | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const d = v as { start?: unknown; end?: unknown }
  if (typeof d.start !== 'string') return null
  const s = dayMs(d.start)
  if (s === null) return null
  const endIso = typeof d.end === 'string' && d.end ? d.end : d.start
  let e = dayMs(endIso) ?? s
  if (!endIso.includes('T')) e += DAY - 1
  return [s, Math.max(s, e)]
}

/** Text of a computed value: strings, numbers, dates and lists of them. */
function computedText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map(computedText).filter(Boolean).join(' ')
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10)
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'number' && Number.isNaN(v))

type RowTest = (row: Page) => boolean

/**
 * A matcher for one property and a value — null when the value cannot match this property (an unknown
 * option, not a number, not a date …). Per row the work is a lookup (computed and related values aside).
 */
function propMatcher(db: Database, prop: PropertyDef, value: string, env: FilterEnv): RowTest | null {
  const id = prop.id
  const raw = (row: Page) => row.properties?.[id]
  switch (prop.type) {
    case 'title': {
      const v = fold(value)
      return v ? (row) => foldedTitle(row).includes(v) : null
    }
    case 'text':
    case 'url':
    case 'email':
    case 'phone': {
      const v = fold(value)
      return v ? (row) => foldedValue(row, id).includes(v) : null
    }
    case 'select':
    case 'status': {
      const set = optionsFor(prop, value)
      return set.size ? (row) => set.has(raw(row) as string) : null
    }
    case 'multi_select': {
      const set = optionsFor(prop, value)
      return set.size ? (row) => Array.isArray(raw(row)) && (raw(row) as string[]).some((x) => set.has(x)) : null
    }
    case 'person': {
      const ids = personIds(prop, value, env)
      return ids.length ? (row) => Array.isArray(raw(row)) && (raw(row) as string[]).some((x) => ids.includes(x)) : null
    }
    case 'created_by':
    case 'last_edited_by': {
      const q = actorQuery(value, env)
      if (!actorValid(q)) return null
      return (row) => actorHits(q, prop.type === 'created_by' ? row.createdBy : row.updatedBy)
    }
    case 'checkbox': {
      const b = parseBool(value)
      return b === null ? null : (row) => (raw(row) === true) === b
    }
    case 'number':
    case 'rating':
    case 'unique_id': {
      const target = numberTarget(prop, value, env.lang)
      if (!target) return null
      return (row) => {
        const v = raw(row)
        return typeof v === 'number' && compare(v, target.cmp, target.n)
      }
    }
    case 'date': {
      const r = dateRange(value, env.now)
      if (!r) return null
      return (row) => {
        const span = dateSpan(raw(row))
        return !!span && overlaps(r, span[0], span[1])
      }
    }
    case 'created_time':
    case 'last_edited_time': {
      const r = dateRange(value, env.now)
      if (!r) return null
      return (row) => overlaps(r, prop.type === 'created_time' ? row.createdAt : row.updatedAt)
    }
    case 'relation': {
      const v = fold(value)
      if (!v) return null
      return (row) => {
        const ids = raw(row)
        if (!Array.isArray(ids)) return false
        for (const rid of ids) {
          const p = typeof rid === 'string' ? env.pages[rid] : undefined
          if (p && foldedTitle(p).includes(v)) return true
        }
        return false
      }
    }
    default: {
      // formula, rollup, files (and anything else computed): the database computes, the value decides how to compare
      const v = fold(value)
      if (!v) return null
      const num = numberTarget(prop, value, env.lang)
      const range = dateRange(value, env.now)
      const bool = parseBool(value)
      return (row) => {
        const c = env.computed(db, prop, row)
        if (c === null || c === undefined) return false
        if (typeof c === 'number') return num ? compare(c, num.cmp, num.n) : foldName(String(c)).includes(v)
        if (c instanceof Date) {
          if (!range) return fold(computedText(c)).includes(v)
          const t = c.getTime()
          const midnight = c.getHours() === 0 && c.getMinutes() === 0
          return overlaps(range, t, midnight ? t + DAY - 1 : t)
        }
        if (typeof c === 'boolean') return bool !== null && c === bool
        return fold(computedText(c)).includes(v)
      }
    }
  }
}

/** Can this value match this property at all (validation)? */
function validFor(prop: PropertyDef, value: string, env: FilterEnv): boolean {
  if (isOptionType(prop.type)) return optionsFor(prop, value).size > 0
  if (isNumberType(prop.type)) return !!numberTarget(prop, value, env.lang)
  if (isDateType(prop.type)) return !!dateRange(value, env.now)
  if (prop.type === 'checkbox') return parseBool(value) !== null
  if (prop.type === 'person') return personIds(prop, value, env).length > 0
  if (ACTOR_TYPES.has(prop.type)) return actorValid(actorQuery(value, env))
  return !!fold(value)
}

/* ------------------------------------------------------------------ */
/* in: roots, @person                                                   */
/* ------------------------------------------------------------------ */

/** Pages `in:<value>` names: titles equal to it (databases first), else starting with it (2+ characters). At most 20. */
export function rootsFor(fx: FilterIndex, value: string): Page[] {
  const v = fold(value)
  if (!v) return []
  const exact: Page[] = []
  const pre: Page[] = []
  for (const p of fx.pages) {
    const t = foldedTitle(p)
    if (t === v) exact.push(p)
    else if (v.length >= 2 && t.startsWith(v)) pre.push(p)
  }
  const dbFirst = (a: Page, b: Page) => Number(b.kind === 'database') - Number(a.kind === 'database')
  return (exact.length ? exact : pre).sort(dbFirst).slice(0, 20)
}

/** `@x`: the ids of the people meant (me: who "me" is on a person property). */
function mentionedPeople(value: string, env: FilterEnv): string[] {
  if (isMe(value)) {
    const me = env.me(PERSON_PROP)
    return me ? [me] : []
  }
  return peopleFor(value, env.people)
}

/** The person / actor properties of each database, for `@x`. */
function personPropsOf(fx: FilterIndex, env: FilterEnv): Map<ID, PropertyDef[]> {
  const out = new Map<ID, PropertyDef[]>()
  for (const dp of fx.dbPages) {
    const db = env.databases[dp.id]
    if (!db) continue
    // created / edited by: team workspaces only (locally there is one author)
    const props = (db.properties ?? []).filter((p) => p.type === 'person' || (env.team && ACTOR_TYPES.has(p.type)))
    if (props.length) out.set(db.id, props)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Validation                                                           */
/* ------------------------------------------------------------------ */

/** Can the filter match anything (a chip) — or what to tell the person. */
export function validate(fx: FilterIndex, f: Filter, env: FilterEnv): true | Invalid {
  switch (f.kind) {
    case 'prop': {
      const refs = propsForKey(fx, f.key)
      if (!refs.length) return { hint: 'shell.palette.hint.unknownKey', vars: { key: f.key } }
      if (refs.some((r) => validFor(r.prop, f.value, env))) return true
      const first = refs[0].prop
      const key = first.name
      if (isNumberType(first.type)) return { hint: 'shell.palette.hint.number', vars: { key } }
      if (isDateType(first.type)) return { hint: 'shell.palette.hint.date', vars: { key } }
      if (first.type === 'person' || ACTOR_TYPES.has(first.type)) return { hint: 'shell.palette.hint.unknownPerson', vars: { value: f.value } }
      return { hint: 'shell.palette.hint.bad', vars: { key, value: f.value } }
    }
    case 'has':
      return propsForKey(fx, f.key).length ? true : { hint: 'shell.palette.hint.unknownKey', vars: { key: f.key } }
    case 'is': {
      const v = parseIs(f.value)
      if (!v || (v === 'private' && !env.team)) return { hint: 'shell.palette.hint.is', vars: { value: f.value } }
      return true
    }
    case 'date':
      return dateRange(f.value, env.now) ? true : { hint: 'shell.palette.hint.date', vars: { key: f.key } }
    case 'in':
      return rootsFor(fx, f.value).length ? true : { hint: 'shell.palette.hint.noPage', vars: { value: f.value } }
    case 'person': {
      if (mentionedPeople(f.value, env).length) return true
      return isMe(f.value) ? { hint: 'shell.palette.hint.noMe' } : { hint: 'shell.palette.hint.unknownPerson', vars: { value: f.value } }
    }
    case 'by':
      return actorValid(actorQuery(f.value, env)) ? true : { hint: 'shell.palette.hint.unknownPerson', vars: { value: f.value } }
  }
}

/* ------------------------------------------------------------------ */
/* Evaluation                                                           */
/* ------------------------------------------------------------------ */

/** true: matches · false: could, but does not · null: not something the filter can ask (no such property). */
type Test = (row: Page) => boolean | null

function compile(fx: FilterIndex, f: Filter, env: FilterEnv, memo: Map<ID, boolean>): Test {
  switch (f.kind) {
    case 'prop':
    case 'has': {
      const byDb = new Map<ID, Array<[PropertyDef, RowTest | null]>>()
      for (const { db, prop } of propsForKey(fx, f.key)) {
        let m: RowTest | null
        if (f.kind === 'has') {
          if (prop.type === 'checkbox') m = (row) => row.properties?.[prop.id] === true
          else if (COMPUTED_TYPES.has(prop.type)) m = (row) => !isEmpty(env.computed(db, prop, row))
          else m = (row) => !isEmpty(row.properties?.[prop.id])
        } else m = propMatcher(db, prop, f.value, env)
        let list = byDb.get(db.id)
        if (!list) byDb.set(db.id, (list = []))
        list.push([prop, m])
      }
      return (row) => {
        const list = row.databaseId ? byDb.get(row.databaseId) : undefined
        if (!list) return null
        let inDomain = false
        for (const [prop, m] of list) {
          if (foreignTo(prop, row)) continue
          inDomain = true
          if (m && m(row)) return true
        }
        return inDomain ? false : null
      }
    }
    case 'in': {
      const roots = new Set(rootsFor(fx, f.value).map((p) => p.id))
      const under = (p: Page): boolean => {
        const hit = memo.get(p.id)
        if (hit !== undefined) return hit
        const seen: ID[] = []
        let cur: Page | undefined = p
        let out = false
        for (let hops = 0; cur && hops < 64; hops++) {
          const parent: ID | null = cur.parentId ?? cur.databaseId ?? null
          if (!parent) break
          if (roots.has(parent)) {
            out = true
            break
          }
          const known = memo.get(parent)
          if (known !== undefined) {
            out = known
            break
          }
          seen.push(parent)
          cur = env.pages[parent]
        }
        memo.set(p.id, out)
        for (const id of seen) memo.set(id, out)
        return out
      }
      return (row) => under(row)
    }
    case 'is': {
      const v = parseIs(f.value)
      return (p) => {
        switch (v) {
          case 'favorite':
            return !!p.favorite
          case 'row':
            return !!p.databaseId
          case 'page':
            return p.kind === 'page' && !p.databaseId
          case 'database':
            return p.kind === 'database'
          case 'private':
            return env.team && !!p.private
          default:
            return false
        }
      }
    }
    case 'date': {
      const r = dateRange(f.value, env.now)
      if (!r) return () => false
      return (p) => overlaps(r, f.key === 'created' ? p.createdAt : p.updatedAt)
    }
    case 'person': {
      const ids = mentionedPeople(f.value, env)
      const props = personPropsOf(fx, env)
      return (row) => {
        const list = row.databaseId ? props.get(row.databaseId) : undefined
        if (!list || !ids.length) return false
        for (const prop of list) {
          if (foreignTo(prop, row)) continue
          if (prop.type === 'person') {
            const v = row.properties?.[prop.id]
            if (Array.isArray(v) && v.some((x) => ids.includes(x))) return true
          } else {
            const stamp = prop.type === 'created_by' ? row.createdBy : row.updatedBy
            if (typeof stamp === 'string' && ids.includes(stamp)) return true
          }
        }
        return false
      }
    }
    case 'by': {
      const q = actorQuery(f.value, env)
      return (p) => actorHits(q, p.createdBy) || actorHits(q, p.updatedBy)
    }
  }
}

const ORDER: Filter['kind'][] = ['in', 'prop', 'has', 'person', 'is', 'date', 'by']

/** A filter's group: the same filter twice means either; negated ones all apply. */
export const groupKey = (f: Filter) => `${f.kind}|${f.neg ? '-' : '+'}|${fold(f.key)}`
/** Two filters that mean the same (chips dedupe). */
export const filterKey = (f: Filter) => `${groupKey(f)}|${fold(f.value)}`

/** The live pages that match every filter group (index order). */
export function applyFilters(fx: FilterIndex, filters: Filter[], env: FilterEnv): Page[] {
  const groups = new Map<string, Filter[]>()
  for (const f of filters) {
    const k = groupKey(f)
    const g = groups.get(k)
    if (g) {
      if (!g.some((x) => fold(x.value) === fold(f.value))) g.push(f)
    } else groups.set(k, [f])
  }
  const sorted = [...groups.values()].sort((a, b) => ORDER.indexOf(a[0].kind) - ORDER.indexOf(b[0].kind))
  let cur: readonly Page[] = fx.pages
  for (const group of sorted) {
    const memo = new Map<ID, boolean>()
    const tests = group.map((f) => compile(fx, f, env, memo))
    if (group[0].neg) cur = cur.filter((row) => tests.every((t) => t(row) === false))
    else cur = cur.filter((row) => tests.some((t) => t(row) === true))
    if (!cur.length) break
  }
  return cur as Page[]
}

/* ------------------------------------------------------------------ */
/* What a result shows                                                  */
/* ------------------------------------------------------------------ */

function firstOptionColor(prop: PropertyDef, v: unknown): ColorName | undefined {
  if (!isOptionType(prop.type)) return undefined
  const id = Array.isArray(v) ? v[0] : v
  return safeColor(prop.options?.find((o) => o.id === id)?.color)
}

/** The values a row was found by (under its title): Status · Done, Owner · Alex, Edited · 8 Oct 2026. */
export function matchedValues(fx: FilterIndex, filters: Filter[], row: Page, env: FilterEnv, t: Translate, limit = 3): ShownValue[] {
  const out: ShownValue[] = []
  const seen = new Set<string>()
  const db = row.databaseId ? env.databases[row.databaseId] : undefined
  const push = (key: string, v: ShownValue) => {
    if (seen.has(key) || out.length >= limit) return
    seen.add(key)
    out.push(v)
  }
  for (const f of filters) {
    if (out.length >= limit) break
    if ((f.kind === 'prop' || f.kind === 'has') && db) {
      const ref = propsForKey(fx, f.key).find((r) => r.db.id === db.id && !foreignTo(r.prop, row))
      if (!ref || ref.prop.type === 'title') continue
      const text = env.text(db, ref.prop, row).trim()
      push(ref.prop.id, { name: ref.prop.name, text: text || '—', color: firstOptionColor(ref.prop, row.properties?.[ref.prop.id]) })
    } else if (f.kind === 'person' && db && !f.neg) {
      const ids = mentionedPeople(f.value, env)
      const prop = (db.properties ?? []).find((p) => p.type === 'person' && !foreignTo(p, row) && Array.isArray(row.properties?.[p.id]) && (row.properties[p.id] as string[]).some((x) => ids.includes(x)))
      if (prop) push(prop.id, { name: prop.name, text: env.text(db, prop, row) })
    } else if (f.kind === 'date') {
      const at = f.key === 'created' ? row.createdAt : row.updatedAt
      const text = new Intl.DateTimeFormat(env.lang === 'de' ? 'de-DE' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(at))
      push(`#${f.key}`, { name: t(`shell.palette.kw.${f.key}`), text })
    }
  }
  return out
}

/** How a chip reads: the property's own name (or the keyword), the value as the workspace spells it. */
export function chipLabel(fx: FilterIndex, f: Filter, env: FilterEnv, t: Translate): { key: string; value: string; color?: ColorName; neg: boolean } {
  const neg = f.neg
  switch (f.kind) {
    case 'prop': {
      const refs = propsForKey(fx, f.key)
      const name = refs[0]?.prop.name ?? f.key
      for (const { prop } of refs) {
        if (!isOptionType(prop.type)) continue
        const exact = (prop.options ?? []).find((o) => foldName(o.name) === fold(f.value))
        if (exact) return { key: name, value: exact.name, color: safeColor(exact.color), neg }
      }
      const group = refs.some((r) => r.prop.type === 'status') ? statusGroupOf(f.value) : null
      if (group) return { key: name, value: t(`database.status.group.${group}`), neg }
      for (const { prop } of refs) {
        if (!isOptionType(prop.type)) continue
        const set = optionsFor(prop, f.value)
        const o = (prop.options ?? []).find((x) => set.has(x.id))
        if (o) return { key: name, value: o.name, color: safeColor(o.color), neg }
      }
      if (refs.some((r) => r.prop.type === 'person') && isMe(f.value)) return { key: name, value: t('shell.palette.me'), neg }
      if (refs.some((r) => r.prop.type === 'person')) {
        const id = peopleFor(f.value, env.people)[0]
        const p = env.people.find((x) => x.id === id)
        if (p) return { key: name, value: p.name, neg }
      }
      if (refs.some((r) => r.prop.type === 'checkbox')) {
        const b = parseBool(f.value)
        if (b !== null) return { key: name, value: t(b ? 'database.yes' : 'database.no'), neg }
      }
      return { key: name, value: f.value, neg }
    }
    case 'has': {
      const name = propsForKey(fx, f.key)[0]?.prop.name ?? f.key
      return { key: t('shell.palette.kw.has'), value: name, neg }
    }
    case 'is': {
      const v = parseIs(f.value)
      return { key: t('shell.palette.kw.is'), value: v ? t(`shell.palette.is.${v}`) : f.value, neg }
    }
    case 'date':
      return { key: t(`shell.palette.kw.${f.key === 'created' ? 'created' : 'edited'}`), value: dateLabel(f.value, t), neg }
    case 'in': {
      const root = rootsFor(fx, f.value)[0]
      return { key: t('shell.palette.kw.in'), value: root ? root.title.trim() || t('common.untitled') : f.value, neg }
    }
    case 'person': {
      if (isMe(f.value)) return { key: '@', value: t('shell.palette.me'), neg }
      const id = peopleFor(f.value, env.people)[0]
      return { key: '@', value: env.people.find((p) => p.id === id)?.name ?? f.value, neg }
    }
    case 'by': {
      if (isMe(f.value)) return { key: t('shell.palette.kw.by'), value: t('shell.palette.me'), neg }
      const agent = agentsFor(f.value, env.agents)[0]
      if (agent) return { key: t('shell.palette.kw.by'), value: env.agents.find((a) => `agent:${a.id}` === agent)?.name ?? f.value, neg }
      const id = peopleFor(f.value, env.people)[0]
      return { key: t('shell.palette.kw.by'), value: env.people.find((p) => p.id === id)?.name ?? f.value, neg }
    }
  }
}

/** The date presets as words (`7d` → "Last 7 days"); anything else as typed. */
export function dateLabel(value: string, t: Translate): string {
  const v = value.trim().toLowerCase()
  const key = DATE_WORDS[v]
  return key ? t(`shell.palette.date.${key}`) : value
}

const DATE_WORDS: Record<string, string> = {
  today: 'today',
  heute: 'today',
  yesterday: 'yesterday',
  gestern: 'yesterday',
  '7d': '7d',
  '7t': '7d',
  '30d': '30d',
  '30t': '30d',
  '>30d': 'older30',
  '>30t': 'older30',
  month: 'month',
  monat: 'month',
  week: 'week',
  woche: 'week',
}
