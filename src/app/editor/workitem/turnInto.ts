/**
 * Task block — making tasks in the editor (slash `/task`, `[!] `, Turn into ▸ Task) and turning a task into other
 * blocks (Turn into ▸ Text, To-do …). Every path that makes a NEW task asks the creation gate first
 * (`itemLookup().canCreate()`, invariant 9) — the caller does (slash item disabled, Turn into hidden, the rule null).
 *
 *  - Where a new task may stand: never inside a task's notes (it goes right after the OUTERMOST task, the line is
 *    taken out of the notes), never in a table cell (refused: "A task can't go in a table cell.").
 *  - A list item / to-do whose first line becomes a task leaves its list: the list is split around it (a to-do's
 *    tick, first date and people become fields — turn.ts `itemFromTodo`).
 *  - A task turned into something else: title + fields written out as mentions, notes after it; links have no form
 *    there — a toast says they are gone (Undo).
 */
import type { Editor, JSONContent } from '@tiptap/core'
import { Fragment, type Node as PMNode, type ResolvedPos } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state'
import { Mapping } from '@tiptap/pm/transform'
import { currentLang, t } from '../../i18n'
import { useWorkspace } from '../../store/store'
import { toast } from '../../store/ui'
import { mentionDateLabel } from '../lib/dates'
import { itemAttrs, WORK_ITEM } from './attrs'
import { itemLookup } from './lookup'
import { blocksFromItem, itemFromBlock, itemFromTodo, splitListAround, type ItemTurnTarget } from './turn'

const LIST_ITEMS = new Set(['listItem', 'taskItem'])
const LISTS = new Set(['bulletList', 'orderedList', 'taskList'])
const CELLS = new Set(['tableCell', 'tableHeader'])

/** The depth of the OUTERMOST task around a position (0: none). */
export function outerItemDepth($pos: ResolvedPos): number {
  for (let d = 1; d <= $pos.depth; d++) if ($pos.node(d).type.name === WORK_ITEM) return d
  return 0
}

/** Inside a table cell? */
export function inTableCell($pos: ResolvedPos): boolean {
  for (let d = $pos.depth; d > 0; d--) if (CELLS.has($pos.node(d).type.name)) return true
  return false
}

/**
 * Where a NEW task may go for a line at `$pos`: the line's own place — or, inside a task's notes, right after the
 * outermost task (`after`). null in a table cell.
 */
export function itemInsertPos($pos: ResolvedPos): { inPlace: boolean; after: number } | null {
  if (inTableCell($pos)) return null
  const outer = outerItemDepth($pos)
  return outer ? { inPlace: false, after: $pos.after(outer) } : { inPlace: true, after: -1 }
}

/**
 * Turn the line at `pos` (a position inside a textblock) into a NEW task, in `tr`. A list item's first line takes its
 * item along (the list split around it); inside a task's notes the line leaves the notes and the task goes after
 * the outermost task. Returns the caret position (inside the new title), 'table' (refused) or null (nothing to do).
 */
