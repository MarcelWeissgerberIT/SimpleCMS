/**
 * Workspace agent — changing existing content (edit_page). Block-addressed, so Claude changes exactly
 * what it means and nothing else:
 *  - read_page with refs: every top-level block (and every list / to-do item) gets a short ref, ⟦b3⟧,
 *    that Claude cites. Refs are per tab and stay the same for a block across reads (by block id; a
 *    block without one by its position). They never reach content: every Markdown Claude writes is
 *    cleaned of them (stripRefs).
 *  - edit_page stages one change per edit (kind 'edit'): its target blocks as they were (normalized
 *    key + JSON), the new Markdown. Nothing changes before the person applies it.
 *  - Applying (applyPageEdits): a version first (snapshotNow 'ai'), then every applied edit of a page in
 *    ONE transaction — through the open editor, so one ⌘Z takes it back — content origin 'ai'. An edit
 *    whose blocks changed since it was staged is skipped and reported, never overwritten.
 */
import type { JSONContent } from '@tiptap/core'
import { Fragment, type Node as PMNode, type Schema } from '@tiptap/pm/model'
import { Transform } from '@tiptap/pm/transform'
import { closeHistory } from '@tiptap/pm/history'
import { useWorkspace } from '../../../store/store'
import { useCloud } from '../../../cloud'
import type { ID } from '../../../store/types'
import { docSchema, docToMarkdown, liveEditorOf, markdownToDoc } from '../../../editor'
import { t } from '../../../i18n'
import { blockKey } from '../../history/diff'
import { contentKey, snapshotNow } from '../../history/snapshots'
import { diffDocs, type DocItem } from '../../history/docDiff'
import type { StagedChange } from './types'

export type EditOp = 'replace' | 'delete' | 'insert_after' | 'replace_all'
export const EDIT_OPS: EditOp[] = ['replace', 'delete', 'insert_after', 'replace_all']

/** A block an edit is about, as it was when the edit was staged. */
export interface EditTarget {
  /** block id (null: a block without one, found by its position) */
  id: string | null
  /** child indexes from the doc down to the block */
  path: number[]
  /** normalized JSON (block ids ignored): a block whose key differs has changed */
  key: string
  block: JSONContent
}

export interface BlockEdit {
  op: EditOp
  /** replace / delete: the blocks in order · insert_after: the block it follows · replace_all: none */
  targets: EditTarget[]
  /** what Claude cited: "b3", "b3–b5" */
  refs: string
  /** replace_all: the whole page then (its key, and the doc for the review once applied) */
  pageKey?: string
  pageBefore?: JSONContent
}

const ITEMS = new Set(['listItem', 'taskItem'])
const LISTS: Record<string, string> = { bulletList: 'listItem', orderedList: 'listItem', taskList: 'taskItem' }
const EMPTY: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

/* ------------------------------------------------------------------ */
/* Refs                                                                */
/* ------------------------------------------------------------------ */

interface RefEntry {
  id: string | null
  path: number[]
  /** the block's key when Claude read it */
  key: string
}

interface PageRefs {
  byBlock: Map<string, string>
  byRef: Map<string, RefEntry>
  next: number
}

const registry = new Map<ID, PageRefs>()

function refsOf(pageId: ID): PageRefs {
  let r = registry.get(pageId)
  if (!r) registry.set(pageId, (r = { byBlock: new Map(), byRef: new Map(), next: 0 }))
  return r
}

const idOf = (node: PMNode): string | null => (typeof node.attrs.id === 'string' && node.attrs.id ? node.attrs.id : null)
const keyOfNode = (node: PMNode) => blockKey(node.toJSON() as JSONContent)

/** The ref of a block (a new one the first time it is shown); remembers what the block reads now. */
function refFor(pageId: ID, node: PMNode, path: number[]): string {
  const r = refsOf(pageId)
  const id = idOf(node)
  const block = id ? `#${id}` : `@${path.join('.')}`
  let ref = r.byBlock.get(block)
  if (!ref) {
    ref = `b${++r.next}`
    r.byBlock.set(block, ref)
  }
  r.byRef.set(ref, { id, path, key: keyOfNode(node) })
  return ref
}

/** "⟦b3⟧", "[b3]", "B3" → "b3" ('' when there is none). */
export function normRef(raw: unknown): string {
  const m = /b\d+/i.exec(typeof raw === 'string' ? raw : '')
  return m ? m[0].toLowerCase() : ''
}

