/**
 * ⌘K's find mode: the query, its chips (complete filters), the filtered pages, the search hits and the
 * suggestions for the token being typed. The work per key is a filter pass over the search index's
 * array of live pages (no page-map walk) and the existing ranked search, limited to the filtered pages.
 */
import { useMemo, useState } from 'react'
import { useWorkspace } from '../../store/store'
import type { Page } from '../../store/types'
import { useT } from '../../i18n'
import { buildIndex, search, type SearchHit, type SearchIndex } from './search'
import { MAX_CHIPS, parseQuery, takeFilters, type Filter, type ParsedQuery, type QueryVocab } from './query'
import { applyFilters, filterIndexOf, filterKey, propsForKey, validate, type FilterEnv, type FilterIndex } from './filters'
import { suggest, type Suggestion, type Suggestions } from './suggest'
import { filterEnv } from './env'
import { visitScore } from '../lib/visits'

export type Mode = 'find' | 'run' | 'ask'

export const modeOf = (q: string): Mode => (q.startsWith('>') ? 'run' : q.startsWith('?') ? 'ask' : 'find')

/** Rows shown for filters without words (newest first). */
export const FILTER_ROWS = 50

export interface Find {
  q: string
  mode: Mode
  /** the chips (find mode only) */
  chips: Filter[]
  /** every path that changes the query goes through here: chips form, `>` / `?` drop them */
  setQuery: (v: string) => void
  removeChip: (i: number) => void
  popChip: () => void
  /** take a suggestion into the input (a complete one becomes a chip) */
  accept: (s: Suggestion) => void
  index: SearchIndex
  fx: FilterIndex
  env: FilterEnv
  parsed: ParsedQuery
  /** chips + the valid filters still in the input (the one being typed counts) */
  active: Filter[]
  filtering: boolean
  /** the words to search for (complete filters that match nothing stay words: the search never shrinks) */
  text: string
  hits: SearchHit[]
  /** filtered pages without words: how many match (more than are shown) */
  total: number | null
  sugs: Suggestions
  /** a change of chips (the palette selects its first row again) */
  rev: number
}

export function useFind(initial: string): Find {
  const t = useT()
  const pages = useWorkspace((s) => s.pages)
  const databases = useWorkspace((s) => s.databases)
  const people = useWorkspace((s) => s.people)
  const agents = useWorkspace((s) => s.agents)
  const lang = useWorkspace((s) => s.settings.language)
  // one "now" per opening: date filters and the formula cache stay put while typing
  const [now] = useState(() => Date.now())
  const index = useMemo(() => buildIndex(pages), [pages])
  const fx = useMemo(() => filterIndexOf(index.pages, databases), [index, databases])
  const env = useMemo(() => filterEnv({ pages, databases, people, lang, agents }, now), [pages, databases, people, lang, agents, now])
  const vocab = useMemo<QueryVocab>(() => ({ isProp: (k) => propsForKey(fx, k).length > 0 }), [fx])

  /** Split typed text into new chips (complete, valid filters) and the rest. */
  const take = (v: string, cur: Filter[]): { q: string; chips: Filter[] } => {
    // > / ?: the chips go (the same empty list when there were none: nothing to re-select)
    if (modeOf(v) !== 'find') return { q: v, chips: cur.length ? [] : cur }
    const { filters, rest } = takeFilters(v, (f) => validate(fx, f, env) === true, vocab)
    if (!filters.length) return { q: v, chips: cur }
    const keys = new Set(cur.map(filterKey))
    const next = [...cur]
    for (const f of filters) {
      if (next.length >= MAX_CHIPS) break
      if (keys.has(filterKey(f))) continue
      keys.add(filterKey(f))
      next.push(f)
    }
    return { q: rest, chips: next }
  }

  const [state, setState] = useState(() => ({ ...take(initial, []), rev: 0 }))
  const { q, chips, rev } = state
  const mode = modeOf(q)

  const setQuery = (v: string) =>
    setState((s) => {
      const next = take(v, s.chips)
      return { q: next.q, chips: next.chips, rev: next.chips !== s.chips ? s.rev + 1 : s.rev }
    })
  const removeChip = (i: number) => setState((s) => ({ q: s.q, chips: s.chips.filter((_, k) => k !== i), rev: s.rev + 1 }))
  const popChip = () => setState((s) => ({ q: s.q, chips: s.chips.slice(0, -1), rev: s.rev + 1 }))

  const parsed = useMemo(() => parseQuery(mode === 'find' ? q : '', vocab), [q, mode, vocab])
  const { active, text } = useMemo(() => {
    const valid: Filter[] = []
    const words: string[] = []
    for (const it of parsed.items) {
      if (typeof it === 'string') words.push(it)
      else if (validate(fx, it, env) === true) valid.push(it)
      // a finished filter that can match nothing searches as text, where it was typed — the one being typed waits
      else if (!it.open) words.push(it.raw)
    }
    return { active: mode === 'find' ? [...chips, ...valid] : [], text: words.join(' ') }
  }, [parsed, fx, env, chips, mode])
  const activeKey = active.map((f) => `${f.kind}|${f.neg ? '-' : ''}|${f.key}|${f.value}`).join('\n')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const matched = useMemo(() => (active.length ? applyFilters(fx, active, env) : null), [activeKey, fx, env])
  const only = useMemo(() => (matched ? new Set(matched.map((p) => p.id)) : null), [matched])

  const hits = useMemo<SearchHit[]>(() => {
    if (mode !== 'find') return []
    if (text.trim()) return search(index, text, 30, { only, boost: (id) => visitScore(id, now) })
    if (!matched) return []
    return [...matched]
      .sort((a: Page, b: Page) => b.updatedAt - a.updatedAt)
      .slice(0, FILTER_ROWS)
      .map((page) => ({ page, field: 'title' as const, titleRanges: [], snippet: null }))
  }, [mode, text, index, only, matched, now])

  const sugs = useMemo(() => (mode === 'find' ? suggest(parsed.partial, fx, env, t) : { items: [], place: 'top' as const }), [mode, parsed, fx, env, t])

  const accept = (s: Suggestion) => {
    const p = parsed.partial
    const before = q.slice(0, p ? p.start : q.length)
    const neg = p?.neg && !s.insert.startsWith('-') ? '-' : ''
    setQuery(`${before}${before && !/\s$/.test(before) ? ' ' : ''}${neg}${s.insert}${s.complete ? ' ' : ''}`)
  }

  return {
    q,
    mode,
    chips: mode === 'find' ? chips : [],
    setQuery,
    removeChip,
    popChip,
    accept,
    index,
    fx,
    env,
    parsed,
    active,
    filtering: active.length > 0,
    text: text.trim(),
    hits,
    total: matched && !text.trim() ? matched.length : null,
    sugs,
    rev,
  }
}