export function lineToItem(tr: Transaction, pos: number, now: number): number | 'table' | null {
  const $pos = tr.doc.resolve(pos)
  if (!$pos.parent.isTextblock) return null
  const place = itemInsertPos($pos)
  if (!place) return 'table'
  const schema = tr.doc.type.schema
  const d = $pos.depth
  const offset = $pos.parentOffset
  // already a task's title
  if (d >= 2 && $pos.node(d - 1).type.name === WORK_ITEM && $pos.index(d - 1) === 0) return null
  // the block that becomes the task: a list item's first line → the item (its list split around it), else the line
  const itemParent = d >= 2 && LIST_ITEMS.has($pos.node(d - 1).type.name) && $pos.index(d - 1) === 0 && d >= 3 && LISTS.has($pos.node(d - 2).type.name)
  // the new task first, then the tasks its notes would have held — moved out whole, unchanged (turn.ts)
  let made: JSONContent[]
  let from: number
  let to: number
  let replacement: JSONContent[]
  if (itemParent) {
    const item = $pos.node(d - 1)
    const list = $pos.node(d - 2)
    const json = item.toJSON() as JSONContent
    made = item.type.name === 'taskItem' ? itemFromTodo(json, now) : itemFromBlock(json)
    from = $pos.before(d - 2)
    to = $pos.after(d - 2)
    replacement = place.inPlace ? splitListAround(list.toJSON() as JSONContent, $pos.index(d - 2), made) : splitListAround(list.toJSON() as JSONContent, $pos.index(d - 2), [])
  } else {
    made = itemFromBlock($pos.parent.toJSON() as JSONContent)
    from = $pos.before(d)
    to = $pos.after(d)
    replacement = place.inPlace ? made : []
  }
  const task = made[0]
  // the new task and its title carry block ids at once: nothing is appended after this transaction (an input rule
  // stays undoable by Backspace)
  stampIds(task)
  if (made.length > 1) toastMovedOut(made.length - 1)
  const nodes = replacement.map((j) => schema.nodeFromJSON(j))
  let at: number
  if (place.inPlace) {
    tr.replaceWith(from, to, nodes)
    // the task's start: after the blocks before it (a list's first part)
    let before = 0
    for (const n of nodes) {
      if (n.type.name === WORK_ITEM) break
      before += n.nodeSize
    }
    at = from + before
  } else {
    // out of the notes: the line goes (its container fills in as needed), the task follows the outermost task
    if (nodes.length) tr.replaceWith(from, to, nodes)
    else tr.deleteRange(from, to)
    at = tr.mapping.map(place.after)
    tr.insert(at, made.map((j) => schema.nodeFromJSON(j)))
  }
  const placed = tr.doc.nodeAt(at)
  const titleSize = placed?.firstChild?.content.size ?? 0
  return at + 2 + Math.min(offset, titleSize)
}

/* ------------------------------------------------------------------ "[!] " — Backspace right after takes it back */

interface ItemRule {
  /** the rule's transaction */
  tr: Transaction
  /** after the typed "[!] " (in the doc before the rule) */
  caret: number
  /** what was appended to it since (a trailing line, block ids) */
  after: Mapping
}

/** The "[!] " rule's meta (behaviors.ts sets `{ caret }`) and the record of it until anything else changes the doc. */
export const ITEM_RULE = new PluginKey<ItemRule | null>('workItemRule')

/**
 * Keeps the last "[!] " rule while nothing but appended transactions (a trailing line, block ids) and selection moves
 * followed it — TipTap's own input-rule undo forgets it at the first of those (an empty title's caret, a new last line).
 */
export function itemRulePlugin(): Plugin<ItemRule | null> {
  return new Plugin<ItemRule | null>({
    key: ITEM_RULE,
    state: {
      init: () => null,
      apply(tr, prev) {
        const meta = tr.getMeta(ITEM_RULE) as { caret: number } | undefined
        if (meta) return { tr, caret: meta.caret, after: new Mapping() }
        if (!prev || !tr.docChanged) return prev
        if (!tr.getMeta('appendedTransaction')) return null
        const after = new Mapping(prev.after.maps.slice())
        after.appendMapping(tr.mapping)
        return { ...prev, after }
      },
    },
  })
}

/** Backspace right after "[!] " made a task: the rule's steps inverted (over what was appended since) — the typed line is back. */
export function undoItemRule(editor: Editor): boolean {
  const rule = ITEM_RULE.getState(editor.state)
  if (!rule || editor.isDestroyed) return false
  const n = rule.tr.steps.length
  const remap = new Mapping(rule.tr.mapping.maps.concat(rule.after.maps))
  const tr = editor.state.tr
  for (let j = n - 1; j >= 0; j--) {
    const step = rule.tr.steps[j].invert(rule.tr.docs[j]).map(remap.slice(j + 1))
    if (!step || tr.maybeStep(step).failed) return false
    remap.appendMap(step.getMap(), j)
  }
  // the caret where it was after the typed "[!] " (the mirrored maps recover a position the rule deleted)
  const caret = remap.map(rule.caret)
  tr.setSelection(TextSelection.create(tr.doc, Math.max(0, Math.min(caret, tr.doc.content.size))))
  editor.view.dispatch(tr.scrollIntoView())
  return true
}