/** Markdown without ref labels (Claude may copy them from read_page; they never reach content). */
export function stripRefs(markdown: string): string {
  return markdown.replace(/^[ \t]*⟦b\d+⟧[ \t]*(?:\n|$)/gm, '').replace(/⟦b\d+⟧[ \t]?/g, '')
}

/* ------------------------------------------------------------------ */
/* The page                                                            */
/* ------------------------------------------------------------------ */

/** The page's doc: the open editor's (with unsaved typing), else the stored content. */
export function pageDoc(pageId: ID): PMNode | null {
  const editor = liveEditorOf(pageId)
  if (editor && !editor.isDestroyed) return editor.state.doc
  const p = useWorkspace.getState().pages[pageId]
  if (!p) return null
  try {
    return docSchema().nodeFromJSON(p.content ?? EMPTY)
  } catch {
    return null
  }
}

/** The key context marks use for a top-level block (features of editor/context: id, else the index). */
const topKey = (node: PMNode, index: number) => idOf(node) ?? `#${index}`

interface Located {
  node: PMNode
  pos: number
  parent: PMNode
  index: number
  /** index of the top-level block it is in */
  top: number
}

function atPath(doc: PMNode, path: number[]): Located | null {
  let parent = doc
  let start = 0
  for (let d = 0; d < path.length; d++) {
    const i = path[d]
    if (i < 0 || i >= parent.childCount) return null
    let pos = start
    for (let k = 0; k < i; k++) pos += parent.child(k).nodeSize
    const node = parent.child(i)
    if (d === path.length - 1) return { node, pos, parent, index: i, top: path[0] }
    parent = node
    start = pos + 1
  }
  return null
}

/** Where a cited block is now: by id anywhere (a top-level block or a list item), else by position. */
function locate(doc: PMNode, e: Pick<RefEntry, 'id' | 'path'>): Located | null {
  if (!e.id) return atPath(doc, e.path)
  let hit: Located | null = null
  doc.descendants((node, pos, parent, index) => {
    if (hit) return false
    if (node.attrs.id === e.id && parent && (parent === doc || ITEMS.has(node.type.name))) {
      hit = { node, pos, parent, index, top: doc.resolve(pos).index(0) }
      return false
    }
    return !node.isTextblock && !node.isAtom
  })
  return hit
}

/* ------------------------------------------------------------------ */
/* read_page with refs                                                 */
/* ------------------------------------------------------------------ */

/** List / to-do items carry their ref at the start of their first paragraph. */
function withItemRefs(pageId: ID, node: PMNode, json: JSONContent, path: number[]): JSONContent {
  if (node.isTextblock || !json.content?.length || json.content.length !== node.childCount) return json
  const content = json.content.map((c, i) => withItemRefs(pageId, node.child(i), c, [...path, i]))
  if (ITEMS.has(node.type.name) && content[0]?.type === 'paragraph') {
    const ref = refFor(pageId, node, path)
    content[0] = { ...content[0], content: [{ type: 'text', text: `⟦${ref}⟧ ` }, ...(content[0].content ?? [])] }
  }
  return { ...json, content }
}

/**
 * The page as Markdown, block by block, each under its ref ("⟦b3⟧" on a line of its own; items inline).
 * `readable`: the top-level blocks the person lets Claude read (null = all). Empty lines are left out.
 */
export function readWithRefs(pageId: ID, readable: ReadonlySet<string> | null): { markdown: string; blocks: number } {
  const doc = pageDoc(pageId)
  if (!doc) return { markdown: '', blocks: 0 }
  const parts: string[] = []
  doc.forEach((node, _pos, i) => {
    if (readable && !readable.has(topKey(node, i))) return
    if (node.type.name === 'paragraph' && !node.content.size) return
    const ref = refFor(pageId, node, [i])
    const json = withItemRefs(pageId, node, node.toJSON() as JSONContent, [i])
    const md = docToMarkdown({ type: 'doc', content: [json] }).trim()
    parts.push(`⟦${ref}⟧\n${md || `(${node.type.name})`}`)
  })
  return { markdown: parts.join('\n\n'), blocks: parts.length }
}

/* ------------------------------------------------------------------ */
/* Staging                                                             */
/* ------------------------------------------------------------------ */

