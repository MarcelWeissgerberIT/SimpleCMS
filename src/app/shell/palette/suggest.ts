/**
 * ⌘K filter suggestions for the token being typed (query.ts `partial`) — pure, like filters.ts.
 *
 *   `@al`         → Me (only when it fits), Alex …            `in:pro`     → the Projects database, then pages
 *   `status:`     → the status groups, then every option      `is:`        → favorite, page, database, entry
 *   `edited:`     → today, yesterday, 7d, 30d, >30d, month     `has:`       → property names
 *   `done:`       → yes / no                                    `budget:`    → a hint (a number, >5, 60%)
 *   a bare word   → property names and keywords starting with it, under the results ("FILTER BY")
 *
 * Every suggestion inserts a whole token (the leading `-` is kept by the palette); `complete` ones end in a
 * space and become a chip. At most 8, deduplicated by what they insert (a status group beats an option of
 * the same name).
 */
import type { ColorName, ID, Page, PropertyType } from '../../store/types'
import type { Translate } from '@/shared/i18n'
import { fold, IS_NAMES, isMe, KEYWORD_NAMES, keyText, keywordOf, tokenText, type Filter, type PartialToken } from './query'
import { foldedTitle, isDateType, isNumberType, isOptionType, propsForKey, safeColor, validate, type FilterEnv, type FilterIndex, type PropRef } from './filters'

export interface Suggestion {
  /** unique within one list (the cmdk value is `sug:<id>`) */
  id: string
  /** the token that replaces the one being typed */
  insert: string
  label: string
  hint?: string
  color?: ColorName
  kind: 'key' | 'keyword' | 'option' | 'group' | 'person' | 'page' | 'database' | 'date' | 'is' | 'bool'
  /** key rows: the property type (TypeIcon) */
  type?: PropertyType
  /** true: becomes a chip (a space is appended) */
  complete: boolean
}

export interface Suggestions {
  items: Suggestion[]
  /** a line about the value being typed (a number, a date … or why it matches nothing) */
  hint?: string
  /** top: above the results (a value is being typed) · bottom: under them (a bare word that may be a key) */
  place: 'top' | 'bottom'
  /** what the list is about: a property name, a keyword, "@" */
  head?: string
}

export const MAX_SUGGESTIONS = 8

const DATE_PRESETS: Record<'en' | 'de', Array<[string, string]>> = {
  en: [
    ['today', 'today'],
    ['yesterday', 'yesterday'],
    ['7d', '7d'],
    ['30d', '30d'],
    ['>30d', 'older30'],
    ['month', 'month'],
  ],
  de: [
    ['heute', 'today'],
    ['gestern', 'yesterday'],
    ['7t', '7d'],
    ['30t', '30d'],
    ['>30t', 'older30'],
    ['monat', 'month'],
  ],
}

const GROUP_WORDS: Record<'en' | 'de', Array<['done' | 'in_progress' | 'todo', string]>> = {
  en: [
    ['done', 'done'],
    ['in_progress', 'in-progress'],
    ['todo', 'todo'],
  ],
  de: [
    ['done', 'erledigt'],
    ['in_progress', 'in-arbeit'],
    ['todo', 'offen'],
  ],
}

const BOOL_WORDS: Record<'en' | 'de', [string, string]> = { en: ['yes', 'no'], de: ['ja', 'nein'] }

const EMPTY: Suggestions = { items: [], place: 'top' }

/** First the ones starting with `v`, then the ones containing it; everything when `v` is empty. */
function rank<T>(list: T[], name: (x: T) => string, v: string): T[] {
  if (!v) return list
  const starts: T[] = []
  const has: T[] = []
  for (const x of list) {
    const n = fold(name(x))
    if (n.startsWith(v)) starts.push(x)
    else if (n.includes(v)) has.push(x)
  }
  return [...starts, ...has]
}

const rowsLabel = (n: number, t: Translate) => (n === 1 ? t('shell.palette.row') : t('shell.palette.rows', { n }))

/** Who "me" is in this language — offered only while the value is empty or a beginning of it. */
const meFits = (v: string, t: Translate) => !v || ['me', 'ich'].some((m) => m.startsWith(v)) || fold(t('shell.palette.me')).startsWith(v)

