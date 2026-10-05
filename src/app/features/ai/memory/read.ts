/**
 * One memory — reading and picking. Whatever is in the memory database is read sanitised (rows added,
 * edited or emptied by hand are fine); a request gets a `<one_memory>` block with:
 *  - every active Preference (newest-used first, capped, text only),
 *  - the most relevant active Facts / Decisions / Procedures for the task (fuse.js over the sentence,
 *    the topics and an excerpt of the row's page) — a Procedure with its template (the row's page as
 *    its context marks allow),
 * within ~12 items / ~3,000 characters. Each gets a label (M1 …) for that request; Claude cites it.
 */
import Fuse from 'fuse.js'
import { format } from 'date-fns'
import { useWorkspace } from '../../../store/store'
import type { ID, PropertyValue } from '../../../store/types'
import { readableContent } from '../../../editor'
import { memoryDbId, memoryProps, typeOfName } from './schema'
import type { Memory, MemoryType, PickedMemory } from './types'

export const MAX_ITEMS = 12
export const MAX_CHARS = 3000
const MAX_PREFS = 6
const BODY_CHARS = 1200

const str = (v: PropertyValue | undefined): string => (typeof v === 'string' ? v : '')
const ids = (v: PropertyValue | undefined): ID[] => (Array.isArray(v) ? v.filter((x): x is ID => typeof x === 'string') : [])

/** Every memory in the memory database (sanitised; trashed rows left out). Empty without a database. */
export function readMemories(dbId: ID | null = memoryDbId()): Memory[] {
  if (!dbId) return []
  const { pages, databases } = useWorkspace.getState()
  const db = databases[dbId]
  if (!db) return []
  const roles = memoryProps(db)
  const optName = (propId: ID | undefined, id: string) => db.properties.find((p) => p.id === propId)?.options?.find((o) => o.id === id)?.name ?? ''
  const out: Memory[] = []
  for (const row of Object.values(pages)) {
    if (row.databaseId !== dbId || row.trashed) continue
    const text = row.title.replace(/\s+/g, ' ').trim()
    if (!text) continue
    const p = row.properties ?? {}
    const typeVal = roles.type ? p[roles.type] : undefined
    const activeVal = roles.active ? p[roles.active] : undefined
    // Uses / Last used: the live log rows that cited it (the rollups show the same)
    const cited = (roles.citedIn ? ids(p[roles.citedIn]) : []).map((id) => pages[id]).filter((r) => !!r && !r.trashed)
    const last = cited.reduce((mx, r) => Math.max(mx, r!.createdAt), 0)
    out.push({
      id: row.id,
      text: text.slice(0, 400),
      type: (typeof typeVal === 'string' ? typeOfName(optName(roles.type, typeVal)) : null) ?? 'fact',
      topics: (roles.topics ? ids(p[roles.topics]) : []).map((id) => optName(roles.topics, id)).filter(Boolean).slice(0, 12),
      source: str(roles.source ? p[roles.source] : undefined).slice(0, 300),
      tag: str(roles.tag ? p[roles.tag] : undefined).trim().toLowerCase().slice(0, 32),
      // a row added by hand has no value yet: it counts as active until its box is unticked
      active: activeVal !== false,
      uses: cited.length,
      lastUsed: last ? format(new Date(last), 'yyyy-MM-dd') : null,
      plain: (row.plain ?? '').slice(0, 2000),
      createdAt: row.createdAt,
    })
  }
  return out.sort((a, b) => a.createdAt - b.createdAt)
}

/** The template / note of a memory's page, as its context marks allow ('' = none). */
export function memoryBody(id: ID, max = BODY_CHARS): string {
  try {
    const r = readableContent(id)
    if (r.mode === 'none' || (r.mode === 'marked' && !r.blocks)) return ''
    const md = r.markdown.trim()
    return md.length > max ? `${md.slice(0, max).trimEnd()}\n[…]` : md
  } catch {
    return ''
  }
}

const STOP = new Set(
  'the a an and or of to in on for with is are was were be what which who how why when where do does my our your we i you it this that these those about from at by as can please der die das und oder von zu im in am auf für mit ist sind war sein was wie warum wann wo mein meine unser unsere ich du es dies diese dieser über aus bei als kann bitte ein eine einen einem'.split(' '),
)
const keywords = (q: string) => [...new Set(q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w)))].slice(0, 10)

/**
 * The memories that go along with a task (active only): the examples it names (`forced`, in full), every
 * preference, then the most relevant facts / decisions / procedures. Examples go along only when named.
 */
