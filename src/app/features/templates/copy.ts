/**
 * Deep copy of a page subtree — the engine behind templates ("Save as template", "Use",
 * "Duplicate"). The page, its subpages, databases (schema, views, row templates, automations,
 * sub-items / dependencies) and rows get fresh ids; trashed pages below it stay behind.
 *
 * Every reference INTO the subtree follows the copy; references to the rest of the workspace stay:
 *  - parentId / databaseId, relation targets (relationDatabaseId) and relation values
 *  - page links, page mentions, inline databases (+ their view) and #/p/<id> hrefs in content,
 *    button actions (databases, pages, property presets), row-template content and presets,
 *    view filters, form / colour-rule / chart / calculation property refs
 *  - synced blocks: a group whose ORIGINAL is inside becomes a new group (fresh syncId, the
 *    references inside point at the copied original); groups from elsewhere stay linked
 *  - two-way relation pairs: a pair inside stays a pair (property ids are per database, so they
 *    are kept); a pair that crosses the edge of the subtree becomes a one-way relation in the copy
 *    (fresh property id) — the other side keeps listing the original's rows only
 *  - unique ids are numbered again from 1 (row order); recurring row templates start counting at
 *    the next scheduler pass (no catch-up for the time before the copy existed)
 * Comments (margin notes) stay with the original: the copy's content has no comment anchors.
 * `fill` fills variables in the copy's titles, text and text properties (never in row templates,
 * button actions or repeat titles — those fill in when they run).
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../store/store'
import type { Database, ID, Page, PageTemplate, PropertyValue, TemplateRepeat } from '../../store/types'
import { newId } from '../../lib/ids'
import { createPrivateDatabase, createPrivatePage } from '../../cloud'

/** Back side of a two-way relation pair: `<forward id>.2way` (database/model/actions.ts TWO_WAY_SUFFIX). */
const TWO_WAY = '.2way'
/** Ids are 12+ characters (lib/ids); shorter strings are never looked up. */
const MIN_ID = 8
const LINK_RE = /#\/p\/([\w-]+)/g

export interface CopyOptions {
  /** Parent of the copy (null = top level). */
  parentId: ID | null
  /** Position among its new siblings (default: last). */
  index?: number
  /** The copy's root page: title (default: the original's), hidden flag, template metadata (null = none). */
  root: { title?: string; hidden?: boolean; template?: PageTemplate | null }
  /** Fill variables in titles, text and text properties. */
  fill?: ((text: string) => string) | null
  /** Team workspaces: create the root in my Private section (everything below follows it). */
  private?: boolean
}

export interface CopyResult {
  rootId: ID
  /** every page id of the copy (root first) */
  ids: ID[]
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
/** A repeat that has not run yet: the scheduler anchors it at its next pass (no catch-up). */
const fresh = ({ lastRunAt: _done, ...repeat }: TemplateRepeat): TemplateRepeat => repeat
const sortPages = (list: Page[]) => list.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)

/** The root and every live page below it (rows, subpages of rows …), parents before children. */
export function subtreeOf(pages: Record<ID, Page>, rootId: ID): Page[] {
  const root = pages[rootId]
  if (!root) return []
  const kids = new Map<ID, Page[]>()
  for (const id of Object.keys(pages)) {
    const p = pages[id]
    if (!p.parentId || p.trashed) continue
    const list = kids.get(p.parentId)
    if (list) list.push(p)
    else kids.set(p.parentId, [p])
  }
  const out: Page[] = []
  const seen = new Set<ID>()
  const visit = (p: Page) => {
    if (seen.has(p.id)) return
    seen.add(p.id)
    out.push(p)
    for (const c of sortPages(kids.get(p.id) ?? [])) visit(c)
  }
  visit(root)
  return out
}

/** Strings equal to a mapped id (and #/p/<id> inside strings) replaced, object keys too; text nodes' text untouched. */
function remap<T>(v: T, map: Map<string, string>): T {
  const walk = (x: unknown, key?: string): unknown => {
    if (typeof x === 'string') {
      if (key === 'text' || x.length < MIN_ID) return x
      const hit = map.get(x)
      if (hit !== undefined) return hit
      return x.includes('#/p/') ? x.replace(LINK_RE, (all, id: string) => (map.has(id) ? `#/p/${map.get(id)}` : all)) : x
    }
    if (Array.isArray(x)) return x.map((y) => walk(y))
    if (x && typeof x === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(x as Record<string, unknown>)) out[map.get(k) ?? k] = walk(val, k)
      return out
    }
    return x
  }
  return walk(v) as T
}

/** Content of a copy: references remapped (see remap), comment anchors dropped, variables filled. */
function copyContent(doc: JSONContent, map: Map<string, string>, fill: ((s: string) => string) | null | undefined): JSONContent {
  const walk = (n: JSONContent): JSONContent => {
    const out: JSONContent = { ...n }
    if (n.marks) {
      const marks = n.marks.filter((m) => m.type !== 'comment')
      if (marks.length) out.marks = marks
      else delete out.marks
    }
    if (fill && n.type === 'text' && typeof n.text === 'string') out.text = fill(n.text)
    if (n.content) out.content = n.content.map(walk)
    return out
  }
  return walk(remap(doc, map))
}

