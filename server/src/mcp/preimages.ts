/**
 * Pre-images of the team server's MCP writes (MCP plan § 3.6, owner Q9). The server has no approval card and no Undo,
 * so it keeps, per call, what it needs to put the call back: the rows it made (and their values then), the rows it
 * changed (each field before and after), the pages it made, the content fragment of a page before a replace (a Y
 * update of a fresh document holding a detached copy) with the document's state right after the call. Sealed with the
 * workspace key (repo.ts savePreimage), kept 14 days, deleted with the workspace.
 *
 * Restore (owners / admins, Workspace → API "Recent MCP writes"): made pages and rows go to the trash; changed rows get
 * back each field that still holds what the call wrote (a field someone changed since is kept and named); a content
 * document that moved since the call is refused `changed_since` — unless `force`, which puts everything back and lets
 * the later changes go (the dialog says so). Restoring twice is a no-op.
 */
import { createHash } from 'node:crypto'
import * as Y from 'yjs'
import type { Services } from '../context.ts'
import { ApiError, notFound } from '../errors.ts'
import { fragmentText } from '../api/content.ts'
import { type Roots, clone, inTrash, liveDatabase, pageMap, propertiesMap, readPage, roots } from '../api/meta.ts'
import { contentDoc, metaDoc, type WorkspaceModel } from '../api/model.ts'
import { newId } from '../tokens.ts'
import { MCP_LIMITS } from '../../../src/shared/mcp/tables.ts'

type Values = Record<string, unknown>

export type Preimage =
  /** rows a call made (`created`, with the values it wrote) or changed (`updated`, each field before → after) */
  | { kind: 'rows'; db: string; created: Array<{ id: string; title: string; values: Values }>; updated: Array<{ id: string; before: { title?: string; values: Values }; after: { title?: string; values: Values } }> }
  /** pages (or a database) a call made */
  | { kind: 'pages'; created: Array<{ id: string; title: string }> }
  /** a page's content before the call: a Y update of a document holding a copy of its fragment, and its `plain` */
  | { kind: 'content'; page: string; before: string; plain: string }

/** What a tool records for its call (one recorder per call). */
export interface Recorder {
  callId: string
  rows(p: Omit<Extract<Preimage, { kind: 'rows' }>, 'kind'>): void
  pages(created: Array<{ id: string; title: string }>): void
  content(pageId: string, before: string, plain: string, afterHash: string | null): void
}

/** A detached copy of a content document's fragment as a Y update (base64): what a restore writes back. */
export function fragmentSnapshot(doc: Y.Doc): string {
  const copy = new Y.Doc()
  const items = doc.getXmlFragment('default').toArray().map((n) => (n as Y.XmlElement | Y.XmlText).clone())
  if (items.length) copy.getXmlFragment('default').insert(0, items)
  return Buffer.from(Y.encodeStateAsUpdate(copy)).toString('base64')
}

/** The state of a document (its state vector) as a hash: "did it change since?". */
export const stateHash = (doc: Y.Doc) => createHash('sha256').update(Y.encodeStateVector(doc)).digest('hex')

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export interface McpCall {
  callId: string
  tool: string
  token: { id: string; name: string | null }
  at: string
  parts: number
  kinds: string[]
  /** pages, databases and rows the call made */
  made: number
  /** rows it changed and page texts it replaced */
  changed: number
  /** the first titles of what it made or changed (≤ 3; read now, else as the call left them) */
  titles: string[]
  restoredAt: string | null
}

export class McpPreimages {
  private readonly s: Services
  private readonly model: WorkspaceModel

  constructor(s: Services, model: WorkspaceModel) {
    this.s = s
    this.model = model
  }

  /** The recorder of one MCP call (its id is new; nothing is kept until it records). */
  recorder(wsId: string, tokenId: string, tool: string): Recorder {
    const callId = newId()
    const save = (doc: string, p: Preimage, afterHash: string | null = null) => {
      try {
        this.s.repo.savePreimage({ id: newId(), workspaceId: wsId, tokenId, callId, tool, doc, kind: p.kind, data: JSON.stringify(p), afterHash, at: Date.now() })
      } catch (err) {
        // the workspace went meanwhile: nothing to put back
        this.s.log.warn('mcp pre-image not stored', { workspace: wsId, error: (err as Error).message })
      }
    }
    return {
      callId,
      rows: (p) => (p.created.length || p.updated.length ? save(metaDoc(wsId), { kind: 'rows', ...p }) : undefined),
      pages: (created) => (created.length ? save(metaDoc(wsId), { kind: 'pages', created }) : undefined),
      content: (pageId, before, plain, afterHash) => save(contentDoc(wsId, pageId), { kind: 'content', page: pageId, before, plain }, afterHash),
    }
  }