export interface RawEdit {
  op?: unknown
  from?: unknown
  to?: unknown
  ref?: unknown
  markdown?: unknown
}

export interface EditPlan {
  edit: BlockEdit
  markdown?: string
  /** a pending change of the same blocks that this one revises */
  revises?: StagedChange
}

type Span = { from: number; to: number; all?: boolean }

const overlaps = (a: Span, b: Span) => {
  if (a.all || b.all) return true
  if (a.from === a.to && b.from === b.to) return a.from === b.from
  if (a.from === a.to) return b.from < a.from && a.from < b.to
  if (b.from === b.to) return a.from < b.from && b.from < a.to
  return a.from < b.to && b.from < a.to
}

/** Where a staged edit sits in a doc now (null: its blocks are gone or changed). */
function spanOf(doc: PMNode, e: BlockEdit): Span | null {
  if (e.op === 'replace_all') return { from: 0, to: doc.content.size, all: true }
  const locs = e.targets.map((x) => locate(doc, x))
  if (!locs.length || locs.some((l) => !l)) return null
  const first = locs[0]!
  const last = locs[locs.length - 1]!
  if (e.op === 'insert_after') return { from: first.pos + first.node.nodeSize, to: first.pos + first.node.nodeSize }
  return { from: first.pos, to: last.pos + last.node.nodeSize }
}

const sameTargets = (a: BlockEdit, b: BlockEdit) =>
  a.op === b.op && a.targets.length === b.targets.length && a.targets.every((x, i) => (x.id ?? x.path.join('.')) === (b.targets[i].id ?? b.targets[i].path.join('.')))

/**
 * Validate Claude's edits against the page as it is now: refs it was given for this page, blocks that
 * still read as they did, readable for Claude (context marks), not overlapping each other or a change
 * still waiting for review (an edit of exactly the same blocks revises that change instead).
 * Returns the plans, or the message Claude gets back.
 */
