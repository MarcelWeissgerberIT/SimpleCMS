import Fuse, { type FuseResultMatch } from 'fuse.js'
import type { ID, Page } from '../../store/types'
import { inTemplate, isEffectivelyTrashed } from '../../store/selectors'

export type Range = [number, number]

export interface SearchHit {
  page: Page
  /** What matched: the title (exact, prefix, substring or fuzzy) or only the body text. */
  field: 'title' | 'content'
  titleRanges: Range[]
  snippet: { text: string; ranges: Range[] } | null
}

interface Entry {
  page: Page
  title: string
  plain: string
  /** the title's words (word-prefix matches) */
  words: string[]
  /** how often each character occurs in the title (see bucket); counted on the first fuzzy search */
  counts?: Uint8Array
}

export interface SearchIndex {
  entries: Entry[]
  /** Fuse over every title (queries of more than 32 characters), built on first use */
  all?: Fuse<Entry>
}

const WORD_SPLIT = /[\s\-_/.,:;()[\]"'“”„’]+/

/**
 * Character buckets: a–z one each, digits and everything else share a few. A shared bucket only
 * makes a title look as if it had more of a character than it has — never fewer.
 */
const bucket = (c: number) => (c >= 97 && c <= 122 ? c - 97 : (c >= 48 && c <= 57 ? 26 : 29) + (c % 3))

function countsOf(text: string): Uint8Array {
  const n = new Uint8Array(32)
  for (let i = 0; i < text.length; i++) {
    const b = bucket(text.charCodeAt(i))
    if (n[b] < 255) n[b]++
  }
  return n
}

/** Per page object (immutable: an edited page is a new object): lower-casing happens once per version, not per opening. */
const entryCache = new WeakMap<Page, Entry>()

function entryOf(page: Page): Entry {
  let e = entryCache.get(page)
  if (!e) {
    const title = (page.title || '').toLowerCase()
    e = { page, title, plain: (page.plain || '').toLowerCase(), words: title.split(WORD_SPLIT) }
    entryCache.set(page, e)
  }
  return e
}

/** Per pages map: opening the palette again without a change in between reuses the index. */
const indexCache = new WeakMap<Record<ID, Page>, SearchIndex>()

/** Every live page — a page under a trashed parent is in the trash too; template pages stay out. */
export function buildIndex(pages: Record<ID, Page>): SearchIndex {
  const hit = indexCache.get(pages)
  if (hit) return hit
  const entries: Entry[] = []
  for (const id of Object.keys(pages)) {
    const p = pages[id]
    if (!p.trashed && !isEffectivelyTrashed(pages, id) && !inTemplate(pages, id)) entries.push(entryOf(p))
  }
  const index: SearchIndex = { entries }
  indexCache.set(pages, index)
  return index
}

/** Fuzzy matching on titles only — catches typos without dragging in random body text. */
const FUZZY = { keys: ['page.title'], includeMatches: true, includeScore: true, ignoreLocation: true, threshold: 0.3, minMatchCharLength: 2 }

/**
 * Fuzzy title hits (Fuse) for `q`. Fuse's bitap allows at most ⌊threshold × length⌋ edits, and each
 * query character a title has fewer of costs one: titles short of more cannot match and are left
 * out before Fuse runs. Scores do not depend on the other titles, and the candidates keep the
 * index order (Fuse breaks ties by it), so the hits are exactly those of a search over every
 * title — for a fraction of the work on a big workspace.
 */
function fuzzyTitles(index: SearchIndex, q: string, limit: number) {
  // Fuse splits a query of more than 32 characters into parts that match on their own: no shortcut
  if (q.length > 32) return (index.all ??= new Fuse(index.entries, FUZZY)).search(q, { limit })
  let edits = 0
  while ((edits + 1) / q.length <= FUZZY.threshold) edits++
  const need = countsOf(q)
  const used: number[] = []
  for (let b = 0; b < need.length; b++) if (need[b]) used.push(b)
  const possible = (e: Entry) => {
    const counts = (e.counts ??= countsOf(e.title))
    let missing = 0
    for (const b of used) {
      const short = need[b] - counts[b]
      if (short > 0 && (missing += short) > edits) return false
    }
    return true
  }
  const candidates = index.entries.filter(possible)
  return candidates.length ? new Fuse(candidates, FUZZY).search(q, { limit }) : []
}

/** Case-insensitive substring ranges for every whitespace-separated term. */
function substringRanges(text: string, query: string): Range[] {
  const lower = text.toLowerCase()
  const out: Range[] = []
  for (const term of query.toLowerCase().split(/\s+/).filter((x) => x.length > 0)) {
    let from = 0
    let i: number
    let guard = 0
    while ((i = lower.indexOf(term, from)) >= 0 && guard++ < 50) {
      out.push([i, i + term.length - 1])
      from = i + term.length
    }
  }
  return merge(out.sort((a, b) => a[0] - b[0]))
}

function merge(ranges: Range[]): Range[] {
  const out: Range[] = []
  for (const r of ranges) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1])
    else out.push([r[0], r[1]])
  }
  return out
}

