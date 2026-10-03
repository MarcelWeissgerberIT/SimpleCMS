/**
 * Pick up files edited outside One (folder or GitHub) — through the Markdown importer's path:
 * its front matter / title / link helpers (io/import/plan.ts, csv.ts) and the editor's
 * markdownToDoc, written with setContent(…, 'sync').
 *
 *  - A changed file whose page One did not change since it was written: title, icon, row
 *    properties (front matter) and content are taken over. Content is merged block by block:
 *    blocks the file left as they were keep everything Markdown can't express (comments, button
 *    actions, colours, widths …); only edited / new blocks come from the file.
 *  - Both sides changed: One's version is kept — the caller saves the file's version as a
 *    "(conflict <date>)" copy.
 *  - A new .md file becomes a new page under the page / database its folder belongs to (a row in a
 *    database folder; unknown folders become pages). A file that carries the `id` of a page whose
 *    own file is gone was renamed / moved: the page follows it.
 *  - `_database.md`, `_rows.csv` and `_files/` are read-only; `.trash/` and hidden folders are ignored.
 *  - Files that disappeared are reported (`missing`) — pages are never trashed without asking.
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../store/store'
import type { DateValue, ID, Page, PropertyDef, PropertyValue, SelectOption } from '../../store/types'
import { newId } from '../../lib/ids'
import { getFile, saveFile } from '../../lib/files'
import { snapshotNow } from '../history/snapshots'
import { safeName } from '../io/export/collect'
import { basename, dirname, linkTargets, normPath, resolveTarget, rewriteLinks, takeTitle } from '../io/import/plan'
import { cellValue } from '../io/import/csv'
import { mimeOf } from '../io/import/apply'
import { deepEqual } from '../../store/merge'
import { DB_FILE, FILES_DIR, ROWS_FILE, TRASH_DIR } from './layout'
import { BASE_KEYS, EDITABLE_PROPS, iconText, parseIcon, propKey, propYaml, type RenderCtx } from './render'
import { readFrontMatter, yamlList, yamlText, type YamlValue } from './yaml'
import { isConflictCopy, type SyncPlan } from './engine'
import { textOf } from './hash'
import type { Manifest, ManifestEntry } from './types'

export interface ExternalFile {
  path: string
  data: Uint8Array
  sha: string
}

export interface PickupInput {
  plan: SyncPlan
  manifest: Manifest
  /** files the manifest knows whose content differs from what was last seen */
  changed: ExternalFile[]
  /** Markdown files the manifest doesn't know */
  added: ExternalFile[]
  /** every path on the target */
  present: Set<string>
  /** another file on the target (attachments a new / edited page links to) */
  readFile: (path: string) => Promise<Uint8Array | null>
}

export interface PickupResult {
  updated: ID[]
  created: ID[]
  moved: ID[]
  conflicts: ExternalFile[]
  /** read-only files that were edited (left as they are) */
  ignored: string[]
  missing: Array<{ path: string; id: ID }>
  /** manifest entries to set */
  entries: Record<string, ManifestEntry>
  /** manifest paths to drop (files that moved) */
  removed: string[]
  /** paths whose page changed here: their `out` is refreshed once the store has the change */
  touched: string[]
}

/** Markdown files a person may add: not hidden, not in the trash / files folder, not a conflict copy. */
export function isPickable(path: string): boolean {
  if (!/\.(md|markdown)$/i.test(path)) return false
  const segs = path.split('/')
  if (segs.some((s) => s.startsWith('.'))) return false
  if (segs[0] === FILES_DIR || segs[0] === TRASH_DIR) return false
  const name = segs[segs.length - 1]
  if (name === DB_FILE || name === ROWS_FILE) return false
  return !isConflictCopy(path)
}

const nfc = (p: string) => normPath(p)
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */

type Editor = RenderCtx['editor']

