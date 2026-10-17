/**
 * One MCP on the team server — reading a page in full (spec § 2.1): the server's side of the shared read core
 * (src/shared/mcp/pageRead.ts). A content document's Y XML is read into the ProseMirror JSON shape the core takes; the
 * Markdown is the server's own (api/markdown.ts); block data comes from the meta document and the files table. The
 * server never learns the task block's form before its phase 4: a task block reads as its plain blocks (flattened).
 * Another member's private page is never in the meta document: a link to one reads "(No access)".
 */
import * as Y from 'yjs'
import type { Services } from '../context.ts'
import { blocksMarkdown, type MarkdownContext, type MdNode, type MdText } from '../api/markdown.ts'
import { type Roots, liveDatabase, pageMap, readOrdered, rowsOf } from '../api/meta.ts'
import type { BlockReader, McpThread, PMJson } from '../../../src/shared/mcp/pageRead.ts'
import { sha256Hex } from '../../../src/shared/mcp/sha256.ts'
import { iso } from '../tokens.ts'

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Attrs that hold JSON (arrays / objects), stored as values or as strings. */
function jsonAttr(v: unknown): unknown {
  if (typeof v !== 'string') return v
  try {
    return JSON.parse(v)
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ Y XML ⇄ the core's JSON */

/** y-prosemirror keys marks that may repeat as `<name>--<hash>`: back to the mark name. */
const markName = (k: string) => k.replace(/--[A-Za-z0-9+/=_-]+$/, '')

function elementJson(el: Y.XmlElement, depth: number): PMJson {
  const attrs = el.getAttributes() as Record<string, unknown>
  const node: PMJson = { type: el.nodeName, ...(Object.keys(attrs).length ? { attrs } : {}) }
  if (depth > 64) return node
  const content: PMJson[] = []
  for (const c of el.toArray()) {
    if (c instanceof Y.XmlText) {
      for (const d of c.toDelta() as Array<{ insert?: unknown; attributes?: Record<string, unknown> }>) {
        if (typeof d.insert !== 'string' || !d.insert) continue
        const marks = Object.entries(d.attributes ?? {}).map(([k, v]) => ({ type: markName(k), ...(isObj(v) && Object.keys(v).length ? { attrs: v } : {}) }))
        content.push({ type: 'text', text: d.insert, ...(marks.length ? { marks } : {}) })
      }
    } else if (c instanceof Y.XmlElement) content.push(elementJson(c, depth + 1))
  }
  if (content.length) node.content = content
  return node
}

/** A content document as one doc node (its `default` fragment). */
export function docJson(doc: Y.Doc): PMJson {
  const content: PMJson[] = []
  for (const c of doc.getXmlFragment('default').toArray()) if (c instanceof Y.XmlElement) content.push(elementJson(c, 0))
  return { type: 'doc', content }
}

/**
 * A content document's state as a SHA-256 (hex): its state vector AND its delete set (a Yjs snapshot). The state vector
 * alone moves only with insertions — a member who only deletes blocks or text would leave it as it was. The read's `rev`
 * (a cursor's "changed between parts?") uses it; a Restore's "changed since?" reads the text instead (preimages.ts
 * textHash — opening a page writes into its document), pre-images stored before that kept this hash.
 */
export const docStateHash = (doc: Y.Doc): string => sha256Hex(Y.encodeSnapshot(Y.snapshot(doc)))

/** The read's `rev`: the document's state (docStateHash) — it moves with every change, a pure deletion too. */
export const contentRev = (doc: Y.Doc): string => docStateHash(doc).slice(0, 16)

/** The core's JSON back into the server Markdown's nodes. */
function mdNode(n: PMJson): MdNode {
  const children: Array<MdNode | MdText> = []
  for (const c of n.content ?? []) {
    if (c.type === 'text') {
      const marks: Record<string, unknown> = {}
      for (const m of c.marks ?? []) if (m.type) marks[m.type] = m.attrs ?? true
      children.push({ text: c.text ?? '', marks })
    } else children.push(mdNode(c))
  }
  return { type: n.type ?? '', attrs: (n.attrs ?? {}) as Record<string, unknown>, children }
}

/* ------------------------------------------------------------------ block data */

export interface ServerReadContext {
  s: Services
  wsId: string
  r: Roots
  /** title of a page of the meta document; null: not there (another member's private page, deleted, out of reach) */
  title(id: string): string | null
  path?(): string[] | null
  transcript: boolean
}

function fileData(a: Record<string, unknown>, c: ServerReadContext): Record<string, unknown> {
  const src = str(a.src)
  const name = str(a.name) || str(a.alt) || str(a.caption) || null
  let file: Record<string, unknown> | null = null
  const m = /^onefile:([A-Za-z0-9_-]{1,80})$/.exec(src)
  if (m) {
    const row = c.s.repo.file(c.wsId, m[1]!)
    // a private upload (private_to) is never described over MCP
    if (!row) file = { ref: src, name, mime: null, size: null }
    else if (!row.private_to) file = { ref: src, name: name ?? row.name, mime: row.mime || null, size: row.size }
  }
  return { file, url: /^https?:\/\//i.test(src) ? src : null, ...(a.display !== undefined && a.display !== null ? { display: a.display } : {}) }
}

function blockData(n: PMJson, c: ServerReadContext): Record<string, unknown> | undefined {
  const a = (n.attrs ?? {}) as Record<string, unknown>
  switch (n.type) {
    case 'databaseBlock': {
      const id = str(a.databaseId)
      const db = id ? liveDatabase(c.r, id) : null
      if (!db) return { databaseId: null, title: '(No access)' }
      const views = readOrdered<Record<string, unknown>>(db.ydb.get('views'))
      const view = views.find((v) => v.id === a.viewId) ?? views[0]
      return { databaseId: id, viewId: view ? str(view.id) : null, title: db.page.title || 'Untitled', viewType: view ? str(view.type) || 'table' : 'table', rows: rowsOf(c.r, id).length }
    }
    case 'pageLink': {
      const id = str(a.pageId)
      const title = id ? c.title(id) : null
      return title === null ? { pageId: null, title: '(No access)' } : { pageId: id, title: title || 'Untitled' }
    }
    case 'spreadsheet': {
      const sheets = jsonAttr(a.sheets)
      const list = Array.isArray(sheets) ? sheets.filter(isObj) : []
      const active = list.find((x) => x.id === a.active) ?? list[0]
      return {
        title: str(a.title),
        active: active ? str(active.name) : null,
        sheets: list.map((sh) => ({
          name: str(sh.name),
          rows: num(sh.rows),
          cols: num(sh.cols),
          frozenRows: num(sh.frozenRows) ?? 0,
          // the inputs only: the server has no formula engine (values come from the app)
          cells: Object.fromEntries(
            Object.entries(isObj(sh.cells) ? sh.cells : {})
              .filter(([, cell]) => isObj(cell) && typeof cell.v === 'string' && cell.v !== '')
              .map(([addr, cell]) => [addr, { input: (cell as { v: string }).v, value: null }]),
          ),
        })),
      }
    }
    case 'chart': {
      const spec = jsonAttr(a.spec)
      if (!isObj(spec)) return {}
      const source = isObj(spec.source) ? spec.source : null
      // the numbers only when the block itself holds them (manual data); live sources are drawn in the app
      return { spec, data: source?.kind === 'manual' && Array.isArray(source.rows) ? { rows: source.rows } : null }
    }
    case 'button': {
      const actions = jsonAttr(a.actions)
      return { label: str(a.label), variant: str(a.variant) || 'signal', actions: Array.isArray(actions) ? actions.map((x) => ({ kind: isObj(x) ? str(x.type) : '' })) : [] }
    }
    case 'syncedBlock':
      return { syncId: str(a.syncId) || null, original: !a.sourcePageId, sourcePageId: str(a.sourcePageId) || null }
    case 'meetingNotes': {
      const lines = jsonAttr(a.transcript)
      const list = Array.isArray(lines) ? lines.filter(isObj) : []
      return {
        title: str(a.title),
        status: str(a.status) || 'idle',
        startedAt: num(a.startedAt) !== null ? iso(num(a.startedAt)!) : null,
        endedAt: num(a.endedAt) !== null ? iso(num(a.endedAt)!) : null,
        duration: num(a.duration),
        language: str(a.language) || null,
        transcriptLines: list.length,
        ...(c.transcript ? { transcript: list.map((l) => ({ t: num(l.t) ?? 0, text: str(l.text) })) } : {}),
      }
    }
    case 'image':
    case 'video':
    case 'audio':
    case 'fileBlock':
      return fileData(a, c)
    case 'bookmark':
      return { url: str(a.url), ...(a.title ? { title: str(a.title) } : {}), ...(a.description ? { description: str(a.description) } : {}) }
    case 'embed':
      return { url: str(a.url), ...(a.provider ? { provider: str(a.provider) } : {}) }
    case 'blockMath':
      return { latex: str(a.latex) }
    case 'mermaid':
      return { code: str(a.code) }
    default:
      return undefined
  }
}

/** Node types the server reads as their plain blocks: the task block, until its phase 4 (source guard). */
const FLATTEN: ReadonlySet<string> = new Set(['workItem'])

export function serverReader(c: ServerReadContext): BlockReader {
  const md: MarkdownContext = { title: c.title, ...(c.path ? { path: c.path } : {}) }
  return {
    markdown: (content) => blocksMarkdown(content.map(mdNode), md),
    data: (n) => blockData(n, c),
    flatten: FLATTEN,
  }
}

/* ------------------------------------------------------------------ comments */

const REPLY_SEP = '/r/'
const COMMENT_MAX = 4000
const cut = (s: string) => (s.length > COMMENT_MAX ? `${s.slice(0, COMMENT_MAX)}…` : s)

/** A page's comment threads from its meta entry (`comments`: thread id → thread, `<thread>/r/<reply>` → reply). */
export function readThreads(r: Roots, pageId: string, anchors: Map<string, string>): McpThread[] {
  const v = pageMap(r, pageId)?.get('comments')
  if (!(v instanceof Y.Map)) return []
  const threads: Array<Record<string, unknown>> = []
  const replies = new Map<string, Array<Record<string, unknown>>>()
  for (const [k, c] of (v as Y.Map<unknown>).entries()) {
    if (!isObj(c) || typeof c.id !== 'string') continue
    const at = k.indexOf(REPLY_SEP)
    if (at > 0) replies.set(k.slice(0, at), [...(replies.get(k.slice(0, at)) ?? []), c])
    else threads.push(c)
  }
  const byTime = (a: Record<string, unknown>, b: Record<string, unknown>) => (num(a.createdAt) ?? 0) - (num(b.createdAt) ?? 0) || (str(a.id) < str(b.id) ? -1 : 1)
  return threads.sort(byTime).map((t) => {
    const inline = Array.isArray(t.replies) ? t.replies.filter(isObj) : []
    const own = replies.get(str(t.id)) ?? []
    const ids = new Set(own.map((x) => str(x.id)))
    const all = [...own, ...inline.filter((x) => !ids.has(str(x.id)))].sort(byTime)
    const ref = anchors.get(str(t.id))
    return {
      id: str(t.id),
      quote: cut(str(t.quote)),
      body: cut(str(t.body)),
      author: str(t.author),
      createdAt: iso(num(t.createdAt) ?? 0)!,
      resolved: t.resolved === true,
      ...(ref ? { ref } : {}),
      replies: all.map((x) => ({ id: str(x.id), body: cut(str(x.body)), author: str(x.author), createdAt: iso(num(x.createdAt) ?? 0)! })),
    }
  })
}
