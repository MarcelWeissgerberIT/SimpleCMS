/**
 * "Sub-page per item" — the items of a selection each become a sub-page of this page, and ONE table takes
 * their place: a page mention per item plus up to three fields the items share. No AI, instant, one
 * transaction, one Undo. Entry points: the block menu (Turn into → Sub-page per item), the AI menu
 * (Structure, and requests like "one page per ticket"), Transform into → Pages + table.
 *
 *  - Items: list items (a list, or some items of one), heading sections (split at the highest heading
 *    level in the selection; blocks before the first heading stay) or table rows (the header row names the
 *    columns). Mixed: headings win, then lists, then a table.
 *  - A page: the item's first line (a heading's text, a row's first cell) is its title; the rest — the
 *    item's other lines and nested blocks, the section's blocks, the row's other cells as "Column: value" —
 *    is its content (origin 'split'). A long first line, or one with links or mentions, stays in the content.
 *  - Fields: "Key: value" lines the items hold (status, owner, date, priority … first), a to-do list's
 *    checkbox as Done, a table's next columns — at most three.
 *  - What lives in an item goes along (inline databases, linked sub-pages, comment threads); a private page
 *    gets private sub-pages (createPrivatePage) — like Turn into page (split.ts).
 *  - Undo: the toast's Undo or ⌘Z puts the items back and trashes the new pages that are still untouched;
 *    ⌘⇧Z brings them back.
 */
import type { Editor, JSONContent } from '@tiptap/core'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { TextSelection, Transaction } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { Transform } from '@tiptap/pm/transform'
import { useWorkspace } from '../../store/store'
import type { ID } from '../../store/types'
import { useUI } from '../../store/ui'
import { newId } from '../../lib/ids'
import { t } from '../../i18n'
import { createPrivatePage, isPrivatePage } from '../../cloud'
import { snapshotNow } from '../../features'
import { commentIdsIn } from '../schema/comment'
import { docSchema } from '../convert'
import { cutTitle, firstLine, holdsBusyMeeting, leafText, readSplit, splitRange, squash, SPLIT_LISTS, TITLE_MAX, type SplitAt, type SplitRange } from './range'
import { childrenIn, closeUndoStep, hasNode, moveThreads, replacement, SPLIT_ORIGIN } from './split'

/* ------------------------------------------------------------------ */
/* Reading the items (pure)                                            */
/* ------------------------------------------------------------------ */

export type ItemsKind = 'list' | 'headings' | 'table'

interface Field {
  /** the key as written ("Status") */
  key: string
  value: string
}

interface Item {
  title: string
  /** the new page's blocks */
  body: JSONContent[]
  /** "Key: value" lines / the row's cells, by lower-case key */
  fields: Map<string, Field>
  /** a to-do item: checked */
  done?: boolean
  /** what leaves the page (inline databases, linked sub-pages, comment threads inside go along) */
  nodes: PMNode[]
}

/** A column of the table after the title: a field key, or DONE (a to-do item's checkbox). */
interface Column {
  key: string
  label: string
}

const DONE = '#done'
/** Columns besides the title, at most. */
export const MAX_FIELDS = 3

export interface ItemsPlan {
  kind: ItemsKind
  at: SplitAt
  items: Item[]
  columns: Column[]
  /** whole blocks: the range rebuilt — kept blocks, null where the table goes (list items: null, the list is split around it) */
  layout: Array<PMNode | null> | null
}

/** Field names that come first (EN + DE): status, people, dates, priority, type, effort. */
const PRIORITY = [
  'status', 'state', 'stage', 'phase', 'stand',
  'owner', 'assignee', 'assigned to', 'responsible', 'lead', 'zuständig', 'verantwortlich', 'bearbeiter', 'bearbeiterin',
  'due', 'due date', 'deadline', 'date', 'fällig', 'fälligkeit', 'frist', 'termin', 'datum',
  'priority', 'prio', 'priorität',
  'type', 'typ', 'kind', 'art',
  'estimate', 'points', 'aufwand',
]

