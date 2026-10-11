/**
 * The live workspace index of tasks: built lazily, kept up to date incrementally, read by node views, pickers,
 * write.ts, reminders and the agenda.
 *
 *  - Lazy: nothing is scanned at boot. The first `getItemIndex()` builds it with ONE pass over the page map.
 *  - Incremental: the store subscription only QUEUES the pages `pageChanges()` reports (the shared diff — no extra
 *    scan); a frame later (50 ms while the tab is hidden) the queue is applied, the version bumped, listeners told.
 *    A page whose parent / trash / template flag changed makes every indexed page's flags be computed again
 *    (ancestor walks over pages that hold tasks only).
 *  - `getItemIndex()` applies a pending queue at once but NEVER notifies synchronously (it may run during a render):
 *    the notification goes to a microtask; `useSyncExternalStore` reads the plain version number.
 *  - Duplicates: an id shared by two live blocks shows DUPLICATE only after DUP_DELAY — a timer bumps the version
 *    at firstSeen + DUP_DELAY (nothing else re-renders then).
 *  - `startItems()` registers the editor's lookup (taken / gone / isPrivate / canCreate — the ONE creation gate).
 * e2e seam `window.__oneItems` (dev, or `?e2e`): rebuild(), index(), counters, forceCanCreate(v).
 */
import { useRef, useSyncExternalStore } from 'react'
import { useWorkspace, pageChanges } from '../../store/store'
import { isEffectivelyTrashed, templateRootOf } from '../../store/selectors'
import type { ID, Page } from '../../store/types'
import { activeWorkspace, useCloud } from '../../cloud'
import { compareOccurrence, docToMarkdown, forgetScans, itemCounters, itemsOfContent, setItemHooks, setItemLookup, setItemTitleLookup, withItemLabels, type WorkItemAttrs } from '../../editor'
import { buildIndex, EMPTY_INDEX, updateIndex, type IndexDeps, type ItemIndex, type PageItems } from './itemIndex'
import { graphOf } from './graph'
import { DUP_DELAY, itemView, type ItemView } from './view'
import { unblockedBy } from './unblock'
import { toastUnblocked } from './unblockToast'
import { forgetMembers } from './members'

const deps: IndexDeps = { compare: compareOccurrence }

let index: ItemIndex | null = null
const queued = new Set<ID>()
let flagsDirty = false
let frame = 0
let timer: number | undefined
let version = 0
const listeners = new Set<() => void>()
/** live pages of a team workspace whose content has not arrived (refs to their tasks read LOADING) */
const unloaded = new Set<ID>()
const firstSeen = new Map<string, number>()
const dupTimers = new Map<string, number>()
let forced: boolean | null = null
let started = false
let rebuilds = 0

const isTeam = () => activeWorkspace().kind === 'cloud'

/* ------------------------------------------------------------------ pages → PageItems */

function infoOf(pages: Record<ID, Page>, page: Page): PageItems | null {
  const items = itemsOfContent(page.content)
  if (!items.length) return null
  const template = templateRootOf(pages, page.id)
  const trashed = isEffectivelyTrashed(pages, page.id)
  return { pageId: page.id, items, createdAt: page.createdAt, private: !!page.private, trashed, template, live: !trashed && !template }
}

function trackUnloaded(pages: Record<ID, Page>, id: ID, team: boolean): void {
  const page = pages[id]
  if (team && page && page.content == null && !!page.plain && !isEffectivelyTrashed(pages, id) && templateRootOf(pages, id) === null) unloaded.add(id)
  else unloaded.delete(id)
}

function cold(): ItemIndex {
  const pages = useWorkspace.getState().pages
  const team = isTeam()
  const infos: PageItems[] = []
  unloaded.clear()
  const ids = Object.keys(pages)
  for (let i = 0; i < ids.length; i++) {
    const page = pages[ids[i]]
    if (team && page.content == null) {
      if (page.plain) trackUnloaded(pages, page.id, team)
      continue
    }
    const info = infoOf(pages, page)
    if (info) infos.push(info)
  }
  queued.clear()
  flagsDirty = false
  rebuilds++
  return buildIndex(infos, unloaded.size, deps, version + 1)
}

/* ------------------------------------------------------------------ notify */

let notifies = 0
function notify(): void {
  if (!index) return
  notifies++
  version = index.version
  for (const l of [...listeners]) l()
}

