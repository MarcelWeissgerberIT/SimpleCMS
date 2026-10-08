/**
 * The workspace look (docs/CLOUD.md § Meta document schema → workspace.look; app: Workspace → Look, lib/look):
 * only owners and admins change it. The app refuses for everyone else and its binding puts their store change
 * back, but a member's client could still write the meta document's `workspace` map directly — so the server
 * says what holds:
 *
 *  - a change of the key `look` from a connection whose role is not owner or admin is put back (the value before
 *    it, or no key) in one transaction with the server's own origin, written right after the member's;
 *  - an owner's or admin's change gets `updatedBy` = their account id, whatever the client wrote there (the
 *    "SET BY …" read-out cannot be forged);
 *  - a change carried by structs that waited for missing ones (Yjs "pending" structs, applied in a later
 *    transaction) counts only when every member whose update left structs waiting may change the look —
 *    otherwise it is put back (structs from the stored state count as unverified).
 *
 * The value itself is cosmetic and every reader sanitizes it (app src/app/store/look.ts); the server does not
 * judge colours. Its own writes (none today) are left alone. Corrections are never corrected again (no loop).
 */
import { isTransactionOrigin, type LocalTransactionOrigin } from '@hocuspocus/server'
import * as Y from 'yjs'
import type { Logger } from '../log.ts'

const GUARD_ORIGIN: LocalTransactionOrigin = { source: 'local', context: { actor: 'server:workspace-look' } }
const KEY = 'look'
/** `updatedBy` of a change whose writer cannot be told. */
const UNVERIFIED = '@unverified'

interface Writer {
  userId: string
  /** may change the look (owner / admin) */
  styles: boolean
}

function isJsonObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Y.AbstractType) && !(v instanceof Y.Doc) && !ArrayBuffer.isView(v)
}

/** The member behind a WebSocket connection (null: the server's own writes). */
function writerOf(origin: unknown): Writer | null {
  if (!isTransactionOrigin(origin) || origin.source !== 'connection') return null
  const ctx = origin.connection.context as { userId?: unknown; role?: unknown } | undefined
  const userId = typeof ctx?.userId === 'string' && ctx.userId ? ctx.userId : null
  if (!userId) return null
  return { userId, styles: ctx?.role === 'owner' || ctx?.role === 'admin' }
}

type Struct = { id: Y.ID; length: number }

/** Watches the shared meta document while it is loaded; returns the function that stops watching. */
export function guardWorkspaceLook(doc: Y.Doc, opts: { workspaceId: string; log: Logger }): () => void {
  const { workspaceId, log } = opts
  const map = doc.getMap<unknown>('workspace')
  const store = doc.store
  /** Who may have written the structs that wait for missing ones (an over-approximation). */
  const pendingFrom = new Map<string, Writer>()
  if (store.pendingStructs) pendingFrom.set(UNVERIFIED, { userId: UNVERIFIED, styles: false })
  const pendingAtStart = new WeakMap<Y.Transaction, Uint8Array>()
  const decoded = new WeakMap<Uint8Array, Struct[]>()

  const wasPending = (tr: Y.Transaction, id: Y.ID): boolean => {
    const update = pendingAtStart.get(tr)
    if (!update) return false
    let structs = decoded.get(update)
    if (!structs) decoded.set(update, (structs = Y.decodeUpdateV2(update).structs))
    return structs.some((s) => s.id.client === id.client && s.id.clock <= id.clock && id.clock < s.id.clock + s.length)
  }

  const beforeTx = (tr: Y.Transaction) => {
    if (store.pendingStructs) pendingAtStart.set(tr, store.pendingStructs.update)
  }
  const afterTx = (tr: Y.Transaction) => {
    const pending = store.pendingStructs
    if (!pending) return pendingFrom.clear()
    if (pending.update !== pendingAtStart.get(tr)) {
      const w = writerOf(tr.origin) ?? { userId: UNVERIFIED, styles: false }
      pendingFrom.set(w.userId, w)
    }
  }

  const onWorkspace = (event: Y.YMapEvent<unknown>, tr: Y.Transaction) => {
    if (tr.origin === GUARD_ORIGIN) return
    const change = event.changes.keys.get(KEY)
    if (!change) return
    const sender = writerOf(tr.origin)
    if (!sender && !pendingAtStart.has(tr)) return
    try {
      const item = map._map.get(KEY)
      const released = !!item && !item.deleted && wasPending(tr, item.id)
      if (!released && !sender) return
      const writers = sender && !released ? [sender] : [...pendingFrom.values()]
      const allowed = writers.length > 0 && writers.every((w) => w.styles)
      if (!allowed) {
        doc.transact(() => {
          if (change.action === 'add') map.delete(KEY)
          else map.set(KEY, change.oldValue)
        }, GUARD_ORIGIN)
        log.warn('workspace look change put back (only owners and admins change it)', { workspace: workspaceId, by: writers.map((w) => w.userId.slice(0, 64)).join(',') })
        return
      }
      if (change.action === 'delete') return
      const value = map.get(KEY)
      if (!isJsonObject(value)) return
      const writer = writers.length === 1 ? writers[0]!.userId : UNVERIFIED
      if (value.updatedBy === writer) return
      doc.transact(() => map.set(KEY, { ...value, updatedBy: writer }), GUARD_ORIGIN)
      log.debug('workspace look change attributed', { workspace: workspaceId, by: writer })
    } catch (err) {
      log.error('workspace look guard failed', { workspace: workspaceId, error: err as Error })
    }
  }

  doc.on('beforeTransaction', beforeTx)
  doc.on('afterTransaction', afterTx)
  map.observe(onWorkspace)
  return () => {
    map.unobserve(onWorkspace)
    doc.off('beforeTransaction', beforeTx)
    doc.off('afterTransaction', afterTx)
  }
}