/** "Status: open" → { key: 'Status', value: 'open' } (a key of at most three words). */
const FIELD_LINE = /^([\p{L}][\p{L}\p{N}._/ -]{0,28}?)\s*[:：]\s+(\S.*)$/u

function fieldOf(line: string): Field | null {
  const m = FIELD_LINE.exec(squash(line))
  if (!m) return null
  const key = m[1].trim()
  if (key.split(' ').length > 3) return null
  const value = m[2].trim()
  return { key, value: value.length > 80 ? `${value.slice(0, 79)}…` : value }
}

const linesOf = (n: PMNode): string[] => (n.isLeaf ? [] : n.textBetween(0, n.content.size, '\n', leafText).split('\n'))

/** Collect "Key: value" lines (first one per key wins). */
function addFields(into: Map<string, Field>, lines: string[]) {
  for (const line of lines) {
    const f = fieldOf(line)
    if (f && !into.has(f.key.toLowerCase())) into.set(f.key.toLowerCase(), f)
  }
}

/** The lines a block offers as fields: a paragraph's lines, a list's item first lines. */
function fieldLines(n: PMNode): string[] {
  if (n.type.name === 'paragraph') return linesOf(n)
  if (SPLIT_LISTS.has(n.type.name)) {
    const out: string[] = []
    n.forEach((item) => {
      if (item.firstChild?.type.name === 'paragraph') out.push(...linesOf(item.firstChild))
    })
    return out
  }
  return []
}

/** Up to `max` fields the items share: known names first, then the most common (a lone one only among few items). */
function pickFields(items: Item[], max: number): Column[] {
  const seen = new Map<string, { label: string; count: number; first: number }>()
  let order = 0
  for (const it of items)
    for (const [k, f] of it.fields) {
      const s = seen.get(k)
      if (s) s.count += 1
      else seen.set(k, { label: f.key, count: 1, first: order++ })
    }
  const rank = (k: string) => {
    const i = PRIORITY.indexOf(k)
    return i < 0 ? PRIORITY.length : i
  }
  return [...seen.entries()]
    .filter(([k, s]) => rank(k) < PRIORITY.length || items.length < 3 || s.count >= 2)
    .sort((a, b) => rank(a[0]) - rank(b[0]) || b[1].count - a[1].count || a[1].first - b[1].first)
    .slice(0, max)
    .map(([key, s]) => ({ key, label: s.label }))
}

/** The inline content of a paragraph after its first line break (null: nothing there). */
function restOfParagraph(p: PMNode): JSONContent | null {
  const kids: JSONContent[] = []
  let broken = false
  p.forEach((c) => {
    if (broken) kids.push(c.toJSON() as JSONContent)
    else if (c.type.name === 'hardBreak') broken = true
  })
  while (kids[0]?.type === 'hardBreak') kids.shift()
  while (kids.length && kids[kids.length - 1].type === 'hardBreak') kids.pop()
  return kids.some((k) => k.type !== 'text' || k.text?.trim()) ? { type: 'paragraph', content: kids } : null
}

/** The paragraph's first line holds plain words only (no links, comments, mentions): the title can stand for it. */
function plainFirstLine(p: PMNode): boolean {
  let plain = true
  let done = false
  p.forEach((c) => {
    if (done) return
    if (c.type.name === 'hardBreak') done = true
    else if (!c.isText || c.marks.some((m) => m.type.name === 'link' || m.type.name === 'comment')) plain = false
  })
  return plain
}

/** A list item: its first line is the title; the other lines and the nested blocks are the page. */
function listItem(node: PMNode, task: boolean): Item | null {
  const first = node.firstChild?.type.name === 'paragraph' ? node.firstChild : null
  const lines = first ? linesOf(first) : []
  const head = squash(lines[0] ?? '')
  const line = head || firstLine(node)
  const body: JSONContent[] = []
  const fields = new Map<string, Field>()
  // a short plain first line IS the title; otherwise the paragraph stays in the page as written
  const titled = !!first && !!head && plainFirstLine(first) && head.length <= TITLE_MAX
  if (first) {
    const rest = titled ? restOfParagraph(first) : (first.toJSON() as JSONContent)
    if (rest) body.push(rest)
    addFields(fields, lines.slice(1))
  }
  node.forEach((child, _o, i) => {
    if (first && i === 0) return
    body.push(child.toJSON() as JSONContent)
    addFields(fields, fieldLines(child))
  })
  if (!line && !body.length) return null
  return { title: cutTitle(line), body, fields, ...(task ? { done: !!node.attrs.checked } : {}), nodes: [node] }
}