let notifyQueued = false
function notifySoon(): void {
  if (notifyQueued) return
  notifyQueued = true
  queueMicrotask(() => {
    notifyQueued = false
    notify()
  })
}

function trackDups(): void {
  if (!index) return
  const now = Date.now()
  for (const id of index.dups.keys()) {
    if (firstSeen.has(id)) continue
    firstSeen.set(id, now)
    dupTimers.set(
      id,
      window.setTimeout(() => {
        dupTimers.delete(id)
        if (!index || !index.dups.has(id)) return
        index = { ...index, version: index.version + 1 }
        notify()
      }, DUP_DELAY + 20),
    )
  }
  for (const id of [...firstSeen.keys()]) {
    if (index.dups.has(id)) continue
    firstSeen.delete(id)
    window.clearTimeout(dupTimers.get(id))
    dupTimers.delete(id)
  }
}

/* ------------------------------------------------------------------ incremental */

/** Apply the queue. True when the index changed. */
function flush(): boolean {
  cancelAnimationFrame(frame)
  window.clearTimeout(timer)
  frame = 0
  timer = undefined
  if (!index || (!queued.size && !flagsDirty)) return false
  const pages = useWorkspace.getState().pages
  const team = isTeam()
  const upserts: PageItems[] = []
  const removed: ID[] = []
  const visit = (id: ID) => {
    trackUnloaded(pages, id, team)
    const page = pages[id]
    const info = page ? infoOf(pages, page) : null
    if (info) upserts.push(info)
    else if (index!.byPage.has(id)) removed.push(id)
  }
  for (const id of queued) visit(id)
  if (flagsDirty) {
    for (const id of index.byPage.keys()) if (!queued.has(id)) visit(id)
    for (const id of [...unloaded]) if (!queued.has(id)) trackUnloaded(pages, id, team)
  }
  queued.clear()
  flagsDirty = false
  const next = updateIndex(index, upserts, removed, unloaded.size, deps)
  if (next === index) return false
  index = next
  trackDups()
  return true
}

function schedule(): void {
  if (frame || timer !== undefined) return
  if (typeof document !== 'undefined' && document.hidden) timer = window.setTimeout(() => flush() && notify(), 50)
  else
    frame = requestAnimationFrame(() => {
      frame = 0
      if (flush()) notify()
    })
}

function onStore(state: { pages: Record<ID, Page> }, prev: { pages: Record<ID, Page> }): void {
  if (!index || state.pages === prev.pages) return
  const ch = pageChanges(state.pages, prev.pages)
  for (const id of ch.changed) {
    queued.add(id)
    if (flagsDirty) continue
    const a = state.pages[id]
    const b = prev.pages[id]
    if (b && (a.parentId !== b.parentId || a.trashed !== b.trashed || !!a.template !== !!b.template)) flagsDirty = true
  }
  for (const id of ch.removed) {
    queued.add(id)
    flagsDirty = true
  }
  if (queued.size || flagsDirty) schedule()
}

/* ------------------------------------------------------------------ public */

/** The index (built on first use; a pending queue applied — listeners hear of it in a microtask, never now). */
export function getItemIndex(): ItemIndex {
  if (!index) {
    index = cold()
    trackDups()
    notifySoon()
  } else if ((queued.size || flagsDirty) && flush()) notifySoon()
  return index
}

/** The index if it was built already (never builds it): for readers that only matter once tasks were seen. */
export function peekItemIndex(): ItemIndex {
  return index ?? EMPTY_INDEX
}

