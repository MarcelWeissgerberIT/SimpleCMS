/**
 * Who changed a custom agent (docs/CLOUD.md § Agents → Who changed an agent). A team browser agent
 * runs in its creator's browser — with their Claude key, MCP servers and named private pages — only
 * while its last change is the creator's (`updatedBy` = `createdBy`, app: features/agents/confirm.ts).
 * So the server, not the client, says who wrote an entry of the meta document's `agents` map:
 *
 *  - every agent entry a member's connection adds or changes gets `updatedBy` = that member's account
 *    id, whatever the client wrote there (a rewrite that leaves the entry exactly as it was is no change);
 *  - `createdBy` stays what it was once set: changed by anyone but that creator, it is put back;
 *  - a change carried by structs that waited for missing ones (Yjs "pending" structs: they are applied
 *    in a later transaction, possibly another member's) is attributed to the members whose updates left
 *    structs waiting — never to the creator while someone else may have written it (`@unverified` when
 *    those structs came from the stored state).
 *
 * The correction is one transaction with the server's own origin, written right after the member's
 * (same tick, so clients receive both together); it is never corrected again (no loop). The server's
 * own writes (public API, webhooks, the agent runner) keep their attribution. Values that are not JSON
 * objects are not agents for any reader (the app's and the server's sanitizers) and are left alone.
 */
import { isTransactionOrigin, type LocalTransactionOrigin } from '@hocuspocus/server'
import * as Y from 'yjs'
import type { Logger } from '../log.ts'

/** `updatedBy` of a change whose writer cannot be told (structs that came back from the stored state). */
export const UNVERIFIED = '@unverified'

/** The server's corrections: a local origin (stored and broadcast like any change), never stamped again. */
const STAMP_ORIGIN: LocalTransactionOrigin = { source: 'local', context: { actor: 'server:agent-authors' } }

const MAX_DEPTH = 32

/** A JSON object as the app stores an agent (decoded from the update — not a Y type, array or binary). */
function isJsonObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Y.AbstractType) && !(v instanceof Y.Doc) && !ArrayBuffer.isView(v)
}

/** Deep equality of two decoded JSON values (key order does not matter; too deep counts as different). */
function sameJson(a: unknown, b: unknown, depth = 0): boolean {
  if (a === b) return true
  if (depth > MAX_DEPTH || !a || !b || typeof a !== 'object' || typeof b !== 'object' || ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => sameJson(x, b[i], depth + 1))
  }
  const ka = Object.keys(a)
  const ob = b as Record<string, unknown>
  if (ka.length !== Object.keys(ob).length) return false
  return ka.every((k) => Object.prototype.hasOwnProperty.call(ob, k) && sameJson((a as Record<string, unknown>)[k], ob[k], depth + 1))
}

/** createdBy / updatedBy as stored: a non-empty string (else null). */
const actorOf = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

/** The account behind a member's WebSocket connection (null: the server's own writes). */
function accountOf(origin: unknown): string | null {
  if (!isTransactionOrigin(origin) || origin.source !== 'connection') return null
  return actorOf((origin.connection.context as { userId?: unknown } | undefined)?.userId)
}

type Struct = { id: Y.ID; length: number }

/**
 * Watches one shared meta document while it is loaded; returns the function that stops watching.
 * Call it right after the stored state was applied (Hocuspocus `afterLoadDocument`).
 */
export function guardAgentAuthors(doc: Y.Doc, opts: { workspaceId: string; log: Logger }): () => void {
  const { workspaceId, log } = opts
  const agents = doc.getMap<unknown>('agents')
  const store = doc.store
  /** Who may have written the structs that wait for missing ones (an over-approximation). */
  const pendingFrom = new Set<string>()
  if (store.pendingStructs) pendingFrom.add(UNVERIFIED)
  /** The waiting structs when a transaction started (those it applies are not its sender's own). */
  const pendingAtStart = new WeakMap<Y.Transaction, Uint8Array>()
  /** Decoded waiting structs, per pending update (it stays the same object until structs are added). */
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
    // this transaction left (other) structs waiting: its sender may have written them
    if (pending.update !== pendingAtStart.get(tr)) pendingFrom.add(accountOf(tr.origin) ?? UNVERIFIED)
  }

  const onAgents = (event: Y.YMapEvent<unknown>, tr: Y.Transaction) => {
    // corrections are never corrected again (no loop)
    if (tr.origin === STAMP_ORIGIN) return
    // a member's connection — else the server's own write, which keeps its attribution (unless it
    // released waiting structs: those are looked at whoever applied them)
    const sender = accountOf(tr.origin)
    if (!sender && !pendingAtStart.has(tr)) return
    try {
      const fixes: Array<[string, Record<string, unknown>]> = []
      for (const [key, change] of event.changes.keys) {
        if (change.action === 'delete') continue
        const value = agents.get(key)
        if (!isJsonObject(value)) continue
        const before = change.action === 'update' && isJsonObject(change.oldValue) ? change.oldValue : null
        // written again exactly as it was: nothing changed, the last writer stays
        if (before && sameJson(before, value)) continue
        const item = agents._map.get(key)
        const released = !!item && wasPending(tr, item.id)
        if (!released && !sender) continue
        const writers = sender && !released ? [sender] : [...pendingFrom]
        if (!writers.length) writers.push(UNVERIFIED)
        const creator = before ? actorOf(before.createdBy) : null
        // only the creator themself may hand an agent over (their successor confirms before it runs)
        const restore = creator !== null && value.createdBy !== creator && !(writers.length === 1 && writers[0] === creator)
        const createdBy = restore ? creator : actorOf(value.createdBy)
        // several possible writers: never the creator (the agent waits for them to confirm it)
        const writer = writers.length === 1 ? writers[0]! : (writers.find((w) => w !== createdBy) ?? writers[0]!)
        if (!restore && value.updatedBy === writer) continue
        fixes.push([key, { ...value, ...(restore ? { createdBy } : {}), updatedBy: writer }])
        // audit: who claimed what (ids only, never content); `@…` markers are the app's "not known yet"
        const claimed = actorOf(value.updatedBy)
        const fields = { workspace: workspaceId, agent: key.slice(0, 64), by: writer, claimed: claimed?.slice(0, 128), createdBy: restore ? 'restored' : undefined }
        if (restore || (claimed !== null && claimed !== writer && !claimed.startsWith('@'))) log.warn('agent change attributed to its real writer', fields)
        else log.debug('agent change attributed', fields)
      }
      if (fixes.length) doc.transact(() => fixes.forEach(([key, v]) => agents.set(key, v)), STAMP_ORIGIN)
    } catch (err) {
      log.error('agent attribution failed', { workspace: workspaceId, error: err as Error })
    }
  }

  doc.on('beforeTransaction', beforeTx)
  doc.on('afterTransaction', afterTx)
  agents.observe(onAgents)
  return () => {
    agents.unobserve(onAgents)
    doc.off('beforeTransaction', beforeTx)
    doc.off('afterTransaction', afterTx)
  }
}
