/**
 * "Turn into page" — the blocks a selection covers become a new sub-page of this page, and ONE
 * `pageLink` block to it takes their place (one editor transaction, a version snapshot first). No AI,
 * instant. Entry points: block menu "Turn into → Page", the bubble toolbar's Turn into, the AI menu
 * ("Structure"), Mod+Alt+9 (SplitKeys).
 *
 *  - What lives in the blocks goes along: inline databases of this page and sub-pages linked by a
 *    `pageLink` block are re-parented to the new page, the comment threads of moved `comment` marks
 *    move to it, block ids stay (synced blocks keep their group, `?b=` links follow the block), files
 *    stay where they are (`onefile:` ids are workspace-wide).
 *  - Team workspaces: the new page is private exactly when this page is (createPrivatePage), and
 *    everything that moves along stays in that scope — nothing crosses Private ⇄ shared.
 *  - Templates: inside a template the new page is part of that template, like any sub-page there.
 *  - Undo: the toast's Undo puts the blocks back and trashes the new page (what went along moves back).
 *    ⌘Z / ⌘⇧Z here (ProseMirror history or Y undo) do the same while the new page is untouched (same
 *    title and text, no sub-pages of its own); a page changed meanwhile stays as it is (a toast says
 *    so). Redo moves everything to it again.
 */
import { Extension, type Editor, type JSONContent } from '@tiptap/core'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, TextSelection, Transaction } from '@tiptap/pm/state'
import { Transform } from '@tiptap/pm/transform'
import { closeHistory } from '@tiptap/pm/history'
import { yUndoPluginKey } from '@tiptap/y-tiptap'
import { useWorkspace } from '../../store/store'
import type { ID, PageComment } from '../../store/types'
import { useUI } from '../../store/ui'
import { newId } from '../../lib/ids'
import { t } from '../../i18n'
import { createPrivatePage, isPrivatePage } from '../../cloud'
import { snapshotNow } from '../../features'
import { commentIdsIn } from '../schema/comment'
import { docSchema } from '../convert'
import { holdsBusyMeeting, readSplit, splitRange, splitTitle, type SplitAt, type SplitRange } from './range'

/** setContent origin of the new page's content (and of a put-back into a page whose editor is gone). */
export const SPLIT_ORIGIN = 'split'

/** Why nothing happened (an i18n key under editor.split.err). */
export type SplitRefusal = 'none' | 'busy' | 'failed'

export interface TurnIntoPageOptions {
  /** what moves (expanded to whole blocks); default: the selection, or the caret's block */
  range?: SplitRange | null
  /** the page the editor shows (default: the editor's `data-page-id`) */
  pageId?: ID
  /** a refusal stays silent (the caller says it) */
  quiet?: boolean
}

interface Split {
  pageId: ID
  newId: ID
  title: string
  /** the new page's text right after the split ("untouched" = still this) */
  plain: string
  /** ids of the moved blocks / list items (their presence here = the split was undone) */
  blockIds: string[]
  /** the moved nodes as they were (for a put-back when the doc changed since) */
  blocks: JSONContent[]
  /** list items: the list's type and attrs (a put-back joins the lists around the link again) */
  list: { type: string; attrs: Record<string, unknown> } | null
  /** inline databases and sub-pages that moved along, comment threads that moved along */
  kids: ID[]
  threads: Set<ID>
  /** the editor's doc right after the split (the toast's Undo uses the editor's own undo while it holds) */
  after: PMNode
  /** applied = the link is here and the blocks are there */
  applied: boolean
  /** the last undo left the page as it was (it had changed) */
  kept: boolean
  trashedByUs: boolean
  /** the next undo reverts even a changed page (the toast's Undo) */
  force: boolean
}

/* ------------------------------------------------------------------ */
/* Turn into page                                                      */
/* ------------------------------------------------------------------ */

