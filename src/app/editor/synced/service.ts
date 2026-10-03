/**
 * Synced-block service — keeps every copy of a synced block in step, through the store only.
 *
 *  - Index, maintained incrementally from content changes (a page is rescanned only when its
 *    content object changed): syncId → pages holding it; per group the latest content ("canon").
 *  - The SOURCE of a group is its earliest live original (page createdAt, id, document order);
 *    later originals (duplicated page / block, template, import) become references to it.
 *  - A page's content changed (origin = who wrote it):
 *      · a block of a group differs from the canon → that block was edited: it becomes the canon
 *        and every other copy (the original included) is rewritten — setContent(…, 'synced'),
 *        only the blocks of that group, unchanged child blocks keep their ids (open editors patch
 *        the changed range and keep the caret)
 *      · blocks that just arrived on the page (paste, insert, undo, restore) and references
 *        restored by history / import are refreshed FROM the canon instead (stale copies never
 *        overwrite the original); an original that comes back while the group had none is the truth
 *      · our own writes ('synced') never trigger anything; nothing is written when a copy
 *        already matches — no loops, no ping-pong
 *  - Team cloud: changes from others ('sync' / applied from the cloud) only update the canon —
 *    the client where the edit happened propagates it (two clients writing the same change into
 *    a Y document would duplicate it). Viewers never write. No reconciliation writes at boot.
 *  - Local boot: stale references are refreshed, duplicate originals resolved, references point
 *    at the current source page.
 */
import type { JSONContent } from '@tiptap/core'
import type { ID, Page } from '../../store/types'
import { pageChanges, useWorkspace } from '../../store/store'
import { isApplyingCloudChange, useCloud } from '../../cloud'
import { docSchema } from '../convert'
import { liveIds } from '../lib/livePages'
import { SYNCED_ORIGIN, adoptIds, contentKey, findSynced, mapSynced, unsyncDoc, type SyncedHit } from './model'
import { allEntries, canonContent, putEntries, setCanon, setRunning, syncedEntry, type SyncedEntry, type SyncedUse } from './state'

/** Writers whose change to a REFERENCE is a restore, not an edit: the reference follows the canon. */
const PULL_ORIGINS = new Set(['history', 'import'])
const WRITE_DELAY = 20
const DUPES_DELAY = 900

interface Scan {
  hits: SyncedHit[]
  keys: string[]
}

let started = false
let unsubscribe: (() => void) | null = null
const scans = new Map<ID, Scan>()
const holders = new Map<string, Set<ID>>()
const canonKey = new Map<string, string>()
let live = new Set<ID>()
/** Pending writes: page → groups whose blocks on it must follow the canon. */
const queued = new Map<ID, Set<string>>()
/** Groups whose surplus originals become references on the next write. */
const convert = new Set<string>()
const dupeCheck = new Set<string>()
let writeTimer = 0
let dupesTimer = 0

const freshId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)

/** Comparison key through the schema (defaults filled in), so differently written equal content matches. */
function keyOf(content: JSONContent[] | undefined): string {
  const list = content ?? []
  try {
    const doc = docSchema().nodeFromJSON({ type: 'doc', content: list.length ? list : [{ type: 'paragraph' }] }).toJSON() as JSONContent
    return contentKey(doc.content)
  } catch {
    return contentKey(list)
  }
}

function writable(): boolean {
  const c = useCloud.getState()
  return !(c.active.kind === 'cloud' && c.readOnly)
}

const isCloud = () => useCloud.getState().active.kind === 'cloud'

function setCanonFrom(syncId: string, content: JSONContent[] | undefined, key: string) {
  const list = content?.length ? content : [{ type: 'paragraph' }]
  setCanon(syncId, list)
  canonKey.set(syncId, key)
}

/* ------------------------------------------------------------------ writes */

function queue(pageId: ID, syncId: string) {
  let set = queued.get(pageId)
  if (!set) queued.set(pageId, (set = new Set()))
  set.add(syncId)
  if (!writeTimer) writeTimer = window.setTimeout(flushWrites, WRITE_DELAY)
}

function queueGroup(syncId: string) {
  for (const pageId of holders.get(syncId) ?? []) if (live.has(pageId)) queue(pageId, syncId)
}