/** Heading sections at the highest heading level among the nodes; `intro` = the blocks before the first one. */
function sections(nodes: PMNode[]): { intro: number; items: Item[] } | null {
  const levels = nodes.filter((n) => n.type.name === 'heading').map((n) => Number(n.attrs.level) || 1)
  if (!levels.length) return null
  const level = Math.min(...levels)
  const starts = nodes.flatMap((n, i) => (n.type.name === 'heading' && (Number(n.attrs.level) || 1) === level ? [i] : []))
  const items = starts.map((s, k): Item => {
    const end = starts[k + 1] ?? nodes.length
    const rest = nodes.slice(s + 1, end)
    const fields = new Map<string, Field>()
    for (const n of rest) addFields(fields, fieldLines(n))
    const heading = nodes[s]
    return { title: cutTitle(squash(heading.textBetween(0, heading.content.size, ' ', leafText))), body: rest.map((n) => n.toJSON() as JSONContent), fields, nodes: nodes.slice(s, end) }
  })
  return { intro: starts[0], items }
}

const cellText = (cell: PMNode | null | undefined) => (cell ? squash(cell.textBetween(0, cell.content.size, ' ', leafText)) : '')

/** Table rows: the first cell is the title, the other cells the page ("Column: value") and the fields. */
function tableRows(table: PMNode): { items: Item[]; columns: Column[] } | null {
  const rows: PMNode[] = []
  table.forEach((r) => rows.push(r))
  if (!rows.length) return null
  let header = true
  rows[0].forEach((c) => {
    if (c.type.name !== 'tableHeader') header = false
  })
  const width = Math.max(...rows.map((r) => r.childCount))
  const names = Array.from({ length: width }, (_, i) => (header ? cellText(rows[0].maybeChild(i)) : '') || t('editor.split.items.column', { n: i + 1 }))
  const items: Item[] = []
  for (const row of header ? rows.slice(1) : rows) {
    const line = cellText(row.maybeChild(0))
    const body: JSONContent[] = []
    const fields = new Map<string, Field>()
    // a long first cell stays in the page as written
    if (line.length > TITLE_MAX) row.child(0).forEach((b) => body.push(b.toJSON() as JSONContent))
    for (let i = 1; i < row.childCount; i++) {
      const cell = row.child(i)
      const value = cellText(cell)
      if (!value) continue
      fields.set(names[i].toLowerCase(), { key: names[i], value: value.length > 80 ? `${value.slice(0, 79)}…` : value })
      const label: JSONContent = { type: 'text', text: `${names[i]}:`, marks: [{ type: 'bold' }] }
      const only = cell.childCount === 1 && cell.firstChild?.type.name === 'paragraph' ? cell.firstChild : null
      if (only) body.push({ type: 'paragraph', content: [label, { type: 'text', text: ' ' }, ...((only.content.toJSON() as JSONContent[] | null) ?? [])] })
      else {
        body.push({ type: 'paragraph', content: [label] })
        cell.forEach((b) => body.push(b.toJSON() as JSONContent))
      }
    }
    if (!line && !body.length) continue
    items.push({ title: cutTitle(line), body, fields, nodes: [row] })
  }
  if (!items.length) return null
  // the next columns that hold anything, in their order
  const columns = names
    .slice(1)
    .filter((n) => items.some((it) => it.fields.has(n.toLowerCase())))
    .slice(0, MAX_FIELDS)
    .map((n) => ({ key: n.toLowerCase(), label: n }))
  return { items, columns }
}

