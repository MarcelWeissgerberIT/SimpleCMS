/**
 * Task block — ItemIds in the editor: a COPY of a task is a new task (new itemId), a MOVE keeps its id.
 *
 *  - Paste / drop (`workItemIds`, appendTransaction): only LOCAL transactions marked `uiEvent` paste / drop that
 *    insert a task — never a remote change (y-sync), external content (applyExternalContent / mergeExternal) or the
 *    synced-block service. Each inserted task (a whole reference the paste brought is the service's; a task pasted
 *    INTO a reference counts — it reaches the original) is a COPY when its itemId also sits in the
 *    final doc outside what was inserted, earlier in the same insert, or on another block of this device
 *    (`itemLookup().taken`); else a MOVE. Copies get `newItemId()` — or, when the creation gate is shut
 *    (`!itemLookup().canCreate()`), become their title + notes as plain blocks (toast). Then every inserted task's
 *    links go through the copy map; links to private tasks are dropped when this page is shared (toast). Only the
 *    keys that change are written; the appended transaction joins the paste's undo step.
 *  - Relink: a paste that re-minted remembers [new, old]; at 2 s, 5 s and 10 s, a pair whose old id is gone from
 *    this device (the source page's store copy caught up with a cut) and whose new id this doc holds exactly once is
 *    renamed back (`addToHistory: false`; through `editAs` as One's own repair, system:repair — its store write at
 *    once) — a cut + paste across pages stays the same task.
 *  - Duplicate (Mod+D, grip, multi-select): `copyBlocks` — a JSON round trip through `remintItems` (one map per
 *    command), or the tasks' plain blocks when the gate is shut.
 * The extension carries the editor's bridge in its storage (`bridgeOf`, context/redo.ts).
 */
import { Extension, type Editor, type JSONContent } from '@tiptap/core'
import { Fragment, type Node as PMNode, type Schema } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { ySyncPluginKey } from '@tiptap/y-tiptap'
import { holdsItemNode, ITEM_ID, newItemId, remintItems } from '../../lib/itemIds'
import { t } from '../../i18n'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { SYSTEM } from '../../store/writer'
import type { Bridge } from '../lib/bridge'
import { editAs } from '../lib/editAs'
import { WORK_ITEM } from './attrs'
import { itemCounters, itemLookup } from './lookup'
import { itemBlocks, unwrapItemsIn } from './turn'

const KEY = new PluginKey('workItemIds')
/** When a pasted copy is checked for "it was a move after all" (ms after the paste). */
const RELINK_AT = [2000, 5000, 10_000]

const isItem = (n: PMNode | null | undefined): n is PMNode => !!n && n.type.name === WORK_ITEM
const isRef = (n: PMNode) => n.type.name === 'syncedBlock' && !!n.attrs.sourcePageId
const isRemote = (tr: Transaction) => !!(tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin
const byHand = (tr: Transaction) => {
  const ui = tr.getMeta('uiEvent')
  return ui === 'paste' || ui === 'drop'
}

/** Does a transaction insert a task (anywhere in a step's slice)? */
function insertsItem(tr: Transaction): boolean {
  return tr.steps.some((step) => {
    const slice = (step as unknown as { slice?: { content: Fragment } }).slice
    let found = false
    slice?.content.descendants((n) => {
      if (isItem(n)) found = true
      return !found && !n.isTextblock
    })
    return found
  })
}

/** The ranges `trs` inserted, mapped to the final doc. */
function insertedRanges(trs: readonly Transaction[], picked: ReadonlySet<Transaction>): Array<[number, number]> {
  const out: Array<[number, number]> = []
  trs.forEach((tr, i) => {
    if (!picked.has(tr)) return
    tr.steps.forEach((step, j) => {
      step.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
        if (newEnd <= newStart) return
        let from = newStart
        let to = newEnd
        const rest = [tr.mapping.slice(j + 1), ...trs.slice(i + 1).map((x) => x.mapping)]
        for (const m of rest) {
          from = m.map(from, 1)
          to = m.map(to, -1)
        }
        if (to > from) out.push([from, to])
      })
    })
  })
  return out
}

interface Hit {
  pos: number
  node: PMNode
  inserted: boolean
}

/**
 * Every task of the doc outside synced references, document order, marked when it lies in an inserted range — plus
 * the tasks a paste / drop put INTO a reference that was already there (the person's own: the service writes the
 * edited reference into its original, so they are judged like any other). A reference's own tasks are its original's
 * and stay out, and so does a whole reference the paste brought along (the service's copy).
 */
