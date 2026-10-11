/**
 * What a task's placard shows beyond its own attrs — pure: blockers with their state and title, dependents,
 * related (own ∪ back), duplicate, blocked / after all. Computed from the node's CURRENT attrs (a write shows at
 * once) + the index for everything else. `prev` gives structural sharing: an equal view comes back as `prev`
 * itself, so a placard re-renders only when what it shows changed.
 */
import type { ID } from '../../store/types'
import type { WorkItemAttrs } from '../../editor'
import type { ItemEntry, ItemIndex } from './itemIndex'
import { edgeKey } from './graph'

export type RefState = 'open' | 'in_progress' | 'done' | 'loop' | 'trash' | 'gone' | 'loading'

export interface ItemRef {
  itemId: string
  state: RefState
  title: string | null
  pageId: ID | null
  blockId: string | null
  people: readonly string[]
  due: string | null
  /** related: listed by this task itself (false: only the other task lists this one) */
  own?: boolean
}

export interface ItemView {
  blockers: readonly ItemRef[]
  openBlockers: number
  /** status ≠ done ∧ an open blocker */
  blocked: boolean
  /** waits for tasks that are all finished now (none open, at least one done) and is not done itself */
  afterAll: boolean
  dependents: readonly ItemRef[]
  related: readonly ItemRef[]
  /** another live block holds the same itemId (shown after DUP_DELAY) */
  duplicate: 'winner' | 'loser' | null
  /** the index has this task (false right after it was made: refs carry no titles yet) */
  indexed: boolean
}

/** How long two blocks share an id before DUPLICATE shows (a cut / paste across pages is a short double). */
export const DUP_DELAY = 1500

export interface ViewCtx {
  pageId: ID | null
  blockId: string | null
  now: number
  /** when this duplicate was first seen (null: not a duplicate) */
  dupSince?: (itemId: string) => number | null
}

const stateOf = (status: string): RefState => (status === 'done' ? 'done' : status === 'in_progress' ? 'in_progress' : 'open')

const refFromEntry = (e: ItemEntry, state: RefState, own?: boolean): ItemRef => ({
  itemId: e.itemId,
  state,
  title: e.title,
  pageId: e.pageId,
  blockId: e.blockId,
  people: e.attrs.people,
  due: e.attrs.due,
  ...(own === undefined ? {} : { own }),
})

const bare = (itemId: string, state: RefState, own?: boolean): ItemRef => ({ itemId, state, title: null, pageId: null, blockId: null, people: [], due: null, ...(own === undefined ? {} : { own }) })

/** The state of a linked id seen from a task (`from`: its own itemId — loop edges; `template`: the viewer's template). */
export function refOf(index: ItemIndex, itemId: string, from: string | null, template: ID | null, own?: boolean): ItemRef {
  const e = index.byId.get(itemId)
  if (e) return refFromEntry(e, from && !template && index.loopEdges.has(edgeKey(from, itemId)) ? 'loop' : stateOf(e.attrs.status), own)
  if (template) {
    // a template's own tasks resolve only within that template
    const t = index.templated.get(itemId)?.find((x) => x.template === template)
    if (t) return refFromEntry(t, stateOf(t.attrs.status), own)
  }
  if (index.trashed.has(itemId)) return bare(itemId, 'trash', own)
  return bare(itemId, index.unloaded > 0 ? 'loading' : 'gone', own)
}

const sameList = (a: readonly string[], b: readonly string[]) => a === b || (a.length === b.length && a.every((x, i) => x === b[i]))
const sameRef = (a: ItemRef, b: ItemRef) =>
  a.itemId === b.itemId && a.state === b.state && a.title === b.title && a.pageId === b.pageId && a.blockId === b.blockId && a.due === b.due && a.own === b.own && sameList(a.people, b.people)
const sameRefs = (a: readonly ItemRef[], b: readonly ItemRef[]) => a === b || (a.length === b.length && a.every((x, i) => sameRef(x, b[i])))

/** Keep the old array (or the old refs inside it) where nothing changed. */
function shareRefs(next: ItemRef[], prev: readonly ItemRef[] | undefined): readonly ItemRef[] {
  if (!prev) return next
  if (sameRefs(next, prev)) return prev
  return next.map((r) => prev.find((p) => sameRef(p, r)) ?? r)
}

export function itemView(index: ItemIndex, attrs: WorkItemAttrs, ctx: ViewCtx, prev: ItemView | null = null): ItemView {
  const id = attrs.itemId
  const page = ctx.pageId ? index.byPage.get(ctx.pageId) : undefined
  const template = page?.template ?? null
  const indexed = !!id && (ctx.pageId ? (index.pagesOf.get(id)?.includes(ctx.pageId) ?? false) : index.everywhere.has(id))
  let blockers: ItemRef[]
  let dependents: ItemRef[] = []
  let related: ItemRef[]
  if (!indexed) {
    blockers = attrs.blockedBy.map((b) => bare(b, 'loading'))
    related = attrs.related.map((r) => bare(r, 'loading', true))
  } else {
    blockers = attrs.blockedBy.map((b) => refOf(index, b, id, template))
    related = attrs.related.map((r) => refOf(index, r, id, template, true))
    if (id && !template) {
      for (const d of index.dependents.get(id) ?? []) {
        const e = index.byId.get(d)
        if (e) dependents.push(refFromEntry(e, stateOf(e.attrs.status)))
      }
      for (const r of index.relatedBack.get(id) ?? []) {
        if (attrs.related.includes(r)) continue
        const e = index.byId.get(r)
        if (e) related.push(refFromEntry(e, stateOf(e.attrs.status), false))
      }
    }
  }
  const openBlockers = blockers.filter((b) => b.state === 'open' || b.state === 'in_progress').length
  const notDone = attrs.status !== 'done'
  const blocked = notDone && openBlockers > 0
  const afterAll = notDone && blockers.length > 0 && openBlockers === 0 && blockers.some((b) => b.state === 'done')
  let duplicate: ItemView['duplicate'] = null
  const dups = id ? index.dups.get(id) : undefined
  if (dups && dups.length > 1) {
    const since = ctx.dupSince?.(id!) ?? null
    if (since !== null && ctx.now - since >= DUP_DELAY) {
      const w = dups[0]
      const winner = w.pageId === ctx.pageId && (w.blockId === ctx.blockId || (w.blockId === null && ctx.blockId === null))
      duplicate = winner ? 'winner' : 'loser'
    }
  }
  const view: ItemView = {
    blockers: shareRefs(blockers, prev?.blockers),
    openBlockers,
    blocked,
    afterAll,
    dependents: shareRefs(dependents, prev?.dependents),
    related: shareRefs(related, prev?.related),
    duplicate,
    indexed,
  }
  if (
    prev &&
    prev.blockers === view.blockers &&
    prev.dependents === view.dependents &&
    prev.related === view.related &&
    prev.openBlockers === openBlockers &&
    prev.blocked === blocked &&
    prev.afterAll === afterAll &&
    prev.duplicate === duplicate &&
    prev.indexed === indexed
  )
    return prev
  return view
}