function parentPath(p: Page, pages: Record<ID, Page>, t: Translate): string {
  const parts: string[] = []
  let cur = p.parentId ? pages[p.parentId] : undefined
  for (let i = 0; cur && i < 6; i++) {
    parts.unshift(cur.title.trim() || t('common.untitled'))
    cur = cur.parentId ? pages[cur.parentId] : undefined
  }
  return parts.join(' / ')
}

/** How many rows hold each option of a key (folded option name → rows), once per key and index. */
function optionCounts(fx: FilterIndex, key: string, refs: PropRef[]): Map<string, number> {
  const k = fold(key)
  const hit = fx.memo.counts.get(k)
  if (hit) return hit
  const out = new Map<string, number>()
  for (const { db, prop } of refs) {
    if (!isOptionType(prop.type)) continue
    const names = new Map((prop.options ?? []).map((o) => [o.id, fold(o.name)]))
    for (const row of fx.rowsByDb.get(db.id) ?? []) {
      const v = row.properties?.[prop.id]
      for (const id of Array.isArray(v) ? v : [v]) {
        const n = typeof id === 'string' ? names.get(id) : undefined
        if (n) out.set(n, (out.get(n) ?? 0) + 1)
      }
    }
  }
  fx.memo.counts.set(k, out)
  return out
}

function peopleItems(keyPart: string, v: string, env: FilterEnv, t: Translate, agents = false): Suggestion[] {
  const out: Suggestion[] = []
  const at = keyPart === '@'
  if (meFits(v, t)) out.push({ id: 'me', insert: at ? '@me' : `${keyPart}:me`, label: t('shell.palette.me'), kind: 'person', complete: true })
  // the name or a word of it starts with what is typed
  const people = env.people.filter((p) => !v || fold(p.name).startsWith(v) || p.name.split(/\s+/).some((w) => fold(w).startsWith(v)))
  for (const p of people) out.push({ id: `person:${p.id}`, insert: at ? tokenText('@', p.name) : tokenText(keyPart, p.name), label: p.name, color: safeColor(p.color), kind: 'person', complete: true })
  if (agents)
    for (const a of rank(env.agents, (x) => x.name, v))
      out.push({ id: `agent:${a.id}`, insert: tokenText(keyPart, a.name), label: a.name, hint: t('shell.palette.agent'), kind: 'person', complete: true })
  return out
}

function dateItems(keyPart: string, v: string, env: FilterEnv, t: Translate): Suggestion[] {
  return DATE_PRESETS[env.lang]
    .filter(([word, key]) => !v || fold(word).startsWith(v) || fold(t(`shell.palette.date.${key}`)).startsWith(v))
    .map(([word, key]) => ({ id: `date:${key}`, insert: tokenText(keyPart, word), label: t(`shell.palette.date.${key}`), hint: word, kind: 'date' as const, complete: true }))
}