export function planEdits(pageId: ID, raw: RawEdit[], readable: ReadonlySet<string> | null, pending: StagedChange[], maxChars: number): { plans: EditPlan[] } | { error: string } {
  const doc = pageDoc(pageId)
  if (!doc) return { error: 'The page could not be read.' }
  const refs = refsOf(pageId)
  const q = (s: string) => JSON.stringify(s)
  const plans: Array<EditPlan & { span: Span }> = []

  const resolve = (where: string, rawRef: unknown): { error: string } | { loc: Located; entry: RefEntry; ref: string } => {
    const ref = normRef(rawRef)
    if (!ref) return { error: `${where}: missing ref (like "b3" from read_page with refs: true).` }
    const entry = refs.byRef.get(ref)
    if (!entry) return { error: `${where}: ${ref} is not a ref of this page. Call read_page with refs: true for this page and use the refs it shows.` }
    const loc = locate(doc, entry)
    if (!loc) return { error: `${where}: the block ${ref} no longer exists (the page changed). Call read_page with refs: true again.` }
    if (keyOfNode(loc.node) !== entry.key) return { error: `${where}: the block ${ref} changed since you read it. Call read_page with refs: true again before you change it.` }
    if (readable && !readable.has(topKey(doc.child(loc.top), loc.top)))
      return { error: `${where}: ${ref} is not readable — the person limited what you may read on this page (context marks), so you may not change it: refused.` }
    return { loc, entry, ref }
  }

  const markdownOf = (where: string, v: unknown): { error: string } | { md: string } => {
    if (typeof v !== 'string' || !v.trim()) return { error: `${where}: "markdown" is required (the new content). To remove blocks, use op "delete".` }
    if (v.length > maxChars) return { error: `${where}: "markdown" is too long (${v.length} characters, at most ${maxChars}).` }
    const md = stripRefs(v).trim()
    if (!md) return { error: `${where}: "markdown" holds only refs. Write the new content itself.` }
    return { md }
  }

  for (let k = 0; k < raw.length; k++) {
    const r = raw[k] ?? {}
    const where = `edits[${k}]`
    const op = typeof r.op === 'string' ? (r.op.trim().toLowerCase() as EditOp) : ('' as EditOp)
    if (!EDIT_OPS.includes(op)) return { error: `${where}: unknown op ${q(String(r.op ?? ''))}. Use one of: ${EDIT_OPS.join(', ')}.` }
    const target = (loc: Located, entry: RefEntry): EditTarget => ({ id: entry.id, path: entry.id ? pathOfLoc(doc, loc) : entry.path, key: keyOfNode(loc.node), block: loc.node.toJSON() as JSONContent })
    let plan: EditPlan & { span: Span }

    if (op === 'replace_all') {
      if (readable) return { error: `${where}: replace_all would overwrite blocks you may not read (the person limited what you may read on this page): refused. Change the readable blocks with replace instead.` }
      const m = markdownOf(where, r.markdown)
      if ('error' in m) return m
      const before = doc.toJSON() as JSONContent
      plan = { edit: { op, targets: [], refs: 'all', pageKey: contentKey(before), pageBefore: before }, markdown: m.md, span: { from: 0, to: doc.content.size, all: true } }
    } else if (op === 'insert_after') {
      const at = resolve(where, r.ref ?? r.from)
      if ('error' in at) return at
      const m = markdownOf(where, r.markdown)
      if ('error' in m) return m
      const p = at.loc.pos + at.loc.node.nodeSize
      plan = { edit: { op, targets: [target(at.loc, at.entry)], refs: at.ref }, markdown: m.md, span: { from: p, to: p } }
    } else {
      const a = resolve(where, r.from ?? r.ref)
      if ('error' in a) return a
      let b = a
      if (r.to !== undefined && r.to !== null && r.to !== '' && normRef(r.to) !== a.ref) {
        const got = resolve(where, r.to)
        if ('error' in got) return got
        b = got
      }
      if (b.loc.parent !== a.loc.parent) return { error: `${where}: ${a.ref} and ${b.ref} are not in the same place (a range runs over blocks side by side: top-level blocks, or items of one list).` }
      if (b.loc.index < a.loc.index) return { error: `${where}: ${b.ref} comes before ${a.ref}. Give the range in reading order (from the first block to the last).` }
      const parent = a.loc.parent
      const targets: EditTarget[] = []
      let pos = a.loc.pos
      for (let i = a.loc.index; i <= b.loc.index; i++) {
        const node = parent.child(i)
        const loc: Located = { node, pos, parent, index: i, top: parent === doc ? i : a.loc.top }
        if (readable && !readable.has(topKey(doc.child(loc.top), loc.top))) return { error: `${where}: the range ${a.ref}–${b.ref} includes blocks you may not read (context marks): refused.` }
        const entryPath = pathOfLoc(doc, loc)
        targets.push({ id: idOf(node), path: entryPath, key: keyOfNode(node), block: node.toJSON() as JSONContent })
        pos += node.nodeSize
      }
      let md: string | undefined
      if (op === 'replace') {
        const m = markdownOf(where, r.markdown)
        if ('error' in m) return m
        md = m.md
      }
      plan = { edit: { op, targets, refs: a.ref === b.ref ? a.ref : `${a.ref}–${b.ref}` }, ...(md !== undefined ? { markdown: md } : {}), span: { from: a.loc.pos, to: b.loc.pos + b.loc.node.nodeSize } }
    }

    for (const other of plans) if (overlaps(plan.span, other.span)) return { error: `${where} (${plan.edit.refs}) overlaps another edit in this call (${other.edit.refs}). Put changes to the same blocks into one edit.` }
    for (const c of pending) {
      if (!c.edit) continue
      if (sameTargets(c.edit, plan.edit)) {
        plan.revises = c
        continue
      }
      const span = spanOf(doc, c.edit)
      if (span && overlaps(plan.span, span))
        return { error: `${where} (${plan.edit.refs}) overlaps staged change #${c.n} (${c.edit.refs}), which is still waiting for review. To revise it, edit exactly the same blocks with the same op; otherwise pick other blocks.` }
    }
    plans.push(plan)
  }
  return { plans: plans.map(({ span: _span, ...p }) => (void _span, p)) }
}

/** Child indexes from the doc down to a located block. */
function pathOfLoc(doc: PMNode, loc: Located): number[] {
  const $pos = doc.resolve(loc.pos)
  const path: number[] = []
  for (let d = 0; d <= $pos.depth; d++) path.push($pos.index(d))
  return path
}

/* ------------------------------------------------------------------ */
/* Applying                                                            */
/* ------------------------------------------------------------------ */

const changedNote = () => t('features.agent.edit.changed')
const goneNote = () => t('features.agent.edit.gone')

