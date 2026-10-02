/**
 * "Ask your workspace": local retrieval (fuse.js over title + page.plain), then Claude
 * answers from the retrieved pages with [[Page title]] citations.
 */
import Fuse from 'fuse.js'
import { useWorkspace } from '../../store/store'
import type { ID, Page } from '../../store/types'
import { WORKSPACE_SYSTEM, streamCompletion } from './client'

export interface WorkspaceSource {
  id: ID
  title: string
}

const STOP = new Set(
  'the a an and or of to in on for with is are was were be been what which who whom how why when where do does did my our your we i you it this that these those about from at by as can could should would will shall there their them they me der die das und oder von zu im in am auf für mit ist sind war waren sein was welche welcher wer wie warum wann wo tun tut hat haben mein meine unser unsere dein deine ich du es dies diese dieser jene über aus bei als kann könnte sollte würde wird gibt ein eine einen einem'.split(
    ' ',
  ),
)

function keywords(q: string): string[] {
  return [...new Set(q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w)))].slice(0, 8)
}

/** Rank pages by relevance to a question. Pure; exported for testing. */
export function retrievePages(question: string, pages: Page[], limit = 6): Page[] {
  const docs = pages.filter((p) => !p.trashed && (p.title.trim() || p.plain?.trim()))
  if (!docs.length) return []
  const fuse = new Fuse(docs, {
    keys: [
      { name: 'title', weight: 2 },
      { name: 'plain', weight: 1 },
    ],
    includeScore: true,
    ignoreLocation: true,
    threshold: 0.38,
    minMatchCharLength: 3,
  })
  const score = new Map<ID, number>()
  const add = (q: string, weight: number) => {
    for (const r of fuse.search(q, { limit: 24 })) score.set(r.item.id, (score.get(r.item.id) ?? 0) + weight * (1 - (r.score ?? 1)))
  }
  add(question, 2)
  for (const w of keywords(question)) add(w, 1)
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => docs.find((d) => d.id === id)!)
}

export async function askWorkspace(opts: {
  question: string
  onToken?: (delta: string) => void
  signal?: AbortSignal
  /** called as soon as retrieval is done, before streaming starts */
  onSources?: (sources: WorkspaceSource[]) => void
}): Promise<{ text: string; sources: WorkspaceSource[] }> {
  const pages = Object.values(useWorkspace.getState().pages)
  const hits = retrievePages(opts.question, pages)
  const sources = hits.map((p) => ({ id: p.id, title: p.title.trim() || 'Untitled' }))
  opts.onSources?.(sources)
  const excerpts = hits
    .map((p) => {
      const body = (p.plain ?? '').slice(0, 4000)
      return `<page title="${(p.title.trim() || 'Untitled').replace(/"/g, "'")}">\n${body}\n</page>`
    })
    .join('\n\n')
  const prompt = `${excerpts || '<no matching pages />'}\n\nQuestion: ${opts.question.trim()}`
  const text = await streamCompletion({ system: WORKSPACE_SYSTEM, prompt, onToken: opts.onToken, signal: opts.signal })
  return { text: text.trim(), sources }
}

/** Replace [[Title]] citations with Markdown links to the cited pages (for inserting into a page). */
export function citationsToLinks(md: string, sources: WorkspaceSource[]): string {
  return md.replace(/\[\[([^\]\n]{1,200})\]\]/g, (m, title: string) => {
    const hit = findSource(title, sources)
    return hit ? `[${hit.title}](#/p/${hit.id})` : title
  })
}

export function findSource(title: string, sources: WorkspaceSource[]): WorkspaceSource | undefined {
  const t = title.trim().toLowerCase()
  return sources.find((s) => s.title.toLowerCase() === t) ?? sources.find((s) => s.title.toLowerCase().includes(t) || t.includes(s.title.toLowerCase()))
}