function fuseRanges(m: FuseResultMatch | undefined): Range[] {
  if (!m) return []
  return (m.indices as ReadonlyArray<readonly [number, number]>).filter(([a, b]) => b - a >= 1).map(([a, b]) => [a, b] as Range)
}

/** Ranks from here on are body-text matches. */
const CONTENT_RANK = 6
/** Fuzzy title hits rank from here (after every exact / prefix / substring title hit). */
const FUZZY_RANK = 4

interface Ranked {
  e: Entry
  score: number
  fuzzy?: Range[]
}

/** Lower first: rank, then the most recently edited. */
const rankOrder = (a: Ranked, b: Ranked) => a.score - b.score || b.e.page.updatedAt - a.e.page.updatedAt

/**
 * Keep the best `limit` in order while offering every hit: the same list as sorting all hits
 * (stably) and taking the first `limit`, without sorting thousands of body-text hits per keystroke.
 */
function offer(top: Ranked[], limit: number, r: Ranked) {
  if (top.length >= limit && rankOrder(r, top[top.length - 1]) >= 0) return
  // after every entry that ranks the same (a stable sort keeps the earlier one first)
  let lo = 0
  let hi = top.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (rankOrder(r, top[mid]) < 0) hi = mid
    else lo = mid + 1
  }
  top.splice(lo, 0, r)
  if (top.length > limit) top.pop()
}

/**
 * Ranked search: exact / prefix / word-prefix / substring title hits first, then fuzzy
 * title hits (typos, 4+ characters), then pages whose body contains every term.
 * Body text is matched literally — no fuzzy noise from long documents.
 */
export function search(index: SearchIndex, query: string, limit = 30): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q || limit <= 0) return []
  const terms = q.split(/\s+/).filter(Boolean)
  /** -1: no literal hit */
  const scoreOf = (e: Entry): number => {
    const title = e.title
    let score = -1
    if (title === q) score = 0
    else if (title.startsWith(q)) score = 1
    else if (e.words.some((w) => w.startsWith(q))) score = 2
    else if (title.includes(q)) score = 3
    else if (terms.length > 1 && terms.every((t) => title.includes(t))) score = 3.5
    else if (terms.every((t) => title.includes(t) || e.plain.includes(t))) score = e.plain.includes(q) ? CONTENT_RANK : CONTENT_RANK + 0.5
    if (score < 0) return -1
    // databases and pages a hair ahead of rows at equal rank
    return e.page.databaseId ? score + 0.2 : score
  }
  const ranked: Ranked[] = []
  let titleHits = 0

  for (const e of index.entries) {
    const score = scoreOf(e)
    if (score < 0) continue
    if (score < FUZZY_RANK) titleHits++
    offer(ranked, limit, { e, score })
  }

  // fuzzy title hits rank below every other title hit: with `limit` of those, none would show
  if (q.length >= 4 && titleHits < limit) {
    for (const r of fuzzyTitles(index, q, 20)) {
      if (scoreOf(r.item) >= 0 || (r.score ?? 1) > 0.3) continue
      offer(ranked, limit, { e: r.item, score: FUZZY_RANK + (r.score ?? 0), fuzzy: fuseRanges(r.matches?.[0]) })
    }
  }

  return ranked.map(({ e, score, fuzzy }) => {
    const page = e.page
    const title = page.title || ''
    const titleSub = substringRanges(title, q)
    const titleRanges = titleSub.length ? titleSub : (fuzzy ?? [])
    let snippet: SearchHit['snippet'] = null
    const plain = page.plain || ''
    const ranges = plain ? substringRanges(plain, q) : []
    if (ranges.length && !titleSub.length) {
      const [a, b] = ranges[0]
      const start = Math.max(0, a - 48)
      const end = Math.min(plain.length, b + 90)
      const pre = start > 0 ? '…' : ''
      // newline → space keeps character offsets stable for highlighting
      const text = pre + plain.slice(start, end).replace(/\n/g, ' ') + (end < plain.length ? '…' : '')
      const shift = pre.length - start
      snippet = {
        text,
        ranges: ranges.filter(([x, y]) => x >= start && y < end).map(([x, y]) => [x + shift, y + shift] as Range),
      }
    }
    return { page, field: score < CONTENT_RANK ? 'title' : 'content', titleRanges, snippet }
  })
}