export function subscribeItems(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const getVersion = () => version

/** Re-render when the index changes (the version number). */
export function useItemIndexVersion(): number {
  return useSyncExternalStore(subscribeItems, getVersion, getVersion)
}

const dupSince = (itemId: string) => firstSeen.get(itemId) ?? null

/**
 * What a task's placard shows beyond its own attrs (blockers, dependents, related, duplicate …). Cached PER
 * COMPONENT INSTANCE: computed again when the attrs object or the index version changes, and an equal view
 * comes back as the same object. The store snapshot IS the view: a new index version re-renders only the placards
 * whose view changed — a keystroke in one task re-renders no other placard. Pass the same attrs object while the
 * node's attrs are unchanged (memoise `itemAttrs(node)` on `node.attrs`). The first read may build the index (in a
 * render: listeners hear of it in a microtask); later snapshots read the index as it is (never flushing inside
 * getSnapshot — a pending queue arrives with its own notification).
 */
export function useItemView(attrs: WorkItemAttrs, pageId: ID | null, blockId: string | null = attrs.id): ItemView {
  const cache = useRef<{ attrs: WorkItemAttrs; version: number; pageId: ID | null; blockId: string | null; view: ItemView } | null>(null)
  const args = useRef({ attrs, pageId, blockId })
  args.current = { attrs, pageId, blockId }
  const get = useRef<(() => ItemView) | null>(null)
  if (!get.current)
    get.current = () => {
      const c = cache.current
      const a = args.current
      if (c && c.attrs === a.attrs && c.version === version && c.pageId === a.pageId && c.blockId === a.blockId) return c.view
      const view = itemView(index ?? getItemIndex(), a.attrs, { pageId: a.pageId, blockId: a.blockId, now: Date.now(), dupSince }, c?.view ?? null)
      cache.current = { attrs: a.attrs, version, pageId: a.pageId, blockId: a.blockId, view }
      return view
    }
  // a queue of changes not applied yet: this first read applies it (no notification now)
  if (!cache.current && index && (queued.size || flagsDirty)) getItemIndex()
  return useSyncExternalStore(subscribeItems, get.current, get.current)
}

/* ------------------------------------------------------------------ the minute ticker */

const minuteListeners = new Set<() => void>()
let minuteNow = Date.now()
let minuteTimer: number | undefined

function tickMinute(): void {
  minuteNow = Date.now()
  for (const l of [...minuteListeners]) l()
  minuteTimer = window.setTimeout(tickMinute, 60_000 - (Date.now() % 60_000) + 50)
}

const minuteOf = (t: number) => Math.floor(t / 60_000)

function subscribeMinute(fn: () => void): () => void {
  minuteListeners.add(fn)
  if (minuteTimer === undefined) {
    // a new minute since the last tick only: the same value within the minute — the first placard to subscribe
    // must not make the ones rendered with it render again (300 placards on a page = 300 renders for nothing)
    const t = Date.now()
    if (minuteOf(t) !== minuteOf(minuteNow)) minuteNow = t
    minuteTimer = window.setTimeout(tickMinute, 60_000 - (t % 60_000) + 50)
  }
  return () => {
    minuteListeners.delete(fn)
    if (!minuteListeners.size) {
      window.clearTimeout(minuteTimer)
      minuteTimer = undefined
    }
  }
}

const getMinute = () => minuteNow

/** "Now", renewed at every full minute — one shared ticker for every placard (overdue, due chips). */
export function useNowMinute(): number {
  return useSyncExternalStore(subscribeMinute, getMinute, getMinute)
}

/* ------------------------------------------------------------------ the creation gate + lookup */

/**
 * May new tasks be made in the active workspace? Local: yes. Team: only when the server's schema gate is on
 * (`schema_min` ≥ 1 — an older server, or one never heard of, would let an older tab delete them) and this tab may
 * write (not a viewer, not outdated).
 */
export function canCreateItems(): boolean {
  if (forced !== null) return forced
  const c = useCloud.getState()
  if (c.active.kind !== 'cloud') return true
  return c.schemaMin !== null && c.schemaMin >= 1 && !c.readOnly && !c.outdated
}

/**
 * Start the index (idempotent): registers the editor's lookup and subscribes to the store. Nothing is scanned
 * until something asks. Call once after the workspace is loaded, before the first editor mounts.
 */
export function startItems(): () => void {
  if (started) return stopItems
  started = true
  setItemLookup({
    taken: (itemId, pageId) => (getItemIndex().pagesOf.get(itemId) ?? []).some((p) => p !== pageId),
    gone: (itemId, pageId) => !(getItemIndex().pagesOf.get(itemId) ?? []).some((p) => p !== pageId),
    isPrivate: (itemId) => !!getItemIndex().byId.get(itemId)?.private,
    canCreate: canCreateItems,
    openBlockers: (attrs, pageId) => itemView(getItemIndex(), attrs, { pageId, blockId: attrs.id, now: Date.now(), dupSince }).openBlockers,
    dependents: (itemId) => getItemIndex().dependents.get(itemId)?.length ?? 0,
  })
  // a person finished tasks in an editor: who can start now (the editor's content is in the store already — commitItems
  // flushed it, team editors through their shared document)
  setItemHooks({
    finished: (itemIds) => toastUnblocked(unblockedBy(getItemIndex(), itemIds)),
  })
  // the Markdown export's link labels (withItemLabels only): a live task's title — never a private one's
  setItemTitleLookup((itemId) => {
    const e = getItemIndex().byId.get(itemId)
    return e && !e.private ? e.title || null : null
  })
  unsub = useWorkspace.subscribe(onStore)
  return stopItems
}

let unsub: (() => void) | null = null

export function stopItems(): void {
  if (!started) return
  started = false
  unsub?.()
  unsub = null
  setItemLookup(null)
  setItemHooks(null)
  setItemTitleLookup(null)
  cancelAnimationFrame(frame)
  window.clearTimeout(timer)
  frame = 0
  timer = undefined
  for (const t of dupTimers.values()) window.clearTimeout(t)
  dupTimers.clear()
  firstSeen.clear()
  queued.clear()
  index = null
}

// Test hook (dev, or ?e2e)
if (typeof window !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e'))) {
  ;(window as unknown as { __oneItems?: unknown }).__oneItems = {
    /**
     * a cold build now (returns ms). `fromScratch`: the walks cached per content object are forgotten first, so every
     * page's content is walked again — the real first build of a session (else the cached walks are reused)
     */
    rebuild: (fromScratch = false) => {
      if (fromScratch) forgetScans()
      const t0 = performance.now()
      index = cold()
      trackDups()
      notify()
      return performance.now() - t0
    },
    /** the index as plain data (counts + the maps that tests read) */
    index: () => {
      const i = getItemIndex()
      return {
        version: i.version,
        pages: [...i.byPage.keys()],
        byId: Object.fromEntries([...i.byId].map(([k, e]) => [k, { pageId: e.pageId, blockId: e.blockId, title: e.title, status: e.attrs.status, order: e.order, private: e.private }])),
        everywhere: Object.fromEntries(i.everywhere),
        trashed: [...i.trashed.keys()],
        templated: [...i.templated.keys()],
        dups: Object.fromEntries([...i.dups].map(([k, l]) => [k, l.map((e) => ({ pageId: e.pageId, blockId: e.blockId }))])),
        dependents: Object.fromEntries(i.dependents),
        relatedBack: Object.fromEntries(i.relatedBack),
        loopEdges: [...i.loopEdges],
        unloaded: i.unloaded,
      }
    },
    /** the view a placard would show for these attrs on that page */
    view: (attrs: WorkItemAttrs, pageId: ID | null, blockId: string | null = null) => itemView(getItemIndex(), attrs, { pageId, blockId, now: Date.now(), dupSince }),
    isBuilt: () => index !== null,
    pending: () => queued.size + (flagsDirty ? 1 : 0),
    rebuilds: () => rebuilds,
    /** how many times listeners were told (e2e: never synchronously from getItemIndex) */
    notifies: () => notifies,
    get renders() {
      return itemCounters.renders
    },
    get remints() {
      return itemCounters.remints
    },
    get relinks() {
      return itemCounters.relinks
    },
    /** forget the team's member list (the next reader asks the server) */
    forgetMembers: () => forgetMembers(),
    forceCanCreate: (v: boolean | null) => {
      forced = v
    },
    canCreate: () => canCreateItems(),
    /** apply the pending queue now (an incremental update after a store write): the ms it took */
    flushMs: () => {
      const t0 = performance.now()
      if (flush()) notifySoon()
      return performance.now() - t0
    },
    /** the graph pass over the live tasks (dependents, related, loops — iterative Tarjan): ms, tasks, blockedBy edges */
    graphMs: () => {
      const i = getItemIndex()
      const t0 = performance.now()
      graphOf(i.byId)
      const ms = performance.now() - t0
      let edges = 0
      for (const e of i.byId.values()) edges += e.attrs.blockedBy.length
      return { ms, items: i.byId.size, edges }
    },
    /** a page's Markdown as docToMarkdown writes it — `labels`: inside withItemLabels (the Markdown export) */
    markdown: (pageId: ID, labels = false) => {
      const content = useWorkspace.getState().pages[pageId]?.content ?? null
      return labels ? withItemLabels(() => docToMarkdown(content)) : docToMarkdown(content)
    },
  }
}
