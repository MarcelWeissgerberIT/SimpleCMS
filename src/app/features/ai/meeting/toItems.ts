/**
 * Meeting notes "Make tasks" (local — no Claude): the to-dos of the notes that sit in a to-do list directly in the notes
 * (not inside another to-do), have text and no row link become task blocks, in ONE transaction (one Undo):
 *  - topTodos(meeting): exactly that set (the key counts it; "Send to database" keeps counting nested ones too).
 *  - makeItems(editor, blockId, writer): first every person mention whose id is no person of the workspace becomes
 *    "@label" text (the meeting runtime matched owners from Claude's summary by name — never a person nobody has), then
 *    each to-do → a task (P1 itemFromTodo: ticked → done, the first date → due + its reminder, people, nested to-dos →
 *    notes), its list split around it. Returns how many tasks it made.
 */
import type { Editor, JSONContent } from '@tiptap/core'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { editAs, endUndoStep, findMeeting, itemFromTodo, startUndoStep } from '../../../editor'
import { useWorkspace } from '../../../store/store'
import type { Writer } from '../../../store/writer'

/** A top-level to-do of the notes: its list (offset in the meeting's content) and its index there. */
export interface TopTodo {
  list: number
  index: number
}

/** Does a to-do qualify: words in its first line and no row link (a page mention) there? */
function qualifies(todo: PMNode): boolean {
  const p = todo.firstChild
  if (!p || !p.isTextblock) return false
  let words = ''
  let linked = false
  p.forEach((child) => {
    if (child.isText) words += child.text ?? ''
    else if (child.type.name === 'mention' && child.attrs.kind === 'page' && child.attrs.id) linked = true
  })
  return !linked && words.replace(/\s+/g, ' ').trim().length > 0
}

/** The to-dos "Make tasks" turns into tasks — in to-do lists directly in the notes, with text, without a row link. */
export function topTodos(meeting: PMNode): TopTodo[] {
  const out: TopTodo[] = []
  meeting.forEach((block, offset) => {
    if (block.type.name !== 'taskList') return
    block.forEach((todo, _o, index) => {
      if (todo.type.name === 'taskItem' && qualifies(todo)) out.push({ list: offset, index })
    })
  })
  return out
}

/** Person mentions of nobody in the workspace → "@label" text (with their marks), at any depth. */
function unknownPeopleToText(json: JSONContent, known: ReadonlySet<string>): JSONContent {
  if (!Array.isArray(json.content)) return json
  let changed = false
  const content: JSONContent[] = []
  for (const c of json.content) {
    if (c?.type === 'mention' && c.attrs?.kind === 'person' && !(typeof c.attrs.id === 'string' && known.has(c.attrs.id))) {
      const text = `@${String(c.attrs?.label ?? c.attrs?.id ?? '').trim()}`
      content.push({ type: 'text', text, ...(c.marks?.length ? { marks: c.marks } : {}) })
      changed = true
      continue
    }
    const next = c && typeof c === 'object' ? unknownPeopleToText(c, known) : c
    if (next !== c) changed = true
    content.push(next)
  }
  return changed ? { ...json, content } : json
}

/** A list with the picked items turned into tasks: the items around them stay lists (the later parts as new blocks). */
function splitPicked(list: JSONContent, picked: ReadonlySet<number>, make: (item: JSONContent) => JSONContent[]): JSONContent[] {
  const items = Array.isArray(list.content) ? list.content : []
  const out: JSONContent[] = []
  let run: JSONContent[] = []
  let first = true
  const flush = () => {
    if (!run.length) return
    const attrs: Record<string, unknown> = { ...(list.attrs ?? {}) }
    // a later part is a new block: the block id goes (UniqueID gives it one)
    if (!first && 'id' in attrs) attrs.id = null
    out.push({ ...list, attrs, content: run })
    run = []
    first = false
  }
  items.forEach((item, i) => {
    if (!picked.has(i)) return void run.push(item)
    flush()
    out.push(...make(item))
    first = false
  })
  flush()
  return out
}

/** "Make tasks": the top-level to-dos of the meeting `blockId` → tasks, one transaction under `writer`. */
export function makeItems(editor: Editor, blockId: string, writer: Writer): number {
  if (editor.isDestroyed) return 0
  const hit = findMeeting(editor.state.doc, blockId)
  if (!hit) return 0
  const todos = topTodos(hit.node)
  if (!todos.length) return 0
  const known = new Set(useWorkspace.getState().people.map((p) => p.id))
  const now = Date.now()
  const byList = new Map<number, Set<number>>()
  for (const t of todos) byList.set(t.list, (byList.get(t.list) ?? new Set()).add(t.index))
  const { schema } = editor
  const tr = closeHistory(editor.state.tr)
  const base = hit.pos + 1
  // last list first: the positions before it hold
  for (const [offset, picked] of [...byList].sort((a, b) => b[0] - a[0])) {
    const at = base + offset
    const list = tr.doc.nodeAt(at)
    if (!list || list.type.name !== 'taskList') continue
    const json = list.toJSON() as JSONContent
    const blocks = splitPicked(json, picked, (item) => itemFromTodo(unknownPeopleToText(item, known), now))
    tr.replaceWith(at, at + list.nodeSize, Fragment.from(blocks.map((b) => schema.nodeFromJSON(b))))
  }
  if (!tr.docChanged) return 0
  // the person's own write (store/writer.ts), one undo step (also in a shared page)
  editAs(editor, writer, () => {
    startUndoStep(editor.view)
    editor.view.dispatch(tr)
    endUndoStep(editor.view)
  })
  return todos.length
}