/** Suggestions for the token being typed. */
export function suggest(partial: PartialToken | null, fx: FilterIndex, env: FilterEnv, t: Translate): Suggestions {
  if (!partial) return EMPTY
  const v = fold(partial.value)
  const done = (s: Suggestions): Suggestions => {
    const seen = new Set<string>()
    const items: Suggestion[] = []
    for (const it of s.items) {
      const k = fold(it.insert)
      if (seen.has(k)) continue
      seen.add(k)
      items.push(it)
      if (items.length >= MAX_SUGGESTIONS) break
    }
    return { ...s, items }
  }

  /* ---------- @person */
  if (partial.person) {
    const items = peopleItems('@', v, env, t)
    const hint = partial.value && !items.length ? t('shell.palette.hint.unknownPerson', { value: partial.value }) : undefined
    return done({ items, hint, place: 'top', head: '@' })
  }

  /* ---------- a bare word: keys starting with it (under the results) */
  if (partial.key === null) {
    if (v.length < 2) return EMPTY
    const items: Suggestion[] = []
    for (const n of fx.names) {
      if (items.length >= 3) break
      if (!n.norm.startsWith(v)) continue
      items.push({
        id: `key:${n.norm}`,
        insert: `${keyText(n.name)}:`,
        label: n.name,
        hint: n.dbs > 1 ? t('shell.palette.inDbs', { n: n.dbs }) : undefined,
        kind: 'key',
        type: n.types[0],
        complete: false,
      })
    }
    for (const k of KEYWORD_NAMES[env.lang]) {
      if (items.length >= 3) break
      if (!fold(k.key).startsWith(v)) continue
      if (fx.propsByName.has(fold(k.key))) continue
      items.push({ id: `kw:${k.kind}`, insert: `${k.key}:`, label: `${k.key}:`, hint: t(`shell.palette.kwHint.${k.kind}`), kind: 'keyword', complete: false })
    }
    return done({ items, place: 'bottom', head: t('shell.palette.filterBy') })
  }

  /* ---------- key:value */
  const key = partial.key
  const keyPart = partial.quoted ? `"${key}"` : key
  const exactRefs = propsForKey(fx, key)
  let kw = partial.quoted ? null : keywordOf(key)
  if (kw === 'by' && exactRefs.length) kw = null
  // the value as a filter: why it matches nothing (once there is a value)
  const invalidHint = (): string | undefined => {
    if (!partial.value) return undefined
    const f: Filter =
      kw === 'edited' || kw === 'created'
        ? { kind: 'date', raw: partial.raw, neg: partial.neg, key: kw, value: partial.value }
        : kw === 'has'
          ? { kind: 'has', raw: partial.raw, neg: partial.neg, key: partial.value, value: '' }
          : kw
            ? { kind: kw, raw: partial.raw, neg: partial.neg, key, value: partial.value }
            : { kind: 'prop', raw: partial.raw, neg: partial.neg, key, value: partial.value }
    const r = validate(fx, f, env)
    if (r === true) return undefined
    const vars = { ...r.vars }
    if (vars.key && (kw === 'edited' || kw === 'created')) vars.key = t(`shell.palette.kw.${kw}`)
    return t(r.hint, vars)
  }

  if (kw === 'in') {
    const list: Page[] = []
    const dbs = rank(fx.dbPages, (p) => p.title, v)
    list.push(...dbs.slice(0, MAX_SUGGESTIONS))
    if (list.length < MAX_SUGGESTIONS && v) {
      const starts: Page[] = []
      const has: Page[] = []
      for (const p of fx.pages) {
        if (p.kind === 'database' || p.databaseId) continue
        const title = foldedTitle(p)
        if (title.startsWith(v)) starts.push(p)
        else if (has.length < MAX_SUGGESTIONS && title.includes(v)) has.push(p)
        if (starts.length >= MAX_SUGGESTIONS) break
      }
      list.push(...starts, ...has)
    }
    const items = list.map((p) => ({
      id: `page:${p.id}`,
      insert: tokenText(keyPart, p.title.trim()),
      label: p.title.trim() || t('common.untitled'),
      hint: parentPath(p, env.pages, t) || undefined,
      kind: p.kind === 'database' ? ('database' as const) : ('page' as const),
      complete: true,
    }))
    return done({ items, hint: items.length ? undefined : invalidHint(), place: 'top', head: t('shell.palette.kw.in') })
  }
  if (kw === 'is') {
    const items = IS_NAMES[env.lang]
      .filter(([value]) => value !== 'private' || env.team)
      .filter(([value, word]) => !v || fold(word).startsWith(v) || fold(t(`shell.palette.is.${value}`)).startsWith(v))
      .map(([value, word]) => ({ id: `is:${value}`, insert: tokenText(keyPart, word), label: t(`shell.palette.is.${value}`), hint: word, kind: 'is' as const, complete: true }))
    return done({ items, hint: items.length ? undefined : invalidHint(), place: 'top', head: t('shell.palette.kw.is') })
  }
  if (kw === 'has') {
    const items = rank(fx.names, (n) => n.name, v).map((n) => ({
      id: `has:${n.norm}`,
      insert: `${keyPart}:${keyText(n.name)}`,
      label: n.name,
      hint: n.dbs > 1 ? t('shell.palette.inDbs', { n: n.dbs }) : undefined,
      kind: 'key' as const,
      type: n.types[0],
      complete: true,
    }))
    return done({ items, place: 'top', head: t('shell.palette.kw.has') })
  }
  if (kw === 'edited' || kw === 'created') {
    const items = dateItems(keyPart, v, env, t)
    return done({ items, hint: items.length ? undefined : invalidHint() ?? t('shell.palette.hint.date', { key: t(`shell.palette.kw.${kw}`) }), place: 'top', head: t(`shell.palette.kw.${kw}`) })
  }
  if (kw === 'by') {
    const items = peopleItems(keyPart, v, env, t, true)
    return done({ items, hint: items.length ? undefined : invalidHint(), place: 'top', head: t('shell.palette.kw.by') })
  }

  /* ---------- a property */
  const refs = exactRefs.length ? exactRefs : propsForKey(fx, key, true)
  if (!refs.length) return EMPTY
  // typed only the beginning of a name ("stat:"): insert the whole key
  const kp = exactRefs.length ? keyPart : keyText(refs[0].prop.name)
  const name = refs[0].prop.name
  const types = refs.map((r) => r.prop.type)
  if (types.some(isOptionType)) {
    const items: Suggestion[] = []
    if (types.includes('status'))
      for (const [group, word] of GROUP_WORDS[env.lang]) {
        const label = t(`database.status.group.${group}`)
        if (v && !fold(word).startsWith(v) && !fold(label).startsWith(v)) continue
        // what the group holds: "Done · Finished · Published"
        const names = new Map<string, string>()
        for (const { prop } of refs) if (prop.type === 'status') for (const o of prop.options ?? []) if (o.group === group && !names.has(fold(o.name))) names.set(fold(o.name), o.name)
        const held = [...names.values()]
        const hint = held.length ? held.slice(0, 3).join(' · ') + (held.length > 3 ? ' …' : '') : t('shell.palette.group')
        items.push({ id: `group:${group}`, insert: tokenText(kp, word), label, hint, kind: 'group', complete: true })
      }
    const seen = new Map<string, { name: string; color?: ColorName }>()
    for (const { prop } of refs) for (const o of prop.options ?? []) if (!seen.has(fold(o.name))) seen.set(fold(o.name), { name: o.name, color: safeColor(o.color) })
    const all = [...seen.values()]
    let options = rank(all, (o) => o.name, v)
    // nothing fits what is typed: offer every option ("pick one below")
    const none = v && !options.length && !items.length
    if (none) options = all
    const counts = optionCounts(fx, key, refs)
    for (const o of options)
      items.push({ id: `opt:${fold(o.name)}`, insert: tokenText(kp, o.name), label: o.name, color: o.color, hint: rowsLabel(counts.get(fold(o.name)) ?? 0, t), kind: 'option', complete: true })
    return done({ items, hint: none ? invalidHint() : undefined, place: 'top', head: name })
  }
  if (types.some((x) => x === 'person' || x === 'created_by' || x === 'last_edited_by')) {
    const items = peopleItems(kp, v, env, t, types.some((x) => x === 'created_by' || x === 'last_edited_by'))
    return done({ items, hint: items.length ? undefined : invalidHint(), place: 'top', head: name })
  }
  if (types.includes('checkbox')) {
    const [yes, no] = BOOL_WORDS[env.lang]
    const items: Suggestion[] = [
      { id: 'bool:yes', insert: tokenText(kp, yes), label: t('database.yes'), kind: 'bool' as const, complete: true },
      { id: 'bool:no', insert: tokenText(kp, no), label: t('database.no'), kind: 'bool' as const, complete: true },
    ].filter((s) => !v || fold(s.insert.slice(kp.length + 1)).startsWith(v) || fold(s.label).startsWith(v))
    return done({ items, hint: items.length ? undefined : invalidHint(), place: 'top', head: name })
  }
  if (types.some(isDateType)) {
    const items = dateItems(kp, v, env, t)
    return done({ items, hint: invalidHint() ?? (items.length ? undefined : t('shell.palette.hint.date', { key: name })), place: 'top', head: name })
  }
  if (types.some(isNumberType)) return { items: [], hint: invalidHint() ?? t('shell.palette.hint.number', { key: name }), place: 'top', head: name }
  return { items: [], hint: t('shell.palette.hint.text', { key: name }), place: 'top', head: name }
}