/** Move the blocks into a new sub-page and link it in their place. Resolves the new page id, null when refused. */
export function turnIntoPage(editor: Editor, opts: TurnIntoPageOptions = {}): ID | null {
  if (editor.isDestroyed || !editor.isEditable) return null
  const pageId = opts.pageId ?? editor.view.dom.getAttribute('data-page-id')
  const ws = useWorkspace.getState()
  const page = pageId ? ws.pages[pageId] : undefined
  const linkType = editor.schema.nodes.pageLink
  if (!pageId || !page || page.trashed || !linkType) return null
  const { state } = editor
  const sel = opts.range ?? state.selection
  const range = splitRange(state.doc, sel.from, sel.to)
  const at = range ? readSplit(state.doc, range) : null
  if (!at) return refuse('none', opts.quiet)
  if (holdsBusyMeeting(at.nodes)) return refuse('busy', opts.quiet)

  // the new page: title, content, what goes along
  const id = newId()
  const { title, drop } = at.list ? { title: splitTitle(at.nodes).title, drop: 0 } : splitTitle(at.nodes)
  const moved: PMNode[] = at.list ? [listCopy(at.list.node, at.nodes)] : at.nodes.slice(drop)
  const content: JSONContent = { type: 'doc', content: moved.length ? moved.map((n) => n.toJSON() as JSONContent) : [{ type: 'paragraph' }] }
  const original = at.nodes.map((n) => n.toJSON() as JSONContent)
  const kids = childrenIn(at.nodes, pageId)
  const threads = commentIdsIn({ type: 'doc', content: original })

  // the replacement here, checked before anything is written
  const link = linkType.create({ pageId: id })
  const swap = replacement(at, link)
  if (!swap) return refuse('none', opts.quiet)

  void snapshotNow(pageId, 'auto')
  try {
    const input = { id, parentId: pageId, title }
    if (isPrivatePage(pageId)) createPrivatePage(input)
    else ws.createPage(input)
  } catch {
    return refuse('failed', opts.quiet)
  }
  useWorkspace.getState().setContent(id, content, SPLIT_ORIGIN)
  for (const kid of kids) useWorkspace.getState().movePage(kid, id)
  moveThreads(pageId, id, threads)

  // ONE transaction: the link where the blocks were, selected; its own undo step
  closeUndoStep(editor)
  const tr = closeHistory(editor.state.tr).replaceWith(swap.from, swap.to, swap.nodes)
  tr.setSelection(NodeSelection.create(tr.doc, swap.from + swap.linkOffset)).scrollIntoView()
  editor.view.dispatch(tr)
  editor.view.dispatch(closeHistory(editor.state.tr))
  closeUndoStep(editor)
  editor.view.focus()

  const split: Split = {
    pageId,
    newId: id,
    title,
    plain: useWorkspace.getState().pages[id]?.plain ?? '',
    blockIds: at.nodes.map((n) => n.attrs.id).filter((x): x is string => typeof x === 'string' && !!x),
    blocks: original,
    list: at.list ? { type: at.list.node.type.name, attrs: { ...at.list.node.attrs } } : null,
    kids,
    threads,
    after: editor.state.doc,
    applied: true,
    kept: false,
    trashedByUs: false,
    force: false,
  }
  track(editor, split)
  useUI.getState().toast({
    message: t('editor.split.done', { title: title || t('common.untitled') }),
    kind: 'success',
    action: { label: t('common.undo'), run: () => undoSplit(editor, split) },
  })
  return id
}

function refuse(why: SplitRefusal, quiet?: boolean): null {
  if (!quiet) useUI.getState().toast({ message: t(`editor.split.err.${why}`), kind: why === 'failed' ? 'error' : 'info' })
  return null
}

/** A copy of a list with some of its items (a fresh block id; a numbered list counts from 1). */
function listCopy(list: PMNode, items: readonly PMNode[]): PMNode {
  const attrs: Record<string, unknown> = { ...list.attrs, id: null }
  if ('start' in attrs) attrs.start = 1
  return list.type.create(attrs, items)
}

/** What takes the range's place: the link — inside a list, between the two halves of the list. */
function replacement(at: SplitAt, link: PMNode): { from: number; to: number; nodes: Fragment; linkOffset: number } | null {
  if (!at.list) {
    const nodes = Fragment.from(link)
    return at.parent.canReplace(at.start, at.end, nodes) ? { from: at.from, to: at.to, nodes, linkOffset: 0 } : null
  }
  const list = at.list.node
  const items = (a: number, b: number) => {
    const out: PMNode[] = []
    for (let i = a; i < b; i++) out.push(list.child(i))
    return out
  }
  const parts: PMNode[] = []
  // the list's first part keeps the list (and its id); the rest after the link is a new list
  if (at.start > 0) parts.push(list.type.create(list.attrs, items(0, at.start)))
  parts.push(link)
  if (at.end < list.childCount) parts.push(list.type.create({ ...list.attrs, id: null }, items(at.end, list.childCount)))
  return { from: at.list.pos, to: at.list.pos + list.nodeSize, nodes: Fragment.from(parts), linkOffset: at.start > 0 ? parts[0].nodeSize : 0 }
}