/** Top-level block → its Markdown, as the file shows it (heading anchors aren't part of file links). */
const mdKey = (editor: Editor, n: JSONContent) =>
  editor
    .docToMarkdown({ type: 'doc', content: [n] })
    .trim()
    .replace(/\]\(#\/p\/([\w-]+)\?[^)\s]*\)/g, '](#/p/$1)')

/**
 * The page after an edit in its file: every block of the page whose Markdown is still in the file
 * (in order, on block boundaries) stays One's own block — with everything Markdown can't carry
 * (comments, button actions, columns, colours, widths, ids). Only the text between those blocks is
 * new or edited and comes from the file (`parse`). Blocks without any Markdown (empty paragraphs,
 * a table of contents …) can't have been edited in the file and stay where they are.
 */
export function mergeBlocks(editor: Editor, ours: JSONContent | null, body: string, parse: (md: string) => JSONContent[]): JSONContent {
  const o = ours?.content ?? []
  const text = body.replace(/\r\n?/g, '\n').trim()
  const out: JSONContent[] = []
  const keys = o.map((n) => mdKey(editor, n))
  const at = (chunk: string, from: number): number => {
    let p = text.indexOf(chunk, from)
    while (p >= 0) {
      const end = p + chunk.length
      if ((p === 0 || text[p - 1] === '\n') && (end === text.length || text[end] === '\n')) return p
      p = text.indexOf(chunk, p + 1)
    }
    return -1
  }
  const gap = (from: number, to: number) => {
    // the blank lines around a gap only separate it from its neighbours
    const md = text.slice(from, to).replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, '')
    if (md.trim()) out.push(...parse(md))
  }
  let cursor = 0
  for (let i = 0; i < o.length; i++) {
    const key = keys[i]
    if (!key) {
      out.push(o[i])
      continue
    }
    const p = at(key, cursor)
    // gone, or edited: its new text arrives with a gap
    if (p < 0) continue
    // a block further down shows up first: this one was deleted here (its twin sits later)
    let deleted = false
    for (let j = i + 1; j < Math.min(o.length, i + 6) && !deleted; j++) {
      const q = keys[j] ? at(keys[j], cursor) : -1
      if (q >= 0 && q + keys[j].length <= p) deleted = true
    }
    if (deleted) continue
    gap(cursor, p)
    out.push(o[i])
    cursor = p + key.length
  }
  gap(cursor, text.length)
  return { type: 'doc', content: out.length ? out : [{ type: 'paragraph' }] }
}

const PROMOTE = new Set(['doc', 'blockquote', 'callout', 'detailsContent', 'column'])
const PAGE_HREF = /^#\/p\/([\w-]+)$/
/** Link marks only take web / relative URLs: a link to a stored file travels as this placeholder. */
const FILE_URL = 'https://one.sync/f/'

export interface FileMetaInfo {
  name: string
  size: number
  type: string
}

/**
 * What the exporter wrote for page links, mentions, inline databases and file blocks comes back as
 * those nodes (a paragraph holding only `[Title](page)` is a page link block, `[@Title](page)` a
 * mention, `[📎 name](file)` a file block).
 */