/** New blocks for a place: list / to-do items inside a list, blocks elsewhere; the first keeps `keepId`. */
function fitted(schema: Schema, markdown: string, parent: PMNode, keepId: string | null): PMNode[] {
  let blocks = (markdownToDoc(markdown).content ?? []).filter(Boolean)
  const itemType = LISTS[parent.type.name]
  if (itemType) {
    const lists = blocks.every((b) => !!b.type && b.type in LISTS)
    const items: JSONContent[] = lists
      ? blocks.flatMap((l) => l.content ?? [])
      : [{ type: itemType, content: blocks[0]?.type === 'paragraph' ? blocks : [{ type: 'paragraph' }, ...blocks] }]
    blocks = items.map((it) => ({ type: itemType, ...(itemType === 'taskItem' ? { attrs: { checked: it.type === 'taskItem' ? !!it.attrs?.checked : false } } : {}), content: it.content?.length ? it.content : [{ type: 'paragraph' }] }))
  }
  if (keepId && blocks[0]) blocks[0] = { ...blocks[0], attrs: { ...(blocks[0].attrs ?? {}), id: keepId } }
  const nodes = blocks.map((b) => schema.nodeFromJSON(b))
  nodes.forEach((n) => n.check())
  if (!nodes.length) throw new Error('empty')
  return nodes
}

interface Spot {
  id: string
  n: number
  from: number
  to: number
  nodes: PMNode[]
}

/** Where a staged edit applies in `doc` now and what goes there — or why it is skipped. */
function spotOf(doc: PMNode, c: StagedChange): Spot | { error: string } {
  const e = c.edit
  if (!e) return { error: goneNote() }
  const schema = doc.type.schema
  try {
    if (e.op === 'replace_all') {
      if (contentKey(doc.toJSON() as JSONContent) !== e.pageKey) return { error: changedNote() }
      return { id: c.id, n: c.n, from: 0, to: doc.content.size, nodes: fitted(schema, c.markdown ?? '', doc, null) }
    }
    const locs = e.targets.map((x) => locate(doc, x))
    if (!locs.length || locs.some((l) => !l)) return { error: goneNote() }
    const first = locs[0]!
    if (e.op === 'insert_after') {
      const p = first.pos + first.node.nodeSize
      return { id: c.id, n: c.n, from: p, to: p, nodes: fitted(schema, c.markdown ?? '', first.parent, null) }
    }
    // the range: still side by side, in order, and reading as when it was staged
    for (let i = 0; i < locs.length; i++) {
      const l = locs[i]!
      if (l.parent !== first.parent || l.index !== first.index + i || keyOfNode(l.node) !== e.targets[i].key) return { error: changedNote() }
    }
    const last = locs[locs.length - 1]!
    let from = first.pos
    let to = last.pos + last.node.nodeSize
    if (e.op === 'delete') {
      // every item of a list: the list goes
      if (ITEMS.has(first.node.type.name) && first.index === 0 && last.index === first.parent.childCount - 1) {
        const $p = doc.resolve(first.pos)
        from = $p.before()
        to = $p.after()
      }
      return { id: c.id, n: c.n, from, to, nodes: [] }
    }
    return { id: c.id, n: c.n, from, to, nodes: fitted(schema, c.markdown ?? '', first.parent, idOf(first.node)) }
  } catch {
    return { error: t('features.agent.edit.invalid') }
  }
}

/** Apply the spots (from the end backwards: earlier positions stay valid; at one place the replacement first). */
function applySpots(tr: Transform, spots: Spot[]) {
  const order = [...spots].sort((a, b) => b.from - a.from || (b.to - b.from) - (a.to - a.from))
  for (const s of order) {
    if (s.from === s.to) tr.insert(s.from, Fragment.fromArray(s.nodes))
    else if (!s.nodes.length) tr.delete(s.from, s.to)
    else tr.replaceWith(s.from, s.to, Fragment.fromArray(s.nodes))
  }
  // a page is never left without a block
  if (!tr.doc.childCount) tr.insert(0, tr.doc.type.schema.nodes.paragraph.create())
}

/** Spots for changes in `doc`; edits overlapping one placed before (a restored discarded one …) are skipped. */
function spotsFor(doc: PMNode, changes: StagedChange[]): { spots: Spot[]; failed: Array<{ id: string; error: string }> } {
  const spots: Spot[] = []
  const failed: Array<{ id: string; error: string }> = []
  for (const c of [...changes].sort((a, b) => a.n - b.n)) {
    const s = spotOf(doc, c)
    if ('error' in s) failed.push({ id: c.id, error: s.error })
    else if (spots.some((o) => overlaps(o, s) || (o.from === 0 && o.to === doc.content.size) || (s.from === 0 && s.to === doc.content.size))) failed.push({ id: c.id, error: changedNote() })
    else spots.push(s)
  }
  return { spots, failed }
}

