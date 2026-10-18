/**
 * Pre-images of the team server's MCP writes (MCP plan § 3.6, owner Q9). The server has no approval card and no Undo,
 * so it keeps, per call, what it needs to put the call back: the rows it made (and their values then), the rows it
 * changed (each field before and after — only the fields the call wrote), the pages it made, the content fragment of a
 * page before a replace (a Y update of a fresh document holding a detached copy) with the document's state right after
 * the call — and for every page or row it made, the state of its own text right after the call. Sealed with the
 * workspace key (repo.ts savePreimage), kept 14 days, deleted with the workspace.
 *
 * Restore (owners / admins, Workspace → API "Recent MCP writes") is ALL OR NOTHING (Weg 4, the owner's decision; the
 * bridge's Undo follows the same rule):
 *  - nothing the call made or changed was touched since → the fields it wrote get their earlier values, the texts it
 *    replaced or wrote a link / database block into get their earlier text, and what it made goes to the trash — the
 *    meta in ONE transaction — the texts first, each checked again in its own write, then the meta, checked again in
 *    its transaction; a change landing meanwhile refuses the whole Restore and the texts written so far are taken back;
 *  - anything moved since → `409 changed_since` naming each thing and what moved (`changedSince`), and NOTHING is
 *    written: a field it wrote, a text it wrote into (textHash: its blocks, ids and the editor's trailing empty paragraph
 *    aside — a member who only opened a page changed nothing), a made page's or row's title, text, stored values, icon /
 *    cover / comments (a database's properties and views), its place, the trash, something put below it — and a page
 *    whose text would go back that was locked in One since;
 *  - `force` (after that answer) puts back the recorded texts the call replaced and the fields it wrote, whole, and never
 *    trashes anything: what the call made stays — with the link or database block it wrote for it — and is listed
 *    (`left`). A call that only made things has nothing force could put back (`canForce: false`), and a page locked
 *    since is never written: both stay refused.
 * A call is put back as a whole (every part marked at once); a second Restore changes nothing.
 */
import * as Y from 'yjs'
import type { Services } from '../context.ts'
import { ApiError, notFound } from '../errors.ts'
import { fragmentText } from '../api/content.ts'
import { createHash } from 'node:crypto'
import { type Roots, clone, databaseMap, inTrash, liveDatabase, pageMap, propertiesMap, readPage, roots } from '../api/meta.ts'
import { contentDoc, metaDoc, type WorkspaceModel } from '../api/model.ts'
import { newId } from '../tokens.ts'
import { docJson, docStateHash } from './pageRead.ts'
import type { PMJson } from '../../../src/shared/mcp/pageRead.ts'
import { forgetCall } from './duplicates.ts'
import { MCP_LIMITS } from '../../../src/shared/mcp/tables.ts'

type Values = Record<string, unknown>

/**
 * A page, row or database a call made, as the call left it: its title, its text (`hash`, textHash), `mark` — what else
 * people change on it (markOf: icon, cover, comment threads; a database's properties and views) — and `place` (placeOf:
 * its parent and database). A Restore compares all of them (one missing counts as moved).
 */
export interface Made {
  id: string
  title: string
  hash?: string
  mark?: string
  place?: string
}

export type Preimage =
  /** rows a call made (`created`, with the values it wrote and its text's state then) or changed (`updated`, the fields it wrote: before → after) */
  | { kind: 'rows'; db: string; created: Array<Made & { values: Values }>; updated: Array<{ id: string; before: { title?: string; values: Values }; after: { title?: string; values: Values } }> }
  /** pages (or a database) a call made, each with its text's state right after the call */
  | { kind: 'pages'; created: Made[] }
  /**
   * a page's content before the call: a Y update of a document holding a copy of its fragment, and its `plain` — `own`:
   * the call wrote only links / a database block of things it made into it (linkInParent, an inline database), named by
   * the made things' ids (a forced Restore leaves those: what the call made stays, with its link or block)
   */
  | { kind: 'content'; page: string; before: string; plain: string; own?: unknown[] }