/** The page's blocks of these groups, brought in line with the canon and the current source. */
function refreshDoc(pageId: ID, doc: JSONContent, ids: Set<string>): JSONContent {
  const firstOriginal = new Set<string>()
  return mapSynced(doc, (n) => {
    const syncId = typeof n.attrs?.syncId === 'string' ? n.attrs.syncId : ''
    if (!ids.has(syncId)) return n
    const source = syncedEntry(syncId)?.source ?? null
    let attrs = n.attrs!
    if (!attrs.sourcePageId) {
      const keep = source === pageId && !firstOriginal.has(syncId)
      firstOriginal.add(syncId)
      if (!keep && source && convert.has(syncId)) attrs = { ...attrs, sourcePageId: source }
    } else if (source && attrs.sourcePageId !== source) attrs = { ...attrs, sourcePageId: source }
    const canon = canonContent(syncId)
    const stale = !!canon && keyOf(n.content) !== canonKey.get(syncId)
    if (attrs === n.attrs && !stale) return n
    return { ...n, attrs, content: stale ? adoptIds(canon!, n.content, freshId) : n.content }
  })
}

function flushWrites() {
  window.clearTimeout(writeTimer)
  writeTimer = 0
  if (!started || !queued.size) return
  const jobs = [...queued]
  queued.clear()
  const ws = useWorkspace.getState()
  for (const [pageId, ids] of jobs) {
    const page = ws.pages[pageId]
    if (!page?.content || !live.has(pageId)) continue
    const next = refreshDoc(pageId, page.content, ids)
    if (next !== page.content) useWorkspace.getState().setContent(pageId, next, SYNCED_ORIGIN)
  }
  convert.clear()
}

/** Groups with more than one live original: the later ones become references to the source. */
function resolveDupes() {
  window.clearTimeout(dupesTimer)
  dupesTimer = 0
  if (!started) return
  for (const syncId of dupeCheck) {
    const source = syncedEntry(syncId)?.source
    if (!source) continue
    let originals = 0
    const pages: ID[] = []
    for (const pageId of holders.get(syncId) ?? []) {
      if (!live.has(pageId)) continue
      const n = scans.get(pageId)?.hits.filter((h) => h.syncId === syncId && !h.sourcePageId).length ?? 0
      originals += n
      if (n && (pageId !== source || n > 1)) pages.push(pageId)
    }
    if (originals < 2) continue
    convert.add(syncId)
    pages.forEach((p) => queue(p, syncId))
  }
  dupeCheck.clear()
  flushWrites()
}

function scheduleDupes(syncId: string) {
  dupeCheck.add(syncId)
  window.clearTimeout(dupesTimer)
  dupesTimer = window.setTimeout(resolveDupes, DUPES_DELAY)
}

/* ------------------------------------------------------------------ index */

function entryFor(syncId: string, pages: Record<ID, Page>): SyncedEntry | undefined {
  const ids = [...(holders.get(syncId) ?? [])].filter((id) => live.has(id) && pages[id])
  if (!ids.length) return undefined
  ids.sort((a, b) => (pages[a].createdAt ?? 0) - (pages[b].createdAt ?? 0) || (a < b ? -1 : a > b ? 1 : 0))
  let source: ID | null = null
  let sourceBlockId: string | null = null
  const uses: SyncedUse[] = []
  for (const id of ids) {
    const hits = scans.get(id)?.hits.filter((h) => h.syncId === syncId) ?? []
    const orig = hits.find((h) => !h.sourcePageId)
    if (orig && !source) {
      source = id
      sourceBlockId = orig.blockId
    }
    uses.push({ pageId: id, blockId: (orig ?? hits[0])?.blockId ?? null, original: false })
  }
  for (const u of uses) u.original = u.pageId === source
  uses.sort((a, b) => Number(b.original) - Number(a.original))
  return { syncId, source, sourceBlockId, uses }
}

function originalsOf(syncId: string): number {
  let n = 0
  for (const pageId of holders.get(syncId) ?? []) if (live.has(pageId)) n += scans.get(pageId)?.hits.filter((h) => h.syncId === syncId && !h.sourcePageId).length ?? 0
  return n
}

interface Pass {
  remote: boolean
  write: boolean
  touched: Set<string>
}

