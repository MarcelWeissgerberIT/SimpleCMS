/** The draft field's "@" / "one:" picker: the person names their own pages (pages and databases, not rows). */
import { useWorkspace } from '../../../store/store'
import { inTemplate, isEffectivelyTrashed } from '../../../store/selectors'
import type { ID, Page } from '../../../store/types'

export interface MentionHit {
  id: ID
  title: string
  page: Page
}

export interface MentionQuery {
  /** where the token starts ("@" or "one:") and what follows it */
  from: number
  query: string
}

/** The token being typed before the caret: "@bas" or "one:bas" at a word start (no line break, ≤ 40 chars). */
export function mentionAt(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret)
  const one = /(^|\s)one:([^\n]{0,40})$/i.exec(before)
  if (one && !/\s$/.test(one[2])) return { from: before.length - one[2].length - 4, query: one[2] }
  const at = /(^|\s)@([^\n@]{0,40})$/.exec(before)
  if (at && !/\s$/.test(at[2])) return { from: before.length - at[2].length - 1, query: at[2] }
  return null
}

export function mentionHits(query: string, max = 6): MentionHit[] {
  const { pages } = useWorkspace.getState()
  const q = query.trim().toLowerCase()
  const scored: Array<{ p: Page; score: number }> = []
  for (const p of Object.values(pages)) {
    if (p.databaseId || p.trashed || p.hidden) continue
    const title = p.title.trim()
    if (!title) continue
    const lower = title.toLowerCase()
    const score = !q ? 3 : lower.startsWith(q) ? 0 : lower.includes(` ${q}`) ? 1 : lower.includes(q) ? 2 : -1
    if (score < 0) continue
    if (isEffectivelyTrashed(pages, p.id) || inTemplate(pages, p.id)) continue
    scored.push({ p, score })
  }
  scored.sort((a, b) => a.score - b.score || b.p.updatedAt - a.p.updatedAt)
  return scored.slice(0, max).map(({ p }) => ({ id: p.id, title: p.title.trim(), page: p }))
}

/** Rows of a database for the row finder: key or title matching, ≤ max. */
export function rowHits(dbId: ID, keyPropId: ID | null, query: string, max = 8): Array<{ id: ID; title: string; key: string }> {
  const { pages } = useWorkspace.getState()
  const q = query.trim().toLowerCase()
  const out: Array<{ id: ID; title: string; key: string; score: number }> = []
  for (const p of Object.values(pages)) {
    if (p.databaseId !== dbId || p.trashed) continue
    const key = keyPropId ? String(p.properties[keyPropId] ?? '') : ''
    const title = p.title.trim()
    const hay = `${key} ${title}`.toLowerCase()
    if (q && !hay.includes(q)) continue
    out.push({ id: p.id, title, key, score: q && key.toLowerCase().startsWith(q) ? 0 : 1 })
  }
  out.sort((a, b) => a.score - b.score || a.key.localeCompare(b.key, undefined, { numeric: true }) || a.title.localeCompare(b.title))
  return out.slice(0, max).map(({ score: _s, ...r }) => r)
}
