/**
 * Writes to tasks from OUTSIDE their editor — the card's Mark done / Remove link, the Blocks picker, the
 * dependents / related lists, the agenda's move. The ONLY way to change a task that is not under the caret.
 *
 *  1. Each edit goes to the page of its index winner — or to the page it names (`pageId`: that page's own occurrence,
 *     e.g. the agenda entry of a duplicate) — (unknown → 'gone', only in the trash → 'trash'). A template's
 *     tasks are written only for a caller acting inside that same template (`opts.from`), and a template caller only
 *     writes its own template's tasks ('template').
 *  2. Gates per page: not in the trash; not locked; team: not outdated / read-only; content loaded ('blind'). Per
 *     edit: a new blocker that closes a loop → 'loop'; a shared task linking a private one → 'scope'.
 *  3. Live editor first: all edits of a page in ONE transaction there (one undo step). A task that editor no longer
 *     holds (deleted / cut meanwhile — the editor is newer than the store) is refused 'gone': never a store write that
 *     would bring it back. Without an editor: team → flushPageContent; `patchItemInDoc` per edit (only the changed
 *     keys); ONE setContent(…, 'items') per page.
 *  4. by 'person' + a task became done → the unblock toast; refusals → one toast with the first reason (`toasts: false`
 *     leaves both to the caller, which gets `unblocked` back).
 *  5. undo(writer?): the inverse patches through writeItems again, only for the fields whose CURRENT value (the live
 *     editor when there is one — the store lags behind it) is still what was written; returns `kept` — the itemIds
 *     left (partly) alone because a value changed since (or the task is gone).
 * Store write path: setContent(pageId, …, opts.origin ?? 'items') (no editor open). Origin 'ai' (Claude's task changes,
 * after a version was kept): through a live editor in a LOCAL workspace the content is also written with origin 'ai'
 * right after the editor's commit (as edit_page's apply does; a team page's document carries it). Every write names
 * its writer (store/writer.ts): `opts.writer`, else the frame open around the call (a derived write keeps its cause),
 * else the person in the UI (`you~ui`); through a live editor as `editAs` (the editor's store write happens at once,
 * inside that frame); the undo as an Undo: its `writer`, else the Undo frame open around it (`you~undo:<batch>` — the
 * terminal's undoStagedBatch keeps its batch ref), else `you~undo`.
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../store/store'
import { isEffectivelyTrashed, templateRootOf } from '../../store/selectors'
import type { ID } from '../../store/types'
import { useUI } from '../../store/ui'
import { t } from '../../i18n'
import { flushPageContent, useCloud } from '../../cloud'
import { commitItems, editAs, findItemPos, itemAttrs, itemsOfContent, liveEditorOf, patchItemAttrs, patchItemInDoc, type ItemPatch, type WorkItemAttrs } from '../../editor'
import { currentWriter, withWriter, type Writer } from '../../store/writer'
import { getItemIndex } from './live'
import { wouldLoop } from './graph'
import type { ItemEntry, ItemIndex } from './itemIndex'
import { unblockedBy } from './unblock'
import { toastUnblocked } from './unblockToast'

export type WriteRefusal = 'gone' | 'trash' | 'locked' | 'readonly' | 'outdated' | 'blind' | 'scope' | 'loop' | 'template'
export interface ItemEdit {
  itemId: string
  patch: ItemPatch
  /**
   * The page whose occurrence is meant (an agenda entry of a duplicate shown on two pages): its first live occurrence
   * there. Default: the index winner's page.
   */
  pageId?: ID
}
export interface WriteResult {
  itemId: string
  ok: boolean
  refused?: WriteRefusal
  pageId?: string
}
export interface WriteOptions {
  /** the content origin of the store write: 'items' (default) · 'ai' (Claude's task changes) */
  origin?: 'items' | 'ai'
  by?: 'person' | 'system'
  /** default true: the unblock toast (by 'person') and the refusal toast */
  toasts?: boolean
  /** the page the caller acts for (the task whose card / list / picker it is) — decides 'template' */
  from?: ID
  /** who writes (store/writer.ts) — default: the frame open around the call, else the person in the UI (`you~ui`) */
  writer?: Writer
  /**
   * The writer of ONE page's write, from the edits it carries (their indexes in `edits`): an apply of staged changes
   * names the changes it writes there (store/writer.ts writerOfChanges). Default: `writer`.
   */
  writerOf?: (written: readonly number[]) => Writer
}

