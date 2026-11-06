/** Last synchronising account per block, plus section-scoped contributions from this deployment onwards.
 * The server compares content, so selection, ID normalisation and view settings don't count.
 * Client writes to the stamp map are restored; attribution comes from the authenticated socket.
 * Pending CRDT structs are deliberately unknown rather than credited to the releasing socket.
 */
import { isTransactionOrigin, type LocalTransactionOrigin } from '@hocuspocus/server'
import * as Y from 'yjs'
import { createHash, randomUUID } from 'node:crypto'
import { BLOCK_CHANGES, PAGE_AREA, isBlockChange, type BlockChange, type BlockContent } from '../../../src/shared/blockChanges.ts'
import { blockContent } from './block-content.ts'

export const BLOCK_AUTHORS = 'blockEditorsV1'
const ORIGIN: LocalTransactionOrigin = { source: 'local', context: { actor: 'server:block-authors' } }
type Stamp = { actor: string; at: number }
type Block = { id: string | null; hash: string; area: string; json: BlockContent }

function serial(node: Y.XmlElement | Y.XmlText): unknown {
  if (node instanceof Y.XmlText) return node.toDelta()
  const attrs = Object.fromEntries(Object.entries(node.getAttributes()).filter(([key, value]) => key !== 'id' && value != null).sort(([a], [b]) => a.localeCompare(b)))
  return [node.nodeName, attrs, node.toArray().map(n => serial(n as Y.XmlElement | Y.XmlText))]
}
function blocks(doc: Y.Doc): Block[] {
  let area = PAGE_AREA
  return doc.getXmlFragment('default').toArray().filter((n): n is Y.XmlElement => n instanceof Y.XmlElement).map(n => {
    const id = typeof n.getAttribute('id') === 'string' ? n.getAttribute('id')! : null
    if (n.nodeName === 'heading' && id) area = id
    return { id, area, json: blockContent(n), hash: createHash('sha256').update(JSON.stringify(serial(n))).digest('hex') }
  })
}

export function guardBlockAuthors(doc: Y.Doc, opts: { history?: boolean } = {}): () => void {
  const map = doc.getMap<Stamp>(BLOCK_AUTHORS)
  const changes = doc.getMap<BlockChange>(BLOCK_CHANGES)
  const acceptedChanges = new Map<string, BlockChange>()
  const heads = new Map<string, BlockChange>()
  if (opts.history !== false) for (const [id, value] of changes) {
    if (!isBlockChange(value) || value.id !== id) continue
    acceptedChanges.set(id, value)
    if ((heads.get(value.block)?.seq ?? 0) < value.seq) heads.set(value.block, value)
  }
  let previous = blocks(doc)
  const accepted = new Map<string, Stamp>()
  for (const [id, v] of map) if (v && typeof v.actor === 'string' && Number.isFinite(v.at)) accepted.set(id, v)
  const pending = new WeakSet<Y.Transaction>()
  const before = (tr: Y.Transaction) => { if (doc.store.pendingStructs || doc.store.pendingDs) pending.add(tr) }
  const after = (tr: Y.Transaction) => {
    if (tr.origin === ORIGIN) return
    const next = blocks(doc)
    const byId = new Map(previous.filter(b => b.id).map(b => [b.id, b]))
    const origin = tr.origin
    const actor = isTransactionOrigin(origin)
      ? origin.source === 'connection'
        ? (origin.connection.context as { userId?: string }).userId
        : origin.source === 'local' ? (origin.context as { actor?: string } | undefined)?.actor : undefined
      : undefined
    const at = Date.now()
    const writer = pending.has(tr) || !actor ? '@unverified' : actor
    const record = (old: Block | undefined, next: Block | undefined) => {
      if (opts.history === false) return
      const block = next?.id ?? old?.id
      if (!block) return
      const area = next?.area ?? old!.area
      const head = heads.get(block)
      // Consecutive writes by one account in this section are ONE contribution, not one per keystroke.
      // Another account (including an unknown one) starts a new contribution: never credit their text to this writer.
      const merge = head && head.actor === writer && head.area === area
      const change: BlockChange = {
        id: merge ? head.id : randomUUID(), block, area, actor: writer,
        seq: merge ? head.seq : (head?.seq ?? 0) + 1, from: merge ? head.from : at, at,
        before: merge ? head.before : old?.json ?? null, after: next?.json ?? null,
      }
      acceptedChanges.set(change.id, change)
      heads.set(block, change)
    }
    const counts = new Map<string, number>()
    for (const b of next) if (b.id) counts.set(b.id, (counts.get(b.id) ?? 0) + 1)
    for (const [i, b] of next.entries()) {
      if (!b.id || counts.get(b.id) !== 1) continue
      const old = byId.get(b.id)
      // Merely attaching IDs to existing content is not an authorship claim.
      const same = old?.hash === b.hash || (!old && !previous[i]?.id && previous[i]?.hash === b.hash)
      if (!same) {
        accepted.set(b.id, { actor: writer, at })
        record(old, b)
      }
    }
    for (const [id, old] of byId) if (id && !counts.has(id)) record(old, undefined)
    for (const id of accepted.keys()) if (!counts.has(id) || counts.get(id) !== 1) accepted.delete(id)
    previous = next
    doc.transact(() => {
      if (opts.history !== false) {
        for (const id of changes.keys()) if (!acceptedChanges.has(id)) changes.delete(id)
        for (const [id, change] of acceptedChanges) if (changes.get(id) !== change) changes.set(id, change)
      }
      for (const id of map.keys()) if (!accepted.has(id)) map.delete(id)
      for (const [id, stamp] of accepted) {
        const v = map.get(id)
        if (!v || v.actor !== stamp.actor || v.at !== stamp.at || Object.keys(v).length !== 2) map.set(id, stamp)
      }
    }, ORIGIN)
  }
  doc.on('beforeTransaction', before)
  doc.on('afterTransaction', after)
  return () => { doc.off('beforeTransaction', before); doc.off('afterTransaction', after) }
}