/** What "Sub-page per item" would do with the blocks from `from` to `to` (the selection: whole blocks / list items); null: no items there. */
export function planItems(doc: PMNode, from: number, to: number): ItemsPlan | null {
  const range = splitRange(doc, from, to)
  const at = range ? readSplit(doc, range) : null
  if (!at) return null
  const withDone = (items: Item[]) => items.some((it) => it.done !== undefined)
  const columnsOf = (items: Item[]): Column[] => {
    const done = withDone(items)
    return [...(done ? [{ key: DONE, label: t('editor.split.items.done') }] : []), ...pickFields(items, MAX_FIELDS - (done ? 1 : 0))]
  }
  // some items of a list: the list is split around the table
  if (at.list) {
    const task = at.list.node.type.name === 'taskList'
    const items = at.nodes.map((n) => listItem(n, task)).filter((x): x is Item => !!x)
    return items.length ? { kind: 'list', at, items, columns: columnsOf(items), layout: null } : null
  }
  const nodes = at.nodes
  const secs = sections(nodes)
  if (secs?.items.length) return { kind: 'headings', at, items: secs.items, columns: columnsOf(secs.items), layout: [...nodes.slice(0, secs.intro), null] }
  // lists: every item of every list; the table goes where the first list was, the other blocks stay
  const lists = nodes.filter((n) => SPLIT_LISTS.has(n.type.name))
  if (lists.length) {
    const items = lists.flatMap((l) => {
      const task = l.type.name === 'taskList'
      const out: Item[] = []
      l.forEach((it) => {
        const item = listItem(it, task)
        if (item) out.push(item)
      })
      return out
    })
    if (!items.length) return null
    let placed = false
    const layout = nodes.flatMap((n): Array<PMNode | null> => {
      if (!SPLIT_LISTS.has(n.type.name)) return [n]
      if (placed) return []
      placed = true
      return [null]
    })
    return { kind: 'list', at, items, columns: columnsOf(items), layout }
  }
  const tables = nodes.filter((n) => n.type.name === 'table')
  if (tables.length === 1) {
    const rows = tableRows(tables[0])
    if (!rows) return null
    return { kind: 'table', at, items: rows.items, columns: rows.columns, layout: nodes.map((n) => (n === tables[0] ? null : n)) }
  }
  return null
}

/** How many sub-pages "Sub-page per item" would make of a range (0: not offered). */
export function itemCount(doc: PMNode, range: SplitRange | null | undefined): number {
  if (!range) return 0
  try {
    return planItems(doc, range.from, range.to)?.items.length ?? 0
  } catch {
    return 0
  }
}

/* ------------------------------------------------------------------ */
/* The table                                                           */
/* ------------------------------------------------------------------ */

const textNodes = (s: string): JSONContent[] => (s ? [{ type: 'text', text: s }] : [])
const cellOf = (type: 'tableHeader' | 'tableCell', content: JSONContent[]): JSONContent => ({ type, content: [{ type: 'paragraph', content }] })

/** The table in the items' place: the page (a mention) and the fields of each. */
function tableJSON(plan: ItemsPlan, ids: ID[], labels: boolean): JSONContent {
  const head: JSONContent = { type: 'tableRow', content: [cellOf('tableHeader', textNodes(t('editor.split.items.page'))), ...plan.columns.map((c) => cellOf('tableHeader', textNodes(c.label)))] }
  const rows = plan.items.map(
    (it, i): JSONContent => ({
      type: 'tableRow',
      content: [
        // mentions of private pages carry no label
        cellOf('tableCell', [{ type: 'mention', attrs: { id: ids[i], label: labels ? it.title || null : null, kind: 'page' } }]),
        ...plan.columns.map((c) => cellOf('tableCell', textNodes(c.key === DONE ? (it.done ? '✓' : '') : (it.fields.get(c.key)?.value ?? '')))),
      ],
    }),
  )
  return { type: 'table', content: [head, ...rows] }
}

/* ------------------------------------------------------------------ */
/* Sub-page per item                                                   */
/* ------------------------------------------------------------------ */

export interface PagesPerItemOptions {
  /** what to read (expanded to whole blocks / list items); default: the selection */
  range?: SplitRange | null
  /** the page the editor shows (default: the editor's `data-page-id`) */
  pageId?: ID
  /** a refusal stays silent (the caller says it) */
  quiet?: boolean
}