  /** A row's title and raw values (those `ids`), as a pre-image keeps them. */
  static rowState(r: Roots, id: string, ids?: Iterable<string>): { title: string; values: Values } | null {
    const yp = pageMap(r, id)
    if (!yp) return null
    const page = readPage(id, yp)
    const values: Values = {}
    for (const k of ids ?? Object.keys(page.properties)) values[k] = clone(page.properties[k] ?? null)
    return { title: page.title, values }
  }

  /** The newest calls (≤ 100, 14 days), each with what it made / changed and the first titles. */
  async list(wsId: string): Promise<McpCall[]> {
    const since = Date.now() - MCP_LIMITS.preimageDays * 86_400_000
    const calls = this.s.repo.mcpCalls(wsId, since).map((c) => {
      let made = 0
      let changed = 0
      const named: Array<{ id: string; title: string }> = []
      for (const part of this.s.repo.preimagesOf(wsId, c.call_id)) {
        const pre = JSON.parse(part.data) as Preimage
        if (pre.kind === 'pages') {
          made += pre.created.length
          named.push(...pre.created)
        } else if (pre.kind === 'rows') {
          made += pre.created.length
          changed += pre.updated.length
          named.push(...pre.created, ...pre.updated.map((u) => ({ id: u.id, title: u.after.title ?? u.before.title ?? '' })))
        } else {
          changed += 1
          named.push({ id: pre.page, title: '' })
        }
      }
      return { c, made, changed, named: named.slice(0, 3) }
    })
    const live = await this.model.read(wsId, (r) => new Map(calls.flatMap((x) => x.named).map((n) => [n.id, pageMap(r, n.id)?.get('title')] as const)))
    return calls.map(({ c, made, changed, named }) => ({
      callId: c.call_id,
      tool: c.tool,
      token: { id: c.token_id, name: c.token_name },
      at: new Date(c.at).toISOString(),
      parts: c.parts,
      kinds: [...new Set(String(c.kinds ?? '').split(',').filter(Boolean))],
      made,
      changed,
      titles: named.map((n) => { const t = live.get(n.id); return typeof t === 'string' ? t : n.title }),
      restoredAt: c.restored_at ? new Date(c.restored_at).toISOString() : null,
    }))
  }