export function restoreNodes(doc: JSONContent, pages: Record<ID, Page>, isDb: (id: ID) => boolean, untitled: string, fileMeta: (ref: string) => FileMetaInfo | undefined = () => undefined): JSONContent {
  const titleOf = (id: ID) => (pages[id]?.title.trim() || untitled)
  const hrefOf = (n: JSONContent): string | null => {
    const href = n.marks?.find((mk) => mk.type === 'link')?.attrs?.href
    return typeof href === 'string' ? href : null
  }
  const linkOf = (n: JSONContent): string | null => {
    const m = hrefOf(n)?.match(PAGE_HREF)
    return m && pages[m[1]] ? m[1] : null
  }
  const fileOf = (n: JSONContent): string | null => {
    const href = hrefOf(n)
    return href?.startsWith(FILE_URL) ? decodeURIComponent(href.slice(FILE_URL.length)) : null
  }
  const inline = (n: JSONContent): JSONContent => {
    if (n.type === 'text' && n.text?.startsWith('@')) {
      const id = linkOf(n)
      if (id && n.text.slice(1).trim() === titleOf(id)) return { type: 'mention', attrs: { id, label: titleOf(id), kind: 'page' } }
    }
    // an inline link to a stored file: the text stays, the link can't
    if (n.type === 'text' && fileOf(n)) return { ...n, marks: n.marks?.filter((mk) => mk.type !== 'link') }
    return n.content ? { ...n, content: n.content.map(inline) } : n
  }
  const fileBlock = (ref: string, text: string): JSONContent => {
    const meta = fileMeta(ref)
    const name = text.replace(/^📎\s*/u, '').trim() || meta?.name || 'file'
    const type = meta?.type ?? ''
    if (/^image\//.test(type)) return { type: 'image', attrs: { src: ref, alt: name } }
    if (/^(video|audio)\//.test(type)) return { type: type.split('/')[0], attrs: { src: ref, name } }
    return { type: 'fileBlock', attrs: { src: ref, name, size: meta?.size ?? 0 } }
  }
  const blocks = (list: JSONContent[], promote: boolean): JSONContent[] =>
    list.map((n) => {
      if (promote && n.type === 'paragraph' && n.content?.length) {
        const parts = n.content.filter((c) => !(c.type === 'text' && !c.text?.trim()))
        const only = parts.length === 1 && parts[0].type === 'text' ? parts[0] : null
        const id = only ? linkOf(only) : null
        if (id && only!.text!.trim() === titleOf(id)) return isDb(id) ? { type: 'databaseBlock', attrs: { databaseId: id, viewId: null } } : { type: 'pageLink', attrs: { pageId: id } }
        const ref = only ? fileOf(only) : null
        if (ref) return fileBlock(ref, only!.text ?? '')
      }
      if (!n.content) return n
      return { ...n, content: PROMOTE.has(n.type ?? '') ? blocks(n.content, true) : n.type === 'paragraph' || n.type === 'heading' ? n.content.map(inline) : blocks(n.content, false) }
    })
  return { ...doc, content: blocks(doc.content ?? [], true) }
}

/* ------------------------------------------------------------------ */
/* Pick-up                                                             */
/* ------------------------------------------------------------------ */

export async function applyPickup(input: PickupInput): Promise<PickupResult> {
  const { plan, manifest } = input
  const { editor } = plan.ctx
  const ws = () => useWorkspace.getState()
  const untitled = plan.ctx.untitled
  const res: PickupResult = { updated: [], created: [], moved: [], conflicts: [], ignored: [], missing: [], entries: {}, removed: [], touched: [] }

  /* ---------- indexes ---------- */
  const idByPath = new Map<string, ID>()
  const pathById = new Map<ID, string>()
  for (const [path, e] of Object.entries(manifest.entries)) {
    if (!e.id || (e.kind !== 'page' && e.kind !== 'row' && e.kind !== 'database')) continue
    idByPath.set(nfc(path), e.id)
    if (e.kind !== 'database') pathById.set(e.id, path)
  }
  for (const [id, path] of plan.layout.pathOfId) if (!idByPath.has(nfc(path))) idByPath.set(nfc(path), id)
  const refByPath = new Map<string, string>()
  for (const [path, e] of Object.entries(manifest.entries)) if (e.kind === 'file' && e.ref) refByPath.set(nfc(path), e.ref)
  for (const [ref, path] of plan.layout.pathOfRef) refByPath.set(nfc(path), ref)
  const folderToId = new Map<string, ID>()
  for (const [id, folder] of plan.layout.folderOfId) folderToId.set(nfc(folder.slice(0, -1)), id)
  const present = new Set([...input.present].map(nfc))

  /* ---------- Markdown body → doc ---------- */
  const fresh = new Map<string, string>()
  const metas = new Map<string, FileMetaInfo>()
  /** Relative links of a file back to what One writes: `#/p/<id>` and `onefile:` refs. */
  const toOne = async (body: string, path: string): Promise<string> => {
    const dir = dirname(path)
    const map = new Map<string, string>()
    for (const href of linkTargets(body)) {
      if (map.has(href)) continue
      const target = resolveTarget(dir, href)
      if (!target) continue
      const id = idByPath.get(target)
      if (id) {
        map.set(href, `#/p/${id}`)
        continue
      }
      let ref = refByPath.get(target) ?? fresh.get(target)
      // a file next to the notes that One doesn't have yet (an image dropped into the folder)
      if (!ref && !/\.(md|markdown)$/i.test(target) && present.has(target)) {
        const data = await input.readFile(target).catch(() => null)
        if (data) {
          ref = await saveFile(new Blob([data as BlobPart], { type: mimeOf(target) }), basename(target))
          fresh.set(target, ref)
        }
      }
      if (ref) {
        map.set(href, ref)
        if (!metas.has(ref)) {
          const f = await getFile(ref).catch(() => undefined)
          if (f) metas.set(ref, { name: f.name, size: f.size, type: f.type })
        }
      }
    }
    return rewriteLinks(body, (href) => map.get(href.trim()) ?? null)
  }
  /** Markdown (with One's links) → blocks. Links to stored files travel as placeholders (see restoreNodes). */
  const parse = (md: string): JSONContent[] => {
    const safe = rewriteLinks(md, (href, isImage) => (href.startsWith('onefile:') && !isImage ? FILE_URL + encodeURIComponent(href) : null))
    const s = ws()
    return restoreNodes(editor.markdownToDoc(safe), s.pages, (id) => s.pages[id]?.kind === 'database' && !!s.databases[id], untitled, (ref) => metas.get(ref)).content ?? []
  }

  /* ---------- row properties ---------- */
  const options = new Map<ID, SelectOption[]>()
  const optionId = (dbId: ID, d: PropertyDef, name: string): string => {
    const list = options.get(d.id) ?? [...(d.options ?? [])]
    options.set(d.id, list)
    const hit = list.find((o) => o.name.toLowerCase() === name.trim().toLowerCase())
    if (hit) return hit.id
    const opt: SelectOption = { id: newId(), name: name.trim(), color: 'default', ...(d.type === 'status' ? { group: 'todo' as const } : {}) }
    list.push(opt)
    ws().updateProperty(dbId, d.id, { options: [...list] })
    return opt.id
  }
  const norm = (v: YamlValue) => (Array.isArray(v) ? v.join('\u0001') : v === null || v === undefined ? '' : String(v))
  const applyProps = (page: Page, data: Map<string, YamlValue>, path: string) => {
    const db = page.databaseId ? ws().databases[page.databaseId] : undefined
    if (!db) return false
    let changed = false
    for (const d of db.properties) {
      if (!EDITABLE_PROPS.has(d.type)) continue
      const key = propKey(d.name)
      const base = BASE_KEYS as readonly string[]
      const hit = data.has(key) ? key : [...data.keys()].find((k) => !base.includes(k) && k.toLowerCase() === key.toLowerCase())
      if (hit === undefined) continue
      const fileVal = data.get(hit)!
      const cur = ws().pages[page.id]
      if (norm(fileVal) === norm(propYaml(plan.ctx, db, d, cur, path))) continue
      let value: PropertyValue
      const text = yamlText(fileVal).trim()
      switch (d.type) {
        case 'number':
        case 'rating': {
          const n = text ? Number(text.replace(',', '.')) : NaN
          value = Number.isFinite(n) ? n : null
          break
        }
        case 'checkbox':
          value = /^(true|yes|ja|x|1|✓|checked)$/i.test(text)
          break
        case 'date': {
          const parsed = text ? (cellValue({ name: d.name, type: 'date' }, text) as DateValue | null) : null
          const old = cur.properties[d.id] as DateValue | null | undefined
          value = parsed ? { ...parsed, ...(old?.reminder ? { reminder: old.reminder } : {}) } : null
          break
        }
        case 'select':
        case 'status':
          value = text ? optionId(db.id, d, text) : null
          break
        case 'multi_select':
          value = [...new Set(yamlList(fileVal).map((name) => optionId(db.id, d, name)))]
          break
        default:
          value = text
      }
      ws().setRowProperty(page.id, d.id, value)
      changed = true
    }
    return changed
  }

  /** Title, icon, properties and content of an existing page from a file. */
  const update = async (page: Page, file: ExternalFile, opts: { renamedFrom?: string } = {}) => {
    const fm = readFrontMatter(textOf(file.data))
    const { title: h1, rest } = takeTitle(fm.body)
    const body = h1 === null ? fm.body : rest
    const fmTitle = yamlText(fm.data.get('title')).trim() || null
    const current = page.title
    const differs = (c: string | null) => !!c && c !== (current.trim() || untitled) && !(c === untitled && !current.trim())
    let title: string | null = differs(h1) ? h1 : differs(fmTitle) ? fmTitle : null
    if (!title && opts.renamedFrom) {
      // renamed in the file manager: the new file name is the title
      const base = basename(file.path).replace(/\.(md|markdown)$/i, '')
      const want = safeName(current, untitled)
      if (base !== want && !new RegExp(`^${escapeRe(want)} \\(\\d+\\)$`).test(base)) title = base
    }
    let changed = false
    if (title !== null && title !== current) {
      ws().updatePage(page.id, { title })
      changed = true
    }
    if (fm.data.has('icon')) {
      const raw = yamlText(fm.data.get('icon'))
      if (raw !== (iconText(page.icon) ?? '')) {
        ws().updatePage(page.id, { icon: parseIcon(raw) })
        changed = true
      }
    }
    if (applyProps(page, fm.data, file.path)) changed = true
    const ours = ws().pages[page.id]?.content ?? null
    const merged = mergeBlocks(editor, ours, await toOne(body, file.path), parse)
    const empty = !body.trim()
    if (!(empty && !ours) && !deepEqual(merged, ours)) {
      if (ours) await snapshotNow(page.id, 'manual').catch(() => null)
      ws().setContent(page.id, empty ? null : merged, 'sync')
      changed = true
    }
    return changed
  }

  /** Page / database / row a folder belongs to; unknown folders become pages. */
  const parentFor = (dir: string): { parentId: ID | null; dbId: ID | null } => {
    if (!dir) return { parentId: null, dbId: null }
    const id = folderToId.get(dir)
    if (id) {
      const s = ws()
      return s.pages[id]?.kind === 'database' && s.databases[id] ? { parentId: id, dbId: id } : { parentId: id, dbId: null }
    }
    const up = parentFor(dirname(dir))
    const s = ws()
    const created = up.dbId ? s.createRow(up.dbId, { title: basename(dir) }) : s.createPage({ parentId: up.parentId, title: basename(dir) })
    folderToId.set(dir, created)
    res.created.push(created)
    return { parentId: created, dbId: null }
  }

  /* ---------- 1. files One knows ---------- */
  for (const file of input.changed) {
    const entry = manifest.entries[file.path]
    if (!entry) continue
    if (entry.kind !== 'page' && entry.kind !== 'row') {
      res.ignored.push(file.path)
      res.entries[file.path] = { ...entry, sha: file.sha }
      continue
    }
    const page = entry.id ? ws().pages[entry.id] : undefined
    if (!page) {
      input.added.push(file)
      res.removed.push(file.path)
      continue
    }
    const oneChanged = plan.layout.pathOfId.get(page.id) !== file.path || plan.renders.get(file.path)?.sha !== entry.out
    if (oneChanged) {
      res.conflicts.push(file)
      continue
    }
    if (await update(page, file)) res.updated.push(page.id)
    res.entries[file.path] = { ...entry, sha: file.sha }
    res.touched.push(file.path)
  }

  /* ---------- 2. new files (or known pages that moved) ---------- */
  for (const file of input.added) {
    if (!isPickable(file.path)) continue
    const fm = readFrontMatter(textOf(file.data))
    const id = yamlText(fm.data.get('id')).trim()
    const existing = id ? ws().pages[id] : undefined
    const oldPath = existing ? pathById.get(existing.id) : undefined
    const dir = nfc(dirname(file.path))
    if (existing && (!oldPath || !present.has(nfc(oldPath))) && !existing.trashed) {
      // the page's file was renamed / moved outside One
      if (oldPath) res.removed.push(oldPath)
      await update(existing, file, { renamedFrom: oldPath })
      if (!existing.databaseId) {
        const { parentId, dbId } = parentFor(dir)
        if (!dbId && parentId !== existing.parentId && parentId !== existing.id) ws().movePage(existing.id, parentId)
      }
      res.moved.push(existing.id)
      res.entries[file.path] = { kind: existing.databaseId ? 'row' : 'page', id: existing.id, sha: file.sha, out: '' }
      continue
    }
    const { title: h1 } = takeTitle(fm.body)
    // the same order an update uses: the heading, then the front matter, then the file name
    const title = h1 || yamlText(fm.data.get('title')).trim() || basename(file.path).replace(/\.(md|markdown)$/i, '')
    const { parentId, dbId } = parentFor(dir)
    const s = ws()
    const pageId = dbId ? s.createRow(dbId, { title }) : s.createPage({ parentId, title })
    const created = ws().pages[pageId]
    await update(created, file)
    res.created.push(pageId)
    res.entries[file.path] = { kind: dbId ? 'row' : 'page', id: pageId, sha: file.sha, out: '' }
  }

  /* ---------- 3. files that are gone ---------- */
  const moved = new Set(res.removed.map(nfc))
  for (const [path, e] of Object.entries(manifest.entries)) {
    if ((e.kind !== 'page' && e.kind !== 'row') || !e.id || present.has(nfc(path)) || moved.has(nfc(path))) continue
    const page = ws().pages[e.id]
    if (page && !page.trashed) res.missing.push({ path, id: e.id })
  }
  return res
}