/** Tasks a line's notes held followed the new task (they never sit inside one). */
export function toastMovedOut(n: number): void {
  if (n > 0) toast({ message: n === 1 ? t('editor.workItem.moved') : t('editor.workItem.movedMany', { n }) })
}

const newBlockId = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`)

/** A block id on a new task and its title (kept where they have one). */
function stampIds(task: JSONContent): void {
  task.attrs = { ...(task.attrs ?? {}), id: (task.attrs?.id as string | undefined) || newBlockId() }
  const title = task.content?.[0]
  if (title && !title.attrs?.id) task.content![0] = { ...title, attrs: { ...(title.attrs ?? {}), id: newBlockId() } }
}

/** Turn into ▸ Task at the caret (one transaction). True when handled (made, already one, or refused). */
export function turnLineIntoItem(editor: Editor): boolean {
  if (!itemLookup().canCreate()) return false
  const { state, view } = editor
  const tr = state.tr
  const caret = lineToItem(tr, state.selection.from, Date.now())
  if (caret === 'table') {
    toast({ message: t('editor.workItem.notInTable') })
    return true
  }
  if (caret === null) return true
  tr.setSelection(TextSelection.create(tr.doc, Math.min(caret, tr.doc.content.size)))
  view.dispatch(tr.scrollIntoView())
  view.focus()
  return true
}

/** The labels a task's fields are written out with (date mentions in the UI's language, people's names). */
export function fieldLabels(): { date: (iso: string) => string; person: (id: string) => string | null } {
  const lang = currentLang()
  const people = useWorkspace.getState().people
  return { date: (iso) => mentionDateLabel(iso, lang), person: (id) => people.find((p) => p.id === id)?.name ?? null }
}

/** A task's blocks as `target` (PM nodes). */
export function itemAsBlocks(node: PMNode, target: ItemTurnTarget): PMNode[] {
  const schema = node.type.schema
  return blocksFromItem(node.toJSON() as JSONContent, fieldLabels(), target).map((j) => schema.nodeFromJSON(j))
}

/** How many links a task loses when it stops being one (its own + the tasks waiting for it). */
export function linksOf(node: PMNode): number {
  const a = itemAttrs(node)
  return a.blockedBy.length + a.related.length + (a.itemId ? itemLookup().dependents(a.itemId) : 0)
}

/** The toast after tasks stopped being tasks while they had links (Undo = the editor's undo). */
export function toastLinksGone(editor: Editor, n: number): void {
  if (!n) return
  toast({ message: n === 1 ? t('editor.workItem.linksGone.one') : t('editor.workItem.linksGone', { n }), action: { label: t('features.workItems.undo'), run: () => editor.commands.undo() } })
}

/** Turn into ▸ <target> of the task at `pos`: one transaction; the caret at the end of the old title. */
export function turnItemInto(editor: Editor, pos: number, target: ItemTurnTarget): boolean {
  const { state, view } = editor
  const node = state.doc.nodeAt(pos)
  if (!node || node.type.name !== WORK_ITEM) return false
  const lost = linksOf(node)
  const nodes = itemAsBlocks(node, target)
  const titleSize = node.firstChild?.content.size ?? 0
  const tr = state.tr.replaceWith(pos, pos + node.nodeSize, Fragment.from(nodes))
  // the caret: in the first textblock of what it became, at the old title's end
  let caret = -1
  tr.doc.nodesBetween(pos, Math.min(pos + nodes.reduce((s, n) => s + n.nodeSize, 0), tr.doc.content.size), (n, p) => {
    if (caret >= 0) return false
    if (n.isTextblock) {
      caret = p + 1 + Math.min(titleSize, n.content.size)
      return false
    }
    return true
  })
  if (caret >= 0) tr.setSelection(TextSelection.create(tr.doc, caret))
  view.dispatch(tr.scrollIntoView())
  view.focus()
  toastLinksGone(editor, lost)
  return true
}