  /** Put a call back (see the head comment). `actor`: the owner / admin who asked. */
  async restore(wsId: string, callId: string, force: boolean, actor: string) {
    const parts = this.s.repo.preimagesOf(wsId, callId)
    if (!parts.length) throw notFound('call_not_found', 'No MCP call with this id (kept 14 days)')
    if (parts.some((p) => p.restored_at)) return { callId, restored: 0, kept: [] as Array<{ id: string; title: string; fields?: string[] }>, note: 'This call was put back already.' }
    const items = parts.map((p) => ({ ...p, pre: JSON.parse(p.data) as Preimage }))
    // content first: a document that moved since the call is refused unless forced (nothing written yet)
    const contents = items.filter((p) => p.pre.kind === 'content')
    if (!force) {
      const moved: string[] = []
      for (const p of contents) {
        const now = await this.s.collab.read(p.doc, (doc) => stateHash(doc))
        if (p.after_hash && now !== p.after_hash) moved.push((p.pre as Extract<Preimage, { kind: 'content' }>).page)
      }
      if (moved.length) {
        const titles = await this.model.read(wsId, (r) => moved.map((id) => String(pageMap(r, id)?.get('title') ?? id)))
        throw new ApiError(409, 'changed_since', `Changed since this call: ${titles.map((t) => JSON.stringify(t)).join(', ')}. Restore with force to put it back anyway (the later changes go).`, { details: { pages: moved } })
      }
    }
    let restored = 0
    const kept: Array<{ id: string; title: string; fields?: string[] }> = []
    for (const p of contents) {
      const pre = p.pre as Extract<Preimage, { kind: 'content' }>
      const update = Buffer.from(pre.before, 'base64')
      const plain = await this.s.collab.write(
        p.doc,
        (doc) => {
          const source = new Y.Doc()
          Y.applyUpdate(source, update)
          const frag = doc.getXmlFragment('default')
          if (frag.length) frag.delete(0, frag.length)
          const back = source.getXmlFragment('default').toArray().map((n) => (n as Y.XmlElement | Y.XmlText).clone())
          if (back.length) frag.insert(0, back)
          return fragmentText(doc, 20_000)
        },
        actor,
      )
      await this.s.collab.write(
        metaDoc(wsId),
        (doc) => {
          const yp = pageMap(roots(doc), pre.page)
          if (!yp) return
          yp.set('plain', plain)
          yp.set('updatedAt', Date.now())
          yp.set('updatedBy', actor)
        },
        actor,
      )
      restored += 1
    }
    // rows and pages: one meta transaction; made pages first, so a row of a database the call made goes along with it
    // (in its trash, as in One) instead of being trashed on its own
    const meta = items
      .filter((p) => p.pre.kind !== 'content')
      .map((p) => p.pre)
      .sort((a, b) => Number(b.kind === 'pages') - Number(a.kind === 'pages'))
    if (meta.length) {
      const out = await this.s.collab.write(
        metaDoc(wsId),
        (doc) => {
          const r = roots(doc)
          const at = Date.now()
          let n = 0
          const keep: typeof kept = []
          const trash = (id: string, matches: boolean, title: string) => {
            const yp = pageMap(r, id)
            if (!yp || inTrash(r, id)) return
            if (!matches && !force) return void keep.push({ id, title })
            yp.set('trashed', true)
            yp.set('trashedAt', at)
            yp.set('updatedAt', at)
            yp.set('updatedBy', actor)
            n += 1
          }
          for (const pre of meta) {
            if (pre.kind === 'rows') {
              // a kept field is named as people see it (its property's name now)
              const props = liveDatabase(r, pre.db)?.properties ?? []
              const nameOf = (k: string) => props.find((p) => p.id === k)?.name ?? k
              const titleName = props.find((p) => p.type === 'title')?.name ?? 'title'
              for (const c of pre.updated) {
                const yp = pageMap(r, c.id)
                if (!yp) continue
                const now = McpPreimages.rowState(r, c.id, Object.keys(c.after.values))!
                const changed: string[] = []
                const pm = propertiesMap(yp)
                for (const [k, after] of Object.entries(c.after.values)) {
                  if (!same(now.values[k], after) && !force) {
                    changed.push(nameOf(k))
                    continue
                  }
                  const before = c.before.values[k]
                  if (before === null || before === undefined) pm.delete(k)
                  else pm.set(k, clone(before))
                }
                if (c.after.title !== undefined && c.before.title !== undefined) {
                  if (now.title === c.after.title || force) yp.set('title', c.before.title)
                  else changed.push(titleName)
                }
                yp.set('updatedAt', at)
                yp.set('updatedBy', actor)
                if (changed.length) keep.push({ id: c.id, title: now.title, fields: changed })
                n += 1
              }
              for (const c of pre.created) {
                const now = McpPreimages.rowState(r, c.id, Object.keys(c.values))
                if (!now) continue
                trash(c.id, now.title === c.title && Object.entries(c.values).every(([k, v]) => same(now.values[k], v)), now.title)
              }
            } else if (pre.kind === 'pages') {
              // made pages: the newest first (a page made under another of the same call goes with it anyway)
              for (const c of [...pre.created].reverse()) {
                const yp = pageMap(r, c.id)
                if (!yp) continue
                trash(c.id, String(yp.get('title') ?? '') === c.title, String(yp.get('title') ?? ''))
              }
            }
          }
          return { n, keep }
        },
        actor,
      )
      restored += out.n
      kept.push(...out.keep)
    }
    // what was kept can still be put back with force; a call put back whole is done
    if (!kept.length) this.s.repo.markPreimagesRestored(wsId, callId, Date.now())
    this.s.log.info('mcp call restored', { workspace: wsId, call: callId, restored, kept: kept.length, force, by: actor })
    return { callId, restored, kept, ...(kept.length ? { note: 'Some things were changed since this call and were left as they are (restore with force to put them back too).' } : {}) }
  }
}