/** A part as kept, with the repeat key of its call (duplicates.ts). */
type Stored = Preimage & { dup?: string }

/** What a tool records for its call (one recorder per call). */
export interface Recorder {
  callId: string
  rows(p: Omit<Extract<Preimage, { kind: 'rows' }>, 'kind'>): void
  pages(created: Made[]): void
  content(pageId: string, before: string, plain: string, afterHash: string | null, own?: string[]): void
}

/**
 * What moved since a call on one thing it made or changed (a Restore's `changed_since` names each): `text` · `title` ·
 * `values` (a made row's stored values; a changed row: `fields` names the fields it wrote that moved) · `mark` (icon,
 * cover, comment threads; a database's properties or views) · `place` (moved) · `below` (a page or row put below it) ·
 * `trash` · `gone` (deleted for good) · `locked` (a page whose text would go back, locked in One since).
 */
export type MovedWhat = 'text' | 'title' | 'values' | 'mark' | 'place' | 'below' | 'trash' | 'gone' | 'locked'
export interface Moved {
  id: string
  /** as it is called now (as the call left it when it is gone) */
  title: string
  what: MovedWhat[]
  fields?: string[]
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

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** An emptied value (null, '', [], {}) is no value: a field cleared again is as it was. */
const emptyValue = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v as object).length)

/** JSON with object keys sorted (Y maps keep no order a fingerprint may rely on). */
function stable(v: unknown): string {
  const walk = (x: unknown): unknown => (Array.isArray(x) ? x.map(walk) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, walk((x as Record<string, unknown>)[k])])) : x)
  return JSON.stringify(walk(v) ?? null)
}

/** A node of a page's text as its fingerprint reads it: no block ids (each editor fills in its own — a mention's id is its target and stays), no empty attrs. */
function textNode(n: PMJson): unknown {
  const a: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(n.attrs ?? {})) if (v !== null && v !== undefined && !(k === 'id' && n.type !== 'mention')) a[k] = v
  return {
    t: n.type ?? '',
    ...(Object.keys(a).length ? { a } : {}),
    ...(n.text !== undefined ? { x: n.text } : {}),
    ...(n.marks?.length ? { m: n.marks.map((m) => textNode(m)) } : {}),
    ...(n.content?.length ? { c: n.content.map(textNode) } : {}),
  }
}

/** The version of textHash's fingerprints (older pre-images hold the document's Y state — textMoved reads both). */
const TEXT_V = 'tx1:'

/**
 * A content document's TEXT as a fingerprint — "did it change since?" for a Restore. Not its Y state: a member who only
 * opens the page writes into it (the empty paragraph the editor keeps after a closing list, heading, table, code or
 * database block; block ids it fills in), and that is no change. So: its blocks as normalized JSON, block ids aside,
 * empty paragraphs at its end dropped — as the bridge's Undo reads a page (history contentKey).
 */
export function textHash(doc: Y.Doc): string {
  const blocks = [...(docJson(doc).content ?? [])]
  while (blocks.length && blocks[blocks.length - 1]!.type === 'paragraph' && !blocks[blocks.length - 1]!.content?.length) blocks.pop()
  return TEXT_V + createHash('sha256').update(stable(blocks.map(textNode))).digest('hex').slice(0, 32)
}

/** Did the document's text move since `hash` (textHash) was taken? A pre-image stored before holds its Y state hash. */
export const textMoved = (doc: Y.Doc, hash: string): boolean => (hash.startsWith(TEXT_V) ? textHash(doc) : docStateHash(doc)) !== hash

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

