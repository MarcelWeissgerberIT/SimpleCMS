/**
 * Task block — turning tasks into other blocks and back. Pure (TipTap JSON).
 *
 *  - `itemBlocks(task)`: a task as plain blocks — its title paragraph + its notes, the fields dropped. The
 *    fallback of the creation gate (a copy that may not become a new task), button templates (which never hold
 *    a task) and Backspace on an empty title.
 *  - `unwrapItemsIn(blocks)`: every task in a block list (at any depth) replaced by its `itemBlocks`.
 *  - `itemFromBlock` / `itemFromTodo`: a line, a list item, a to-do as a NEW task (Turn into, `[!] `); a to-do's
 *    tick, first date mention and person mentions become its fields.
 *  - `blocksFromItem`: a task as other blocks — its fields written out as mentions (Turn into ▸ paragraph …).
 *  - `splitListAround`: a list split around the items that became tasks.
 */
import type { JSONContent } from '@tiptap/core'
import { newItemId } from '../../lib/itemIds'
import { itemAttrs, MAX_PEOPLE, PERSON_ID, readDue, readReminder, WORK_ITEM } from './attrs'

const TEXTBLOCKS = new Set(['paragraph', 'heading', 'codeBlock', 'detailsSummary'])
const INLINE = new Set(['text', 'hardBreak', 'mention', 'inlineMath', 'icon'])
const isNode = (n: unknown): n is JSONContent => !!n && typeof n === 'object' && !Array.isArray(n)

/** A task's title paragraph + notes (the same objects); fields dropped. Never empty. */
export function itemBlocks(task: JSONContent): JSONContent[] {
  const kids = Array.isArray(task.content) ? task.content.filter(isNode) : []
  return kids.length ? kids : [{ type: 'paragraph' }]
}

const SPLICE = '\u0000item'

/**
 * The block list with every task in it — at any depth, synced references included — replaced by its
 * `itemBlocks` (tasks inside a task's notes too). The same array when it holds none; iterative.
 */
export function unwrapItemsIn(list: readonly JSONContent[]): JSONContent[] {
  type Frame = { n: JSONContent; i: number; out: unknown[] | null }
  const root: JSONContent = { type: 'doc', content: list as JSONContent[] }
  const stack: Frame[] = [{ n: root, i: 0, out: null }]
  while (stack.length) {
    const f = stack[stack.length - 1]
    const type = f.n.type ?? ''
    const kids = Array.isArray(f.n.content) && !TEXTBLOCKS.has(type) && !INLINE.has(type) ? (f.n.content as unknown[]) : null
    if (kids && f.i < kids.length) {
      const c = kids[f.i++]
      if (isNode(c) && !INLINE.has(c.type ?? '')) stack.push({ n: c.type === WORK_ITEM ? { type: SPLICE, content: itemBlocks(c) } : c, i: 0, out: null })
      else if (f.out) f.out.push(c)
      continue
    }
    stack.pop()
    const parent = stack[stack.length - 1]
    if (!parent) return (f.out as JSONContent[] | null) ?? (list as JSONContent[])
    const splice = f.n.type === SPLICE
    const made: unknown[] = splice ? (f.out ?? (f.n.content as unknown[])) : [f.out ? { ...f.n, content: f.out } : f.n]
    const original = (parent.n.content as unknown[])[parent.i - 1]
    if ((splice || made[0] !== original) && !parent.out) parent.out = (parent.n.content as unknown[]).slice(0, parent.i - 1)
    if (parent.out) parent.out.push(...made)
  }
  return list as JSONContent[]
}

/* ------------------------------------------------------------------ to a task and back (Turn into, [!] ) */

type Inline = JSONContent

/** Glue left-over text back together: neighbours with the same marks joined, doubled spaces at the joints and the line's ends trimmed. */
function tidyInline(list: Inline[]): Inline[] {
  const out: Inline[] = []
  const sameMarks = (a: Inline, b: Inline) => JSON.stringify(a.marks ?? []) === JSON.stringify(b.marks ?? [])
  for (const n of list) {
    const prev = out[out.length - 1]
    if (n.type === 'text' && prev?.type === 'text' && sameMarks(prev, n)) out[out.length - 1] = { ...prev, text: `${prev.text ?? ''}${n.text ?? ''}` }
    else out.push(n)
  }
  const fixed = out.map((n) => (n.type === 'text' ? { ...n, text: (n.text ?? '').replace(/ {2,}/g, ' ') } : n))
  if (fixed[0]?.type === 'text') fixed[0] = { ...fixed[0], text: (fixed[0].text ?? '').replace(/^\s+/, '') }
  const last = fixed.length - 1
  if (fixed[last]?.type === 'text') fixed[last] = { ...fixed[last], text: (fixed[last].text ?? '').replace(/\s+$/, '') }
  return fixed.filter((n) => n.type !== 'text' || !!n.text)
}