interface NewPage {
  id: ID
  title: string
  /** its text right after (untouched = still this) */
  plain: string
  kids: ID[]
  threads: Set<ID>
}

interface Batch {
  pageId: ID
  pages: NewPage[]
  /** ids of the blocks / list items that left (back here = undone) */
  blockIds: string[]
  /** the nodes that left, as they were (a put-back when the doc changed since; kept blocks stayed around the table) */
  blocks: JSONContent[]
  /** list items: the list's type and attrs */
  list: { type: string; attrs: Record<string, unknown> } | null
  after: PMNode
  applied: boolean
  /** pages left as they were at the last undo (changed meanwhile) */
  kept: Set<ID>
  trashed: Set<ID>
  force: boolean
}

function refuse(why: 'none' | 'busy' | 'failed', quiet?: boolean): null {
  if (!quiet) useUI.getState().toast({ message: t(why === 'none' ? 'editor.split.items.err.none' : `editor.split.err.${why}`), kind: why === 'failed' ? 'error' : 'info' })
  return null
}

/** Every item becomes a sub-page; one table with their links takes their place. Returns the new page ids, null when refused. */
export function pagesPerItem(editor: Editor, opts: PagesPerItemOptions = {}): ID[] | null {
  if (editor.isDestroyed || !editor.isEditable) return null
  const pageId = opts.pageId ?? editor.view.dom.getAttribute('data-page-id')
  const ws = useWorkspace.getState()
  const page = pageId ? ws.pages[pageId] : undefined
  if (!pageId || !page || page.trashed || !editor.schema.nodes.table || !editor.schema.nodes.mention) return null
  const { state } = editor
  const sel = opts.range ?? state.selection
  const plan = planItems(state.doc, sel.from, sel.to)
  if (!plan) return refuse('none', opts.quiet)
  const { at } = plan
  if (holdsBusyMeeting(at.nodes)) return refuse('busy', opts.quiet)

  const privatePages = isPrivatePage(pageId)
  const ids = plan.items.map(() => newId())
  let table: PMNode
  try {
    table = editor.schema.nodeFromJSON(tableJSON(plan, ids, !privatePages))
    table.check()
  } catch {
    return refuse('failed', opts.quiet)
  }
  // the replacement here, checked before anything is written
  let swap: { from: number; to: number; nodes: Fragment; tableAt: number } | null = null
  if (!plan.layout) {
    const r = replacement(at, table)
    if (r) swap = { from: r.from, to: r.to, nodes: r.nodes, tableAt: r.linkOffset }
  } else {
    const nodes = plan.layout.map((n) => n ?? table)
    const frag = Fragment.from(nodes)
    const index = plan.layout.indexOf(null)
    const tableAt = nodes.slice(0, index).reduce((n, x) => n + x.nodeSize, 0)
    if (at.parent.canReplace(at.start, at.end, frag)) swap = { from: at.from, to: at.to, nodes: frag, tableAt }
  }
  if (!swap) return refuse('none', opts.quiet)

  void snapshotNow(pageId, 'auto')
  const pages: NewPage[] = []
  try {
    plan.items.forEach((it, i) => {
      const input = { id: ids[i], parentId: pageId, title: it.title }
      if (privatePages) createPrivatePage(input)
      else useWorkspace.getState().createPage(input)
      const content: JSONContent = { type: 'doc', content: it.body.length ? it.body : [{ type: 'paragraph' }] }
      useWorkspace.getState().setContent(ids[i], content, SPLIT_ORIGIN)
      const kids = childrenIn(it.nodes, pageId)
      for (const kid of kids) useWorkspace.getState().movePage(kid, ids[i])
      const threads = commentIdsIn({ type: 'doc', content: it.nodes.map((n) => n.toJSON() as JSONContent) })
      moveThreads(pageId, ids[i], threads)
      pages.push({ id: ids[i], title: it.title, plain: useWorkspace.getState().pages[ids[i]]?.plain ?? '', kids, threads })
    })
  } catch {
    // nothing half-done stays behind
    for (const p of pages) undoPage(pageId, p, true)
    return refuse('failed', opts.quiet)
  }

  // ONE transaction: the table where the items were, the caret in its first cell; its own undo step
  closeUndoStep(editor)
  const tr = closeHistory(editor.state.tr).replaceWith(swap.from, swap.to, swap.nodes)
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(swap.from + swap.tableAt + 1, tr.doc.content.size)))).scrollIntoView()
  editor.view.dispatch(tr)
  editor.view.dispatch(closeHistory(editor.state.tr))
  closeUndoStep(editor)
  editor.view.focus()

  // what left the page (blocks the layout keeps stay where they are)
  const leaving = plan.layout ? at.nodes.filter((n) => !plan.layout!.includes(n)) : at.nodes
  const batch: Batch = {
    pageId,
    pages,
    blockIds: leaving.map((n) => n.attrs.id).filter((x): x is string => typeof x === 'string' && !!x),
    blocks: leaving.map((n) => n.toJSON() as JSONContent),
    list: at.list ? { type: at.list.node.type.name, attrs: { ...at.list.node.attrs } } : null,
    after: editor.state.doc,
    applied: true,
    kept: new Set(),
    trashed: new Set(),
    force: false,
  }
  track(editor, batch)
  useUI.getState().toast({
    message: t(`editor.split.items.made.${ids.length === 1 ? 'one' : 'other'}`, { count: ids.length }),
    kind: 'success',
    action: { label: t('common.undo'), run: () => undoBatch(editor, batch) },
  })
  return ids
}

