/**
 * The workspace look (docs/CLOUD.md § Meta document schema → workspace.look; app: Workspace → Look, lib/look):
 * only owners and admins change it. The app refuses for everyone else and its binding puts their store change
 * back, but a member's client could still write the meta document's `workspace` map directly — so the server
 * says what holds:
 *
 *  - a change of the key `look` from a connection whose member is not owner or admin NOW (the role is looked up
 *    for every change, never taken from the connection's start: a demoted admin's open socket loses the right at
 *    once) is put back (the value before it, or no key) in one transaction with the server's own origin, written
 *    right after the member's;
 *  - an owner's or admin's change gets `updatedBy` = their account id, whatever the client wrote there (the
 *    "SET BY …" read-out cannot be forged);
 *  - a change carried by structs that waited for missing ones (Yjs "pending" structs, applied in a later
 *    transaction) counts only when every member whose update left structs waiting may change the look —
 *    otherwise it is put back (structs from the stored state count as unverified);
 *  - the same for deletes that waited for structs not there yet (Yjs "pending" delete sets: a member can plant
 *    one for clocks the server or an admin will write next, and it is replayed inside a later update of
 *    someone else): a look removed that way counts as removed by every member whose update left deletes
 *    waiting (and the sender). Not allowed → the look is put back — the admin's new value when it was theirs —
 *    and the waiting deletes are dropped (they would hit the put-back again).
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
  /** the role the connection started with (used only without a live role lookup) */
  role: unknown
}
const UNKNOWN: Writer = { userId: UNVERIFIED, role: null }

function isJsonObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Y.AbstractType) && !(v instanceof Y.Doc) && !ArrayBuffer.isView(v)
}

/** The member behind a WebSocket connection (null: the server's own writes). */
function writerOf(origin: unknown): Writer | null {
  if (!isTransactionOrigin(origin) || origin.source !== 'connection') return null
  const ctx = origin.connection.context as { userId?: unknown; role?: unknown } | undefined
  const userId = typeof ctx?.userId === 'string' && ctx.userId ? ctx.userId : null
  if (!userId) return null
  return { userId, role: ctx?.role }
}

const styler = (role: unknown) => role === 'owner' || role === 'admin'

type Struct = { id: Y.ID; length: number }
type DeleteRanges = Map<number, Array<{ clock: number; len: number }>>

/**
 * Watches the shared meta document while it is loaded; returns the function that stops watching.
 * `roleOf` = the member's current role in this workspace (the repo); without it the connection's role counts.
 */