/** Synced-block groups whose ORIGINAL (sourcePageId null) is on one of these pages. */
function syncedOriginals(list: Page[]): string[] {
  const out = new Set<string>()
  const walk = (n: JSONContent) => {
    if (n.type === 'syncedBlock' && typeof n.attrs?.syncId === 'string' && n.attrs.syncId && !n.attrs.sourcePageId) out.add(n.attrs.syncId)
    n.content?.forEach(walk)
  }
  for (const p of list) if (p.content) walk(p.content)
  return [...out]
}

/**
 * Relation properties of the copied databases that are one side of a two-way pair whose other side
 * stays outside: their copies get fresh ids (a one-way relation), so the pair is not shared.
 */
function crossingPairs(list: Page[], dbs: Record<ID, Database>, inside: Set<ID>): string[] {
  const out: string[] = []
  for (const p of list) {
    for (const prop of dbs[p.id]?.properties ?? []) {
      const target = prop.type === 'relation' ? prop.relationDatabaseId : undefined
      if (!target || inside.has(target)) continue
      const back = prop.id.endsWith(TWO_WAY) || !!dbs[target]?.properties.some((x) => x.id === prop.id + TWO_WAY)
      if (back) out.push(prop.id)
    }
  }
  return out
}

/** Copy the subtree of `rootId` (see the module comment). Null when the page is gone. */
export function copyTree(rootId: ID, opts: CopyOptions): CopyResult | null {
  const st = useWorkspace.getState()
  const list = subtreeOf(st.pages, rootId)
  if (!list.length) return null
  const inside = new Set(list.map((p) => p.id))
  const map = new Map<string, string>()
  for (const p of list) map.set(p.id, newId())
  for (const p of list) for (const v of st.databases[p.id]?.views ?? []) map.set(v.id, newId())
  for (const syncId of syncedOriginals(list)) map.set(syncId, newId())
  for (const propId of crossingPairs(list, st.databases, inside)) map.set(propId, newId())
  const fill = opts.fill ?? null
  const fillStr = (s: string) => (fill ? fill(s) : s)

  // unique ids: the rows of each copied database numbered again in row order
  const uniqueNo = new Map<ID, number>()
  const nextUnique = new Map<ID, number>()
  for (const p of list) {
    const db = st.databases[p.id]
    if (!db?.properties.some((x) => x.type === 'unique_id')) continue
    const rows = list.filter((r) => r.databaseId === p.id)
    rows.forEach((r, i) => uniqueNo.set(r.id, i + 1))
    nextUnique.set(p.id, rows.length + 1)
  }

  const ws = () => useWorkspace.getState()
  for (const src of list) {
    const id = map.get(src.id)!
    const isRoot = src.id === rootId
    const parentId = isRoot ? opts.parentId : (map.get(src.parentId ?? '') ?? src.parentId)
    const databaseId = isRoot ? null : src.databaseId ? (map.get(src.databaseId) ?? src.databaseId) : null
    const title = isRoot && opts.root.title !== undefined ? opts.root.title : fillStr(src.title)
    const hidden = isRoot ? opts.root.hidden || undefined : src.hidden
    const content = src.content ? copyContent(src.content, map, fill) : null
    const index = isRoot ? opts.index : undefined
    const db = st.databases[src.id]

    if (src.kind === 'database' && db) {
      const copy = remap(clone(db), map)
      const { id: _id, properties, views, inline, ...rest } = copy
      if (rest.templates) rest.templates = rest.templates.map((tpl) => ({ ...tpl, id: newId(), ...(tpl.repeat ? { repeat: fresh(tpl.repeat) } : {}) }))
      if (rest.automations) rest.automations = rest.automations.map((a) => ({ ...a, id: newId(), lastRunAt: null, lastStatus: null, lastMessage: null }))
      for (const prop of properties) if (prop.autofill?.fills) delete prop.autofill.fills
      if (nextUnique.has(src.id)) rest.nextUniqueId = nextUnique.get(src.id)!
      const input = { id, parentId, title, icon: src.icon, cover: src.cover, properties, views, inline, index }
      if (isRoot && opts.private) createPrivateDatabase(input)
      else ws().createDatabase(input)
      ws().updateDatabase(id, rest)
      ws().updatePage(id, { settings: { ...src.settings }, ...(hidden ? { hidden } : {}) })
      if (content) ws().setContent(id, content, 'template')
      continue
    }

    let properties: Record<ID, PropertyValue> = {}
    if (!isRoot && src.databaseId) {
      const rowDb = st.databases[src.databaseId]
      properties = remap(clone(src.properties ?? {}), map)
      for (const prop of rowDb?.properties ?? []) {
        const key = map.get(prop.id) ?? prop.id
        if (prop.type === 'unique_id' && uniqueNo.has(src.id)) properties[key] = uniqueNo.get(src.id)!
        else if (prop.type === 'text' && typeof properties[key] === 'string') properties[key] = fillStr(properties[key] as string)
      }
    }
    const input = { id, parentId, databaseId, title, icon: src.icon, cover: src.cover, content, properties, settings: { ...src.settings }, hidden, index, kind: 'page' as const }
    if (isRoot && opts.private) createPrivatePage(input)
    else ws().createPage(input)
  }

  const newRoot = map.get(rootId)!
  if (opts.root.template) ws().updatePage(newRoot, { template: clone(opts.root.template) })
  return { rootId: newRoot, ids: list.map((p) => map.get(p.id)!) }
}