function index(pageId: ID, page: Page | undefined, pass: Pass): { before: Scan | undefined; scan: Scan | undefined } {
  const before = scans.get(pageId)
  const hits = page ? findSynced(page.content) : []
  if (!hits.length && !before) return { before, scan: undefined }
  const scan: Scan = { hits, keys: hits.map((h) => keyOf(h.node.content)) }
  if (hits.length) scans.set(pageId, scan)
  else scans.delete(pageId)
  const now = new Set(hits.map((h) => h.syncId))
  for (const h of before?.hits ?? []) {
    pass.touched.add(h.syncId)
    if (!now.has(h.syncId)) holders.get(h.syncId)?.delete(pageId)
  }
  for (const id of now) {
    pass.touched.add(id)
    let set = holders.get(id)
    if (!set) holders.set(id, (set = new Set()))
    set.add(pageId)
  }
  return { before, scan: hits.length ? scan : undefined }
}

const groupsOf = (scan: Scan | undefined) => {
  const m = new Map<string, number[]>()
  scan?.hits.forEach((h, i) => {
    const list = m.get(h.syncId)
    if (list) list.push(i)
    else m.set(h.syncId, [i])
  })
  return m
}

/** A page's content changed: who leads — this page's copy, or the canon? */
function decide(pageId: ID, origin: string | null, before: Scan | undefined, scan: Scan, pass: Pass) {
  const countBefore = new Map<string, number>()
  before?.hits.forEach((h) => countBefore.set(h.syncId, (countBefore.get(h.syncId) ?? 0) + 1))
  const remote = pass.remote || origin === 'sync'
  for (const [syncId, idx] of groupsOf(scan)) {
    const known = canonKey.get(syncId)
    if (known === undefined) {
      const pick = idx.find((i) => !scan.hits[i].sourcePageId) ?? idx[0]
      setCanonFrom(syncId, scan.hits[pick].node.content, scan.keys[pick])
      continue
    }
    if (origin === SYNCED_ORIGIN) continue
    const changed = idx.filter((i) => scan.keys[i] !== known)
    if (!changed.length) continue
    const lead = changed.find((i) => !scan.hits[i].sourcePageId) ?? changed[0]
    if (remote || !pass.write) {
      setCanonFrom(syncId, scan.hits[lead].node.content, scan.keys[lead])
      continue
    }
    const arrived = idx.length > (countBefore.get(syncId) ?? 0)
    const revivedOriginal = arrived && !syncedEntry(syncId)?.source && changed.some((i) => !scan.hits[i].sourcePageId)
    const restored = !!origin && PULL_ORIGINS.has(origin) && changed.every((i) => !!scan.hits[i].sourcePageId)
    if ((arrived && !revivedOriginal) || restored) {
      queue(pageId, syncId)
      continue
    }
    setCanonFrom(syncId, scan.hits[lead].node.content, scan.keys[lead])
    queueGroup(syncId)
  }
}

/** A page came back from the trash: its copies follow the canon — or lead, if they hold the only original. */
function revive(pageId: ID, pass: Pass) {
  const scan = scans.get(pageId)
  if (!scan || pass.remote || !pass.write) return
  for (const [syncId, idx] of groupsOf(scan)) {
    const known = canonKey.get(syncId)
    if (known === undefined || idx.every((i) => scan.keys[i] === known)) continue
    const orig = idx.find((i) => !scan.hits[i].sourcePageId)
    if (orig !== undefined && !syncedEntry(syncId)?.source) {
      setCanonFrom(syncId, scan.hits[orig].node.content, scan.keys[orig])
      queueGroup(syncId)
    } else queue(pageId, syncId)
  }
}

function recompute(touched: Set<string>, pass: Pass | null) {
  if (!touched.size) return
  const pages = useWorkspace.getState().pages
  const next = new Map<string, SyncedEntry | undefined>()
  for (const syncId of touched) {
    const prev = syncedEntry(syncId)
    const e = entryFor(syncId, pages)
    next.set(syncId, e)
    if (!pass || pass.remote || !pass.write || !e) continue
    // the original moved to another page: references point at the new one
    if (e.source && prev?.source && e.source !== prev.source) queueGroup(syncId)
    if (originalsOf(syncId) > 1) scheduleDupes(syncId)
  }
  putEntries(next)
}

