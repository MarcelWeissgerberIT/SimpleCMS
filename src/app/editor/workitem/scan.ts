/**
 * Task block — the tasks of a page's content, for the workspace index, reminders and the agenda. Pure.
 *
 * `itemsOfContent(doc)` walks BLOCKS only: it never descends into a line's inline content, an atom or a table (the
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
import { itemCounters } from './lookup'

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

let cache = new WeakMap<object, readonly ScannedItem[]>()

/** Measuring only (the e2e perf budget's cold build): forget every cached walk — the next calls walk the contents again. */
export function forgetScans(): void {
  cache = new WeakMap()
}

/** The tasks of a page's content in document order (cached per content object). */
export function itemsOfContent(doc: JSONContent | null | undefined): readonly ScannedItem[] {
  if (!doc || typeof doc !== 'object') return NONE
  const hit = cache.get(doc)
  if (hit) return hit
  itemCounters.walks++
  const out = scan(doc)
  const result = out.length ? Object.freeze(out) : NONE
  cache.set(doc, result)
  return result
}

type Synced = 'original' | 'copy' | null

/**
 * The walk: only blocks that can HOLD blocks are visited (a textblock, an atom or any other leaf is looked at once,
 * as its parent's child, and never pushed) — most of a page is lines, so most nodes cost one type check. The stack
 * is three parallel arrays (no object per node): the cold build walks every page of a large workspace.
 */
function scan(doc: JSONContent): ScannedItem[] {
  const out: ScannedItem[] = []
  const nodes: JSONContent[] = [doc]
  const syncs: Synced[] = [null]
  const parents: string[] = ['']
  while (nodes.length) {
    const n = nodes.pop()!
    const synced = syncs.pop()!
    const parent = parents.pop()!
    const type = n.type ?? ''
    if (type === WORK_ITEM) {
      const attrs = itemAttrs(n)
      out.push({ attrs, blockId: attrs.id, title: itemTitleText(n), progress: todoProgress(n), synced, inList: LIST_ITEMS.has(parent), order: out.length })
    }
    const kids = n.content
    if (!Array.isArray(kids)) continue
    const inner: Synced = synced === 'copy' ? 'copy' : type === 'syncedBlock' ? (typeof n.attrs?.sourcePageId === 'string' && n.attrs.sourcePageId ? 'copy' : 'original') : synced
    // a task's title line is read above; its notes are walked like any blocks (a misplaced task inside shows too)
    for (let i = kids.length - 1, from = type === WORK_ITEM ? 1 : 0; i >= from; i--) {
      const c = kids[i] as JSONContent | null
      if (!c || typeof c !== 'object') continue
      const t = c.type ?? ''
      // the type first: a line's inline content is never read (not even to see that it is there); a table is never
      // entered — a task never sits in one (place.ts moves it out on every load and local change), and its cells are
      // a third of a large workspace's blocks
      if (t !== WORK_ITEM && (TEXTBLOCKS.has(t) || INLINE.has(t) || t === 'table' || !Array.isArray(c.content))) continue
      nodes.push(c)
      syncs.push(inner)
      parents.push(type)
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
