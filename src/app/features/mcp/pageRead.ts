/**
 * One MCP — reading a page in full and listing pages on the local bridge (spec § 2.1): the tab's side of the shared read
 * core (src/shared/mcp/pageRead.ts). The page is read from the store (its `contentRev` is the read's `rev`), in the file
 * form; the person's context marks (editor/context — what Claude may read of a page) hold for MCP too: a limited read
 * hands out only the marked blocks and says what it left out (`limited`). Comments only while this device's switch
 * allows reading them (Settings → Agents · MCP).
 */
import type { JSONContent } from '@tiptap/core'
import { inTemplate, selectBacklinks } from '../../store/selectors'
import type { ID, Page, PageComment } from '../../store/types'
import { docToFileMarkdown, isContextLimited, itemAttrs, readableBlocks } from '../../editor'
import { classOfPage } from '../ai/core'
import { fileWorkspace, getLocalFile, type StoredFile } from '../../lib/files'
import { mcpError } from '../../../shared/mcp/errors'
import { MCP_LIMITS, MCP_PAGE_KINDS } from '../../../shared/mcp/tables'
import {
  blockPieces,
  markdownUnits,
  wholeMarkdown,
  type MdUnit,
  PIECE_ROOM,
  readBlocks,
  readPart,
  readPrint,
  refIndex,
  sizeOf,
  type BlockReader,
  type McpBlock,
  type McpThread,
  type PMJson,
  type ReadAnchors,
} from '../../../shared/mcp/pageRead'
import { useMcp } from './state'
import { iconText, iso, kindOf, live, McpToolError, pageUrl, pathOf, q, rowProperties, rowsOf, titleOf, ws } from './values'

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const flag = (v: unknown) => v === true || v === 'true'

/** Where links of this One start: a page's link is urlBase + its id (lists carry it once). */
export const urlBase = (): string => `${window.location.origin}${window.location.pathname}#/p/`

