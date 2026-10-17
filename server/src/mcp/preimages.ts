/**
 * Pre-images of the team server's MCP writes (MCP plan § 3.6, owner Q9). The server has no approval card and no Undo,
 * so it keeps, per call, what it needs to put the call back: the rows it made (and their values then), the rows it
 * changed (each field before and after — only the fields the call wrote), the pages it made, the content fragment of a
 * page before a replace (a Y update of a fresh document holding a detached copy) with the document's state right after
 * the call — and for every page or row it made, the state of its own text right after the call. Sealed with the
 * workspace key (repo.ts savePreimage), kept 14 days, deleted with the workspace.
 *
 * Restore (owners / admins, Workspace → API "Recent MCP writes") puts back only what nobody changed since — the bridge's
 * Undo rule (spec § 3.6):
 *  - a made page or row goes to the trash while it is as the call left it: its title (and a row's values), its text
 *    (the state hash), and nothing below it but what the call made (a sub-page someone added, a row the team put into a
 *    database the call made, a row of the call that changed). Else it stays and is named in `kept`;
 *  - a changed row gets back each field that still holds what the call wrote (a field someone changed since is kept and
 *    named); relation values go back as a write puts them (two-way partners in step — putValues);
 *  - a content document that moved since the call is refused `changed_since` (nothing is written).
 * `force` puts back what was kept too (the dialog says the later changes go). Each part — and inside one, each thing — is
 * put back once: a later Restore (with or without force) touches only what is left (`done`), never what an earlier one
 * put back (its own write is no "change since"), and a call whose every part is back is done.
 */
import * as Y from 'yjs'
import type { Services } from '../context.ts'
import { ApiError, notFound } from '../errors.ts'
import { fragmentText } from '../api/content.ts'
import { createHash } from 'node:crypto'
import { type Roots, clone, databaseMap, inTrash, liveDatabase, pageMap, propertiesMap, readPage, roots } from '../api/meta.ts'
import { contentDoc, metaDoc, type WorkspaceModel } from '../api/model.ts'
import { newId } from '../tokens.ts'
import { docStateHash } from './pageRead.ts'
import { forgetCall } from './duplicates.ts'
import { MCP_LIMITS } from '../../../src/shared/mcp/tables.ts'

type Values = Record<string, unknown>

/**
 * A page, row or database a call made, as the call left it: its title, its text's state (`hash`) and `mark` — what else
 * people change on it (markOf: icon, cover, comment threads; a database's properties and views). Pre-images stored
 * before `mark` existed have none (that check is left out for them).
 */
export interface Made {
  id: string
  title: string
  hash?: string
  mark?: string
}

export type Preimage =
  /** rows a call made (`created`, with the values it wrote and its text's state then) or changed (`updated`, the fields it wrote: before → after) */
  | { kind: 'rows'; db: string; created: Array<Made & { values: Values }>; updated: Array<{ id: string; before: { title?: string; values: Values }; after: { title?: string; values: Values } }> }
  /** pages (or a database) a call made, each with its text's state right after the call */
  | { kind: 'pages'; created: Made[] }
  /** a page's content before the call: a Y update of a document holding a copy of its fragment, and its `plain` */
  | { kind: 'content'; page: string; before: string; plain: string }

/** A part as kept: its pre-image, the repeat key of its call, and what an earlier Restore put back already (keysOf). */
type Stored = Preimage & { dup?: string; done?: string[] }

/** What a tool records for its call (one recorder per call). */
export interface Recorder {
  callId: string
  rows(p: Omit<Extract<Preimage, { kind: 'rows' }>, 'kind'>): void
  pages(created: Made[]): void
  content(pageId: string, before: string, plain: string, afterHash: string | null): void
}

