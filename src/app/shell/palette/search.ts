import Fuse, { type FuseResultMatch } from 'fuse.js'
import type { ID, Page } from '../../store/types'

export type Range = [number, number]

export interface SearchHit {
  page: Page
  titleRanges: Range[]
  snippet: { text: string; ranges: Range[] } | null
}

export function buildIndex(pages: Record<ID, Page>): Fuse<Page> {
  const list = Object.values(pages).filter((p) => !p.trashed)
  return new Fuse(list, {
    keys: [
      { name: 'title', weight: 3 },
      { name: 'plain', weight: 1 },
    ],
    includeMatches: true,
    includeScore: true,
    ignoreLocation: true,
    threshold: 0.34,
    minMatchCharLength: 2,
  })
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
  return out.sort((a, b) => a[0] - b[0])
}

function fuseRanges(m: FuseResultMatch | undefined): Range[] {
  if (!m) return []
  return (m.indices as ReadonlyArray<readonly [number, number]>).filter(([a, b]) => b - a >= 1).map(([a, b]) => [a, b] as Range)
}

export function search(fuse: Fuse<Page>, query: string, limit = 30): SearchHit[] {
  const q = query.trim()
  if (!q) return []
  return fuse.search(q, { limit }).map((r) => {
    const page = r.item
    const title = page.title || ''
    const titleSub = substringRanges(title, q)
    const titleRanges = titleSub.length ? titleSub : fuseRanges(r.matches?.find((m) => m.key === 'title'))
    let snippet: SearchHit['snippet'] = null
    const plain = page.plain || ''
    const plainSub = substringRanges(plain, q)
    const ranges = plainSub.length ? plainSub : fuseRanges(r.matches?.find((m) => m.key === 'plain'))
    if (ranges.length && plain) {
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
