/**
 * One MCP — reading a page in full (spec § 2.1), pure: the Block tree with stateless refs, Markdown with ref labels, and
 * the paging of a read into parts that each serialize under MCP_LIMITS.part. The One tab (src/app/features/mcp/
 * pageRead.ts) and the team server (server/src/mcp/pageRead.ts) feed it their document (TipTap JSON; the server reads its
 * Y XML into the same shape), their Markdown and their block data — the shapes an agent gets are the same on both.
 *
 * The Block tree: every block of the page, nested. A leaf carries its Markdown (that block alone in the file form); a
 * list / to-do item its own line's Markdown and its nested blocks as children; a container (quote, callout, toggle,
 * columns / column, tabs / tab, synced block, meeting notes) carries no Markdown of its own — its children do (the
 * text is never sent twice). `attrs` is an allow-list per type, `data` what the type holds beyond its text.
 */
import { MCP_LIMITS } from './tables.ts'
import { blockHash, formatRef, prefixesFor, refLabel, type McpRef, type PMJson } from './refs.ts'
import { sha256Hex } from './sha256.ts'
import { canonicalJson } from './duplicates.ts'

export type { PMJson } from './refs.ts'

/** One block as a read hands it out (format 'blocks'). */
export interface McpBlock {
  ref: string
  type: string
  markdown?: string
  attrs?: Record<string, unknown>
  data?: Record<string, unknown>
  children?: McpBlock[]
  /** a later part of a block cut across parts: the same ref, the rest of its children / cells / lines / text */
  continued?: true
}

/** What a platform brings to a read: its Markdown, its block data and the node types it reads as their children. */
export interface BlockReader {
  /** the file-form Markdown of a doc holding exactly these blocks */
  markdown(content: PMJson[]): string
  /** a block's data beyond its text (undefined: none) */
  data(node: PMJson, at: { ref: string; path: number[] }): Record<string, unknown> | undefined
  /** node types read as their children in place (the team server: task blocks, until its phase 4) */
  flatten?: ReadonlySet<string>
}

/* ------------------------------------------------------------------ */
/* Node kinds                                                          */
/* ------------------------------------------------------------------ */

const INLINE = new Set(['text', 'hardBreak', 'mention', 'inlineMath', 'icon', 'emoji'])
const TEXTBLOCKS = new Set(['paragraph', 'heading', 'codeBlock', 'detailsSummary'])
const ITEMS = new Set(['listItem', 'taskItem'])
/** containers whose children carry a ref label of their own in Markdown */
const LABELLED_KIDS = new Set(['blockquote', 'callout', 'detailsContent', 'column', 'tab', 'syncedBlock', 'meetingNotes'])

/** attrs a Block carries, per type (spec § 2.1). */
export const BLOCK_ATTRS: Readonly<Record<string, readonly string[]>> = {
  heading: ['level'],
  codeBlock: ['language'],
  callout: ['icon', 'color'],
  details: ['heading'],
  image: ['width', 'align', 'alt', 'caption'],
  video: ['width', 'align', 'caption'],
  audio: ['caption'],
  taskItem: ['checked'],
  orderedList: ['start'],
}

const isTextblock = (n: PMJson) => TEXTBLOCKS.has(n.type ?? '') || (!!n.content?.length && n.content.every((c) => INLINE.has(c.type ?? '')))
const str = (v: unknown) => (typeof v === 'string' ? v : '')

/* ------------------------------------------------------------------ */
/* Refs                                                                */
/* ------------------------------------------------------------------ */

export interface RefIndex {
  /** the ref of a block of this page: `#<prefix>~<h>`, or `@<path>~<h>` for one without a (unique) id */
  refOf(node: PMJson, path: number[]): string
}

