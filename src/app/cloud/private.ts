/**
 * Private pages in a team workspace (docs/CLOUD.md § Private pages): this member's own meta document
 * (`ws:<id>:u:<userId>`) next to the workspace's, opened by the server for them only.
 *
 *  - create: a root page / database the binding writes into the private meta document (subpages,
 *    rows and databases below a private page go there by themselves);
 *  - move: a page with everything below it (subpages, databases, rows, trashed ones too) between
 *    Private and the workspace. Online only, in this order: every content document synced, its
 *    full Y state confirmed by the server under the target name (same Y.Doc, a second provider —
 *    moving TO the workspace first clears the labels of mentions of pages that stay private), private
 *    uploads the pages use published, then the meta entries copied into the target meta document
 *    and deleted from the source one, the store updated, the content documents switched over and
 *    the old ones purged on the server (DELETE …/documents, `?scope=private` for the private side).
 *    Page ids stay, so links and mentions keep working (for whoever can see the page).
 */
import * as Y from 'yjs'
import { descendantIds, useWorkspace, type NewDatabaseInput, type NewPageInput } from '../store/store'
import type { ID, Page } from '../store/types'
import { newId } from '../lib/ids'
import { applyFromCloud, intendPrivate } from './binding'
import { prepareMove, type ContentMove } from './content'
import { publishNow } from './files'
import { fileRefs, sharedPlain } from './privacy'
import { queuePurge } from './purge'
import { LOCAL, roots } from './schema'
import { isConnected } from './socket'
import { CloudError, useCloud } from './state'
import { activeCloud } from './workspace'

/** Is this page in my Private section (only I can see it)? */
export function isPrivate(pageId: ID | null | undefined): boolean {
  return !!pageId && !!useWorkspace.getState().pages[pageId]?.private
}

/** A parent a private page may live under: a private, live, ordinary page (not a database or row). */
function privateParent(parentId: ID | null | undefined): ID | null {
  const p = parentId ? useWorkspace.getState().pages[parentId] : undefined
  return p && p.private && !p.trashed && p.kind === 'page' && !p.databaseId ? p.id : null
}

function requireWritable() {
  const a = activeCloud()
  if (!a || !a.writable()) throw new CloudError('forbidden', 'Private pages need a team workspace you can edit.', 403)
  return a
}

/** A new page in my Private section (at its root, or under a private page). */
export function createPrivatePageImpl(input: NewPageInput = {}): ID {
  requireWritable()
  const id = input.id ?? newId()
  intendPrivate(id)
  return useWorkspace.getState().createPage({ ...input, id, parentId: privateParent(input.parentId) })
}

/** A new database in my Private section. */
export function createPrivateDatabaseImpl(input: NewDatabaseInput = {}): ID {
  requireWritable()
  const id = input.id ?? newId()
  intendPrivate(id)
  return useWorkspace.getState().createDatabase({ ...input, id, parentId: privateParent(input.parentId) })
}

/* ------------------------------------------------------------------ moving */

let moving = false

/** The order for a page placed at `index` among the target's children (roots: of that scope only). */
function orderIn(pages: Record<ID, Page>, parentId: ID | null, priv: boolean, index: number | undefined, exclude: ID): number {
  const sibs = Object.values(pages)
    .filter((p) => p.parentId === parentId && p.id !== exclude && !p.databaseId && (parentId !== null || !!p.private === priv))
    .sort((a, b) => a.order - b.order)
  const live = sibs.filter((p) => !p.trashed)
  if (index === undefined || index >= live.length) return (sibs.length ? Math.max(...sibs.map((p) => p.order)) : 0) + 1
  if (index <= 0) return (live[0]?.order ?? 1) - 1
  return (live[index - 1].order + live[index].order) / 2
}

const isMap = (v: unknown): v is Y.Map<unknown> => v instanceof Y.Map

/**
 * Move `pageId` (with everything below it) into my Private section (`toPrivate`) or into the
 * workspace, under `target.parentId` (a page of that scope; null = its root) at `target.index`.
 * Within one scope it is a plain move. Errors (CloudError): 'forbidden' (viewer / local),
 * 'not_found', 'invalid_request' (a row, or a parent that can't take it), 'offline' (no connection
 * — nothing changed), 'timeout', 'busy' (another move is running).
 */