function tasksIn(doc: PMNode, ranges: Array<[number, number]>): Hit[] {
  const out: Hit[] = []
  const within = (from: number, to: number) => ranges.some(([a, b]) => from >= a && to <= b)
  doc.descendants((node, pos) => {
    if (isRef(node)) {
      if (within(pos, pos + node.nodeSize)) return false
      node.descendants((inner, at) => {
        const p = pos + 1 + at
        if (isItem(inner) && within(p, p + inner.nodeSize)) out.push({ pos: p, node: inner, inserted: true })
        return !inner.isTextblock && !inner.isAtom
      })
      return false
    }
    if (isItem(node)) out.push({ pos, node, inserted: within(pos, pos + node.nodeSize) })
    return !node.isTextblock && !node.isAtom
  })
  return out
}

const pageIdOf = (dom: Element | null | undefined) => dom?.getAttribute?.('data-page-id') ?? null

/** Links through the copy map; private ones dropped (a shared page). Null when nothing changes. */
function linksDelta(attrs: Record<string, unknown>, map: ReadonlyMap<string, string>, dropPrivate: boolean, dropped: { n: number }): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of ['blockedBy', 'related'] as const) {
    const v = attrs[key]
    if (!Array.isArray(v) || !v.length) continue
    let changed = false
    const next: unknown[] = []
    for (const x of v) {
      if (typeof x !== 'string') {
        next.push(x)
        continue
      }
      const to = map.get(x) ?? x
      if (to !== x) changed = true
      if (dropPrivate && to === x && itemLookup().isPrivate(x)) {
        dropped.n++
        changed = true
        continue
      }
      if (!next.includes(to)) next.push(to)
      else changed = true
    }
    if (changed) out[key] = next
  }
  return out
}

/** The re-mint / relink transaction for a paste or drop, or null. */
function settlePaste(trs: readonly Transaction[], state: EditorState, pageId: string | null, onRemint: (pairs: Array<[string, string]>) => void): Transaction | null {
  const picked = new Set(trs.filter((tr) => tr.docChanged && !isRemote(tr) && byHand(tr) && insertsItem(tr)))
  if (!picked.size) return null
  const ranges = insertedRanges(trs, picked)
  if (!ranges.length) return null
  const hits = tasksIn(state.doc, ranges)
  const inserted = hits.filter((h) => h.inserted)
  if (!inserted.length) return null
  const outside = new Set(hits.filter((h) => !h.inserted).map((h) => h.node.attrs.itemId as string))
  const lookup = itemLookup()
  const canCreate = lookup.canCreate()
  const seen = new Set<string>()
  const map = new Map<string, string>()
  const copies: Hit[] = []
  for (const h of inserted) {
    const id = typeof h.node.attrs.itemId === 'string' && ITEM_ID.test(h.node.attrs.itemId) ? (h.node.attrs.itemId as string) : null
    const copy = !id || outside.has(id) || seen.has(id) || lookup.taken(id, pageId)
    if (id) seen.add(id)
    if (!copy) continue
    copies.push(h)
    if (canCreate && id && !map.has(id)) map.set(id, newItemId())
  }
  const page = pageId ? useWorkspace.getState().pages[pageId] : undefined
  const dropPrivate = !page?.private
  const dropped = { n: 0 }
  const tr = state.tr
  const pairs: Array<[string, string]> = []
  let unwrapped = 0
  // from the end: an unwrapped copy changes the size of what comes after it
  for (const h of [...inserted].reverse()) {
    const isCopy = copies.includes(h)
    if (isCopy && !canCreate) {
      const cur = tr.doc.nodeAt(h.pos) ?? h.node
      const blocks = itemBlocks(cur.toJSON() as JSONContent)
      tr.replaceWith(h.pos, h.pos + cur.nodeSize, Fragment.fromJSON(state.schema, blocks))
      unwrapped++
      continue
    }
    const attrs = h.node.attrs as Record<string, unknown>
    const delta: Record<string, unknown> = linksDelta(attrs, map, dropPrivate, dropped)
    if (isCopy) {
      const old = attrs.itemId as string
      const first = map.get(old)
      // the first copy of an id takes the map's id (links among the paste follow it); a second copy its own
      const id = first && !pairs.some(([n]) => n === first) ? first : newItemId()
      delta.itemId = id
      if (ITEM_ID.test(old ?? '')) pairs.push([id, old])
    }
    if (Object.keys(delta).length) tr.setNodeMarkup(h.pos, undefined, { ...h.node.attrs, ...delta })
  }
  if (!tr.docChanged) return null
  if (pairs.length) {
    itemCounters.remints += pairs.length
    onRemint(pairs)
  }
  if (unwrapped) useUI.getState().toast({ message: t('editor.workItem.createOffText') })
  if (dropped.n) useUI.getState().toast({ message: dropped.n === 1 ? t('features.workItems.privateLinksDroppedOne') : t('features.workItems.privateLinksDropped', { n: dropped.n }) })
  return tr.setMeta(KEY, 'settled')
}

/**
 * How often a doc holds an itemId — synced references included (a re-minted id is this paste's own, wherever it
 * went; an old id a reference shows is its original's: no relink while the doc holds it).
 */