export function guardWorkspaceLook(doc: Y.Doc, opts: { workspaceId: string; log: Logger; roleOf?: (userId: string) => unknown }): () => void {
  const { workspaceId, log, roleOf } = opts
  const map = doc.getMap<unknown>('workspace')
  const store = doc.store
  /** May this writer change the look — now? */
  const mayStyle = (w: Writer) => w.userId !== UNVERIFIED && styler(roleOf ? roleOf(w.userId) : w.role)

  /** Who may have written the structs that wait for missing ones (an over-approximation). */
  const pendingFrom = new Map<string, Writer>()
  if (store.pendingStructs) pendingFrom.set(UNVERIFIED, UNKNOWN)
  /** Who may have written the deletes that wait for missing structs (an over-approximation). */
  const pendingDsFrom = new Map<string, Writer>()
  if (store.pendingDs) pendingDsFrom.set(UNVERIFIED, UNKNOWN)
  const pendingAtStart = new WeakMap<Y.Transaction, Uint8Array>()
  const pendingDsAtStart = new WeakMap<Y.Transaction, Uint8Array>()
  const decoded = new WeakMap<Uint8Array, Struct[]>()
  const decodedDs = new WeakMap<Uint8Array, DeleteRanges>()

  const wasPending = (tr: Y.Transaction, id: Y.ID): boolean => {
    const update = pendingAtStart.get(tr)
    if (!update) return false
    let structs = decoded.get(update)
    if (!structs) decoded.set(update, (structs = Y.decodeUpdateV2(update).structs))
    return structs.some((s) => s.id.client === id.client && s.id.clock <= id.clock && id.clock < s.id.clock + s.length)
  }
  /** Did deletes that were waiting when the transaction started name this struct? */
  const wasPendingDelete = (tr: Y.Transaction, id: Y.ID): boolean => {
    const update = pendingDsAtStart.get(tr)
    if (!update) return false
    let ranges = decodedDs.get(update)
    if (!ranges) decodedDs.set(update, (ranges = Y.decodeUpdateV2(update).ds.clients as DeleteRanges))
    return (ranges.get(id.client) ?? []).some((d) => d.clock <= id.clock && id.clock < d.clock + d.len)
  }

  const beforeTx = (tr: Y.Transaction) => {
    if (store.pendingStructs) pendingAtStart.set(tr, store.pendingStructs.update)
    if (store.pendingDs) pendingDsAtStart.set(tr, store.pendingDs)
  }
  const afterTx = (tr: Y.Transaction) => {
    const pending = store.pendingStructs
    if (!pending) pendingFrom.clear()
    else if (pending.update !== pendingAtStart.get(tr)) {
      const w = writerOf(tr.origin) ?? UNKNOWN
      pendingFrom.set(w.userId, w)
    }
    const ds = store.pendingDs
    if (!ds) pendingDsFrom.clear()
    else if (ds !== pendingDsAtStart.get(tr)) {
      const w = writerOf(tr.origin) ?? UNKNOWN
      pendingDsFrom.set(w.userId, w)
    }
  }

  const onWorkspace = (event: Y.YMapEvent<unknown>, tr: Y.Transaction) => {
    if (tr.origin === GUARD_ORIGIN) return
    const change = event.changes.keys.get(KEY)
    if (!change) return
    const sender = writerOf(tr.origin)
    if (!sender && !pendingAtStart.has(tr) && !pendingDsAtStart.has(tr)) return
    try {
      const item = map._map.get(KEY) ?? null
      const added = !!item && event.adds(item)
      const removed = !!item && item.deleted
      // the key's current item came out of structs that waited for missing ones
      const released = added && wasPending(tr, item.id)
      // … or was removed by deletes that waited for it
      const dropped = removed && wasPendingDelete(tr, item.id)
      if (!released && !dropped && !sender) return

      /** who put the current item there in this transaction (none: it was there before) */
      const adders: Writer[] = !added ? [] : released ? [...pendingFrom.values()] : sender ? [sender] : [UNKNOWN]
      /** who removed it in this transaction */
      const removers: Writer[] = !removed ? [] : [...(dropped ? pendingDsFrom.values() : []), ...(sender ? [sender] : dropped ? [] : [UNKNOWN])]
      const writers = removed ? removers : adders
      const allowed = writers.length > 0 && writers.every(mayStyle)
      if (!allowed) {
        // an admin's new value that only waiting deletes took away comes back as theirs; else the value before
        const keepNew = removed && added && adders.length > 0 && adders.every(mayStyle)
        const back: unknown = keepNew ? stamped(lastOf(item), adders) : change.oldValue
        // planted deletes would take the put-back value away again with the next update
        if (dropped) {
          store.pendingDs = null
          pendingDsFrom.clear()
        }
        doc.transact(() => {
          if (back === undefined) map.delete(KEY)
          else map.set(KEY, back)
        }, GUARD_ORIGIN)
        log.warn('workspace look change put back (only owners and admins change it)', { workspace: workspaceId, by: writers.map((w) => w.userId.slice(0, 64)).join(',') })
        return
      }
      if (removed) return
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

/** The value an item held (its content is still there while the transaction's observers run). */
function lastOf(item: Y.Item): unknown {
  const content = item.content.getContent()
  return content[content.length - 1]
}

/** `updatedBy` = the one writer (or unverified), as for an accepted change. */
function stamped(value: unknown, writers: Writer[]): unknown {
  if (!isJsonObject(value)) return value
  return { ...value, updatedBy: writers.length === 1 ? writers[0]!.userId : UNVERIFIED }
}