/** A JSON attr as stored (a value, or text holding JSON). */
function jsonAttr(v: unknown): unknown {
  if (typeof v !== 'string') return v
  try {
    return JSON.parse(v)
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Block data                                                          */
/* ------------------------------------------------------------------ */

/** What a read loaded before its blocks are built (block data is sync). */
interface Loaded {
  files: Map<string, StoredFile | undefined>
  sheets: typeof import('../sheets') | null
  charts: typeof import('../charts') | null
  transcript: boolean
}

const FILE_RE = /onefile:[A-Za-z0-9_-]{1,80}/g

/** Every `onefile:` ref a node holds (sources, links, cover-like attrs). */
const fileRefsOf = (v: unknown): string[] => [...new Set(JSON.stringify(v ?? null).match(FILE_RE) ?? [])]

const hasType = (doc: PMJson, type: string): boolean => (doc.type === type ? true : (doc.content ?? []).some((c) => hasType(c, type)))

async function load(doc: PMJson, transcript: boolean): Promise<Loaded> {
  const refs = fileRefsOf(doc)
  const files = new Map<string, StoredFile | undefined>()
  await Promise.all(
    refs.slice(0, 500).map(async (r) => {
      try {
        files.set(r, await getLocalFile(r))
      } catch {
        files.set(r, undefined)
      }
    }),
  )
  const [sheets, charts] = await Promise.all([hasType(doc, 'spreadsheet') ? import('../sheets') : null, hasType(doc, 'chart') ? import('../charts') : null])
  return { files, sheets, charts, transcript }
}

/** A media / file block's data: the stored file (never loaded — only its record), a web address, the display. */
function fileData(a: Record<string, unknown>, loaded: Loaded): Record<string, unknown> {
  const src = str(a.src)
  const name = str(a.name) || str(a.alt) || str(a.caption) || null
  let file: Record<string, unknown> | null = null
  if (src.startsWith('onefile:')) {
    const rec = loaded.files.get(src)
    // another workspace's file (one-files is shared by the browser's workspaces) is named, never described
    const own = rec && (!rec.ws || rec.ws === fileWorkspace())
    file = { ref: src, name: name ?? (own ? rec.name : null), mime: own ? rec.type || null : null, size: own ? rec.size : null }
  }
  return { file, url: /^https?:\/\//i.test(src) ? src : null, ...(a.display !== undefined && a.display !== null ? { display: a.display } : {}) }
}

function sheetData(a: Record<string, unknown>, loaded: Loaded): Record<string, unknown> {
  const mod = loaded.sheets
  if (!mod) return {}
  const attrs = mod.readAttrs(a)
  let wb: ReturnType<typeof mod.workbookOf> | null = null
  try {
    wb = mod.workbookOf(attrs)
  } catch {
    wb = null
  }
  const valueOf = (sheetId: string, addr: string): unknown => {
    const m = /^([A-Z]{1,3})(\d{1,6})$/.exec(addr)
    if (!m || !wb) return null
    let c = 0
    for (const ch of m[1]!) c = c * 26 + ch.charCodeAt(0) - 64
    const v = wb.get(sheetId, Number(m[2]) - 1, c - 1).value
    if (mod.isErr(v)) return (v as { code?: unknown }).code ?? '#ERROR'
    return v ?? null
  }
  return {
    title: attrs.title ?? '',
    active: attrs.sheets.find((s) => s.id === attrs.active)?.name ?? attrs.sheets[0]?.name ?? null,
    sheets: attrs.sheets.map((s) => ({
      name: s.name,
      rows: s.rows,
      cols: s.cols,
      frozenRows: s.frozenRows ?? 0,
      cells: Object.fromEntries(
        Object.entries(s.cells)
          .filter(([, cell]) => typeof cell?.v === 'string' && cell.v !== '')
          .map(([addr, cell]) => [addr, { input: cell!.v, value: valueOf(s.id, addr) }]),
      ),
    })),
  }
}

function chartData(a: Record<string, unknown>, loaded: Loaded): Record<string, unknown> {
  const spec = jsonAttr(a.spec) as Record<string, unknown> | null
  if (!spec || typeof spec !== 'object') return {}
  const mod = loaded.charts
  let data: unknown = null
  if (mod && spec.source && typeof spec.source === 'object') {
    try {
      const d = mod.resolveChartDataSync(spec.source as Parameters<typeof mod.resolveChartDataSync>[0], spec)
      data = d.error ? { error: d.error } : { labels: d.labels, series: d.series.map((s) => ({ name: s.name, values: s.values })), ...(d.unit ? { unit: d.unit } : {}) }
    } catch {
      data = null
    }
  }
  return { spec, data }
}

function blockData(node: PMJson, loaded: Loaded): Record<string, unknown> | undefined {
  const a = (node.attrs ?? {}) as Record<string, unknown>
  const { databases, people } = ws()
  switch (node.type) {
    case 'databaseBlock': {
      const id = str(a.databaseId)
      const page = live(id)
      const db = page ? databases[id] : undefined
      if (!page || !db) return { databaseId: null, title: '(No access)' }
      const view = db.views.find((v) => v.id === a.viewId) ?? db.views[0]
      return { databaseId: id, viewId: view?.id ?? null, title: titleOf(page), viewType: view?.type ?? 'table', rows: rowsOf(id).length }
    }
    case 'pageLink': {
      const p = live(str(a.pageId))
      return p ? { pageId: p.id, title: titleOf(p) } : { pageId: null, title: '(No access)' }
    }
    case 'spreadsheet':
      return sheetData(a, loaded)
    case 'chart':
      return chartData(a, loaded)
    case 'button': {
      const actions = jsonAttr(a.actions)
      return { label: str(a.label), variant: str(a.variant) || 'signal', actions: Array.isArray(actions) ? actions.map((x) => ({ kind: str((x as { type?: unknown })?.type) })) : [] }
    }
    case 'syncedBlock':
      return { syncId: str(a.syncId) || null, original: !a.sourcePageId, sourcePageId: str(a.sourcePageId) || null }
    case 'meetingNotes': {
      const lines = jsonAttr(a.transcript)
      const list = Array.isArray(lines) ? lines.filter((l): l is { t?: unknown; text?: unknown } => !!l && typeof l === 'object') : []
      return {
        title: str(a.title),
        status: str(a.status) || 'idle',
        startedAt: num(a.startedAt) !== null ? iso(num(a.startedAt)!) : null,
        endedAt: num(a.endedAt) !== null ? iso(num(a.endedAt)!) : null,
        duration: num(a.duration),
        language: str(a.language) || null,
        transcriptLines: list.length,
        ...(loaded.transcript ? { transcript: list.map((l) => ({ t: num(l.t) ?? 0, text: str(l.text) })) } : {}),
      }
    }
    case 'image':
    case 'video':
    case 'audio':
    case 'fileBlock':
      return fileData(a, loaded)
    case 'bookmark':
      return { url: str(a.url), ...(a.title ? { title: str(a.title) } : {}), ...(a.description ? { description: str(a.description) } : {}) }
    case 'embed':
      return { url: str(a.url), ...(a.provider ? { provider: str(a.provider) } : {}) }
    case 'blockMath':
      return { latex: str(a.latex) }
    case 'mermaid':
      return { code: str(a.code) }
    case 'workItem': {
      const f = itemAttrs(node as JSONContent)
      const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? id
      return {
        itemId: f.itemId,
        status: f.status,
        due: f.due,
        reminder: f.reminder,
        people: f.people.map(nameOf),
        blockedBy: f.blockedBy,
        related: f.related,
        ...(f.doneAt ? { doneAt: f.doneAt } : {}),
      }
    }
    default:
      return undefined
  }
}

function readerFor(loaded: Loaded): BlockReader {
  return {
    markdown: (content) => docToFileMarkdown({ type: 'doc', content: content as JSONContent[] }),
    data: (node) => blockData(node, loaded),
  }
}

/* ------------------------------------------------------------------ */
/* Comments                                                            */
/* ------------------------------------------------------------------ */

/** This device's switch for comments over MCP (Settings → Agents · MCP; off by default). */
export const commentsMode = () => useMcp.getState().comments

const COMMENT_MAX = 4000
const cut = (s: string) => (s.length > COMMENT_MAX ? `${s.slice(0, COMMENT_MAX)}…` : s)

function threadOut(c: PageComment, ref: string | undefined): McpThread {
  return {
    id: c.id,
    quote: cut(c.quote ?? ''),
    body: cut(c.body ?? ''),
    author: c.author ?? '',
    createdAt: iso(c.createdAt ?? 0),
    resolved: !!c.resolved,
    ...(ref ? { ref } : {}),
    replies: (c.replies ?? []).map((r) => ({ id: r.id, body: cut(r.body ?? ''), author: r.author ?? '', createdAt: iso(r.createdAt ?? 0) })),
  }
}

/* ------------------------------------------------------------------ */
/* one_get_page                                                        */
/* ------------------------------------------------------------------ */

/** A page by id, or by exact (case-insensitive) title — the most recently edited if several match. */
export function findPage(args: Record<string, unknown>): { page: Page; others: Page[] } {
  const id = str(args.id).trim()
  const title = str(args.title).trim()
  if (!id && !title) throw new McpToolError(mcpError('bad_argument', 'id', 'Give the page id (or its exact title)'))
  if (id) {
    // a template's page is not found by its id either (live)
    const p = live(id)
    if (p) return { page: p, others: [] }
    if (!title) throw new McpToolError(`not_found: No page with id ${q(id)}. Use one_search to find page ids.`)
  }
  // by title: template pages (features/templates) never answer, as by id
  const pages = ws().pages
  const all = Object.values(pages).filter((p) => live(p.id) && !inTemplate(pages, p.id))
  const hits = all.filter((p) => p.title.trim().toLowerCase() === title.toLowerCase()).sort((a, b) => b.updatedAt - a.updatedAt)
  if (!hits.length) {
    const near = all
      .filter((p) => p.title.toLowerCase().includes(title.toLowerCase()))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 5)
    throw new McpToolError(`not_found: No page titled ${q(title)}.${near.length ? ` Similar: ${near.map((p) => `${q(titleOf(p))} (${p.id})`).join(', ')}` : ' Try one_search.'}`)
  }
  return { page: hits[0]!, others: hits.slice(1) }
}

const CLASS_ORDER = ['mail', 'memory', 'private', 'rows', 'page'] as const

/** The page's data class for the agent (spec § 3.5): mail, memory, private, rows or page. */
export function classOf(id: ID): string {
  const s = ws()
  const classes = classOfPage(id, { pages: s.pages, databases: s.databases, mailDb: s.settings.mail?.databaseId ?? null })
  return CLASS_ORDER.find((c) => classes.has(c)) ?? 'page'
}

const coverOut = (p: Page) => (p.cover ? { type: p.cover.type, value: p.cover.value } : null)

/** The top-level blocks the person lets Claude read of this page (context marks): null = all. */
function readableTop(p: Page, top: PMJson[]): Set<number> | null {
  if (!isContextLimited(p.id)) return null
  const ids = new Set(readableBlocks(p.id).flatMap((b) => (typeof b.attrs?.id === 'string' && b.attrs.id ? [b.attrs.id] : [])))
  const keep = new Set<number>()
  top.forEach((b, i) => {
    if (typeof b.attrs?.id === 'string' && ids.has(b.attrs.id)) keep.add(i)
  })
  return keep
}

/** What a bridge older than parts gets (contract 1): the whole Markdown up to this many characters, then "[Truncated …]". */
export const LEGACY_MARKDOWN_MAX = 60_000

/**
 * one_get_page. `whole`: for a bridge older than MCP_BRIDGE_CURRENT (spec § 4.4) — its schema knows no cursor and its
 * description no parts, so it gets contract 1's answer: the whole Markdown up to LEGACY_MARKDOWN_MAX characters, cut with
 * a "[Truncated: …]" line and `truncated: true`, never a first part that reads like the whole page.
 */
export async function getPage(args: Record<string, unknown>, opts: { whole?: boolean } = {}): Promise<Record<string, unknown>> {
  if (opts.whole) args = { ...(args.id !== undefined ? { id: args.id } : {}), ...(args.title !== undefined ? { title: args.title } : {}) }
  const format = args.format === undefined || args.format === null || args.format === '' ? 'markdown' : args.format
  if (format !== 'markdown' && format !== 'blocks') throw new McpToolError(mcpError('bad_argument', 'format', '"format" is "markdown" or "blocks"'))
  const refs = flag(args.refs)
  const transcript = flag(args.transcript)
  const wantComments = flag(args.comments)
  if (wantComments && commentsMode() === 'off') throw new McpToolError(mcpError('comments_off', 'comments', 'Comments over MCP are off on this device'))
  const { page: p, others } = findPage(args)
  const { pages, databases } = ws()
  const doc = (p.content ?? { type: 'doc', content: [] }) as PMJson
  const top = doc.content ?? []
  const keep = readableTop(p, top)
  const loaded = await load({ type: 'doc', content: keep ? top.filter((_, i) => keep.has(i)) : top }, transcript)
  // the store may have moved while the files loaded: read the page as it is now
  const now = live(p.id) ?? p
  const nowDoc = (now.content ?? { type: 'doc', content: [] }) as PMJson
  const nowTop = nowDoc.content ?? []
  const nowKeep = readableTop(now, nowTop)
  const reader = readerFor(loaded)
  const index = refIndex(nowDoc)
  const kept = nowTop.map((node, i) => ({ node, path: [i] })).filter((c) => !nowKeep || nowKeep.has(c.path[0]!))
  const rev = String(now.contentRev ?? 0)
  const limitKey = nowKeep ? `:${[...nowKeep].map((i) => str(nowTop[i]?.attrs?.id) || `#${i}`).join(',')}` : ''
  const print = readPrint({ page: now.id, format, refs, transcript })

  // comment threads (asked for and allowed): where each sits, from the blocks it reads (a limited read counts the
  // threads of the blocks it leaves out, so it reads its blocks in any format)
  const anchors: ReadAnchors = { comments: new Map() }
  let blocks: McpBlock[] | null = null
  if (format === 'blocks' || wantComments || nowKeep) blocks = readBlocks(nowDoc, reader, index, nowKeep ? (i) => nowKeep.has(i) : undefined, anchors)
  const threads = wantComments ? (now.comments ?? []).filter((c) => !nowKeep || anchors.comments.has(c.id)).map((c) => threadOut(c, anchors.comments.get(c.id))) : null

  const head: Record<string, unknown> = {
    id: now.id,
    kind: kindOf(now),
    title: now.title,
    icon: iconText(now.icon),
    cover: coverOut(now),
    path: pathOf(now.id),
    url: pageUrl(now.id),
    parentId: now.parentId,
    rev,
    class: classOf(now.id),
  }
  if (now.databaseId && databases[now.databaseId]) head.database = { id: now.databaseId, title: titleOf(pages[now.databaseId]) }
  head.createdAt = iso(now.createdAt)
  head.updatedAt = iso(now.updatedAt)
  head.settings = { fullWidth: !!now.settings.fullWidth, font: now.settings.font, smallText: !!now.settings.smallText, locked: !!now.settings.locked }
  if (now.settings.locked) head.locked = true
  if (now.databaseId && databases[now.databaseId]) head.properties = rowProperties(databases[now.databaseId], now)
  if (now.kind === 'database' && databases[now.id]) {
    head.rows = rowsOf(now.id).length
    head.schema = databases[now.id].properties.map((prop) => ({ name: prop.name, type: prop.type, ...(prop.options ? { options: prop.options.map((o) => o.name) } : {}) }))
    head.hint = 'A database: one_query_database lists its rows, one_get_database has the full schema and views.'
  }
  // sub-pages as the sidebar shows them: never a template's (they read like unknown ids) nor a hidden one
  const children = Object.values(pages)
    .filter((c) => c.parentId === now.id && !c.databaseId && !c.hidden && live(c.id))
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
  head.children = { items: children.slice(0, 50).map((c) => ({ id: c.id, title: titleOf(c), kind: kindOf(c) })), more: Math.max(0, children.length - 50) }
  if (others.length) head.alsoTitled = others.slice(0, 10).map((o) => ({ id: o.id, path: pathOf(o.id) }))
  head.backlinks = selectBacklinks(pages, now.id)
    .filter((b) => live(b.id) && !inTemplate(pages, b.id))
    .slice(0, 50)
    .map((b) => ({ id: b.id, title: titleOf(b), path: pathOf(b.id) }))
  if (threads) head.comments = threads
  if (nowKeep) {
    const hidden = nowTop.filter((_, i) => !nowKeep.has(i))
    const shownFiles = new Set(fileRefsOf(kept.map((k) => k.node)))
    head.limited = {
      blocks: hidden.length,
      files: fileRefsOf(hidden).filter((r) => !shownFiles.has(r)).length,
      comments: (now.comments ?? []).filter((c) => !anchors.comments.has(c.id)).length,
      note: 'The person limited what you may read of this page in One: only the blocks they marked are here.',
    }
  }

  const units = format === 'blocks' ? blocks!.flatMap((b) => blockPieces(b, PIECE_ROOM)) : markdownUnits(kept, reader, refs ? index : null)
  if (opts.whole) {
    const md = wholeMarkdown(units as MdUnit[], reader)
    const cut = md.length > LEGACY_MARKDOWN_MAX
    return { ...head, markdown: cut ? `${md.slice(0, LEGACY_MARKDOWN_MAX)}\n[Truncated: ${LEGACY_MARKDOWN_MAX.toLocaleString('en')} of ${md.length.toLocaleString('en')} characters — the rest needs the updated One bridge]` : md, ...(cut ? { truncated: true } : {}) }
  }
  const part = readPart({ head, id: now.id, rev, cursorRev: `${rev}${limitKey}`, print, cursor: args.cursor, format, units, reader })
  if (!part.ok) throw new McpToolError(mcpError(part.code, 'cursor', part.what))
  return part.result
}

/* ------------------------------------------------------------------ */
/* one_list_pages                                                      */
/* ------------------------------------------------------------------ */

function int(v: unknown, def: number, min: number, max: number, key: string): number {
  if (v === undefined || v === null || v === '') return def
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isInteger(n) || n < min || n > max) throw new McpToolError(mcpError('bad_argument', key, `"${key}" is a whole number from ${min} to ${max}`))
  return n
}

/** Short stable hash (a cursor belongs to one listing). */
function fnv(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}

type Kind = (typeof MCP_PAGE_KINDS)[number]

export function listPages(args: Record<string, unknown>): Record<string, unknown> {
  const rawParent = args.parentId
  let parent: Page | null = null
  if (rawParent !== undefined && rawParent !== null && rawParent !== '') {
    if (typeof rawParent !== 'string') throw new McpToolError(mcpError('bad_argument', 'parentId', '"parentId" is a page id or null'))
    parent = live(rawParent.trim())
    if (!parent) throw new McpToolError(mcpError('not_found', 'parentId', `No page with id ${JSON.stringify(rawParent.trim())}`))
  }
  const depth = int(args.depth, 1, 1, 3, 'depth')
  const limit = int(args.limit, MCP_LIMITS.listDefault, 1, MCP_LIMITS.listMax, 'limit')
  let kinds: Kind[] = ['page', 'database']
  if (args.kinds !== undefined && args.kinds !== null) {
    if (!Array.isArray(args.kinds) || !args.kinds.length || args.kinds.some((k) => !(MCP_PAGE_KINDS as readonly unknown[]).includes(k)))
      throw new McpToolError(mcpError('bad_argument', 'kinds', `"kinds" lists any of ${MCP_PAGE_KINDS.join(', ')}`))
    kinds = [...new Set(args.kinds as Kind[])]
  }
  const rows = kinds.includes('row')
  const { pages } = ws()
  // the tree once: children by parent (sidebar order: shared before private, then the page order)
  const byParent = new Map<string, Page[]>()
  for (const p of Object.values(pages)) {
    if (p.hidden && !p.databaseId) continue
    if (!live(p.id)) continue
    const key = p.parentId ?? ''
    const list = byParent.get(key)
    if (list) list.push(p)
    else byParent.set(key, [p])
  }
  const kidsOf = (id: string): Page[] =>
    (byParent.get(id) ?? [])
      .filter((p) => (p.databaseId ? rows && p.databaseId === id : true))
      .sort((a, b) => Number(!!a.private) - Number(!!b.private) || a.order - b.order || a.createdAt - b.createdAt)
  const listed = (p: Page) => kinds.includes(kindOf(p))
  const items: Array<Record<string, unknown>> = []
  const walk = (id: string, level: number) => {
    for (const p of kidsOf(id)) {
      const kids = kidsOf(p.id)
      if (listed(p))
        items.push({
          id: p.id,
          kind: kindOf(p),
          title: titleOf(p),
          icon: iconText(p.icon),
          parentId: p.parentId,
          depth: level,
          children: kids.filter(listed).length,
          ...(p.private ? { private: true } : {}),
          updatedAt: iso(p.updatedAt),
        })
      if (level < depth) walk(p.id, level + 1)
    }
  }
  walk(parent?.id ?? '', 1)
  const print = fnv(JSON.stringify([parent?.id ?? null, depth, [...kinds].sort()]))
  let offset = 0
  if (args.cursor !== undefined && args.cursor !== null && args.cursor !== '') {
    const m = typeof args.cursor === 'string' ? /^([0-9a-z]{1,8})\.([0-9a-z]{1,10})$/.exec(args.cursor.trim()) : null
    if (!m || m[2] !== print) throw new McpToolError(mcpError('bad_argument', 'cursor', 'This cursor belongs to another listing (other parentId, depth or kinds): start again without it'))
    offset = parseInt(m[1]!, 36)
  }
  const slice = items.slice(offset, offset + limit)
  const end = offset + slice.length
  const out: Record<string, unknown> = { urlBase: urlBase(), parentId: parent?.id ?? null, total: items.length, items: slice, next: end < items.length ? `${end.toString(36)}.${print}` : null }
  // a listing is one part too: very long titles never push it over the limit
  while (sizeOf(out) > MCP_LIMITS.part && (out.items as unknown[]).length > 1) {
    const kept = (out.items as unknown[]).slice(0, -Math.max(1, Math.floor((out.items as unknown[]).length / 4)))
    out.items = kept
    out.next = `${(offset + kept.length).toString(36)}.${print}`
  }
  return out
}
