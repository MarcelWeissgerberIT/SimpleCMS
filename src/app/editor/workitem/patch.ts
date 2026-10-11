/**
 * Task block — changing a task's fields. Pure.
 *
 * `patchItemAttrs` returns ONLY the keys that change: every write is `{ ...node.attrs, ...delta }`, so the values
 * it leaves alone keep their object. y-tiptap writes a Y attribute when `yAttrs[key] !== pAttrs[key]` — by
 * reference: a fresh, equal `people` array would be written again and win over a member's concurrent change.
 * Never rebuild the whole attrs object (`storedItemAttrs(itemAttrs(node))`) for an edit.
 */
import type { JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { isSyncedRef } from '../../lib/itemIds'
import { ITEM_ID, itemAttrs, MAX_LINKS, MAX_PEOPLE, PERSON_ID, readDue, readReminder, WORK_ITEM, WORK_ITEM_STATUSES, type WorkItemStatus } from './attrs'

export interface ItemPatch {
  status?: WorkItemStatus
  /** null clears the due date AND the reminder */
  due?: string | null
  /** ignored without a due date */
  reminder?: string | null
  people?: { add?: string[]; remove?: string[] }
  blockedBy?: { add?: string[]; remove?: string[] }
  related?: { add?: string[]; remove?: string[] }
  /** a new id (the duplicate key, relink) — only ids passing ITEM_ID */
  itemId?: string
}

type ListEdit = { add?: string[]; remove?: string[] }

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** The edited list, or null when it comes out unchanged. `add` appends in order (deduped, valid, capped). */
function editList(current: string[], edit: ListEdit | undefined, valid: RegExp, max: number, own: string | null): string[] | null {
  const remove = new Set(Array.isArray(edit?.remove) ? edit!.remove : [])
  const list = current.filter((x) => !remove.has(x) && x !== own)
  for (const x of Array.isArray(edit?.add) ? edit!.add : []) {
    if (list.length >= max) break
    if (typeof x !== 'string' || !valid.test(x) || x === own || list.includes(x)) continue
    list.push(x)
  }
  return same(list, current) ? null : list
}

const isSet = (v: unknown) => v !== undefined && v !== null

/**
 * The attrs that change when `patch` is applied (null: nothing changes). Rules: status → done sets doneAt = now
 * (unless already done), any other status clears doneAt; links: valid itemIds, never the task's own, deduped, at
 * most 20 (extra adds dropped); people: valid ids, deduped, at most 12; a cleared due date clears the reminder.
 */
export function patchItemAttrs(attrs: Record<string, unknown> | null | undefined, patch: ItemPatch, now: number): Record<string, unknown> | null {
  const raw = attrs ?? {}
  const cur = itemAttrs(raw)
  const delta: Record<string, unknown> = {}
  let own = cur.itemId
  if (typeof patch.itemId === 'string' && ITEM_ID.test(patch.itemId) && patch.itemId !== cur.itemId) {
    delta.itemId = patch.itemId
    own = patch.itemId
  }
  if (patch.status && WORK_ITEM_STATUSES.includes(patch.status) && patch.status !== cur.status) {
    delta.status = patch.status
    if (patch.status === 'done') delta.doneAt = now
    else if (isSet(raw.doneAt)) delta.doneAt = null
  }
  let due = cur.due
  if (patch.due === null) {
    if (isSet(raw.due)) delta.due = null
    if (isSet(raw.reminder)) delta.reminder = null
    due = null
  } else if (patch.due !== undefined) {
    const d = readDue(patch.due)
    if (d && d !== cur.due) {
      delta.due = d
      due = d
    }
  }
  if (due && patch.due !== null) {
    // undefined = the reminder stays as it is
    let want: string | null | undefined = patch.reminder === null ? null : patch.reminder === undefined ? undefined : (readReminder(patch.reminder) ?? undefined)
    // a reminder left over without its date never comes back with a new one
    if (want === undefined && !cur.due) want = null
    if (want !== undefined && want !== ((raw.reminder as unknown) ?? null)) delta.reminder = want
  }
  if (patch.people) {
    const next = editList(cur.people, patch.people, PERSON_ID, MAX_PEOPLE, null)
    if (next) delta.people = next
  }
  for (const key of ['blockedBy', 'related'] as const) {
    if (!patch[key] && !('itemId' in delta)) continue
    const next = editList(cur[key], patch[key], ITEM_ID, MAX_LINKS, own)
    if (next) delta[key] = next
  }
  return Object.keys(delta).length ? delta : null
}

const INLINE = new Set(['text', 'hardBreak', 'mention', 'inlineMath', 'icon'])
const TEXTBLOCKS = new Set(['paragraph', 'heading', 'codeBlock', 'detailsSummary'])

/**
 * The doc with `patch` applied to the first task with `itemId` outside synced copies (document order —
 * the page's index winner). null: no such task; the same doc: nothing changes. Immutable, only changed keys.
 */
export function patchItemInDoc(doc: JSONContent, itemId: string, patch: ItemPatch, now: number): JSONContent | null {
  type Frame = { n: JSONContent; i: number }
  const stack: Frame[] = [{ n: doc, i: 0 }]
  const hit = (n: JSONContent) => n.type === WORK_ITEM && n.attrs?.itemId === itemId
  if (!hit(doc)) {
    let found = false
    while (stack.length && !found) {
      const f = stack[stack.length - 1]
      const type = f.n.type ?? ''
      const kids = Array.isArray(f.n.content) && !TEXTBLOCKS.has(type) && !isSyncedRef(f.n) ? f.n.content : null
      if (kids && f.i < kids.length) {
        const c = kids[f.i++]
        if (!c || typeof c !== 'object' || INLINE.has(c.type ?? '')) continue
        stack.push({ n: c, i: 0 })
        if (hit(c)) found = true
        continue
      }
      stack.pop()
    }
    if (!found) return null
  }
  const item = stack[stack.length - 1].n
  const delta = patchItemAttrs(item.attrs, patch, now)
  if (!delta) return doc
  let node: JSONContent = { ...item, attrs: { ...item.attrs, ...delta } }
  for (let j = stack.length - 2; j >= 0; j--) {
    const parent = stack[j].n
    const content = (parent.content as JSONContent[]).slice()
    content[stack[j].i - 1] = node
    node = { ...parent, content }
  }
  return node
}

/** The position of the first task with `itemId` outside synced copies, or null. */
export function findItemPos(doc: PMNode, itemId: string): number | null {
  let at: number | null = null
  doc.descendants((node, pos) => {
    if (at !== null) return false
    if (node.type.name === WORK_ITEM && node.attrs.itemId === itemId) {
      at = pos
      return false
    }
    if (node.type.name === 'syncedBlock' && node.attrs.sourcePageId) return false
    return !node.isTextblock && !node.isAtom
  })
  return at
}
