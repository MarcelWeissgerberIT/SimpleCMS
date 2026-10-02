import Fuse, { type FuseResultMatch } from 'fuse.js'
import type { ID, Page } from '../../store/types'

export type Range = [number, number]

export interface SearchHit {
  page: Page
  titleRanges: Range[]
  snippet: { text: string; ranges: Range[] } | null
}

interface Entry {
  page: Page
  title: string
  plain: string
}

export interface SearchIndex {
  entries: Entry[]
  /** Fuzzy matching on titles only — catches typos without dragging in random body text. */
  titles: Fuse<Entry>
}

export function buildIndex(pages: Record<ID, Page>): SearchIndex {
  const entries = Object.values(pages)
    .filter((p) => !p.trashed)
    .map((page) => ({ page, title: (page.title || '').toLowerCase(), plain: (page.plain || '').toLowerCase() }))
  const titles = new Fuse(entries, {
    keys: ['page.title'],
    includeMatches: true,
    includeScore: true,
    ignoreLocation: true,
    threshold: 0.3,
    minMatchCharLength: 2,
  })
  return { entries, titles }
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

const WORD_SPLIT = /[\s\-_/.,:;()[\]"'“”„’]+/

/**
 * Ranked search: exact / prefix / word-prefix / substring title hits first, then fuzzy
 * title hits (typos, 4+ characters), then pages whose body contains every term.
 * Body text is matched literally — no fuzzy noise from long documents.
 */
export function search(index: SearchIndex, query: string, limit = 30): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const terms = q.split(/\s+/).filter(Boolean)
  const ranked: Array<{ e: Entry; score: number; fuzzy?: Range[] }> = []
  const seen = new Set<ID>()

  for (const e of index.entries) {
    const title = e.title
    let score = -1
    if (title === q) score = 0
    else if (title.startsWith(q)) score = 1
    else if (title.split(WORD_SPLIT).some((w) => w.startsWith(q))) score = 2
    else if (title.includes(q)) score = 3
    else if (terms.length > 1 && terms.every((t) => title.includes(t))) score = 3.5
    else if (terms.every((t) => title.includes(t) || e.plain.includes(t))) score = e.plain.includes(q) ? 6 : 6.5
    if (score < 0) continue
    // databases and pages a hair ahead of rows at equal rank
    if (e.page.databaseId) score += 0.2
    ranked.push({ e, score })
    seen.add(e.page.id)
  }

  if (q.length >= 4) {
    for (const r of index.titles.search(q, { limit: 20 })) {
      if (seen.has(r.item.page.id) || (r.score ?? 1) > 0.3) continue
      ranked.push({ e: r.item, score: 4 + (r.score ?? 0), fuzzy: fuseRanges(r.matches?.[0]) })
      seen.add(r.item.page.id)
    }
  }

  ranked.sort((a, b) => a.score - b.score || b.e.page.updatedAt - a.e.page.updatedAt)

  return ranked.slice(0, limit).map(({ e, fuzzy }) => {
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
    return { page, titleRanges, snippet }
  })
}