function onChange(s: { pages: Record<ID, Page> }, prev: { pages: Record<ID, Page> }) {
  if (!started || s.pages === prev.pages) return
  const changed: ID[] = []
  let liveDirty = false
  const diff = pageChanges(s.pages, prev.pages)
  for (const id of diff.changed) {
    const p = s.pages[id]
    const o = prev.pages[id]
    if (!o || p.trashed !== o.trashed || p.parentId !== o.parentId) liveDirty = true
    if (!o || p.content !== o.content) changed.push(id)
  }
  const removed = diff.removed
  if (removed.length) liveDirty = true
  if (!changed.length && !liveDirty) return

  const pass: Pass = { remote: isApplyingCloudChange(), write: writable(), touched: new Set() }
  const revived: ID[] = []
  if (liveDirty) {
    const next = liveIds(s.pages)
    for (const [id, scan] of scans) {
      if (live.has(id) === next.has(id)) continue
      scan.hits.forEach((h) => pass.touched.add(h.syncId))
      if (next.has(id)) revived.push(id)
    }
    live = next
  }
  for (const id of removed) index(id, undefined, pass)
  for (const id of changed) {
    const page = s.pages[id]
    const { before, scan } = index(id, page, pass)
    if (scan && live.has(id)) decide(id, page.contentOrigin, before, scan, pass)
  }
  for (const id of revived) if (!changed.includes(id)) revive(id, pass)
  recompute(pass.touched, pass)
}

/* ------------------------------------------------------------------ lifecycle */

/**
 * Start the service (idempotent): index the workspace, then follow every content change.
 * Call once after the workspace is loaded (main.tsx, next to the other services). Returns stop.
 */
export function startSyncedBlocks(): () => void {
  if (started) return stopSyncedBlocks
  started = true
  setRunning(true)
  const pages = useWorkspace.getState().pages
  live = liveIds(pages)
  const pass: Pass = { remote: false, write: false, touched: new Set() }
  for (const id in pages) index(id, pages[id], pass)
  recompute(pass.touched, null)
  // the canon of each group: its source original (the truth), else its first live copy
  for (const syncId of pass.touched) {
    const e = syncedEntry(syncId)
    const pageId = e?.source ?? e?.uses[0]?.pageId ?? [...(holders.get(syncId) ?? [])][0]
    const scan = pageId ? scans.get(pageId) : undefined
    if (!scan) continue
    let i = e?.source ? scan.hits.findIndex((h) => h.syncId === syncId && !h.sourcePageId) : -1
    if (i < 0) i = scan.hits.findIndex((h) => h.syncId === syncId)
    if (i >= 0) setCanonFrom(syncId, scan.hits[i].node.content, scan.keys[i])
  }
  // local workspace: bring stale copies in line (a team workspace leaves that to whoever edits)
  if (!isCloud() && writable()) {
    for (const syncId of pass.touched) {
      queueGroup(syncId)
      if (originalsOf(syncId) > 1) dupeCheck.add(syncId)
    }
    if (dupeCheck.size) resolveDupes()
    else flushWrites()
  }
  unsubscribe = useWorkspace.subscribe(onChange)
  return stopSyncedBlocks
}

export function stopSyncedBlocks(): void {
  if (!started) return
  started = false
  unsubscribe?.()
  unsubscribe = null
  window.clearTimeout(writeTimer)
  window.clearTimeout(dupesTimer)
  writeTimer = dupesTimer = 0
  scans.clear()
  holders.clear()
  canonKey.clear()
  queued.clear()
  convert.clear()
  dupeCheck.clear()
  live = new Set()
  setRunning(false)
}

/* ------------------------------------------------------------------ actions */

/** "Unsync all": every copy of the group on other pages becomes plain blocks. Returns how many pages changed. */
export function unsyncEverywhere(syncId: string, exceptPageId: ID | null): number {
  const ws = useWorkspace.getState()
  let n = 0
  for (const pageId of [...(holders.get(syncId) ?? [])]) {
    if (pageId === exceptPageId) continue
    const page = ws.pages[pageId]
    if (!page?.content) continue
    const next = unsyncDoc(page.content, syncId)
    if (next === page.content) continue
    useWorkspace.getState().setContent(pageId, next, SYNCED_ORIGIN)
    n++
  }
  return n
}

// Test hook (dev, or ?e2e): run pending writes now, read the index.
if (typeof window !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e'))) {
  ;(window as unknown as { __oneSynced?: unknown }).__oneSynced = {
    start: startSyncedBlocks,
    stop: stopSyncedBlocks,
    flush: () => {
      if (dupeCheck.size) resolveDupes()
      else flushWrites()
    },
    entry: (syncId: string) => syncedEntry(syncId),
    entries: allEntries,
    canon: (syncId: string) => canonContent(syncId),
  }
}