/** A textblock's inline content as a title paragraph (a heading's marks stay; code becomes plain text). */
function titleOf(block: JSONContent | undefined): JSONContent {
  if (!block) return { type: 'paragraph' }
  const content = Array.isArray(block.content) ? block.content.filter(isNode) : []
  const keep = block.type === 'codeBlock' ? content.map((n) => ({ type: 'text', text: n.text ?? '' })).filter((n) => n.text) : content
  const attrs = block.type === 'paragraph' && block.attrs ? block.attrs : undefined
  return keep.length ? { type: 'paragraph', ...(attrs ? { attrs } : {}), content: keep } : { type: 'paragraph', ...(attrs ? { attrs } : {}) }
}

const TITLE_BLOCKS = new Set(['paragraph', 'heading', 'codeBlock', 'detailsSummary'])

/**
 * A block as a NEW task (fresh itemId, nothing set): a paragraph / heading / code line → its text is the title; a list
 * item, quote or callout → its first line is the title, the rest its notes.
 */
export function itemFromBlock(block: JSONContent, itemId: string = newItemId()): JSONContent {
  const kids = Array.isArray(block.content) ? block.content.filter(isNode) : []
  if (TITLE_BLOCKS.has(block.type ?? '')) return { type: WORK_ITEM, attrs: { itemId, status: 'todo' }, content: [titleOf(block)] }
  const [first, ...rest] = kids
  const title = first && TITLE_BLOCKS.has(first.type ?? '') ? titleOf(first) : { type: 'paragraph' }
  const notes = first && TITLE_BLOCKS.has(first.type ?? '') ? rest : kids
  return { type: WORK_ITEM, attrs: { itemId, status: 'todo' }, content: [title, ...unwrapItemsIn(notes)] }
}

/**
 * A to-do as a NEW task: ticked → done (doneAt now); the FIRST date mention of its line → due + reminder; person
 * mentions → people (≤ 12) — both taken out of the title; its nested blocks (nested to-dos …) → notes.
 */
export function itemFromTodo(todo: JSONContent, now: number, itemId: string = newItemId()): JSONContent {
  const kids = Array.isArray(todo.content) ? todo.content.filter(isNode) : []
  const [first, ...rest] = kids
  let due: string | null = null
  let reminder: string | null = null
  const people: string[] = []
  const kept: Inline[] = []
  const line = first && TITLE_BLOCKS.has(first.type ?? '') ? first : null
  for (const n of Array.isArray(line?.content) ? line!.content.filter(isNode) : []) {
    const a = (n.attrs ?? {}) as Record<string, unknown>
    if (n.type === 'mention' && a.kind === 'date' && !due && readDue(a.id)) {
      due = readDue(a.id)
      reminder = readReminder(a.reminder)
      continue
    }
    if (n.type === 'mention' && a.kind === 'person' && typeof a.id === 'string' && PERSON_ID.test(a.id)) {
      if (!people.includes(a.id) && people.length < MAX_PEOPLE) people.push(a.id)
      continue
    }
    kept.push(n)
  }
  const done = todo.attrs?.checked === true
  const title: JSONContent = { type: 'paragraph', ...(line?.type === 'paragraph' && line.attrs ? { attrs: line.attrs } : {}) }
  const content = tidyInline(kept)
  if (content.length) title.content = content
  return {
    type: WORK_ITEM,
    attrs: { itemId, status: done ? 'done' : 'todo', doneAt: done ? now : null, due, reminder: due ? reminder : null, people, blockedBy: [], related: [] },
    content: [title, ...unwrapItemsIn(line ? rest : kids)],
  }
}