/** Inline databases of this page and its sub-pages linked by `pageLink` blocks among the nodes. */
function childrenIn(nodes: readonly PMNode[], pageId: ID): ID[] {
  const { pages, databases } = useWorkspace.getState()
  const out = new Set<ID>()
  const visit = (n: PMNode) => {
    const name = n.type.name
    const id = name === 'pageLink' ? n.attrs.pageId : name === 'databaseBlock' ? n.attrs.databaseId : null
    const p = typeof id === 'string' ? pages[id] : undefined
    if (p && p.parentId === pageId && !p.databaseId && (name === 'pageLink' || databases[p.id]?.inline)) out.add(p.id)
    return true
  }
  for (const n of nodes) {
    visit(n)
    n.descendants(visit)
  }
  return [...out]
}

/** Comment threads anchored in the moved text go with it (replies and state included). */
function moveThreads(from: ID, to: ID, ids: Set<ID>) {
  if (!ids.size) return
  const ws = useWorkspace.getState()
  const a = ws.pages[from]
  const b = ws.pages[to]
  if (!a || !b) return
  const going: PageComment[] = (a.comments ?? []).filter((c) => ids.has(c.id))
  if (!going.length) return
  ws.updatePage(to, { comments: [...(b.comments ?? []).filter((c) => !ids.has(c.id)), ...going] })
  ws.updatePage(from, { comments: (a.comments ?? []).filter((c) => !ids.has(c.id)) })
}

/** Team cloud: Y undo merges changes within 500 ms — the split is a step of its own. */
function closeUndoStep(editor: Editor) {
  const undo = yUndoPluginKey.getState(editor.state) as { undoManager?: { stopCapturing: () => void } } | undefined
  undo?.undoManager?.stopCapturing()
}

/* ------------------------------------------------------------------ */
/* Undo / redo                                                         */
/* ------------------------------------------------------------------ */

const splits = new WeakMap<Editor, Split[]>()

function hasNode(doc: PMNode, test: (n: PMNode) => boolean): boolean {
  let found = false
  doc.descendants((n) => {
    if (found) return false
    if (test(n)) found = true
    return !found && !n.isTextblock
  })
  return found
}

const linkHere = (doc: PMNode, s: Split) => hasNode(doc, (n) => n.type.name === 'pageLink' && n.attrs.pageId === s.newId)
const blocksHere = (doc: PMNode, s: Split) => {
  if (!s.blockIds.length) return !linkHere(doc, s)
  const ids = new Set(s.blockIds)
  return hasNode(doc, (n) => typeof n.attrs.id === 'string' && ids.has(n.attrs.id))
}

/** Keep the store in step with undo / redo of the split in this editor. */
function track(editor: Editor, split: Split) {
  let list = splits.get(editor)
  if (!list) {
    const own: Split[] = []
    list = own
    splits.set(editor, own)
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      // undo / redo: ProseMirror history, or Y undo in a team-cloud page
      const undoRedo = !!transaction.getMeta('history$') || !!(transaction.getMeta('y-sync$') as { isUndoRedoOperation?: boolean } | undefined)?.isUndoRedoOperation
      if (!transaction.docChanged || !undoRedo || editor.isDestroyed) return
      const doc = editor.state.doc
      for (const s of own) {
        const link = linkHere(doc, s)
        const blocks = blocksHere(doc, s)
        if (s.applied && !link && blocks) storeBack(s)
        else if (!s.applied && link && !blocks) storeAgain(s)
      }
    }
    editor.on('transaction', onTransaction)
    editor.on('destroy', () => editor.off('transaction', onTransaction))
  }
  list.push(split)
}

/** Untouched = the new page still is what the split made of it. */
function untouched(s: Split): boolean {
  const { pages } = useWorkspace.getState()
  const p = pages[s.newId]
  if (!p) return true
  if (p.title !== s.title || (p.plain ?? '') !== s.plain) return false
  return !Object.values(pages).some((c) => c.parentId === s.newId && !c.trashed && !s.kids.includes(c.id))
}