/** Refs for one page as it is now (id prefixes against every block id of the page, hashes of the blocks' content). */
export function refIndex(doc: PMJson): RefIndex {
  const ids: string[] = []
  const walk = (n: PMJson) => {
    if (INLINE.has(n.type ?? '')) return
    const id = n.attrs?.id
    if (typeof id === 'string' && id) ids.push(id)
    for (const c of n.content ?? []) walk(c)
  }
  for (const c of doc.content ?? []) walk(c)
  const prefixes = prefixesFor(ids)
  const memo = new WeakMap<object, string>()
  return {
    refOf(node, path) {
      const id = node.attrs?.id
      const prefix = typeof id === 'string' ? prefixes.get(id) : undefined
      const hash = blockHash(node, memo)
      return prefix ? formatRef({ kind: 'id', prefix, hash }) : formatRef({ kind: 'path', path, hash })
    },
  }
}

/**
 * The top-level block that holds the NESTED block a ref names: a path ref of more than one step, or an id prefix only a
 * block inside another one has (exactly one). null: the ref names no nested block of the page (gone, ambiguous, or a
 * top-level one). Tools that place something between top-level blocks (`inline.afterBlock`) answer such a ref with
 * the top-level block's ref instead of `stale_ref` — reading again would hand out the same nested ref.
 */
export function nestedTopLevel(doc: PMJson, ref: McpRef): number | null {
  const top = doc.content ?? []
  if (ref.kind === 'path') return ref.path.length > 1 && ref.path[0]! < top.length ? ref.path[0]! : null
  let at: number | null = null
  let hits = 0
  const walk = (n: PMJson, i: number) => {
    for (const c of n.content ?? []) {
      if (INLINE.has(c.type ?? '')) continue
      const id = c.attrs?.id
      if (typeof id === 'string' && id.startsWith(ref.prefix)) {
        hits += 1
        at = i
      }
      walk(c, i)
    }
  }
  top.forEach((n, i) => walk(n, i))
  return hits === 1 ? at : null
}

/* ------------------------------------------------------------------ */
/* The Block tree                                                      */
/* ------------------------------------------------------------------ */

interface At {
  node: PMJson
  path: number[]
}

/** A node's own block children (an item's / a task's first paragraph is its line; a toggle's are its content's). */
function ownChildren(node: PMJson, path: number[], flatten: ReadonlySet<string>): At[] {
  const kids = node.content ?? []
  const type = node.type ?? ''
  if (type === 'table' || isTextblock(node)) return []
  if (type === 'details') {
    const ci = kids.findIndex((k) => k.type === 'detailsContent')
    return ci < 0 ? [] : (kids[ci]!.content ?? []).map((n, i) => ({ node: n, path: [...path, ci, i] }))
  }
  const all = kids.map((n, i) => ({ node: n, path: [...path, i] })).filter((c) => !INLINE.has(c.node.type ?? ''))
  const lined = ITEMS.has(type) || (type === 'workItem' && !flatten.has('workItem'))
  return lined && all[0]?.node.type === 'paragraph' ? all.slice(1) : all
}

/** Children with the flattened types replaced by their own children (in place, at their real paths). */
function expand(list: At[], flatten: ReadonlySet<string>): At[] {
  return list.flatMap((c) =>
    flatten.has(c.node.type ?? '') ? expand((c.node.content ?? []).map((n, i) => ({ node: n, path: [...c.path, i] })).filter((x) => !INLINE.has(x.node.type ?? '')), flatten) : [c],
  )
}

/** Comment threads anchored in a node's own text: thread id → where (the caller keeps the first). */
function commentIds(node: PMJson, into: Set<string>) {
  for (const m of node.marks ?? []) if (m.type === 'comment' && typeof m.attrs?.id === 'string') into.add(m.attrs.id)
  for (const c of node.content ?? []) commentIds(c, into)
}

/** Where a read found things: comment thread → the ref of the block holding its mark. */
export interface ReadAnchors {
  comments: Map<string, string>
}

