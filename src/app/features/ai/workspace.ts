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
import { precheck, type Prepared } from './core/gate'
import { routed, shapeOf, withShape, type Shape } from './core/shape'
import { ancestorClassesOf, type SourceWorld } from './core/sources'
import { rowFactsFor, type FactsContext } from './rowFacts'
import { MEMBER_CLASSES } from '@/shared/ai/policy'
import { docToMarkdown, readableContent } from '../../editor'
import type { Route, SourceRef } from '@/shared/ai/types'
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

/** Which pages a route may see while documents are collected (cheap: ancestors only; the synced-copy check runs on
 *  the ranking's candidates — D-S2-28). Absent: every page (a route that sees everything — today's loop). */
export interface DocsFilter {
  /** may the route see this page, judged by its ancestors (private, mail, memory) */
  quick: (id: ID) => boolean
}

/**
 * Searchable documents for every live page; database pages include a compact table of their rows.
 * Templates (features/templates) are not workspace content: their pages stay out. With a filter (a route that does not
 * see everything) pages it may not see are left out before ranking, and a database lists only rows it may see.
 */
export function workspaceDocs(filter?: DocsFilter | null): Doc[] {
  const { pages, databases } = useWorkspace.getState()
  const docs: Doc[] = []
  for (const p of Object.values(pages)) {
    if (p.trashed || isEffectivelyTrashed(pages, p.id) || inTemplate(pages, p.id)) continue
    if (filter && !filter.quick(p.id)) continue
    const title = p.title.trim() || 'Untitled'
    let text = p.plain ?? ''
    if (p.databaseId && databases[p.databaseId]) {
      const facts = rowFacts(databases[p.databaseId], p)
      const dbTitle = pages[p.databaseId]?.title?.trim()
      text = `${dbTitle ? `Entry in database "${dbTitle}". ` : ''}${facts}${text ? `\n${text}` : ''}`
    } else if (p.kind === 'database' && databases[p.id]) {
      const db = databases[p.id]
      const rows = Object.values(pages)
        .filter((r) => r.databaseId === p.id && !r.trashed && (!filter || filter.quick(r.id)))
        .sort((a, b) => a.order - b.order)
        .slice(0, 60)
      text = `Database with ${rows.length} entries:\n${rows.map((r) => `- ${r.title.trim() || 'Untitled'} — ${rowFacts(db, r)}`).join('\n')}${text ? `\n${text}` : ''}`
    }
    if (!title && !text.trim()) continue
    docs.push({ id: p.id, title, text })
  }
  return docs
}

/**
 * A retrieved page as a route that does not see everything receives it: its content as Markdown built inside the
 * request-text scope (names, transcripts, pages it may not see left out), a row's fields through rowFactsFor, a
 * database's summary with only the rows it may see.
 */