export interface PageEditResult {
  applied: string[]
  failed: Array<{ id: string; error: string }>
  /** back to the page before (false: edited since — left alone) */
  undo: () => boolean
}

/** Apply edits of one page: a version first, then ONE transaction (one ⌘Z in the open editor), origin 'ai'. */
export async function applyPageEdits(pageId: ID, changes: StagedChange[]): Promise<PageEditResult> {
  const none: PageEditResult = { applied: [], failed: [], undo: () => true }
  if (!useWorkspace.getState().pages[pageId]) return { ...none, failed: changes.map((c) => ({ id: c.id, error: goneNote() })) }
  await snapshotNow(pageId, 'ai')
  const editor = liveEditorOf(pageId)
  const doc = pageDoc(pageId)
  if (!doc) return { ...none, failed: changes.map((c) => ({ id: c.id, error: goneNote() })) }
  const { spots, failed } = spotsFor(doc, changes)
  if (!spots.length) return { ...none, failed }
  const prev = doc.toJSON() as JSONContent
  const invalid = () => ({ ...none, failed: [...failed, ...spots.map((s) => ({ id: s.id, error: t('features.agent.edit.invalid') }))] })
  let next: JSONContent
  if (editor && !editor.isDestroyed && editor.state.doc === doc) {
    const tr = closeHistory(editor.state.tr)
    try {
      applySpots(tr, spots)
    } catch {
      return invalid()
    }
    editor.view.dispatch(tr)
    next = editor.getJSON()
    // local: written right away, as Claude's; team: the editor's document carries it (Yjs)
    if (useCloud.getState().active.kind !== 'cloud') useWorkspace.getState().setContent(pageId, next, 'ai')
  } else {
    const tr = new Transform(doc)
    try {
      applySpots(tr, spots)
    } catch {
      return invalid()
    }
    next = tr.doc.toJSON() as JSONContent
    useWorkspace.getState().setContent(pageId, next, 'ai')
  }
  const nextKey = contentKey(next)
  return {
    applied: spots.map((s) => s.id),
    failed,
    undo: () => {
      const now = useWorkspace.getState().pages[pageId]
      if (!now || contentKey(now.content) !== nextKey) return false
      useWorkspace.getState().setContent(pageId, prev, 'ai')
      return true
    },
  }
}

/* ------------------------------------------------------------------ */
/* The review                                                          */
/* ------------------------------------------------------------------ */

export type EditPreview = { state: 'ready'; items: DocItem[] } | { state: 'changed' | 'gone'; items: DocItem[] }

/** What the edit's blocks become, without the rest of the page (an applied / discarded edit, a skipped one). */
export function stagedItems(c: StagedChange): DocItem[] {
  const e = c.edit
  if (!e) return []
  const after = c.markdown ? (markdownToDoc(c.markdown).content ?? []) : []
  if (e.op === 'replace_all') return diffDocs(e.pageBefore ?? null, { type: 'doc', content: after })
  if (e.op === 'insert_after') return diffDocs({ type: 'doc', content: e.targets.map((x) => x.block) }, { type: 'doc', content: [...e.targets.map((x) => x.block), ...after] })
  return diffDocs({ type: 'doc', content: e.targets.map((x) => x.block) }, { type: 'doc', content: e.op === 'delete' ? [] : after })
}

/** The page with this edit applied, diffed against the page now (pending edits). */
export function previewEdit(c: StagedChange): EditPreview {
  const doc = pageDoc(c.pageId)
  if (!doc) return { state: 'gone', items: stagedItems(c) }
  const s = spotOf(doc, c)
  if ('error' in s) return { state: s.error === goneNote() ? 'gone' : 'changed', items: stagedItems(c) }
  const tr = new Transform(doc)
  try {
    applySpots(tr, [s])
  } catch {
    return { state: 'changed', items: stagedItems(c) }
  }
  return { state: 'ready', items: diffDocs(doc.toJSON() as JSONContent, tr.doc.toJSON() as JSONContent) }
}