/** The Block of one node (with its subtree); `anchors` collects where comment threads sit. */
export function readBlock(node: PMJson, path: number[], reader: BlockReader, refs: RefIndex, anchors?: ReadAnchors): McpBlock {
  const flatten = reader.flatten ?? new Set<string>()
  const ref = refs.refOf(node, path)
  const type = node.type ?? 'unknown'
  const out: McpBlock = { ref, type }
  const kids = expand(ownChildren(node, path, flatten), flatten)
  const lined = (ITEMS.has(type) || (type === 'workItem' && !flatten.has('workItem'))) && node.content?.[0]?.type === 'paragraph'
  // the block's own text: a leaf whole, an item its line (a task: its title quote with the field line)
  const own: PMJson | null = lined ? (type === 'workItem' ? { ...node, content: [node.content![0]!] } : node.content![0]!) : kids.length ? null : node
  if (own) {
    const md = reader.markdown([own]).trim()
    if (md) out.markdown = md
    if (anchors) {
      const ids = new Set<string>()
      commentIds(own, ids)
      for (const id of ids) if (!anchors.comments.has(id)) anchors.comments.set(id, ref)
    }
  }
  const keep = BLOCK_ATTRS[type]
  if (keep) {
    const attrs: Record<string, unknown> = {}
    for (const k of keep) {
      const v = node.attrs?.[k]
      if (v !== null && v !== undefined && v !== '') attrs[k] = v
    }
    if (Object.keys(attrs).length) out.attrs = attrs
  }
  let data = reader.data(node, { ref, path }) ?? undefined
  // the core's own data: a toggle's summary line, the tabs' titles, a tab's title
  if (type === 'details') {
    const summary = (node.content ?? []).find((k) => k.type === 'detailsSummary')
    const md = summary?.content?.length ? reader.markdown([{ type: 'paragraph', content: summary.content }]).trim() : ''
    data = { ...data, summary: md }
    if (anchors && summary) {
      const ids = new Set<string>()
      commentIds(summary, ids)
      for (const id of ids) if (!anchors.comments.has(id)) anchors.comments.set(id, ref)
    }
  } else if (type === 'tabs') data = { ...data, tabs: (node.content ?? []).map((t) => ({ title: str(t.attrs?.title) })) }
  else if (type === 'tab') data = { ...data, title: str(node.attrs?.title) }
  if (data && Object.keys(data).length) out.data = data
  if (kids.length) out.children = kids.map((k) => readBlock(k.node, k.path, reader, refs, anchors))
  return out
}

/** Every block of a page's top level (with their subtrees) — `keep(index)` leaves blocks out (context marks). */
export function readBlocks(doc: PMJson, reader: BlockReader, refs: RefIndex, keep?: (index: number) => boolean, anchors?: ReadAnchors): McpBlock[] {
  const flatten = reader.flatten ?? new Set<string>()
  const top = (doc.content ?? []).map((node, i) => ({ node, path: [i] })).filter((c) => !keep || keep(c.path[0]!))
  return expand(top, flatten).map((c) => readBlock(c.node, c.path, reader, refs, anchors))
}

/* ------------------------------------------------------------------ */
/* Markdown with ref labels                                            */
/* ------------------------------------------------------------------ */

