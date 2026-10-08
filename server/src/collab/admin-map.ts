/**
 * Keys of the shared meta document that only owners and admins change (docs/CLOUD.md § Meta document schema): the
 * workspace look (`workspace.look`, workspace-look.ts) and the integration profiles (every key of the `integrations`
 * map). The app refuses for everyone else and its binding puts their store change back, but a member's client could
 * still write the meta document directly — so the server says what holds:
 *
 *  - a change of a guarded key from a connection whose member is not owner or admin NOW (the role is looked up for
 *    every change, never taken from the connection's start: a demoted admin's open socket loses the right at once)
 *    is put back (the value before it, or no key) in one transaction with the server's own origin, written right
 *    after the member's;
 *  - an owner's or admin's change gets `updatedBy` = their account id, whatever the client wrote there (the
 *    "SET BY …" read-outs cannot be forged);
 *  - a change carried by structs that waited for missing ones (Yjs "pending" structs, applied in a later
 *    transaction) counts only when every member whose update left structs waiting may change it — otherwise it is
 *    put back (structs from the stored state count as unverified);
 *  - the same for deletes that waited for structs not there yet (Yjs "pending" delete sets: a member can plant
 *    one for clocks the server or an admin will write next, and it is replayed inside a later update of
 *    someone else): a value removed that way counts as removed by every member whose update left deletes
 *    waiting (and the sender). Not allowed → the value is put back — the admin's new value when it was theirs —
 *    and the waiting deletes are dropped (they would hit the put-back again).
 *
 * Every reader sanitizes the values (the app's store/look.ts, store/integrations.ts; the server's
 * agents/integrations.ts); the guard does not judge them. Its own writes are left alone; corrections are never
 * corrected again (no loop).
 */
import { isTransactionOrigin, type LocalTransactionOrigin } from '@hocuspocus/server'
import * as Y from 'yjs'
import type { Logger } from '../log.ts'

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

const admin = (role: unknown) => role === 'owner' || role === 'admin'

type Struct = { id: Y.ID; length: number }
type DeleteRanges = Map<number, Array<{ clock: number; len: number }>>

export interface AdminKeysOptions {
  workspaceId: string
  log: Logger
  /** the member's current role in this workspace (the repo); without it the connection's role counts */
  roleOf?: (userId: string) => unknown
  /** the meta document's map */
  map: string
  /** only this key of the map (absent: every key) */
  key?: string
  /** what is guarded, for the log ("workspace look", "integration profile") */
  what: string
}

/** Watches the shared meta document while it is loaded; returns the function that stops watching. */
export function guardAdminKeys(doc: Y.Doc, opts: AdminKeysOptions): () => void {
  const { workspaceId, log, roleOf, what } = opts
  const origin: LocalTransactionOrigin = { source: 'local', context: { actor: `server:admin-map:${opts.map}` } }
  const map = doc.getMap<unknown>(opts.map)
  const store = doc.store
  const guarded = (key: string) => opts.key === undefined || key === opts.key
  /** May this writer change it — now? */
  const mayWrite = (w: Writer) => w.userId !== UNVERIFIED && admin(roleOf ? roleOf(w.userId) : w.role)

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

  const onMap = (event: Y.YMapEvent<unknown>, tr: Y.Transaction) => {
    if (tr.origin === origin) return
    const sender = writerOf(tr.origin)
    if (!sender && !pendingAtStart.has(tr) && !pendingDsAtStart.has(tr)) return
    /** what to write back (undefined: remove the key) */
    const fixes: Array<{ key: string; value: unknown }> = []
    let dropWaitingDeletes = false
    for (const [key, change] of event.changes.keys) {
      if (!guarded(key)) continue
      try {
        const item = map._map.get(key) ?? null
        const added = !!item && event.adds(item)
        const removed = !!item && item.deleted
        // the key's current item came out of structs that waited for missing ones
        const released = added && wasPending(tr, item.id)
        // … or was removed by deletes that waited for it
        const dropped = removed && wasPendingDelete(tr, item.id)
        if (!released && !dropped && !sender) continue

        /** who put the current item there in this transaction (none: it was there before) */
        const adders: Writer[] = !added ? [] : released ? [...pendingFrom.values()] : sender ? [sender] : [UNKNOWN]
        /** who removed it in this transaction */
        const removers: Writer[] = !removed ? [] : [...(dropped ? pendingDsFrom.values() : []), ...(sender ? [sender] : dropped ? [] : [UNKNOWN])]
        const writers = removed ? removers : adders
        const allowed = writers.length > 0 && writers.every(mayWrite)
        if (!allowed) {
          // an admin's new value that only waiting deletes took away comes back as theirs; else the value before
          const keepNew = removed && added && adders.length > 0 && adders.every(mayWrite)
          fixes.push({ key, value: keepNew ? stamped(lastOf(item), adders) : change.oldValue })
          // planted deletes would take the put-back value away again with the next update
          if (dropped) dropWaitingDeletes = true
          log.warn(`${what} change put back (only owners and admins change it)`, { workspace: workspaceId, key: key.slice(0, 64), by: writers.map((w) => w.userId.slice(0, 64)).join(',') })
          continue
        }
        if (removed) continue
        const value = map.get(key)
        if (!isJsonObject(value)) continue
        const writer = writers.length === 1 ? writers[0]!.userId : UNVERIFIED
        if (value.updatedBy === writer) continue
        fixes.push({ key, value: { ...value, updatedBy: writer } })
        log.debug(`${what} change attributed`, { workspace: workspaceId, key: key.slice(0, 64), by: writer })
      } catch (err) {
        log.error(`${what} guard failed`, { workspace: workspaceId, error: err as Error })
      }
    }
    if (dropWaitingDeletes) {
      store.pendingDs = null
      pendingDsFrom.clear()
    }
    if (!fixes.length) return
    doc.transact(() => {
      for (const { key, value } of fixes) {
        if (value === undefined) map.delete(key)
        else map.set(key, value)
      }
    }, origin)
  }

  doc.on('beforeTransaction', beforeTx)
  doc.on('afterTransaction', afterTx)
  map.observe(onMap)
  return () => {
    map.unobserve(onMap)
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