/** What a task is turned into (the Turn into targets but the task itself). */
export type ItemTurnTarget =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'toggle'
  | 'toggleHeading1'
  | 'toggleHeading2'
  | 'toggleHeading3'
  | 'blockquote'
  | 'callout'
  | 'codeBlock'

export interface FieldLabels {
  /** a date mention's label ("Fri 17 Oct") */
  date: (iso: string) => string
  /** a person's name (null: nobody — left out) */
  person: (id: string) => string | null
}

/**
 * A task as other blocks: its title with its fields written out at the end as mentions (the due date with its
 * reminder, its people — labels from the caller), its notes after it (a to-do: nested in it, ticked when done).
 * The links (blocked by, related) have no form here — the caller says so.
 */
export function blocksFromItem(task: JSONContent, labels: FieldLabels, target: ItemTurnTarget): JSONContent[] {
  const a = itemAttrs(task)
  const [first, ...notes] = itemBlocks(task)
  const inline: Inline[] = Array.isArray(first?.content) ? first.content.filter(isNode) : []
  const extra: Inline[] = []
  if (a.due) extra.push({ type: 'mention', attrs: { id: a.due, label: labels.date(a.due), kind: 'date', ...(a.reminder ? { reminder: a.reminder } : {}) } })
  for (const id of a.people) {
    const name = labels.person(id)
    if (name) extra.push({ type: 'mention', attrs: { id, label: name, kind: 'person' } })
  }
  const line: Inline[] = [...inline]
  for (const m of extra) {
    const last = line[line.length - 1]
    if (line.length && !(last?.type === 'text' && /\s$/.test(last.text ?? ''))) line.push({ type: 'text', text: ' ' })
    line.push(m)
  }
  const attrs = first?.type === 'paragraph' && first.attrs ? first.attrs : undefined
  const para: JSONContent = { type: 'paragraph', ...(attrs ? { attrs } : {}), ...(line.length ? { content: line } : {}) }
  const body = notes
  switch (target) {
    case 'paragraph':
      return [para, ...body]
    case 'heading1':
    case 'heading2':
    case 'heading3':
      return [{ type: 'heading', attrs: { level: Number(target.slice(-1)) }, ...(line.length ? { content: line } : {}) }, ...body]
    case 'taskList':
      return [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: a.status === 'done' }, content: [para, ...body] }] }]
    case 'bulletList':
    case 'orderedList':
      return [{ type: target, content: [{ type: 'listItem', content: [para, ...body] }] }]
    case 'blockquote':
      return [{ type: 'blockquote', content: [para, ...body] }]
    case 'callout':
      return [{ type: 'callout', attrs: { icon: '💡', color: 'gray' }, content: [para, ...body] }]
    case 'codeBlock': {
      const text = inline.map((n) => n.text ?? (n.type === 'mention' ? `@${(n.attrs as { label?: string } | undefined)?.label ?? ''}` : '')).join('')
      return [{ type: 'codeBlock', ...(text ? { content: [{ type: 'text', text }] } : {}) }, ...body]
    }
    default: {
      const level = target === 'toggle' ? 0 : Number(target.slice(-1))
      return [{ type: 'details', attrs: { open: true, heading: level }, content: [{ type: 'detailsSummary', ...(line.length ? { content: line } : {}) }, { type: 'detailsContent', content: body.length ? body : [{ type: 'paragraph' }] }] }]
    }
  }
}

/**
 * A list with its item at `index` replaced by `replacement` blocks: the items before stay a list, the replacement
 * follows, the items after become a second list (a numbered one keeps counting). No empty list is left.
 */
export function splitListAround(list: JSONContent, index: number, replacement: readonly JSONContent[], count = 1): JSONContent[] {
  const items = Array.isArray(list.content) ? list.content : []
  const before = items.slice(0, index)
  const after = items.slice(index + count)
  const out: JSONContent[] = []
  if (before.length) out.push({ ...list, content: before })
  out.push(...replacement)
  if (after.length) {
    const attrs: Record<string, unknown> = { ...(list.attrs ?? {}) }
    // the second list is a new block: the block id goes (UniqueID gives it one)
    if ('id' in attrs) attrs.id = null
    if (list.type === 'orderedList') attrs.start = (typeof attrs.start === 'number' ? attrs.start : 1) + index + count
    out.push({ ...list, attrs, content: after })
  }
  return out
}