export async function movePagePrivacyImpl(pageId: ID, toPrivate: boolean, target: { parentId?: ID | null; index?: number } = {}): Promise<void> {
  const a = requireWritable()
  const s = useWorkspace.getState()
  const page = s.pages[pageId]
  if (!page) throw new CloudError('not_found', 'No such page.', 404)
  if (page.databaseId) throw new CloudError('invalid_request', 'Rows move with their database.', 400)
  const parentId = target.parentId ?? null
  if (parentId) {
    const parent = s.pages[parentId]
    const ok = parent && !parent.trashed && parent.kind === 'page' && !parent.databaseId && !!parent.private === toPrivate && parentId !== pageId && !descendantIds(s.pages, pageId).includes(parentId)
    if (!ok) throw new CloudError('invalid_request', 'The page cannot go there.', 400)
  }
  if (!!page.private === toPrivate) {
    s.movePage(pageId, parentId, target.index)
    return
  }
  if (moving) throw new CloudError('busy', 'Another page is being moved.', 409)
  if (!isConnected() || !a.provider.isSynced || !a.privateProvider.isSynced) throw new CloudError('offline', 'Moving pages between Private and the workspace needs a connection.')

  moving = true
  let flipped = false
  const moves: ContentMove[] = []
  const prepared = new Set<ID>()
  const subtree = () => (useWorkspace.getState().pages[pageId] ? [pageId, ...descendantIds(useWorkspace.getState().pages, pageId)] : [])
  // what stays private must not be named in what becomes visible to everyone
  const stillPrivate = (moved: Set<ID>) => (id: ID) => {
    const p = useWorkspace.getState().pages[id]
    return !p || (!!p.private && !moved.has(id))
  }
  const undo = () => {
    moves.forEach((m) => m.abort())
    // moving to the workspace: the standby documents may already hold the private content
    if (!toPrivate && prepared.size) queuePurge([...prepared].map((id) => ({ pageId: id, private: false })))
  }
  try {
    // content first (pages created below it meanwhile join in)
    let ids = subtree()
    for (let round = 0; round < 3 && ids.some((id) => !prepared.has(id)); round++) {
      const todo = ids.filter((id) => !prepared.has(id))
      todo.forEach((id) => prepared.add(id))
      moves.push(await prepareMove(todo, toPrivate, toPrivate ? undefined : stillPrivate(new Set(ids))))
      ids = subtree()
    }
    const now = useWorkspace.getState()
    const cur = now.pages[pageId]
    if (!cur || !!cur.private === toPrivate || ids.some((id) => !prepared.has(id))) throw new CloudError('busy', 'The pages changed while they were being moved — try again.', 409)
    const movedSet = new Set(ids)

    // private uploads the pages use become workspace files before anyone sees the pages
    if (!toPrivate) {
      const refs = new Set<string>()
      for (const m of moves) for (const json of m.json.values()) fileRefs(json, refs)
      for (const id of ids) {
        const p = now.pages[id]
        fileRefs(p?.cover, refs)
        fileRefs(p?.properties, refs)
        fileRefs(now.databases[id]?.templates, refs)
      }
      await publishNow([...refs])
    }

    // the meta entries: copied into the target document, then gone from the source
    const from = roots(toPrivate ? a.doc : a.privateDoc)
    const to = roots(toPrivate ? a.privateDoc : a.doc)
    const toDoc = toPrivate ? a.privateDoc : a.doc
    const fromDoc = toPrivate ? a.doc : a.privateDoc
    const at = Date.now()
    const uid = a.user.id
    const order = orderIn(now.pages, parentId, toPrivate, target.index, pageId)
    const hidden = stillPrivate(movedSet)
    toDoc.transact(() => {
      for (const id of ids) {
        const src = from.pages.get(id)
        if (!isMap(src)) continue
        const copy = src.clone()
        if (id === pageId) {
          copy.set('parentId', parentId)
          copy.set('order', order)
          copy.set('updatedAt', at)
          copy.set('updatedBy', uid)
        }
        if (!toPrivate && now.pages[id]) {
          const plain = sharedPlain(now.pages[id], hidden)
          if (plain !== undefined && plain !== copy.get('plain')) copy.set('plain', plain)
        }
        to.pages.set(id, copy)
        const db = from.databases.get(id)
        if (isMap(db)) to.databases.set(id, db.clone())
      }
    }, LOCAL)
    fromDoc.transact(() => {
      for (const id of ids) {
        from.pages.delete(id)
        from.databases.delete(id)
      }
    }, LOCAL)
    flipped = true

    // the store: same pages, the other scope (no echo — the meta documents already say so)
    applyFromCloud(() => {
      const pages: Record<ID, Page> = {}
      for (const id of ids) {
        const p = useWorkspace.getState().pages[id]
        if (!p) continue
        const { private: _p, ...rest } = p
        const next: Page = toPrivate ? { ...rest, private: true } : rest
        pages[id] = id === pageId ? { ...next, parentId, order, updatedAt: at, updatedBy: uid } : next
      }
      useWorkspace.getState().cloudPatch({ pages })
    })
    moves.forEach((m) => m.commit())
    // the old content documents go on the server (once the meta change is confirmed)
    queuePurge(ids.map((id) => ({ pageId: id, private: !toPrivate })))
  } catch (err) {
    // after the meta documents moved there is nothing to take back (the rest catches up on reload)
    if (!flipped) undo()
    else console.error('[one] finishing a move between Private and the workspace failed', err)
    throw err instanceof CloudError ? err : new CloudError('internal', (err as Error)?.message || 'The move failed.')
  } finally {
    moving = false
  }
}

/** Which private-pages UI this tab gets: none (local workspace / signed out), read (viewers), write. */
export function usePrivateModeImpl(): 'none' | 'read' | 'write' {
  return useCloud((c) => (c.active.kind !== 'cloud' || c.status === 'signed-out' || c.status === 'checking' ? 'none' : c.readOnly ? 'read' : 'write'))
}