export function docForRoute(d: Doc, ctx: FactsContext): Doc {
  const { pages, databases } = useWorkspace.getState()
  const p = pages[d.id]
  if (!p) return d
  return withShape(ctx.shape, () => {
    const body = p.content ? docToMarkdown(p.content).trim() : ''
    if (p.databaseId && databases[p.databaseId]) {
      const facts = rowFactsFor(databases[p.databaseId], p, ctx).map((f) => `${f.name}: ${f.value}`).join('; ')
      const dbTitle = pages[p.databaseId]?.title?.trim()
      return { ...d, text: `${dbTitle ? `Entry in database "${dbTitle}". ` : ''}${facts}${body ? `\n${body}` : ''}` }
    }
    if (p.kind === 'database' && databases[p.id]) {
      const db = databases[p.id]
      const rows = Object.values(pages)
        .filter((r) => r.databaseId === p.id && !r.trashed && ctx.visible(r.id))
        .sort((a, b) => a.order - b.order)
        .slice(0, 60)
      const list = rows.map((r) => `- ${r.title.trim() || 'Untitled'} — ${rowFactsFor(db, r, ctx).map((f) => `${f.name}: ${f.value}`).join('; ')}`).join('\n')
      return { ...d, text: `Database with ${rows.length} entries:\n${list}${body ? `\n${body}` : ''}` }
    }
    return { ...d, text: body }
  })
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
  /** a page whose context marks limit what is read of it (the AI menu's page): only that part, or nothing */
  limitPage?: ID | null
  /** the route chip (this request only) — else the rules decide */
  route?: Route | null
}): Promise<{ text: string; sources: WorkspaceSource[] }> {
  // the gate first (newer AI rules, a key typed into the question, the route …): nothing is retrieved or recorded when
  // it refuses
  const pre = precheck({ purpose: 'workspace.ask', sources: [{ all: true }], typed: opts.question, route: opts.route ?? null })
  const shape = shapeOf(pre)
  const ctx: FactsContext = { shape, visible: pre.visible }
  // a route that does not see everything: pages it may not see leave before ranking (ancestors), the candidates are
  // checked whole (synced copies) and re-ranked without the ones it may not see
  const filter = shape ? quickFilter(pre) : null
  const lim = opts.limitPage ? limitText(opts.limitPage, shape) : null
  const all = workspaceDocs(filter)
  const docs = lim ? all.flatMap((d) => (d.id !== lim.id ? [d] : lim.text === null ? [] : [{ ...d, text: lim.text }])) : all
  const ranked = shape ? retrieve(opts.question, docs, 18).filter((d) => pre.visible(d.id)).slice(0, 6) : retrieve(opts.question, docs)
  // what goes out of a route that does not see everything: its own re-serialisation of each page (the limited page as
  // its marks allow, already built for it)
  const hits = shape ? ranked.map((d) => (lim && d.id === lim.id ? d : docForRoute(d, ctx))) : ranked
  const sources = hits.map((d) => ({ id: d.id, title: d.title }))
  opts.onSources?.(sources)
  // what goes out: the workspace as a whole — the pages retrieval picked (core/sources.ts)
  const refs: SourceRef[] = [{ all: true }, ...hits.map((d) => ({ page: d.id }))]
  if (usesDemo()) {
    // demo (no key): answer from the retrieved pages themselves, with real citations — local, never sent (the gate
    // decided above)
    const lang = useWorkspace.getState().settings.language === 'de' ? 'de' : 'en'
    const text = await streamDemoText(demoWorkspaceAnswer(opts.question, hits, keywords(opts.question), lang), opts.onToken, opts.signal)
    return { text: text.trim(), sources }
  }
  const excerpts = hits.map((d) => `<page title="${d.title.replace(/"/g, "'")}">\n${d.text.slice(0, 5000)}\n</page>`).join('\n\n')
  const today = new Date().toISOString().slice(0, 10)
  const prompt = `${excerpts || '<no matching pages />'}\n\nToday is ${today}.\nQuestion: ${opts.question.trim()}`
  const text = await streamCompletion({ purpose: 'workspace.ask', sources: refs, typed: opts.question, system: WORKSPACE_SYSTEM, prompt, onToken: opts.onToken, signal: opts.signal, ...routed(pre) })
  return { text: text.trim(), sources }
}

/** The pages a route may see, judged by their ancestors (memoised per request; S5 adds restricted pages). */
function quickFilter(pre: Pick<Prepared, 'allows'>): DocsFilter {
  const s = useWorkspace.getState()
  const hidden = MEMBER_CLASSES.filter((c) => !pre.allows(c))
  const memo = new Map<ID, boolean>()
  const w: SourceWorld = { pages: s.pages, databases: s.databases, mailDb: s.settings.mail?.databaseId ?? null }
  return {
    quick: (id) => {
      if (!hidden.length) return true
      let v = memo.get(id)
      if (v === undefined) {
        v = ![...ancestorClassesOf(id, w)].some((c) => (hidden as readonly string[]).includes(c))
        memo.set(id, v)
      }
      return v
    },
  }
}

/** What may be read of the limited page (its context marks): its text, or null (nothing). */
function limitText(pageId: ID, shape: Shape | null): { id: ID; text: string | null } {
  const r = withShape(shape, () => readableContent(pageId))
  const mode = r.mode === 'marked' && !r.blocks ? 'none' : r.mode
  if (mode === 'none') return { id: pageId, text: null }
  // a route that sees everything: the plain text as before; else the Markdown built for the route
  return { id: pageId, text: shape ? r.markdown : r.plain }
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