/* ------------------------------------------------------------------ */
/* Undo / redo                                                         */
/* ------------------------------------------------------------------ */

const batches = new WeakMap<Editor, Batch[]>()

const mentionsHere = (doc: PMNode, b: Batch) => {
  const ids = new Set(b.pages.map((p) => p.id))
  return hasNode(doc, (n) => n.type.name === 'mention' && ids.has(n.attrs.id))
}
const blocksHere = (doc: PMNode, b: Batch) => {
  if (!b.blockIds.length) return !mentionsHere(doc, b)
  const ids = new Set(b.blockIds)
  return hasNode(doc, (n) => typeof n.attrs.id === 'string' && ids.has(n.attrs.id))
}

/** Keep the store in step with undo / redo in this editor (ProseMirror history, or Y undo in a team page). */
function track(editor: Editor, batch: Batch) {
  let list = batches.get(editor)
  if (!list) {
    const own: Batch[] = []
    list = own
    batches.set(editor, own)
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      const undoRedo = !!transaction.getMeta('history$') || !!(transaction.getMeta('y-sync$') as { isUndoRedoOperation?: boolean } | undefined)?.isUndoRedoOperation
      if (!transaction.docChanged || !undoRedo || editor.isDestroyed) return
      const doc = editor.state.doc
      for (const b of own) {
        const links = mentionsHere(doc, b)
        const blocks = blocksHere(doc, b)
        if (b.applied && !links && blocks) storeBack(b)
        else if (!b.applied && links && !blocks) storeAgain(b)
      }
    }
    editor.on('transaction', onTransaction)
    editor.on('destroy', () => editor.off('transaction', onTransaction))
  }
  list.push(batch)
}

/** Untouched = the page still is what was made of the item (same title and text, no sub-pages of its own). */
function untouched(p: NewPage): boolean {
  const { pages } = useWorkspace.getState()
  const now = pages[p.id]
  if (!now) return true
  if (now.title !== p.title || (now.plain ?? '') !== p.plain) return false
  return !Object.values(pages).some((c) => c.parentId === p.id && !c.trashed && !p.kids.includes(c.id))
}

/** One page back: what went along moves back, the page goes to the trash (false: changed meanwhile, kept). */
function undoPage(pageId: ID, p: NewPage, force: boolean): boolean {
  const ws = useWorkspace.getState()
  const now = ws.pages[p.id]
  if (!now) return true
  if (!force && !untouched(p)) return false
  for (const kid of p.kids) if (useWorkspace.getState().pages[kid]?.parentId === p.id) useWorkspace.getState().movePage(kid, pageId)
  moveThreads(p.id, pageId, p.threads)
  if (!now.trashed) useWorkspace.getState().trashPage(p.id)
  return true
}