/** A label as text Markdown escaped (`\_`, `\~`) → as it was. */
export const unescapeLabels = (md: string): string => md.replace(/⟦[^⟦⟧\n]*⟧/g, (m) => m.replace(/\\([_~*`[\]\\])/g, '$1'))

const labelParagraph = (ref: string): PMJson => ({ type: 'paragraph', content: [{ type: 'text', text: refLabel(ref) }] })

/** The node with its nested labels: items and nested tasks in front of their line, children of containers above them. */
function withLabels(node: PMJson, path: number[], refs: RefIndex, flatten: ReadonlySet<string>): PMJson {
  const kids = node.content
  if (!kids?.length || isTextblock(node) || node.type === 'table') return node
  const type = node.type ?? ''
  const labelKids = LABELLED_KIDS.has(type) || flatten.has(type)
  const content: PMJson[] = []
  kids.forEach((c, i) => {
    const p = [...path, i]
    if (labelKids && !INLINE.has(c.type ?? '') && !flatten.has(c.type ?? '')) content.push(labelParagraph(refs.refOf(c, p)))
    content.push(withLabels(c, p, refs, flatten))
  })
  const lined = ITEMS.has(type) || (type === 'workItem' && path.length > 1 && !flatten.has('workItem'))
  if (lined) {
    const label = refLabel(refs.refOf(node, path))
    // the label paragraph a container put in front is not the item's line: the line is the first real child
    if (content[0]?.type === 'paragraph') content[0] = { ...content[0], content: [{ type: 'text', text: `${label} ` }, ...(content[0].content ?? [])] }
    else content.unshift({ type: 'paragraph', content: [{ type: 'text', text: label }] })
  }
  return { ...node, content }
}

/**
 * One top-level block as Markdown under its label (`⟦#3f9a1c~a1b2c3⟧` on a line of its own), with the labels of its
 * items and container children inside — what `refs: true` reads.
 */
export function labelledMarkdown(node: PMJson, path: number[], reader: BlockReader, refs: RefIndex): string {
  const flatten = reader.flatten ?? new Set<string>()
  if (flatten.has(node.type ?? '')) {
    const parts = (node.content ?? []).map((c, i) => (INLINE.has(c.type ?? '') ? '' : labelledMarkdown(c, [...path, i], reader, refs))).filter(Boolean)
    return parts.join('\n\n')
  }
  const md = unescapeLabels(reader.markdown([withLabels(node, path, refs, flatten)]).trim())
  return `${refLabel(refs.refOf(node, path))}\n${md || `(${node.type ?? 'block'})`}`
}

/** An empty paragraph (nothing to label or read). */
export const isBlank = (n: PMJson): boolean => n.type === 'paragraph' && !(n.content ?? []).some((c) => c.type !== 'text' || (c.text ?? '').trim())

/* ------------------------------------------------------------------ */
/* Cutting a read into parts                                           */
/* ------------------------------------------------------------------ */

/** Serialized size of a value (what a part is measured by). */
export const sizeOf = (v: unknown): number => JSON.stringify(v)?.length ?? 0

/** Room a part keeps for the workspace stamp and the envelope's own keys. */
export const PART_RESERVE = 600

/** Lines of a long text cut into chunks of at most `room` serialized characters (a line longer than that is cut too). */
export function textChunks(text: string, room: number): string[] {
  const max = Math.max(1000, room)
  const out: string[] = []
  let cur = ''
  const push = (s: string) => {
    if (cur && sizeOf(`${cur}\n${s}`) > max) {
      out.push(cur)
      cur = s
    } else cur = cur ? `${cur}\n${s}` : s
  }
  for (const line of text.split('\n')) {
    if (sizeOf(line) <= max) push(line)
    else {
      // JSON escapes may double a character: cut by half the room to stay under it
      const step = Math.max(500, Math.floor(max / 2))
      for (let i = 0; i < line.length; i += step) push(line.slice(i, i + step))
    }
  }
  if (cur || !out.length) out.push(cur)
  return out
}

/** A list cut into consecutive groups whose serialized items fit `room` (one oversized item stays alone). */
export function groupsOf<T>(items: T[], room: number, size: (x: T) => number = sizeOf): T[][] {
  const groups: T[][] = []
  let cur: T[] = []
  let used = 0
  for (const it of items) {
    const s = size(it) + 1
    if (cur.length && used + s > room) {
      groups.push(cur)
      cur = []
      used = 0
    }
    cur.push(it)
    used += s
  }
  if (cur.length) groups.push(cur)
  return groups
}

const countBlocks = (b: McpBlock): number => 1 + (b.children ?? []).reduce((n, c) => n + countBlocks(c), 0)

/** Data a block holds in a list that may continue in the next part: a spreadsheet's cells, a meeting's transcript. */
function splitData(b: McpBlock, budget: number): McpBlock[] | null {
  const data = b.data
  if (!data) return null
  const shell = (d: Record<string, unknown>): McpBlock => ({ ref: b.ref, type: b.type, continued: true, data: d })
  if (Array.isArray(data.transcript) && data.transcript.length > 1) {
    const lines = data.transcript as unknown[]
    const firstRoom = budget - sizeOf({ ...b, data: { ...data, transcript: [] } })
    const room = budget - sizeOf(shell({ transcript: [] }))
    if (firstRoom < budget / 4) return null
    const [head = [], ...rest] = groupsOf(lines, firstRoom)
    const tail = groupsOf(rest.flat(), room)
    return [{ ...b, data: { ...data, transcript: head } }, ...tail.map((g) => shell({ transcript: g }))]
  }
  if (Array.isArray(data.sheets) && data.sheets.length) {
    type Sheet = Record<string, unknown> & { name?: unknown; cells?: Record<string, unknown> }
    const sheets = data.sheets as Sheet[]
    const cells = sheets.flatMap((s, si) => Object.entries(s.cells ?? {}).map(([addr, cell]) => ({ si, addr, cell })))
    if (cells.length < 2) return null
    const bare = sheets.map((s) => ({ ...s, cells: {} }))
    const firstRoom = budget - sizeOf({ ...b, data: { ...data, sheets: bare } })
    const room = budget - sizeOf(shell({ sheets: sheets.map((s) => ({ name: s.name, cells: {} })) }))
    if (firstRoom < budget / 4) return null
    const cellSize = (c: { addr: string; cell: unknown }) => sizeOf(c.addr) + sizeOf(c.cell) + 1
    const [head = [], ...rest] = groupsOf(cells, firstRoom, cellSize)
    const tail = groupsOf(rest.flat(), room, cellSize)
    const fill = (base: Sheet[], group: typeof cells, keepAll: boolean): Sheet[] => {
      const out = base.map((s) => ({ ...s, cells: {} as Record<string, unknown> }))
      for (const c of group) out[c.si]!.cells[c.addr] = c.cell
      return keepAll ? out : out.filter((s) => Object.keys(s.cells).length)
    }
    return [{ ...b, data: { ...data, sheets: fill(bare, head, true) } }, ...tail.map((g) => shell({ sheets: fill(sheets.map((s) => ({ name: s.name })), g, false) }))]
  }
  return null
}

/** A Block cut into pieces that each serialize within `budget` (the first is the block, the rest `continued`). */
export function blockPieces(b: McpBlock, budget: number): McpBlock[] {
  if (sizeOf(b) <= budget) return [b]
  const byData = splitData(b, budget)
  if (byData) return byData.flatMap((p, i) => (i === 0 ? childPieces(p, budget) : [p]))
  return childPieces(b, budget)
}

function childPieces(b: McpBlock, budget: number): McpBlock[] {
  if (sizeOf(b) <= budget) return [b]
  if (b.children?.length) {
    const cont: McpBlock = { ref: b.ref, type: b.type, continued: true, children: [] }
    const room = Math.max(budget / 2, budget - Math.max(sizeOf({ ...b, children: [] }), sizeOf(cont)) - 2)
    const kids = b.children.flatMap((c) => blockPieces(c, room))
    return groupsOf(kids, room).map((g, i) => (i === 0 ? { ...b, children: g } : { ...cont, children: g }))
  }
  if (b.markdown && b.markdown.length > 1) {
    const room = budget - sizeOf({ ...b, markdown: '' })
    const chunks = textChunks(b.markdown, room)
    if (chunks.length > 1) return chunks.map((md, i) => (i === 0 ? { ...b, markdown: md } : { ref: b.ref, type: b.type, continued: true, markdown: md }))
  }
  return [b]
}

/** How many blocks a piece counts in a part (MCP_LIMITS.partBlocks). */
export const blocksIn = (piece: McpBlock | string): number => (typeof piece === 'string' ? 1 : countBlocks(piece))

/**
 * The end (exclusive) of the part that starts at `from`: pieces while they fit `budget` serialized characters (the
 * separator counted) and MCP_LIMITS.partBlocks blocks. A part always takes at least one piece.
 */
export function partEnd(sizes: number[], counts: number[], from: number, budget: number, maxBlocks: number = MCP_LIMITS.partBlocks): number {
  let used = 0
  let n = 0
  let i = from
  while (i < sizes.length) {
    const s = sizes[i]! + (i > from ? 2 : 0)
    if (i > from && (used + s > budget || n + counts[i]! > maxBlocks)) break
    used += s
    n += counts[i]!
    i++
  }
  return i
}

/* ------------------------------------------------------------------ */
/* The cursor                                                          */
/* ------------------------------------------------------------------ */

const short = (s: string) => sha256Hex(s).slice(0, 10)

/** The read's fingerprint: page and arguments that change the parts (a cursor belongs to one read). */
export const readPrint = (args: Record<string, unknown>): string => short(canonicalJson(args))

/** The opaque cursor of the part that starts at `offset` of a read of the page at `rev`. */
export const encodeReadCursor = (offset: number, rev: string, print: string): string => `${offset.toString(36)}.${short(rev)}.${print}`

export type CursorCheck = { ok: true; offset: number } | { ok: false; code: 'bad_argument' | 'page_changed'; what: string }

/** Where a cursor continues — or why it cannot: another read (`bad_argument`), the page changed since (`page_changed`). */
export function decodeReadCursor(raw: unknown, rev: string, print: string, units: number): CursorCheck {
  if (raw === undefined || raw === null || raw === '') return { ok: true, offset: 0 }
  const m = typeof raw === 'string' ? /^([0-9a-z]{1,8})\.([0-9a-f]{10})\.([0-9a-f]{10})$/.exec(raw.trim()) : null
  if (!m) return { ok: false, code: 'bad_argument', what: 'This is not a cursor of one_get_page: pass the "next" value of the previous part' }
  if (m[3] !== print) return { ok: false, code: 'bad_argument', what: 'This cursor belongs to another read (another page, format, refs or transcript): start again without it' }
  if (m[2] !== short(rev)) return { ok: false, code: 'page_changed', what: 'The page changed since the part this cursor came from' }
  const offset = parseInt(m[1]!, 36)
  if (!Number.isFinite(offset) || offset <= 0 || offset >= units) return { ok: false, code: 'bad_argument', what: 'This cursor points past the end of the page: start again without it' }
  return { ok: true, offset }
}

/* ------------------------------------------------------------------ */
/* A part                                                              */
/* ------------------------------------------------------------------ */

/**
 * The most a first part's head (everything but the content) takes, serialized: longer heads are trimmed (fitHead), so
 * every piece is cut for the same room in every part and a cursor's offset means the same piece in every call.
 */
export const HEAD_CAP = 16_000

/** The room one piece of content may take (a part = head or its short shell + pieces). */
export const PIECE_ROOM = MCP_LIMITS.part - PART_RESERVE - HEAD_CAP

/** A first part's head within HEAD_CAP: comment threads, backlinks, sub-pages, long property values give way, in that order. */
export function fitHead(head: Record<string, unknown>): Record<string, unknown> {
  if (sizeOf(head) <= HEAD_CAP) return head
  const out: Record<string, unknown> = { ...head }
  const trimList = (key: string, more: (n: number) => void) => {
    const list = out[key]
    if (!Array.isArray(list)) return
    const kept = [...list]
    let dropped = 0
    while (kept.length && sizeOf(out) > HEAD_CAP) {
      kept.pop()
      dropped++
      out[key] = kept
    }
    if (dropped) more(dropped)
  }
  trimList('comments', (n) => (out.commentsMore = n))
  trimList('backlinks', (n) => (out.backlinksMore = n))
  const children = out.children as { items?: unknown[]; more?: number } | undefined
  if (sizeOf(out) > HEAD_CAP && children?.items?.length) {
    const items = [...children.items]
    let more = children.more ?? 0
    while (items.length && sizeOf(out) > HEAD_CAP) {
      items.pop()
      more++
      out.children = { items: [...items], more }
    }
  }
  if (sizeOf(out) > HEAD_CAP && out.properties && typeof out.properties === 'object') {
    const props: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(out.properties as Record<string, unknown>)) props[k] = typeof v === 'string' && v.length > 1000 ? `${v.slice(0, 1000)}…` : v
    out.properties = props
    if (sizeOf(out) > HEAD_CAP) {
      delete out.properties
      out.propertiesNote = 'The property values are too long for this answer: one_query_database reads them.'
    }
  }
  return out
}

/** A comment thread as a read hands it out (spec § 2.1). */
export interface McpThread {
  id: string
  quote: string
  body: string
  author: string
  createdAt: string
  resolved: boolean
  ref?: string
  replies: Array<{ id: string; body: string; author: string; createdAt: string }>
}

/** A unit of Markdown content: a top-level block (rendered with its neighbours when refs are off) or a cut piece of one. */
export interface MdUnit {
  text: string
  node?: PMJson
}

/**
 * The Markdown units of a read: one per top-level block (labelled when `refs`), a block longer than one piece's room cut
 * into chunks at line ends; empty paragraphs are left out of a labelled read.
 */
export function markdownUnits(top: Array<{ node: PMJson; path: number[] }>, reader: BlockReader, refs: RefIndex | null): MdUnit[] {
  const out: MdUnit[] = []
  for (const { node, path } of top) {
    if (refs && isBlank(node)) continue
    const text = refs ? labelledMarkdown(node, path, reader, refs) : reader.markdown([node]).trim()
    if (sizeOf(text) <= PIECE_ROOM) out.push(refs ? { text } : { text, node })
    else for (const chunk of textChunks(text, PIECE_ROOM)) out.push({ text: chunk })
  }
  return out
}

/** Units [from, to) as one text: neighbouring whole blocks through the platform's Markdown at once (as a whole page reads). */
function renderUnits(units: MdUnit[], from: number, to: number, reader: BlockReader): string {
  const parts: string[] = []
  let run: PMJson[] = []
  const flush = () => {
    if (!run.length) return
    const md = reader.markdown(run).trim()
    if (md) parts.push(md)
    run = []
  }
  for (let i = from; i < to; i++) {
    const u = units[i]!
    if (u.node) run.push(u.node)
    else {
      flush()
      if (u.text) parts.push(u.text)
    }
  }
  flush()
  return parts.join('\n\n')
}

export type PartResult = { ok: true; result: Record<string, unknown> } | { ok: false; code: 'bad_argument' | 'page_changed'; what: string }

/**
 * One part of a read: the head (first part) or `{ id, rev }`, then as many units as fit MCP_LIMITS.part serialized, and
 * `next` (the cursor of the following part; null at the end).
 */
export function readPart(o: {
  head: Record<string, unknown>
  id: string
  rev: string
  /** what the cursor checks: the rev and anything else that changes the units (context marks) */
  cursorRev: string
  print: string
  cursor: unknown
  format: 'markdown' | 'blocks'
  units: MdUnit[] | McpBlock[]
  reader: BlockReader
}): PartResult {
  const n = o.units.length
  const at = decodeReadCursor(o.cursor, o.cursorRev, o.print, Math.max(n, 1))
  if (!at.ok) return at
  const shell = at.offset === 0 ? fitHead(o.head) : { id: o.id, rev: o.rev }
  const budget = MCP_LIMITS.part - PART_RESERVE - sizeOf(shell)
  const md = o.format === 'markdown'
  const units = o.units as Array<MdUnit | McpBlock>
  const sizes = units.map((u) => (md ? sizeOf((u as MdUnit).text) : sizeOf(u)))
  const counts = units.map((u) => (md ? 1 : blocksIn(u as McpBlock)))
  let to = partEnd(sizes, counts, at.offset, budget)
  let content: string | McpBlock[] = ''
  for (;;) {
    content = md ? renderUnits(o.units as MdUnit[], at.offset, to, o.reader) : (o.units as McpBlock[]).slice(at.offset, to)
    // a run rendered at once may come out a little longer than its units: one unit fewer, then again
    if (sizeOf(content) <= budget || to - at.offset <= 1) break
    to--
  }
  const next = to < n ? encodeReadCursor(to, o.cursorRev, o.print) : null
  return { ok: true, result: { ...shell, [o.format]: content, next } }
}
