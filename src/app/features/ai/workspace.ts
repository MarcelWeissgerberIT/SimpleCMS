/**
 * "Ask your workspace": local retrieval (fuse.js over title + page text, including database
 * properties), then Claude answers from the retrieved pages with [[Page title]] citations.
 * Only the retrieved excerpts leave the device.
 */
import Fuse from 'fuse.js'
import { useWorkspace } from '../../store/store'
import { inTemplate, isEffectivelyTrashed } from '../../store/selectors'
import type { Database, ID, Page } from '../../store/types'
import { propertyValueToText } from '../../database'
import { WORKSPACE_SYSTEM, streamCompletion, streamDemoText, usesDemo } from './client'
import { demoWorkspaceAnswer } from './demo'

export interface WorkspaceSource {
  id: ID
  title: string
}

interface Doc {
  id: ID
  title: string
  text: string
}

const STOP = new Set(
  'the a an and or of to in on for with is are was were be been what which who whom how why when where do does did my our your we i you it this that these those about from at by as can could should would will shall there their them they me der die das und oder von zu im in am auf für mit ist sind war waren sein was welche welcher wer wie warum wann wo tun tut hat haben mein meine unser unsere dein deine ich du es dies diese dieser jene über aus bei als kann könnte sollte würde wird gibt ein eine einen einem'.split(
    ' ',
  ),
)

function keywords(q: string): string[] {
  return [...new Set(q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w)))].slice(0, 8)
}

function rowFacts(db: Database, row: Page): string {
  const parts: string[] = []
  for (const prop of db.properties) {
    if (prop.type === 'title') continue
    let v = ''
    try {
      v = propertyValueToText(db, prop, row)
    } catch {
      v = ''
    }
    if (v) parts.push(`${prop.name}: ${v}`)
  }
  return parts.join('; ')
}

/**
 * Searchable documents for every live page; database pages include a compact table of their rows.
 * Templates (features/templates) are not workspace content: their pages stay out.
 */
export function workspaceDocs(): Doc[] {
  const { pages, databases } = useWorkspace.getState()
  const docs: Doc[] = []
  for (const p of Object.values(pages)) {
    if (p.trashed || isEffectivelyTrashed(pages, p.id) || inTemplate(pages, p.id)) continue
    const title = p.title.trim() || 'Untitled'
    let text = p.plain ?? ''
    if (p.databaseId && databases[p.databaseId]) {
      const facts = rowFacts(databases[p.databaseId], p)
      const dbTitle = pages[p.databaseId]?.title?.trim()
      text = `${dbTitle ? `Entry in database "${dbTitle}". ` : ''}${facts}${text ? `\n${text}` : ''}`
    } else if (p.kind === 'database' && databases[p.id]) {
      const db = databases[p.id]
      const rows = Object.values(pages)
        .filter((r) => r.databaseId === p.id && !r.trashed)
        .sort((a, b) => a.order - b.order)
        .slice(0, 60)
      text = `Database with ${rows.length} entries:\n${rows.map((r) => `- ${r.title.trim() || 'Untitled'} — ${rowFacts(db, r)}`).join('\n')}${text ? `\n${text}` : ''}`
    }
    if (!title && !text.trim()) continue
    docs.push({ id: p.id, title, text })
  }
  return docs
}

/** Rank documents by relevance to a question. Exported for testing. */
export function retrieve(question: string, docs: Doc[], limit = 6): Doc[] {
  if (!docs.length) return []
  const fuse = new Fuse(docs, {
    keys: [
      { name: 'title', weight: 2 },
      { name: 'text', weight: 1 },
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
  const byId = new Map(docs.map((d) => [d.id, d]))
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => byId.get(id)!)
}

export async function askWorkspace(opts: {
  question: string
  onToken?: (delta: string) => void
  signal?: AbortSignal
  /** called as soon as retrieval is done, before streaming starts */
  onSources?: (sources: WorkspaceSource[]) => void
}): Promise<{ text: string; sources: WorkspaceSource[] }> {
  const hits = retrieve(opts.question, workspaceDocs())
  const sources = hits.map((d) => ({ id: d.id, title: d.title }))
  opts.onSources?.(sources)
  if (usesDemo()) {
    // demo (no key): answer from the retrieved pages themselves, with real citations
    const lang = useWorkspace.getState().settings.language === 'de' ? 'de' : 'en'
    const text = await streamDemoText(demoWorkspaceAnswer(opts.question, hits, keywords(opts.question), lang), opts.onToken, opts.signal)
    return { text: text.trim(), sources }
  }
  const excerpts = hits.map((d) => `<page title="${d.title.replace(/"/g, "'")}">\n${d.text.slice(0, 5000)}\n</page>`).join('\n\n')
  const today = new Date().toISOString().slice(0, 10)
  const prompt = `${excerpts || '<no matching pages />'}\n\nToday is ${today}.\nQuestion: ${opts.question.trim()}`
  const text = await streamCompletion({ system: WORKSPACE_SYSTEM, prompt, onToken: opts.onToken, signal: opts.signal })
  return { text: text.trim(), sources }
}

/** Replace [[Title]] citations with Markdown links to the cited pages (for inserting into a page). */
export function citationsToLinks(md: string, sources: WorkspaceSource[]): string {
  return md.replace(/\[\[([^\]\n]{1,200})\]\]/g, (_m, title: string) => {
    const hit = findSource(title, sources)
    return hit ? `[${hit.title}](#/p/${hit.id})` : title
  })
}

export function findSource(title: string, sources: WorkspaceSource[]): WorkspaceSource | undefined {
  const t = title.trim().toLowerCase()
  if (!t) return undefined
  return sources.find((s) => s.title.toLowerCase() === t) ?? sources.find((s) => s.title.toLowerCase().includes(t) || t.includes(s.title.toLowerCase()))
}