/** The items are back here: the pages go to the trash (a page changed meanwhile stays, a toast says so). */
function storeBack(b: Batch) {
  b.applied = false
  b.kept.clear()
  for (const p of b.pages) {
    const wasTrashed = !!useWorkspace.getState().pages[p.id]?.trashed
    if (undoPage(b.pageId, p, b.force)) {
      if (!wasTrashed) b.trashed.add(p.id)
    } else b.kept.add(p.id)
  }
  if (b.kept.size) useUI.getState().toast({ message: t(`editor.split.items.kept.${b.kept.size === 1 ? 'one' : 'other'}`, { count: b.kept.size }) })
}

/** Redo: the table is back — so are the pages and what went along. */
function storeAgain(b: Batch) {
  b.applied = true
  for (const p of b.pages) {
    if (b.kept.has(p.id)) continue
    const ws = useWorkspace.getState()
    if (ws.pages[p.id]?.trashed && b.trashed.has(p.id)) ws.restorePage(p.id)
    b.trashed.delete(p.id)
    for (const kid of p.kids) if (useWorkspace.getState().pages[kid]?.parentId === b.pageId) useWorkspace.getState().movePage(kid, p.id)
    moveThreads(b.pageId, p.id, p.threads)
  }
  b.kept.clear()
}

/** The toast's Undo: the editor's own undo while nothing changed since, else the table becomes the items again. */
function undoBatch(editor: Editor, b: Batch) {
  if (!b.applied) return
  if (!editor.isDestroyed && editor.state.doc.eq(b.after)) {
    b.force = true
    editor.commands.undo()
    b.force = false
    if (!b.applied) return
  }
  putBack(editor, b)
  b.force = true
  storeBack(b)
  b.force = false
}

function putBack(editor: Editor, b: Batch) {
  if (!editor.isDestroyed) {
    const tr = restore(closeHistory(editor.state.tr), b)
    if (tr) editor.view.dispatch(tr.scrollIntoView())
    return
  }
  const ws = useWorkspace.getState()
  const content = ws.pages[b.pageId]?.content
  if (!content) return
  try {
    const tr = restore(new Transform(docSchema().nodeFromJSON(content)), b)
    if (tr) ws.setContent(b.pageId, tr.doc.toJSON() as JSONContent, SPLIT_ORIGIN)
  } catch {
    /* the page no longer fits the schema: leave it */
  }
}

/** The table with the batch's pages replaced by the original blocks (list items join the lists around it again). */
function restore<T extends Transform>(tr: T, b: Batch): T | null {
  const doc = tr.doc
  const ids = new Set(b.pages.map((p) => p.id))
  let pos = -1
  doc.descendants((n, p) => {
    if (pos >= 0) return false
    if (n.type.name === 'table' && hasNode(n, (m) => m.type.name === 'mention' && ids.has(m.attrs.id))) {
      pos = p
      return false
    }
    return true
  })
  const table = pos >= 0 ? doc.nodeAt(pos) : null
  if (!table) return null
  const schema = doc.type.schema
  try {
    const nodes = b.blocks.map((j) => schema.nodeFromJSON(j))
    const $pos = doc.resolve(pos)
    const listType = b.list ? schema.nodes[b.list.type] : undefined
    if (b.list && listType) {
      const index = $pos.index()
      const prev = index > 0 ? $pos.parent.child(index - 1) : null
      const next = index + 1 < $pos.parent.childCount ? $pos.parent.child(index + 1) : null
      const before = prev?.type === listType ? prev : null
      const after = next?.type === listType ? next : null
      const items: PMNode[] = []
      before?.forEach((c) => items.push(c))
      items.push(...nodes)
      after?.forEach((c) => items.push(c))
      tr.replaceWith(pos - (before?.nodeSize ?? 0), pos + table.nodeSize + (after?.nodeSize ?? 0), listType.create(before?.attrs ?? b.list.attrs, items))
    } else tr.replaceWith(pos, pos + table.nodeSize, nodes)
    if (tr instanceof Transaction) tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos + 1, tr.doc.content.size))))
    return tr
  } catch {
    return null
  }
}
