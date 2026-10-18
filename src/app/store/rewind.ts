/**
 * The flight recorder's eject and its Undo (features/recorder eject/commit.ts, eject/undo.ts): planned pages and
 * databases put back in ONE store update — the store's `applyRewind` (and `putBack`, an MCP call's Undo in Agent
 * activity: features/mcp/undo.ts, in team workspaces too). Every patched page keeps what is not a part of
 * it from the page as it is now (id, kind, stamps of creation, comments, privacy, template marker, settings, hidden),
 * content written by reference gets a new revision with the writer as its origin, trash and restore follow
 * `trashPage` / `restorePage`. Nothing is created here: a patched id that does not exist now refuses the whole patch,
 * so does a locked database whose schema would change, a page locked now, a parent chain that would loop, and the guard
 * a team workspace registers
 * (cloud/workspace.ts — R3 ejects in the local workspace only). Pure: the store hands in its state.
 */
import type { Database, ID, Page } from './types'
import { plainText } from './plain'
import { deepFreeze } from './freeze'

export interface RewindPatch {
  pages?: Record<ID, Page>
  databases?: Record<ID, Database>
}

let allowed: () => boolean = () => true
/** Who may rewind here (the team binding registers: nobody, until team ejects come). applyRewind refuses otherwise. */
export function setRewindGuard(fn: () => boolean): void {
  allowed = fn
}
export const rewindAllowed = (): boolean => allowed()

export interface RewindNext {
  pages: Record<ID, Page>
  databases: Record<ID, Database>
  recent: ID[]
  /** pages that are a different object now (for pageChanges(): no scan of the map) */
  changed: ID[]
}

const schemaOf = (db: Database) => JSON.stringify([db.properties, db.views, !!db.locked])

/** Is the page or one of its ancestors in the trash (cycle-safe)? */
function underTrash(pages: Record<ID, Page>, id: ID | null): boolean {
  const seen = new Set<ID>()
  let cur: Page | undefined = id ? pages[id] : undefined
  while (cur && !seen.has(cur.id)) {
    if (cur.trashed) return true
    seen.add(cur.id)
    cur = cur.parentId ? pages[cur.parentId] : undefined
  }
  return false
}

/** Does walking up from the page come back to it? */
function inCycle(pages: Record<ID, Page>, id: ID): boolean {
  const seen = new Set<ID>()
  let cur: ID | null = pages[id]?.parentId ?? null
  while (cur && !seen.has(cur)) {
    if (cur === id) return true
    seen.add(cur)
    cur = pages[cur]?.parentId ?? null
  }
  return false
}

/**
 * The state after a rewind (null: refused — nothing may change). `origin`: the content origin of rewritten pages;
 * `t`: now. `lockedPages`: an MCP call's Undo (store `putBack`) writes a page locked before the call back as the call
 * found it — its caller refused a lock set since (features/mcp/undo.ts).
 */
export function rewindState(
  cur: { pages: Record<ID, Page>; databases: Record<ID, Database>; recent: ID[] },
  patch: RewindPatch,
  origin: 'eject' | 'rewind' | 'history',
  t: number,
  opts: { lockedPages?: boolean } = {},
): RewindNext | null {
  const pageIds = Object.keys(patch.pages ?? {})
  const dbIds = Object.keys(patch.databases ?? {})
  for (const id of pageIds) {
    const now = cur.pages[id]
    // never created here; a page locked now is never written (the planner holds it — defence in depth)
    if (!now || patch.pages![id].id !== id || (now.settings?.locked && !opts.lockedPages)) return null
  }
  for (const id of dbIds) {
    const now = cur.databases[id]
    if (!now || patch.databases![id].id !== id) return null
    if (now.locked && schemaOf(now) !== schemaOf(patch.databases![id])) return null
  }
  let pages = cur.pages
  const changed: ID[] = []
  const trashed: ID[] = []
  if (pageIds.length) {
    // the patched pages first (a restored page's parent may be patched in the same update)
    const merged = new Map<ID, Page>()
    for (const id of pageIds) {
      const now = cur.pages[id]
      const p = patch.pages![id]
      const content = p.content !== now.content
      const next: Page = {
        ...p,
        id: now.id,
        kind: now.kind,
        createdAt: now.createdAt,
        settings: now.settings,
        updatedAt: t,
        updatedBy: p.updatedBy ?? null,
        contentRev: content ? now.contentRev + 1 : now.contentRev,
        contentOrigin: content ? origin : now.contentOrigin,
        plain: content ? plainText(p.content) : now.plain,
      }
      // the page as it is now: never parts of a place
      for (const k of ['createdBy', 'comments', 'private', 'template', 'hidden'] as const) {
        if (now[k] === undefined) delete next[k]
        else (next as unknown as Record<string, unknown>)[k] = now[k]
      }
      if (next.trashed) {
        next.favorite = false
        next.trashedAt = now.trashed ? (now.trashedAt ?? t) : t
        trashed.push(id)
      } else {
        next.favorite = now.favorite
        next.trashedAt = null
      }
      merged.set(id, next)
    }
    const map: Record<ID, Page> = {}
    const ids = Object.keys(cur.pages)
    for (let i = 0; i < ids.length; i++) map[ids[i]] = cur.pages[ids[i]]
    for (const [id, p] of merged) map[id] = p
    // restored: a page (never a row) whose parent is gone or in the trash goes to the root, as restorePage does
    for (const [id, p] of merged) {
      const was = cur.pages[id]
      if (!was.trashed || p.trashed || p.databaseId || !p.parentId) continue
      const parent = map[p.parentId]
      if (!parent || underTrash(map, p.parentId)) map[id] = { ...p, parentId: null }
    }
    // a page whose new parent chain reaches itself would vanish from the tree with all below it: refused (the callers
    // check parents first — defence in depth)
    for (const id of merged.keys()) if (map[id].parentId !== cur.pages[id].parentId && inCycle(map, id)) return null
    for (const id of merged.keys()) {
      map[id] = deepFreeze(map[id])
      changed.push(id)
    }
    pages = Object.freeze(map)
  }
  let databases = cur.databases
  if (dbIds.length) {
    const map: Record<ID, Database> = { ...cur.databases }
    for (const id of dbIds) map[id] = deepFreeze({ ...patch.databases![id], id })
    databases = Object.freeze(map)
  }
  const recent = trashed.length && cur.recent.some((r) => trashed.includes(r)) ? cur.recent.filter((r) => !trashed.includes(r)) : cur.recent
  return { pages, databases, recent, changed }
}
