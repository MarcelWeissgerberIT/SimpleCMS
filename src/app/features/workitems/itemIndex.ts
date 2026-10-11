/**
 * The workspace index of tasks — pure (no store, no editor at runtime: the scanned pages come in as
 * `PageItems`, the winner order as `deps.compare` — live.ts hands in the editor's `itemsOfContent` results and
 * `compareOccurrence`).
 *
 *  - `byPage`: every page that holds a task, with its scanned items and flags;
 *  - `byId`: the WINNER per itemId among live originals (not in the trash, not in a template, not a synced copy);
 *  - `pagesOf` / `everywhere`: where an id occurs on this device (trash and templates included, synced copies not);
 *  - `trashed` / `templated`: occurrences outside live pages (a ref's IN TRASH; links inside one template);
 *  - `dups`: live originals sharing an id (winner first); `dependents` / `relatedBack` / `loopEdges`: the graph.
 *
 * Updates are incremental: `updateIndex` takes the changed pages only. The graph and the winners are rebuilt
 * only when a page's link FACTS change (itemId, status, blockedBy, related, synced per item, or the page's
 * flags); a title / notes / due / people edit replaces that page's entries and nothing else.
 */
import type { ID } from '../../store/types'
import type { Occurrence, ScannedItem } from '../../editor'
import { graphOf } from './graph'

export interface PageItems {
  pageId: ID
  items: readonly ScannedItem[]
  createdAt: number
  private: boolean
  /** the page or an ancestor is in the trash */
  trashed: boolean
  /** the root of the template the page belongs to, or null */
  template: ID | null
  /** = !trashed && !template */
  live: boolean
}

export interface ItemEntry extends ScannedItem {
  itemId: string
  pageId: ID
  private: boolean
  pageCreatedAt: number
  /** the template the page belongs to (null outside templates) */
  template: ID | null
}

export interface ItemIndex {
  version: number
  byPage: ReadonlyMap<ID, PageItems>
  /** the winner per itemId among LIVE originals */
  byId: ReadonlyMap<string, ItemEntry>
  /** occurrences on this device per itemId, trash + templates included, synced copies not (identity: ItemIds) */
  everywhere: ReadonlyMap<string, number>
  /** the pages holding each itemId (same scope as `everywhere`), each page once */
  pagesOf: ReadonlyMap<string, readonly ID[]>
  /** an occurrence in the trash (outside templates) of ids with no live one */
  trashed: ReadonlyMap<string, ItemEntry>
  /** occurrences inside templates */
  templated: ReadonlyMap<string, readonly ItemEntry[]>
  /** live originals sharing an itemId — winner first */
  dups: ReadonlyMap<string, readonly ItemEntry[]>
  /** reverse blockedBy among live items: blocker → its dependents */
  dependents: ReadonlyMap<string, readonly string[]>
  /** reverse related among live items */
  relatedBack: ReadonlyMap<string, readonly string[]>
  /** `${from}>${to}` blockedBy edges inside a loop (a strongly connected component) — they never block */
  loopEdges: ReadonlySet<string>
  /** live pages whose content has not arrived yet (team): unresolved refs read LOADING */
  unloaded: number
}

export interface IndexDeps {
  /** the winner order among occurrences (editor `compareOccurrence`) */
  compare: (a: Occurrence, b: Occurrence) => number
}

export const EMPTY_INDEX: ItemIndex = Object.freeze({
  version: 0,
  byPage: new Map(),
  byId: new Map(),
  everywhere: new Map(),
  pagesOf: new Map(),
  trashed: new Map(),
  templated: new Map(),
  dups: new Map(),
  dependents: new Map(),
  relatedBack: new Map(),
  loopEdges: new Set(),
  unloaded: 0,
}) as ItemIndex

/* ------------------------------------------------------------------ entries + facts */

const entryCache = new WeakMap<ScannedItem, { page: PageItems; entry: ItemEntry }>()

function entryOf(page: PageItems, item: ScannedItem): ItemEntry | null {
  const id = item.attrs.itemId
  if (!id) return null
  const hit = entryCache.get(item)
  if (hit && hit.page.pageId === page.pageId && hit.page.private === page.private && hit.page.createdAt === page.createdAt && hit.page.template === page.template) return hit.entry
  const entry: ItemEntry = { ...item, itemId: id, pageId: page.pageId, private: page.private, pageCreatedAt: page.createdAt, template: page.template }
  entryCache.set(item, { page, entry })
  return entry
}

const factsCache = new WeakMap<readonly ScannedItem[], string>()

/** What the graph and the winners depend on, as one string: link facts per item. */
function itemFacts(items: readonly ScannedItem[]): string {
  let f = factsCache.get(items)
  if (f !== undefined) return f
  f = items.map((i) => `${i.attrs.itemId ?? ''}:${i.attrs.status}:${i.synced ?? ''}:${i.attrs.blockedBy.join(',')}:${i.attrs.related.join(',')}`).join(';')
  factsCache.set(items, f)
  return f
}

const pageFacts = (p: PageItems) => `${p.live ? 1 : 0}${p.trashed ? 1 : 0}${p.private ? 1 : 0}|${p.template ?? ''}|${p.createdAt}|${itemFacts(p.items)}`

