/**
 * Task block — the tasks of a page's content, for the workspace index, reminders and the agenda. Pure.
 *
 * `itemsOfContent(doc)` walks BLOCKS only: it never descends into a line's inline content or into an atom (the
 * title line of each task is read once, through `itemTitleText`; a task's steps through `todoProgress`) — the
 * cold build of the index walks every page of a large workspace. Cached per content object (WeakMap): the same
 * content object gives the same array, so a keystroke rescans one page only. Iterative (deep pages).
 *
 * `compareOccurrence` is THE order between occurrences of one itemId (duplicates): the earliest page wins
 * (created first, then page id), then the first in the document — the index's winner and the inbox's dedupe.
 */
import type { JSONContent } from '@tiptap/core'
import { itemAttrs, WORK_ITEM, type WorkItemAttrs } from './attrs'
import { itemTitleText, todoProgress } from './text'

export interface ScannedItem {
  attrs: WorkItemAttrs
  /** the task's block id (`?b=` links) */
  blockId: string | null
  /** the title line (itemTitleText) */
  title: string
  /** the to-dos in its notes; null without any */
  progress: { done: number; total: number } | null
  /** inside a synced block: 'original' (the source) or 'copy' (a reference's cached copy — its task is the original's) */
  synced: 'original' | 'copy' | null
  /** the task sits in a list item / to-do (a compact task) */
  inList: boolean
  /** position among the page's tasks (document order, from 0) */
  order: number
}

const TEXTBLOCKS = new Set(['paragraph', 'heading', 'codeBlock', 'detailsSummary'])
const INLINE = new Set(['text', 'hardBreak', 'mention', 'inlineMath', 'icon'])
const LIST_ITEMS = new Set(['listItem', 'taskItem'])
const NONE: readonly ScannedItem[] = Object.freeze([])

const cache = new WeakMap<object, readonly ScannedItem[]>()

/** The tasks of a page's content in document order (cached per content object). */
export function itemsOfContent(doc: JSONContent | null | undefined): readonly ScannedItem[] {
  if (!doc || typeof doc !== 'object') return NONE
  const hit = cache.get(doc)
  if (hit) return hit
  const out = scan(doc)
  const result = out.length ? Object.freeze(out) : NONE
  cache.set(doc, result)
  return result
}

type Frame = { n: JSONContent; synced: 'original' | 'copy' | null; parent: string }

function scan(doc: JSONContent): ScannedItem[] {
  const out: ScannedItem[] = []
  const stack: Frame[] = [{ n: doc, synced: null, parent: '' }]
  while (stack.length) {
    const { n, synced, parent } = stack.pop()!
    const type = n.type ?? ''
    if (type === WORK_ITEM) {
      const attrs = itemAttrs(n)
      out.push({ attrs, blockId: attrs.id, title: itemTitleText(n), progress: todoProgress(n), synced, inList: LIST_ITEMS.has(parent), order: out.length })
    }
    if (TEXTBLOCKS.has(type) || INLINE.has(type)) continue
    const kids = n.content
    if (!Array.isArray(kids)) continue
    const inner = type === 'syncedBlock' ? (typeof n.attrs?.sourcePageId === 'string' && n.attrs.sourcePageId ? 'copy' : 'original') : synced
    // a task's title line is read above; its notes are walked like any blocks (a misplaced task inside shows too)
    const from = type === WORK_ITEM ? 1 : 0
    for (let i = kids.length - 1; i >= from; i--) {
      const c = kids[i]
      if (c && typeof c === 'object' && !INLINE.has(c.type ?? '')) stack.push({ n: c, synced: synced === 'copy' ? 'copy' : inner, parent: type })
    }
  }
  return out
}

/** Where an occurrence of a task sits — enough to order duplicates. */
export interface Occurrence {
  pageCreatedAt: number
  pageId: string
  order: number
}

/** The winner order among occurrences of one itemId: earliest page (created, then id), then document order. */
export function compareOccurrence(a: Occurrence, b: Occurrence): number {
  if (a.pageCreatedAt !== b.pageCreatedAt) return a.pageCreatedAt - b.pageCreatedAt
  if (a.pageId !== b.pageId) return a.pageId < b.pageId ? -1 : 1
  return a.order - b.order
}