/** The things of a part a Restore puts back one by one: `p:<page>`, `c:<made row>`, `u:<row>:<field>` (`#title`). */
function keysOf(pre: Preimage): string[] {
  if (pre.kind === 'pages') return pre.created.map((c) => `p:${c.id}`)
  if (pre.kind === 'rows')
    return [
      ...pre.created.map((c) => `c:${c.id}`),
      ...pre.updated.flatMap((u) => [...Object.keys(u.after.values).map((k) => `u:${u.id}:${k}`), ...(u.after.title !== undefined && u.before.title !== undefined ? [`u:${u.id}:#title`] : [])]),
    ]
  return []
}

/**
 * Row values put back as a write puts them (an MCP Restore, a failed call's rollback): stored values (null → none), and
 * each two-way relation's partner rows kept in step (model.ts syncPartners) — never a one-sided link.
 */
export function putValues(model: WorkspaceModel, r: Roots, rowId: string, values: Values, actor: string, at: number): void {
  const yp = pageMap(r, rowId)
  if (!yp) return
  const pm = propertiesMap(yp)
  const dbId = typeof yp.get('databaseId') === 'string' ? (yp.get('databaseId') as string) : null
  const props = dbId ? (liveDatabase(r, dbId)?.properties ?? []) : []
  const was: Values = {}
  const relations: Values = {}
  for (const [k, v] of Object.entries(values)) {
    was[k] = clone(pm.get(k) ?? null)
    if (v === null || v === undefined) pm.delete(k)
    else pm.set(k, clone(v))
    if (props.find((p) => p.id === k)?.type === 'relation') relations[k] = Array.isArray(v) ? v : []
  }
  if (dbId && Object.keys(relations).length) model.syncPartners(r, dbId, props, rowId, was, relations, actor, at)
}

/** A detached copy of a content document's fragment as a Y update (base64): what a restore writes back. */
export function fragmentSnapshot(doc: Y.Doc): string {
  const copy = new Y.Doc()
  const items = doc.getXmlFragment('default').toArray().map((n) => (n as Y.XmlElement | Y.XmlText).clone())
  if (items.length) copy.getXmlFragment('default').insert(0, items)
  return Buffer.from(Y.encodeStateAsUpdate(copy)).toString('base64')
}

/** The state of a document as a hash (state vector + delete set, pageRead.ts docStateHash): "did it change since?". */
export const stateHash = (doc: Y.Doc) => docStateHash(doc)

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** An emptied value (null, '', [], {}) is no value: a field cleared again is as it was. */
const emptyValue = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v as object).length)

/** JSON with object keys sorted (Y maps keep no order a fingerprint may rely on). */
function stable(v: unknown): string {
  const walk = (x: unknown): unknown => (Array.isArray(x) ? x.map(walk) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, walk((x as Record<string, unknown>)[k])])) : x)
  return JSON.stringify(walk(v) ?? null)
}