function occurrences(doc: PMNode, itemId: string): number {
  let n = 0
  doc.descendants((node) => {
    if (isItem(node) && node.attrs.itemId === itemId) n++
    return !node.isTextblock && !node.isAtom
  })
  return n
}

/** Rename `from` (an id this paste minted) → `to` in a doc: the task and every link to it, also inside a reference it was pasted into. */
function renameTr(state: EditorState, from: string, to: string): Transaction | null {
  const tr = state.tr
  state.doc.descendants((node, pos) => {
    if (isItem(node)) {
      const a = node.attrs as Record<string, unknown>
      const delta: Record<string, unknown> = {}
      if (a.itemId === from) delta.itemId = to
      for (const key of ['blockedBy', 'related'] as const) {
        const v = a[key]
        if (Array.isArray(v) && v.includes(from)) delta[key] = v.map((x) => (x === from ? to : x))
      }
      if (Object.keys(delta).length) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...delta })
    }
    return !node.isTextblock && !node.isAtom
  })
  return tr.docChanged ? tr.setMeta('addToHistory', false).setMeta(KEY, 'relink') : null
}

export interface WorkItemIdsOptions {
  bridge: Bridge | null
}

export const WorkItemIds = Extension.create<WorkItemIdsOptions, { bridge: Bridge | null }>({
  name: 'workItemIds',
  // before the task schema's own plugin (placement): a pasted task is settled before it may be moved out
  priority: 1100,
  addOptions() {
    return { bridge: null }
  },
  addStorage() {
    return { bridge: this.options.bridge }
  },
  addProseMirrorPlugins() {
    const editor = this.editor
    let pending: Array<{ pairs: Array<[string, string]>; timers: number[] }> = []
    let viewRef: EditorView | null = null
    const relink = (job: { pairs: Array<[string, string]>; timers: number[] }) => {
      const view = viewRef
      if (!view || view.isDestroyed) return
      const pageId = pageIdOf(view.dom)
      const left: Array<[string, string]> = []
      let done = false
      for (const [next, old] of job.pairs) {
        if (!itemLookup().gone(old, pageId) || occurrences(view.state.doc, next) !== 1 || occurrences(view.state.doc, old) > 0) {
          left.push([next, old])
          continue
        }
        const tr = renameTr(view.state, next, old)
        if (!tr) continue
        // One's own repair of the person's paste (store/writer.ts): its store write at once, as system:repair
        editAs(editor, SYSTEM('repair'), () => view.dispatch(tr))
        itemCounters.relinks++
        done = true
      }
      job.pairs = left
      if (done || !left.length) {
        for (const id of job.timers) window.clearTimeout(id)
        pending = pending.filter((j) => j !== job)
      }
    }
    return [
      new Plugin({
        key: KEY,
        view(view) {
          viewRef = view
          return {
            destroy() {
              for (const job of pending) for (const id of job.timers) window.clearTimeout(id)
              pending = []
              viewRef = null
            },
          }
        },
        appendTransaction(trs, _old, state) {
          if (!trs.some((tr) => tr.docChanged && byHand(tr))) return null
          return settlePaste(trs, state, pageIdOf(viewRef?.dom), (pairs) => {
            const job = { pairs, timers: [] as number[] }
            job.timers = RELINK_AT.map((ms, i) =>
              window.setTimeout(() => {
                relink(job)
                // the last check ends the watch either way
                if (i === RELINK_AT.length - 1) pending = pending.filter((j) => j !== job)
              }, ms),
            )
            pending.push(job)
          })
        },
      }),
    ]
  },
})

/**
 * Copies of blocks for Duplicate (Mod+D, the grip, a block selection): a fresh block id on each copy, the tasks in
 * them re-minted (one map: links among the copies follow) — or, when the creation gate is shut, the tasks as their
 * title + notes (toast). Synced references stay references.
 */
export function copyBlocks(schema: Schema, nodes: readonly PMNode[]): PMNode[] {
  const json = nodes.map((n) => {
    const j = n.toJSON() as JSONContent
    return n.attrs.id !== undefined ? { ...j, attrs: { ...j.attrs, id: null } } : j
  })
  if (!json.some((j) => holdsItemNode(j))) return nodes.map((n) => n.type.create(n.attrs.id !== undefined ? { ...n.attrs, id: null } : n.attrs, n.content, n.marks))
  if (!itemLookup().canCreate()) {
    useUI.getState().toast({ message: t('editor.workItem.createOffText') })
    return unwrapItemsIn(json).map((j) => schema.nodeFromJSON(j))
  }
  // one pass over all of them: a copy's link to another copied task follows it, whichever comes first
  const all = remintItems({ type: 'doc', content: json }).doc.content ?? json
  return all.map((j) => schema.nodeFromJSON(j))
}

/** The bridge an editor was made with (null for read-only / template editors). */
export function idsBridge(editor: Editor): Bridge | null {
  return (editor.storage as unknown as Record<string, { bridge?: Bridge | null } | undefined>).workItemIds?.bridge ?? null
}