export function pickMemories(task: string, all: Memory[] = readMemories(), forced: Memory[] = []): PickedMemory[] {
  const named = forced.filter((m) => m.active).slice(0, 4)
  const active = all.filter((m) => m.active && m.type !== 'example')
  if (!active.length && !named.length) return []
  const prefs = active
    .filter((m) => m.type === 'preference')
    .sort((a, b) => (b.lastUsed ?? '').localeCompare(a.lastUsed ?? '') || b.uses - a.uses || b.createdAt - a.createdAt)
    .slice(0, MAX_PREFS)
  const others = active.filter((m) => m.type !== 'preference')
  const picked: Memory[] = [...prefs]
  const text = task.trim()
  if (text && others.length) {
    const docs = others.map((m) => ({ m, text: m.text, topics: m.topics.join(' '), body: m.plain.slice(0, 600) }))
    const fuse = new Fuse(docs, {
      keys: [
        { name: 'text', weight: 2 },
        { name: 'topics', weight: 2 },
        { name: 'body', weight: 1 },
      ],
      includeScore: true,
      ignoreLocation: true,
      threshold: 0.36,
      minMatchCharLength: 3,
    })
    const score = new Map<ID, number>()
    const add = (q: string, w: number) => {
      for (const r of fuse.search(q, { limit: 24 })) score.set(r.item.m.id, (score.get(r.item.m.id) ?? 0) + w * (1 - (r.score ?? 1)))
    }
    add(text.slice(0, 200), 2)
    for (const w of keywords(text)) add(w, 1)
    // a topic named in the task counts in full
    const lower = text.toLowerCase()
    for (const m of others) if (m.topics.some((tp) => tp.length > 1 && new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(tp.toLowerCase())}([^\\p{L}\\p{N}]|$)`, 'u').test(lower))) score.set(m.id, (score.get(m.id) ?? 0) + 3)
    const byId = new Map(others.map((m) => [m.id, m]))
    picked.push(
      ...[...score.entries()]
        .filter(([, s]) => s > 0.4)
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => byId.get(id)!),
    )
  }
  // the caps: ~12 items, ~3,000 characters (a Procedure's template counts); named examples come first, outside the cap
  const out: PickedMemory[] = named.map((m, i) => ({ id: m.id, label: `M${i + 1}`, type: m.type, text: m.text, forced: m.tag }))
  let chars = 0
  for (const m of picked) {
    if (out.length >= MAX_ITEMS + named.length) break
    const size = m.text.length + (m.type === 'procedure' ? Math.min(BODY_CHARS, m.plain.length) : 0) + 40
    if (out.length && chars + size > MAX_CHARS) continue
    chars += size
    out.push({ id: m.id, label: `M${out.length + 1}`, type: m.type, text: m.text })
  }
  return out
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const TYPE_EN: Record<MemoryType, string> = { fact: 'Fact', preference: 'Preference', decision: 'Decision', procedure: 'Procedure', example: 'Example' }

export const EXAMPLE_INSTRUCTION =
  "Create the content based on this example: same structure, sections, columns and format, same tone and length. The facts come from the task, the current page or the person's input — never copy the example's facts unless asked."

/** An example in full for a request (its entry's body as its context marks allow), cut at `max` with a note. */
export function exampleText(id: ID, max = 10_000): string {
  let md = ''
  try {
    const r = readableContent(id)
    md = r.mode === 'none' ? '' : r.markdown.trim()
  } catch {
    md = ''
  }
  if (md.length <= max) return md
  const cut = md.lastIndexOf('\n', max)
  return `${md.slice(0, cut > max * 0.7 ? cut : max).trimEnd()}\n[Cut: the example is longer than ${max.toLocaleString('en')} characters — follow the part shown.]`
}

export const MEMORY_INSTRUCTION =
  "This is the person's One memory — standing knowledge and templates they asked you to keep. Follow a matching Procedure as the template for the task; say [M3] (the memory's label) when you use one; if the task contradicts a memory, say so instead of silently choosing."

/** The `<one_memory>` block for a request ('' when nothing was picked). */
export function memoryBlock(items: PickedMemory[], all: Memory[] = readMemories()): string {
  if (!items.length) return ''
  const byId = new Map(all.map((m) => [m.id, m]))
  const clean = (s: string) => s.replace(/<\/?one_memory>/gi, '')
  const lines = items.map((it) => {
    const m = byId.get(it.id)
    const topics = m?.topics.length ? ` · topics: ${m.topics.join(', ')}` : ''
    const source = m?.source ? ` · source: ${clean(m.source)}` : ''
    if (it.forced) {
      // an example the request named: in full, with "same structure, new facts"
      const body = exampleText(it.id).replace(/<\/?example>/gi, '')
      return `[${it.label}] Example #${it.forced}: ${clean(it.text)}${source}\n${EXAMPLE_INSTRUCTION}\n<example tag="${it.forced}">\n${clean(body)}\n</example>`
    }
    let line = `[${it.label}] ${TYPE_EN[it.type]}: ${clean(it.text)}${topics}${source}`
    if (it.type !== 'preference') {
      const body = memoryBody(it.id)
      if (body) line += `\n${it.type === 'procedure' ? 'Template:' : 'Note:'}\n${clean(body)}`
    }
    return line
  })
  return `<one_memory>\n${MEMORY_INSTRUCTION}\n\n${lines.join('\n\n')}\n</one_memory>`
}

/** The labels Claude cited ("[M3]", "[M1, M4]") → the picked memories. */
export function citedIn(text: string, items: PickedMemory[]): PickedMemory[] {
  if (!items.length || !text) return []
  const labels = new Set<string>()
  for (const m of text.matchAll(/\[(M\d{1,3}(?:\s*[,;/]\s*M\d{1,3})*)\]/g)) for (const l of m[1].split(/\s*[,;/]\s*/)) labels.add(l)
  return items.filter((it) => labels.has(it.label))
}

/** Search the memory (the `recall` tool): best matches first, inactive ones too (marked). */
export function searchMemories(query: string, limit = 8): Memory[] {
  const all = readMemories()
  const q = query.trim()
  if (!q) return all.filter((m) => m.active).slice(0, limit)
  const fuse = new Fuse(all, {
    keys: [
      { name: 'text', weight: 2 },
      { name: 'topics', weight: 2 },
      { name: 'plain', weight: 1 },
    ],
    ignoreLocation: true,
    threshold: 0.4,
    minMatchCharLength: 2,
  })
  const hits = new Map<ID, Memory>()
  for (const r of fuse.search(q, { limit })) hits.set(r.item.id, r.item)
  for (const w of keywords(q)) for (const r of fuse.search(w, { limit })) if (hits.size < limit) hits.set(r.item.id, r.item)
  return [...hits.values()].slice(0, limit)
}