/** The person in the UI (a card, a list, a picker), and an Undo of theirs. */
const PERSON: Writer = { kind: 'you', via: 'ui' }
const UNDO: Writer = { kind: 'you', via: 'undo' }

interface Written {
  itemId: string
  pageId: ID
  patch: ItemPatch
  before: WorkItemAttrs
  after: WorkItemAttrs
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** The task (first occurrence outside synced copies) on a page: through its live editor, else the stored content. */
function currentAttrs(pageId: ID, itemId: string): WorkItemAttrs | null {
  const editor = liveEditorOf(pageId)
  if (editor && !editor.isDestroyed) {
    const pos = findItemPos(editor.state.doc, itemId)
    return pos === null ? null : itemAttrs(editor.state.doc.nodeAt(pos))
  }
  const page = useWorkspace.getState().pages[pageId]
  const hit = itemsOfContent(page?.content).find((i) => i.synced !== 'copy' && i.attrs.itemId === itemId)
  return hit ? hit.attrs : null
}

/** Which page an edit goes to, or why not. */
function placeOf(index: ItemIndex, itemId: string, fromTpl: ID | null, pageId?: ID): { entry: ItemEntry } | { refused: WriteRefusal } {
  if (pageId && !fromTpl) {
    // a named page: that page's own occurrence — never the winner's on another page (a duplicate is never fixed by a write)
    const e = index.byId.get(itemId)
    if (e?.pageId === pageId) return { entry: e }
    const own = index.dups.get(itemId)?.find((x) => x.pageId === pageId)
    if (own) return { entry: own }
    if (index.templated.get(itemId)?.some((x) => x.pageId === pageId)) return { refused: 'template' }
    return { refused: index.trashed.get(itemId)?.pageId === pageId ? 'trash' : 'gone' }
  }
  if (fromTpl) {
    const own = index.templated.get(itemId)?.find((e) => e.template === fromTpl)
    if (own) return { entry: own }
    return { refused: index.byId.has(itemId) || index.templated.has(itemId) ? 'template' : 'gone' }
  }
  const e = index.byId.get(itemId)
  if (e) return { entry: e }
  if (index.templated.has(itemId)) return { refused: 'template' }
  if (index.trashed.has(itemId)) return { refused: 'trash' }
  return { refused: 'gone' }
}

/** A refusal for one edit's links (loop, shared → private, live ⇄ template), or null. */
function linkRefusal(index: ItemIndex, graph: Parameters<typeof wouldLoop>[0], entry: ItemEntry, patch: ItemPatch, team: boolean, pagePrivate: boolean): WriteRefusal | null {
  const added = [...(patch.blockedBy?.add ?? []), ...(patch.related?.add ?? [])]
  for (const to of patch.blockedBy?.add ?? []) if (wouldLoop(graph, entry.itemId, to)) return 'loop'
  for (const to of added) {
    const target = index.byId.get(to)
    if (team && !pagePrivate && target?.private) return 'scope'
    if (!target && !entry.template && index.templated.has(to)) return 'template'
  }
  return null
}

export function writeItems(edits: readonly ItemEdit[], opts: WriteOptions = {}): { results: WriteResult[]; unblocked: ItemEntry[]; undo: (writer?: Writer) => { kept: string[] } } {
  const index = getItemIndex()
  const state = useWorkspace.getState()
  const pages = state.pages
  const cloud = useCloud.getState()
  const team = cloud.active.kind === 'cloud'
  const fromTpl = opts.from ? templateRootOf(pages, opts.from) : null
  const results: WriteResult[] = edits.map((e) => ({ itemId: e.itemId, ok: false }))
  const writer = opts.writer ?? currentWriter() ?? PERSON
  const byPage = new Map<ID, number[]>()
  // the graph as this batch leaves it: an edit is checked against the blockers the edits before it add (two edits that
  // each look fine alone may close a loop together)
  const batchEdges = new Map<string, string[]>()
  const graph = {
    byId: {
      get: (id: string) => {
        const e = index.byId.get(id)
        const more = batchEdges.get(id)
        return more ? { attrs: { blockedBy: [...(e?.attrs.blockedBy ?? []), ...more] } } : e
      },
    },
  } as unknown as Parameters<typeof wouldLoop>[0]

  // 1 + 2: place and gate
  edits.forEach((edit, i) => {
    const r = results[i]
    const placed = placeOf(index, edit.itemId, fromTpl, edit.pageId)
    if ('refused' in placed) {
      r.refused = placed.refused
      return
    }
    const pageId = placed.entry.pageId
    r.pageId = pageId
    const page = pages[pageId]
    if (!page) r.refused = 'gone'
    else if (isEffectivelyTrashed(pages, pageId)) r.refused = 'trash'
    else if (page.settings?.locked) r.refused = 'locked'
    else if (team && cloud.outdated) r.refused = 'outdated'
    else if (team && cloud.readOnly) r.refused = 'readonly'
    else if (page.content == null) r.refused = 'blind'
    else r.refused = linkRefusal(index, graph, placed.entry, edit.patch, team, !!page.private) ?? undefined
    if (r.refused) return
    const adds = edit.patch.blockedBy?.add ?? []
    if (adds.length) batchEdges.set(placed.entry.itemId, [...(batchEdges.get(placed.entry.itemId) ?? []), ...adds])
    const list = byPage.get(pageId)
    if (list) list.push(i)
    else byPage.set(pageId, [i])
  })

  // 3: write, page by page
  const written: Written[] = []
  const finished: string[] = []
  const now = Date.now()
  for (const [pageId, idxs] of byPage) {
    const editor = liveEditorOf(pageId)
    if (editor && !editor.isDestroyed && editor.isEditable) {
      const before = idxs.map((i) => {
        const pos = findItemPos(editor.state.doc, edits[i].itemId)
        return pos === null ? null : itemAttrs(editor.state.doc.nodeAt(pos))
      })
      // the writer's transaction, and the editor's store write at once inside its frame
      const w = opts.writerOf?.(idxs) ?? writer
      let oks: boolean[] = []
      editAs(editor, w, () => {
        oks = commitItems(
          editor,
          idxs.map((i) => ({ target: { itemId: edits[i].itemId }, patch: edits[i].patch })),
          { by: 'system' },
        )
      })
      // Claude's change in a local workspace: the content as written, with its origin (a team page's document carries it)
      if (opts.origin === 'ai' && !team && oks.some(Boolean)) {
        const json = editor.getJSON()
        withWriter(w, () => useWorkspace.getState().setContent(pageId, json, 'ai'))
      }
      idxs.forEach((i, k) => {
        const b = before[k]
        if (!oks[k] || !b) {
          results[i].refused = 'gone'
          return
        }
        const after = currentAttrs(pageId, edits[i].patch.itemId ?? edits[i].itemId) ?? b
        results[i].ok = true
        written.push({ itemId: after.itemId ?? edits[i].itemId, pageId, patch: edits[i].patch, before: b, after })
        if (b.status !== 'done' && after.status === 'done') finished.push(after.itemId ?? edits[i].itemId)
      })
      continue
    }
    if (team) flushPageContent(pageId)
    const page = useWorkspace.getState().pages[pageId]
    if (!page?.content) {
      for (const i of idxs) results[i].refused = 'blind'
      continue
    }
    let doc: JSONContent = page.content
    // the edits that change the page (one that changes nothing writes nothing)
    const wrote: number[] = []
    for (const i of idxs) {
      const edit = edits[i]
      const hit = itemsOfContent(doc).find((x) => x.synced !== 'copy' && x.attrs.itemId === edit.itemId)
      const next = hit ? patchItemInDoc(doc, edit.itemId, edit.patch, now) : null
      if (!hit || !next) {
        results[i].refused = 'gone'
        continue
      }
      results[i].ok = true
      if (next === doc) {
        written.push({ itemId: edit.itemId, pageId, patch: edit.patch, before: hit.attrs, after: hit.attrs })
        continue
      }
      doc = next
      wrote.push(i)
      const delta = patchItemAttrs(hit.attrs as unknown as Record<string, unknown>, edit.patch, now) ?? {}
      const after = itemAttrs({ ...hit.attrs, ...delta })
      written.push({ itemId: after.itemId ?? edit.itemId, pageId, patch: edit.patch, before: hit.attrs, after })
      if (hit.attrs.status !== 'done' && after.status === 'done') finished.push(after.itemId ?? edit.itemId)
    }
    if (doc !== page.content) withWriter(opts.writerOf?.(wrote) ?? writer, () => useWorkspace.getState().setContent(pageId, doc, opts.origin ?? 'items'))
  }

  // 4: what it freed, toasts
  const unblocked = finished.length ? unblockedBy(index, finished) : []
  if (opts.toasts !== false) {
    if (opts.by === 'person') toastUnblocked(unblocked)
    const refused = results.find((r) => r.refused)
    if (refused) {
      const title = refused.pageId ? pages[refused.pageId]?.title || t('common.untitled') : ''
      useUI.getState().toast({ message: t(`features.workItems.refused.${refused.refused}`, { page: title }), kind: 'error' })
    }
  }

  // 5: undo — the fields that still hold what was written go back; the rest is kept (and named)
  const undo = (undoWriter?: Writer): { kept: string[] } => {
    const inverse: ItemEdit[] = []
    const kept: string[] = []
    for (const w of written) {
      const cur = currentAttrs(w.pageId, w.itemId)
      if (!cur) {
        kept.push(w.itemId)
        continue
      }
      const p: ItemPatch = {}
      let left = false
      if (w.patch.status !== undefined && w.before.status !== w.after.status) {
        if (cur.status === w.after.status) p.status = w.before.status
        else left = true
      }
      if ((w.patch.due !== undefined || w.patch.reminder !== undefined) && (w.before.due !== w.after.due || w.before.reminder !== w.after.reminder)) {
        if (cur.due === w.after.due && cur.reminder === w.after.reminder) {
          p.due = w.before.due
          if (w.before.due) p.reminder = w.before.reminder
        } else left = true
      }
      for (const key of ['people', 'blockedBy', 'related'] as const) {
        if (!w.patch[key] || sameList(w.before[key], w.after[key])) continue
        if (!sameList(cur[key], w.after[key])) {
          left = true
          continue
        }
        p[key] = { add: w.before[key].filter((x) => !w.after[key].includes(x)), remove: w.after[key].filter((x) => !w.before[key].includes(x)) }
      }
      if (w.patch.itemId && w.before.itemId && w.before.itemId !== w.after.itemId) {
        if (cur.itemId === w.after.itemId) p.itemId = w.before.itemId
        else left = true
      }
      if (left && !kept.includes(w.itemId)) kept.push(w.itemId)
      // back on the very page it was written (a duplicate on another page stays as it is)
      if (Object.keys(p).length) inverse.push({ itemId: w.itemId, patch: p, pageId: w.pageId })
    }
    // an Undo's writer: the one given, else the Undo frame open around this call (its batch ref kept), else `you~undo`
    const open = currentWriter()
    const by = undoWriter ?? (open?.kind === 'you' && open.via === 'undo' ? open : UNDO)
    if (inverse.length) writeItems(inverse, { by: 'system', toasts: false, from: opts.from, origin: opts.origin, writer: by })
    return { kept }
  }

  return { results, unblocked, undo }
}

// Test hook (dev, or ?e2e): writeItems from a test; the last write's undo
if (typeof window !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e'))) {
  const seam = (window as unknown as { __oneItems?: Record<string, unknown> }).__oneItems
  let lastUndo: ((writer?: Writer) => { kept: string[] }) | null = null
  if (seam) {
    seam.write = (edits: ItemEdit[], opts?: WriteOptions) => {
      const r = writeItems(edits, opts)
      lastUndo = r.undo
      return { results: r.results, unblocked: r.unblocked.map((e) => e.itemId) }
    }
    /** the last write's undo — `ref`: as the Undo of a terminal batch (`you~undo:<ref>`, opened around it) */
    seam.undoLast = (ref?: string) => (ref ? withWriter({ kind: 'you', via: 'undo', ref }, () => lastUndo?.()) : lastUndo?.()) ?? null
  }
}