/** A row's whole stored values as the call left them vs now: every field — one filled in since that was empty too. */
function valuesMoved(then: Values, now: Values): boolean {
  const keys = new Set([...Object.keys(then), ...Object.keys(now)])
  for (const k of keys) {
    const a = then[k]
    const b = now[k]
    if (emptyValue(a) && emptyValue(b)) continue
    if (!same(a, b)) return true
  }
  return false
}

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

  /**
   * The recorder of one MCP call (its id is new; nothing is kept until it records). `dup`: the key its answer is kept
   * under for repeats (duplicates.ts) — a Restore forgets it, so repeating the call makes the thing again.
   */
  recorder(wsId: string, tokenId: string, tool: string, dup: string | null = null): Recorder {
    const callId = newId()
    const save = (doc: string, p: Preimage, afterHash: string | null = null) => {
      try {
        this.s.repo.savePreimage({ id: newId(), workspaceId: wsId, tokenId, callId, tool, doc, kind: p.kind, data: JSON.stringify(dup ? { ...p, dup } : p), afterHash, at: Date.now() })
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

  /**
   * What people change on a made page / row / database besides its title, values and text, as one fingerprint: its icon,
   * cover and comment threads — and a database's properties and views (a column or a view the team added since).
   */
  static markOf(r: Roots, id: string): string {
    const yp = pageMap(r, id)
    if (!yp) return ''
    const json = (v: unknown): unknown => {
      const out = v instanceof Y.AbstractType ? (v as Y.Map<unknown>).toJSON() : (v ?? null)
      return emptyValue(out) ? null : out
    }
    const of: Record<string, unknown> = { icon: json(yp.get('icon')), cover: json(yp.get('cover')), comments: json(yp.get('comments')) }
    if (yp.get('kind') === 'database') {
      const ydb = databaseMap(r, id)
      of.properties = json(ydb?.get('properties'))
      of.views = json(ydb?.get('views'))
    }
    return createHash('sha256').update(stable(of)).digest('hex').slice(0, 32)
  }

  /** The newest calls (≤ 100, 14 days), each with what it made / changed and the first titles. */
  async list(wsId: string): Promise<McpCall[]> {
    const since = Date.now() - MCP_LIMITS.preimageDays * 86_400_000
    const calls = this.s.repo.mcpCalls(wsId, since).map((c) => {
      let made = 0
      let changed = 0
      /** rows and pages the call changed (a row whose values and body it wrote is one) */
      const touched = new Set<string>()
      const named: Array<{ id: string; title: string }> = []
      for (const part of this.s.repo.preimagesOf(wsId, c.call_id)) {
        const pre = JSON.parse(part.data) as Preimage
        if (pre.kind === 'pages') {
          made += pre.created.length
          named.push(...pre.created)
        } else if (pre.kind === 'rows') {
          made += pre.created.length
          for (const u of pre.updated) touched.add(u.id)
          named.push(...pre.created, ...pre.updated.map((u) => ({ id: u.id, title: u.after.title ?? u.before.title ?? '' })))
        } else {
          // a page's text (a row's body an upsert wrote counts once, with its row)
          if (!touched.has(pre.page)) named.push({ id: pre.page, title: '' })
          touched.add(pre.page)
        }
      }
      changed = touched.size
      // each thing once (a row's body and its values are two parts of one call)
      const once = [...new Map(named.map((n) => [n.id, n] as const)).values()].map((n) => ({ ...n, title: n.title || named.find((x) => x.id === n.id && x.title)?.title || '' }))
      return { c, made, changed, named: once.slice(0, 3) }
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

  /** A content pre-image written back: the fragment as it was (a detached copy), the page's plain text in the meta. */
  async writeBack(wsId: string, docName: string, pageId: string, before: string, actor: string): Promise<void> {
    const update = Buffer.from(before, 'base64')
    const plain = await this.s.collab.write(
      docName,
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
        const yp = pageMap(roots(doc), pageId)
        if (!yp) return
        yp.set('plain', plain)
        yp.set('updatedAt', Date.now())
        yp.set('updatedBy', actor)
      },
      actor,
    )
  }

  /** Put a call back (see the head comment). `actor`: the owner / admin who asked. */
  async restore(wsId: string, callId: string, force: boolean, actor: string) {
    const rows = this.s.repo.preimagesOf(wsId, callId)
    if (!rows.length) throw notFound('call_not_found', 'No MCP call with this id (kept 14 days)')
    const all = rows.map((p) => ({ ...p, pre: JSON.parse(p.data) as Stored }))
    // only what is still to put back: parts an earlier Restore finished are never written again
    const open = all.filter((p) => !p.restored_at)
    if (!open.length) return { callId, restored: 0, kept: [] as Array<{ id: string; title: string; fields?: string[] }>, note: 'This call was put back already.' }
    const done = new Map(open.map((p) => [p.id, new Set(p.pre.done ?? [])] as const))
    // everything the call made (also what an earlier Restore put back already): what lies below it is the call's own
    const made = new Set<string>()
    for (const p of all) if (p.pre.kind === 'pages' || p.pre.kind === 'rows') for (const c of p.pre.created) made.add(c.id)

    // content first: a document that moved since the call is refused unless forced (nothing written yet)
    const contents = open.filter((p) => p.pre.kind === 'content')
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
    // the text of each page and row the call made, now against right after the call (read before the meta write)
    const textMoved = new Set<string>()
    for (const p of open) {
      if (p.pre.kind !== 'pages' && p.pre.kind !== 'rows') continue
      const d = done.get(p.id)!
      for (const c of p.pre.created) {
        if (!c.hash || d.has(`${p.pre.kind === 'pages' ? 'p' : 'c'}:${c.id}`)) continue
        if ((await this.s.collab.read(contentDoc(wsId, c.id), (doc) => stateHash(doc))) !== c.hash) textMoved.add(c.id)
      }
    }

    let restored = 0
    const kept: Array<{ id: string; title: string; fields?: string[] }> = []
    for (const p of contents) {
      const pre = p.pre as Extract<Preimage, { kind: 'content' }>
      await this.writeBack(wsId, p.doc, pre.page, pre.before, actor)
      // back now: never written again by a later Restore (its own write is no change since — and a failure below
      // leaves it done)
      this.s.repo.updatePreimage(wsId, p.id, null, Date.now())
      done.get(p.id)!.add('*')
      restored += 1
    }
    // rows and pages: one meta transaction; made pages first, so a row of a database the call made goes along with it
    // (in its trash, as in One) instead of being trashed on its own
    const meta = open.filter((p) => p.pre.kind !== 'content').sort((a, b) => Number(b.pre.kind === 'pages') - Number(a.pre.kind === 'pages'))
    if (meta.length) {
      const out = await this.s.collab.write(
        metaDoc(wsId),
        (doc) => {
          const r = roots(doc)
          const at = Date.now()
          let n = 0
          const keep: typeof kept = []
          // the live pages below each page and in each database (one pass)
          const below = new Map<string, string[]>()
          for (const [id, yp] of r.pages.entries()) {
            if (!(yp instanceof Y.Map) || yp.get('trashed') === true) continue
            for (const up of new Set([yp.get('parentId'), yp.get('databaseId')])) if (typeof up === 'string' && up && up !== id) below.set(up, [...(below.get(up) ?? []), id])
          }
          /** made things this Restore keeps (changed since): a made page above one stays with it */
          const keptHere = new Set<string>()
          /**
           * something below it that is not the call's to take (a sub-page someone added, a row the team put in) — or a
           * page the call made that stays (kept below: trashing its made parent would take it, and what is below it, along)
           */
          const foreign = (id: string) => (below.get(id) ?? []).some((k) => !made.has(k) || keptHere.has(k))
          /** its icon, cover, comment threads (a database: its properties and views) moved since the call */
          const markMoved = (c: Made) => c.mark !== undefined && McpPreimages.markOf(r, c.id) !== c.mark
          // each made row: as the call left it? (title, its whole stored values — a field filled in since too —, its
          // text, icon / cover / comments, nothing put below it)
          const rowChanged = new Map<string, boolean>()
          for (const p of meta) {
            if (p.pre.kind !== 'rows') continue
            for (const c of p.pre.created) {
              const now = McpPreimages.rowState(r, c.id)
              const changed = !now || now.title !== c.title || valuesMoved(c.values, now.values) || textMoved.has(c.id) || markMoved(c) || foreign(c.id)
              rowChanged.set(c.id, changed)
              if (changed && !force) keptHere.add(c.id)
            }
          }
          const trash = (id: string) => {
            const yp = pageMap(r, id)!
            yp.set('trashed', true)
            yp.set('trashedAt', at)
            yp.set('updatedAt', at)
            yp.set('updatedBy', actor)
            n += 1
          }
          /** made databases left as they are: their rows of the call stay with them (not trashed, not named twice) */
          const keptDbs = new Set<string>()
          for (const p of meta) {
            const pre = p.pre
            const d = done.get(p.id)!
            if (pre.kind === 'pages') {
              // the newest first (a page made under another of the same call before its parent)
              for (const c of [...pre.created].reverse()) {
                const key = `p:${c.id}`
                if (d.has(key)) continue
                const yp = pageMap(r, c.id)
                if (!yp || inTrash(r, c.id)) {
                  d.add(key)
                  continue
                }
                const title = String(yp.get('title') ?? '')
                const isDb = yp.get('kind') === 'database'
                const changed =
                  title !== c.title || textMoved.has(c.id) || markMoved(c) || foreign(c.id) || (isDb && [...rowChanged].some(([rid, ch]) => ch && pageMap(r, rid)?.get('databaseId') === c.id))
                if (changed && !force) {
                  keep.push({ id: c.id, title })
                  keptHere.add(c.id)
                  if (isDb) keptDbs.add(c.id)
                  continue
                }
                trash(c.id)
                d.add(key)
              }
            } else if (pre.kind === 'rows') {
              for (const c of pre.updated) {
                const yp = pageMap(r, c.id)
                if (!yp) {
                  for (const k of keysOf({ ...pre, created: [], updated: [c] })) d.add(k)
                  continue
                }
                const dbId = typeof yp.get('databaseId') === 'string' ? (yp.get('databaseId') as string) : pre.db
                // a kept field is named as people see it (its property's name now)
                const props = liveDatabase(r, dbId)?.properties ?? []
                const nameOf = (k: string) => props.find((x) => x.id === k)?.name ?? k
                const now = McpPreimages.rowState(r, c.id, Object.keys(c.after.values))!
                const changed: string[] = []
                const back: Values = {}
                for (const [k, after] of Object.entries(c.after.values)) {
                  const key = `u:${c.id}:${k}`
                  if (d.has(key)) continue
                  if (!same(now.values[k], after) && !force) {
                    changed.push(nameOf(k))
                    continue
                  }
                  back[k] = c.before.values[k] ?? null
                  d.add(key)
                }
                let title = false
                if (c.after.title !== undefined && c.before.title !== undefined && !d.has(`u:${c.id}:#title`)) {
                  if (now.title === c.after.title || force) {
                    yp.set('title', c.before.title)
                    d.add(`u:${c.id}:#title`)
                    title = true
                  } else changed.push(props.find((x) => x.type === 'title')?.name ?? 'title')
                }
                if (Object.keys(back).length || title) {
                  // relation values as a write puts them: the partner rows in step (no one-sided link left)
                  putValues(this.model, r, c.id, back, actor, at)
                  yp.set('updatedAt', at)
                  yp.set('updatedBy', actor)
                  n += 1
                }
                if (changed.length) keep.push({ id: c.id, title: now.title, fields: changed })
              }
              for (const c of pre.created) {
                const key = `c:${c.id}`
                if (d.has(key)) continue
                const yp = pageMap(r, c.id)
                if (!yp || inTrash(r, c.id)) {
                  d.add(key)
                  continue
                }
                // a row of a made database that stays: it stays with it
                if (keptDbs.has(String(yp.get('databaseId') ?? ''))) continue
                if (rowChanged.get(c.id) && !force) {
                  keep.push({ id: c.id, title: String(yp.get('title') ?? '') })
                  continue
                }
                trash(c.id)
                d.add(key)
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
    // each part: back whole → done; else what it put back is noted (a later Restore touches only the rest)
    const at = Date.now()
    for (const p of open) {
      const d = done.get(p.id)!
      if (p.pre.kind === 'content') continue
      const whole = keysOf(p.pre).every((k) => d.has(k))
      if (whole) this.s.repo.updatePreimage(wsId, p.id, null, at)
      else if (d.size !== (p.pre.done?.length ?? 0)) this.s.repo.updatePreimage(wsId, p.id, JSON.stringify({ ...p.pre, done: [...d] }), null)
    }
    // a repeat of the call is no longer answered with what it made (it is in the trash now): it makes it again
    if (restored) {
      const dup = all.map((p) => p.pre.dup).find((d): d is string => typeof d === 'string')
      if (dup) forgetCall(this.s, rows[0]!.token_id, dup)
    }
    this.s.log.info('mcp call restored', { workspace: wsId, call: callId, restored, kept: kept.length, force, by: actor })
    return { callId, restored, kept, ...(kept.length ? { note: 'Some things were changed since this call and were left as they are (restore with force to put them back too).' } : {}) }
  }
}