/** The blocks are back here: what went along goes back, the new page goes to the trash. */
function storeBack(s: Split) {
  s.applied = false
  const ws = useWorkspace.getState()
  const p = ws.pages[s.newId]
  if (!p) return
  if (!s.force && !untouched(s)) {
    s.kept = true
    useUI.getState().toast({ message: t('editor.split.kept', { title: p.title || t('common.untitled') }) })
    return
  }
  for (const kid of s.kids) if (useWorkspace.getState().pages[kid]?.parentId === s.newId) useWorkspace.getState().movePage(kid, s.pageId)
  moveThreads(s.newId, s.pageId, s.threads)
  if (!p.trashed) {
    useWorkspace.getState().trashPage(s.newId)
    s.trashedByUs = true
  }
}

/** Redo: the link is back — so are the page and what went along. */
function storeAgain(s: Split) {
  s.applied = true
  if (s.kept) {
    s.kept = false
    return
  }
  const ws = useWorkspace.getState()
  const p = ws.pages[s.newId]
  if (!p) return
  if (p.trashed && s.trashedByUs) {
    ws.restorePage(s.newId)
    s.trashedByUs = false
  }
  for (const kid of s.kids) if (useWorkspace.getState().pages[kid]?.parentId === s.pageId) useWorkspace.getState().movePage(kid, s.newId)
  moveThreads(s.pageId, s.newId, s.threads)
}

/** The toast's Undo: the blocks back here (the editor's own undo while nothing changed since), the page in the trash. */
function undoSplit(editor: Editor, s: Split) {
  if (!s.applied) return
  if (!editor.isDestroyed && editor.state.doc.eq(s.after)) {
    s.force = true
    editor.commands.undo()
    s.force = false
    if (!s.applied) return
  }
  // edited since (or the page was left): the link becomes the blocks again
  putBack(editor, s)
  s.force = true
  storeBack(s)
  s.force = false
}

function putBack(editor: Editor, s: Split) {
  if (!editor.isDestroyed) {
    const tr = restore(closeHistory(editor.state.tr), s)
    if (tr) editor.view.dispatch(tr.scrollIntoView())
    return
  }
  const ws = useWorkspace.getState()
  const content = ws.pages[s.pageId]?.content
  if (!content) return
  try {
    const tr = restore(new Transform(docSchema().nodeFromJSON(content)), s)
    if (tr) ws.setContent(s.pageId, tr.doc.toJSON() as JSONContent, SPLIT_ORIGIN)
  } catch {
    /* the page's content no longer fits the schema: leave it */
  }
}

/** The link to the new page replaced by the original blocks (list items join the lists around it again). */
function restore<T extends Transform>(tr: T, s: Split): T | null {
  const doc = tr.doc
  let pos = -1
  doc.descendants((n, p) => {
    if (pos >= 0) return false
    if (n.type.name === 'pageLink' && n.attrs.pageId === s.newId) pos = p
    return pos < 0
  })
  const link = pos >= 0 ? doc.nodeAt(pos) : null
  if (!link) return null
  const schema = doc.type.schema
  try {
    const nodes = s.blocks.map((j) => schema.nodeFromJSON(j))
    const $pos = doc.resolve(pos)
    const listType = s.list ? schema.nodes[s.list.type] : undefined
    if (s.list && listType) {
      const index = $pos.index()
      const prev = index > 0 ? $pos.parent.child(index - 1) : null
      const next = index + 1 < $pos.parent.childCount ? $pos.parent.child(index + 1) : null
      const before = prev?.type === listType ? prev : null
      const after = next?.type === listType ? next : null
      const items: PMNode[] = []
      before?.forEach((c) => items.push(c))
      items.push(...nodes)
      after?.forEach((c) => items.push(c))
      const from = pos - (before?.nodeSize ?? 0)
      tr.replaceWith(from, pos + link.nodeSize + (after?.nodeSize ?? 0), listType.create(before?.attrs ?? s.list.attrs, items))
    } else tr.replaceWith(pos, pos + link.nodeSize, nodes)
    if (tr instanceof Transaction) tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos + 1, tr.doc.content.size))))
    return tr
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Keyboard                                                            */
/* ------------------------------------------------------------------ */

/** Mod+Alt+9 (Notion's "turn into page"): the selected blocks — or the caret's block — become a page. */
export const SPLIT_SHORTCUT = 'Mod+Alt+9'

export const SplitKeys = Extension.create({
  name: 'oneSplitKeys',
  addKeyboardShortcuts() {
    return { 'Mod-Alt-9': () => turnIntoPage(this.editor) !== null }
  },
})