const samePage = (a: PageItems, b: PageItems) =>
  a.items === b.items && a.live === b.live && a.trashed === b.trashed && a.private === b.private && a.template === b.template && a.createdAt === b.createdAt

/* ------------------------------------------------------------------ build */

function derive(byPage: ReadonlyMap<ID, PageItems>, unloaded: number, version: number, deps: IndexDeps): ItemIndex {
  const everywhere = new Map<string, number>()
  const pagesOf = new Map<string, ID[]>()
  const trashed = new Map<string, ItemEntry>()
  const templated = new Map<string, ItemEntry[]>()
  const live = new Map<string, ItemEntry[]>()
  for (const page of byPage.values()) {
    for (const item of page.items) {
      if (item.synced === 'copy') continue
      const e = entryOf(page, item)
      if (!e) continue
      const id = e.itemId
      everywhere.set(id, (everywhere.get(id) ?? 0) + 1)
      const where = pagesOf.get(id)
      if (!where) pagesOf.set(id, [page.pageId])
      else if (where[where.length - 1] !== page.pageId) where.push(page.pageId)
      if (page.live) {
        const list = live.get(id)
        if (list) list.push(e)
        else live.set(id, [e])
      } else if (page.template) {
        const list = templated.get(id)
        if (list) list.push(e)
        else templated.set(id, [e])
      } else if (!trashed.has(id)) trashed.set(id, e)
    }
  }
  const byId = new Map<string, ItemEntry>()
  const dups = new Map<string, ItemEntry[]>()
  for (const [id, list] of live) {
    if (list.length > 1) {
      list.sort(deps.compare)
      dups.set(id, list)
    }
    byId.set(id, list[0])
    trashed.delete(id)
  }
  const graph = graphOf(byId)
  return { version, byPage, byId, everywhere, pagesOf, trashed, templated, dups, dependents: graph.dependents, relatedBack: graph.relatedBack, loopEdges: graph.loopEdges, unloaded }
}

/** The index of these pages (pages without tasks are left out). */
export function buildIndex(pages: Iterable<PageItems>, unloaded: number, deps: IndexDeps, version = 1): ItemIndex {
  const byPage = new Map<ID, PageItems>()
  for (const p of pages) if (p.items.length) byPage.set(p.pageId, p)
  return derive(byPage, unloaded, version, deps)
}

/* ------------------------------------------------------------------ update */

/** Replace the entries of one page in a map of entries (same page, same order → the new entry). */
function replaceEntries(map: Map<string, ItemEntry>, page: PageItems, entries: Map<string, ItemEntry[]>): void {
  for (const [id, es] of entries) {
    const cur = map.get(id)
    if (!cur || cur.pageId !== page.pageId) continue
    const next = es.find((e) => e.order === cur.order)
    if (next) map.set(id, next)
  }
}

/**
 * The index after these pages changed: `upserts` = their current state (a page whose items are empty is
 * dropped), `removed` = pages gone or without tasks now. The same index object when nothing changed.
 */
export function updateIndex(prev: ItemIndex, upserts: readonly PageItems[], removed: readonly ID[], unloaded: number, deps: IndexDeps): ItemIndex {
  // copy-on-write: the page map is copied at the first change
  const box: { map: Map<ID, PageItems> | null } = { map: null }
  const edit = () => (box.map ??= new Map(prev.byPage))
  const current = () => box.map ?? prev.byPage
  let factsChanged = false
  const titled: PageItems[] = []
  for (const id of removed) {
    if (!current().has(id)) continue
    edit().delete(id)
    factsChanged = true
  }
  for (const p of upserts) {
    const old = current().get(p.pageId)
    if (!p.items.length) {
      if (old) {
        edit().delete(p.pageId)
        factsChanged = true
      }
      continue
    }
    if (old && samePage(old, p)) continue
    edit().set(p.pageId, p)
    if (!old || pageFacts(old) !== pageFacts(p)) factsChanged = true
    else titled.push(p)
  }
  const byPage = box.map
  if (!byPage) {
    if (unloaded === prev.unloaded) return prev
    return { ...prev, version: prev.version + 1, unloaded }
  }
  if (factsChanged) return derive(byPage, unloaded, prev.version + 1, deps)
  // only titles / notes / due / people changed: the same winners, the same graph — swap that page's entries
  const byId = new Map(prev.byId)
  const trashed = new Map(prev.trashed)
  const dups = new Map(prev.dups)
  const templated = new Map(prev.templated)
  for (const page of titled) {
    const entries = new Map<string, ItemEntry[]>()
    for (const item of page.items) {
      if (item.synced === 'copy') continue
      const e = entryOf(page, item)
      if (!e) continue
      const list = entries.get(e.itemId)
      if (list) list.push(e)
      else entries.set(e.itemId, [e])
    }
    replaceEntries(byId, page, entries)
    replaceEntries(trashed, page, entries)
    for (const [id, es] of entries) {
      const d = dups.get(id)
      if (d) dups.set(id, d.map((x) => (x.pageId === page.pageId ? (es.find((e) => e.order === x.order) ?? x) : x)))
      const tp = templated.get(id)
      if (tp) templated.set(id, tp.map((x) => (x.pageId === page.pageId ? (es.find((e) => e.order === x.order) ?? x) : x)))
    }
  }
  return { ...prev, version: prev.version + 1, byPage, byId, trashed, dups, templated, unloaded }
}