/** How a refusal names what moved (English API words; the app has its own, EN + DE). */
const MOVED_WORDS: Record<MovedWhat, string> = {
  text: 'text',
  title: 'title',
  values: 'values',
  mark: 'icon, cover, comments, properties or views',
  place: 'moved',
  below: 'a page or row put below it',
  trash: 'in the trash',
  gone: 'deleted',
  locked: 'locked in One',
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
      content: (pageId, before, plain, afterHash, own) => save(contentDoc(wsId, pageId), { kind: 'content', page: pageId, before, plain, ...(own?.length ? { own } : {}) }, afterHash),
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

  /** Where a page / row sits: its parent and its database (a move since the call is a change since). */
  static placeOf(r: Roots, id: string): string {
    const yp = pageMap(r, id)
    if (!yp) return ''
    const at = (k: string) => (typeof yp.get(k) === 'string' ? String(yp.get(k)) : '')
    return `${at('parentId')}|${at('databaseId')}`
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

  /**
   * A content document's fragment replaced by a pre-image's detached copy, checked in the same transaction: with
   * `expect` (textHash) only while its text is still that one — else nothing is written and the answer is null. Answers
   * its plain text then, the fragment it replaced (`was`, a detached copy) and its text's fingerprint after the write.
   */
  private putText(docName: string, before: string, actor: string, expect?: string): Promise<{ plain: string; was: string; hash: string } | null> {
    const update = Buffer.from(before, 'base64')
    return this.s.collab.write(
      docName,
      (doc) => {
        if (expect !== undefined && textMoved(doc, expect)) return null
        const was = fragmentSnapshot(doc)
        const source = new Y.Doc()
        Y.applyUpdate(source, update)
        const frag = doc.getXmlFragment('default')
        if (frag.length) frag.delete(0, frag.length)
        const back = source.getXmlFragment('default').toArray().map((n) => (n as Y.XmlElement | Y.XmlText).clone())
        if (back.length) frag.insert(0, back)
        return { plain: fragmentText(doc, 20_000), was, hash: textHash(doc) }
      },
      actor,
    )
  }

  /** A content pre-image written back (a failed call's rollback): the fragment as it was, the page's plain text in the meta. */
  async writeBack(wsId: string, docName: string, pageId: string, before: string, actor: string): Promise<void> {
    const plain = (await this.putText(docName, before, actor))!.plain
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

  /**
   * The refusal of a Restore: `409 changed_since`, each thing named with what moved (details: `changed`, `canForce`).
   * `stayed`: texts this Restore had put back and could not take back again because they were typed into right after
   * (the rare case of a change landing while the Restore wrote) — named, never hidden behind "Nothing was put back".
   */
  private static refusal(changed: Moved[], canForce: boolean, stayed: string[] = []): ApiError {
    const say = (m: Moved) => `${JSON.stringify(m.title || 'Untitled')} (${[...(m.fields ?? []), ...m.what.filter((w) => !(w === 'values' && m.fields?.length)).map((w) => MOVED_WORDS[w])].join(', ')})`
    const remedy = canForce
      ? 'Restore with force to put back the texts and fields the call changed anyway (the later changes there go; what it made stays) — or undo it in One instead: version history or the trash.'
      : 'Undo it in One instead: version history or the trash.'
    const done = stayed.length
      ? `Nothing else was put back — the text of ${stayed.map((t) => JSON.stringify(t || 'Untitled')).join(', ')} was put back and typed into right after, so it stays as it is now (its earlier text is in version history).`
      : 'Nothing was put back.'
    return new ApiError(409, 'changed_since', `Changed since this call: ${changed.map(say).join(', ')}. ${done} ${remedy}`, { details: { changed, canForce, ...(stayed.length ? { stayed } : {}) } })
  }

  /** Put a call back, all or nothing (see the head comment). `actor`: the owner / admin who asked. */
  async restore(wsId: string, callId: string, force: boolean, actor: string): Promise<{ callId: string; restored: number; left: Array<{ id: string; title: string }>; note?: string }> {
    const rows = this.s.repo.preimagesOf(wsId, callId)
    if (!rows.length) throw notFound('call_not_found', 'No MCP call with this id (kept 14 days)')
    // a call goes back as a whole: once a part is marked, it was put back
    if (rows.some((p) => p.restored_at)) return { callId, restored: 0, left: [], note: 'This call was put back already.' }
    const parts = rows.map((p) => ({ ...p, pre: JSON.parse(p.data) as Stored }))
    const contents = parts.flatMap((p) => (p.pre.kind === 'content' ? [{ ...p.pre, doc: p.doc, after: p.after_hash }] : []))
    const made: Array<Made & { values?: Values }> = parts.flatMap((p) => (p.pre.kind === 'pages' || p.pre.kind === 'rows' ? p.pre.created : []))
    const updated = parts.flatMap((p) => {
      const pre = p.pre
      return pre.kind === 'rows' ? pre.updated.map((u) => ({ ...u, db: pre.db })) : []
    })
    const madeIds = new Set(made.map((m) => m.id))
    /** a text the call wrote only its own links / database block into: force leaves it (what it made stays, with them) */
    const ownOnly = (c: (typeof contents)[number]) => Array.isArray(c.own) && c.own.length > 0
    const forced = contents.filter((c) => !ownOnly(c))

    // the texts as they are now, before the meta is read: each text the call wrote into, each made page's / row's own text
    const textMovedIds = new Set<string>()
    for (const c of contents) if (!c.after || (await this.s.collab.read(c.doc, (doc) => textMoved(doc, c.after!)))) textMovedIds.add(c.page)
    for (const m of made) if (!m.hash || (await this.s.collab.read(contentDoc(wsId, m.id), (doc) => textMoved(doc, m.hash!)))) textMovedIds.add(m.id)

    /** everything that moved since the call (read before the write and again inside it: nothing is written when it moved) */
    const changedSince = (r: Roots): Moved[] => {
      const out = new Map<string, Moved>()
      const note = (id: string, title: string, what: MovedWhat, fields?: string[]) => {
        const m = out.get(id) ?? { id, title, what: [] }
        if (!m.what.includes(what)) m.what.push(what)
        if (fields?.length) m.fields = [...(m.fields ?? []), ...fields]
        out.set(id, m)
      }
      // the live pages and rows below each thing the call made
      const below = new Map<string, string[]>()
      if (made.length)
        for (const [id, yp] of r.pages.entries()) {
          if (!(yp instanceof Y.Map) || yp.get('trashed') === true) continue
          for (const up of new Set([yp.get('parentId'), yp.get('databaseId')])) if (typeof up === 'string' && up !== id && madeIds.has(up)) below.set(up, [...(below.get(up) ?? []), id])
        }
      for (const m of made) {
        const yp = pageMap(r, m.id)
        if (!yp) {
          note(m.id, m.title, 'gone')
          continue
        }
        const title = String(yp.get('title') ?? '')
        if (yp.get('trashed') === true) note(m.id, title, 'trash')
        if (title !== m.title) note(m.id, title, 'title')
        if (textMovedIds.has(m.id)) note(m.id, title, 'text')
        if (m.values && valuesMoved(m.values, McpPreimages.rowState(r, m.id)?.values ?? {})) note(m.id, title, 'values')
        if (m.mark === undefined || McpPreimages.markOf(r, m.id) !== m.mark) note(m.id, title, 'mark')
        if (m.place === undefined || McpPreimages.placeOf(r, m.id) !== m.place) note(m.id, title, 'place')
        if ((below.get(m.id) ?? []).some((k) => !madeIds.has(k))) note(m.id, title, 'below')
      }
      for (const u of updated) {
        const yp = pageMap(r, u.id)
        if (!yp) {
          note(u.id, u.after.title ?? u.before.title ?? '', 'gone')
          continue
        }
        const defs = liveDatabase(r, typeof yp.get('databaseId') === 'string' ? String(yp.get('databaseId')) : u.db)?.properties ?? []
        const now = McpPreimages.rowState(r, u.id, Object.keys(u.after.values))!
        // the fields it wrote, named as people see them now
        const fields = Object.entries(u.after.values)
          .filter(([k, v]) => !same(now.values[k], v))
          .map(([k]) => defs.find((d) => d.id === k)?.name ?? k)
        if (u.after.title !== undefined && u.before.title !== undefined && now.title !== u.after.title) fields.push(defs.find((d) => d.type === 'title')?.name ?? 'title')
        if (fields.length) note(u.id, now.title, 'values', fields)
      }
      for (const c of contents) {
        const yp = pageMap(r, c.page)
        if (!yp) {
          note(c.page, '', 'gone')
          continue
        }
        const title = String(yp.get('title') ?? '')
        if (textMovedIds.has(c.page)) note(c.page, title, 'text')
        // its text would go back into a page locked in One since (the call could not have written into a locked one)
        if ((yp.get('settings') as { locked?: unknown } | undefined)?.locked === true) note(c.page, title, 'locked')
      }
      return [...out.values()]
    }
    /** force puts back texts and fields — never into a locked page, and never when the call only made things */
    const canForce = (changed: Moved[]) => (updated.length > 0 || forced.length > 0) && !changed.some((m) => m.what.includes('locked'))
    /** the fields it wrote back to their earlier values (relations as a write puts them), its replaced texts' plain text */
    const putFields = (r: Roots, texts: typeof contents, at: number) => {
      let n = 0
      for (const u of updated) {
        const yp = pageMap(r, u.id)
        if (!yp) continue
        putValues(this.model, r, u.id, Object.fromEntries(Object.keys(u.after.values).map((k) => [k, u.before.values[k] ?? null])), actor, at)
        if (u.after.title !== undefined && u.before.title !== undefined) yp.set('title', u.before.title)
        yp.set('updatedAt', at)
        yp.set('updatedBy', actor)
        n += 1
      }
      for (const c of texts) {
        const yp = pageMap(r, c.page)
        if (!yp) continue
        yp.set('plain', c.plain)
        yp.set('updatedAt', at)
        yp.set('updatedBy', actor)
      }
      return n
    }
    /** a made thing with nothing the call made above it (what is below one goes along with it, in its trash, as in One) */
    const topOf = (r: Roots) =>
      made.filter((m) => {
        const seen = new Set<string>([m.id])
        let yp = pageMap(r, m.id)
        while (yp) {
          const ups = [yp.get('parentId'), yp.get('databaseId')].filter((x): x is string => typeof x === 'string' && !!x && !seen.has(x))
          if (ups.some((x) => madeIds.has(x))) return false
          const next: string | undefined = ups[0]
          if (!next) return true
          seen.add(next)
          yp = pageMap(r, next)
        }
        return true
      })

    const changed = await this.model.read(wsId, (r) => changedSince(r))
    if (changed.length && (!force || !canForce(changed))) throw McpPreimages.refusal(changed, canForce(changed))
    if (this.s.config.mcpRestoreGapMs) await new Promise((ok) => setTimeout(ok, this.s.config.mcpRestoreGapMs))

    // The texts first, each checked in its own write (a text typed into since the check above is never overwritten:
    // with force only one that had moved already, as the refusal named it, goes); then the meta in ONE transaction,
    // checked again in it. Anything that moved meanwhile refuses the whole Restore: the texts written so far are taken
    // back (each only while it is still as this Restore left it) and nothing else is written.
    const gone = new Set(changed.filter((m) => m.what.includes('gone')).map((m) => m.id))
    const texts = force && changed.length ? forced.filter((c) => !gone.has(c.page)) : contents
    const written: Array<{ doc: string; page: string; was: string; hash: string }> = []
    const takeBack = async (): Promise<string[]> => {
      const stayed: string[] = []
      for (const w of written.reverse()) if (!(await this.putText(w.doc, w.was, actor, w.hash))) stayed.push(w.page)
      return stayed
    }
    const refuse = async (moved?: Moved[]): Promise<never> => {
      const stayed = await takeBack()
      const now = moved ?? (await this.model.read(wsId, (r) => changedSince(r)))
      const titles = stayed.length ? await this.model.read(wsId, (r) => stayed.map((id) => String(pageMap(r, id)?.get('title') ?? ''))) : []
      throw McpPreimages.refusal(now, canForce(now), titles)
    }
    for (const c of texts) {
      const out = await this.putText(c.doc, c.before, actor, force && textMovedIds.has(c.page) ? undefined : (c.after ?? ''))
      if (!out) {
        textMovedIds.add(c.page)
        await refuse()
      }
      written.push({ doc: c.doc, page: c.page, was: out!.was, hash: out!.hash })
    }
    // a made page's or row's own text, read once more right before the meta is written
    if (!force || !changed.length) for (const m of made) if (!textMovedIds.has(m.id) && (!m.hash || (await this.s.collab.read(contentDoc(wsId, m.id), (doc) => textMoved(doc, m.hash!))))) textMovedIds.add(m.id)

    if (changed.length) {
      // "Restore anyway": the texts it replaced and the fields it wrote, whole; what it made stays and is listed
      let out: { n: number; left: Array<{ id: string; title: string }> } | Moved[]
      try {
        out = await this.s.collab.write(
          metaDoc(wsId),
          (doc) => {
            const r = roots(doc)
            // a page locked meanwhile: refused (its text was taken back above)
            const again = changedSince(r)
            if (!canForce(again)) return again
            const n = putFields(r, texts.filter((c) => !!pageMap(r, c.page)), Date.now())
            const left = topOf(r)
              .filter((m) => !!pageMap(r, m.id) && !inTrash(r, m.id))
              .map((m) => ({ id: m.id, title: String(pageMap(r, m.id)!.get('title') ?? '') }))
            return { n, left }
          },
          actor,
        )
      } catch (err) {
        await takeBack()
        throw err
      }
      if (Array.isArray(out)) return refuse(out)
      this.s.repo.markCallRestored(wsId, callId, Date.now())
      const restored = out.n + texts.length
      this.s.log.info('mcp call restored', { workspace: wsId, call: callId, restored, left: out.left.length, force: true, by: actor })
      return { callId, restored, left: out.left, ...(out.left.length ? { note: 'Put back the texts and fields this call changed. What it made stays (left): move it to the trash in One if it is no longer wanted.' } : {}) }
    }

    // nothing moved: the meta in one transaction, checked again in it (the texts above were checked as they were written)
    let n: number | Moved[]
    try {
      n = await this.s.collab.write(
        metaDoc(wsId),
        (doc) => {
          const r = roots(doc)
          const again = changedSince(r)
          if (again.length) return again
          const at = Date.now()
          let n = putFields(r, contents, at)
          for (const m of topOf(r)) {
            const yp = pageMap(r, m.id)!
            yp.set('trashed', true)
            yp.set('trashedAt', at)
            yp.set('updatedAt', at)
            yp.set('updatedBy', actor)
            n += 1
          }
          return n
        },
        actor,
      )
    } catch (err) {
      await takeBack()
      throw err
    }
    if (Array.isArray(n)) return refuse(n)
    this.s.repo.markCallRestored(wsId, callId, Date.now())
    // a repeat of the call is no longer answered with what it made (it is in the trash now): it makes it again
    const dup = parts.map((p) => p.pre.dup).find((d): d is string => typeof d === 'string')
    if (dup) forgetCall(this.s, rows[0]!.token_id, dup)
    const restored = n + contents.length
    this.s.log.info('mcp call restored', { workspace: wsId, call: callId, restored, force, by: actor })
    return { callId, restored, left: [] }
  }
}
