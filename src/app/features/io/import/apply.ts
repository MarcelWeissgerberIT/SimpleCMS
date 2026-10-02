/**
 * Commit an ImportPlan to the workspace: save attachments to IndexedDB, convert Markdown to
 * TipTap JSON (rewriting internal links → #/p/<id>, images → onefile refs), build databases
 * with inferred properties and rows, then insert everything with ONE store update.
 */
import type { JSONContent } from '@tiptap/core'
import { markdownToDoc } from '../../../editor'
import { useWorkspace, getWorkspaceSnapshot, plainText, defaultView, DEFAULT_PAGE_SETTINGS } from '../../../store/store'
import type { Database, ID, Page, PropertyDef, PropertyValue, View } from '../../../store/types'
import { saveFile } from '../../../lib/files'
import { newId } from '../../../lib/ids'
import { cellValue, RELATION_TOKEN, splitList, type ColumnSpec } from './csv'
import { basename, extname, hexOf, resolveTarget, rewriteLinks, type ImportPlan, type PlanNode } from './plan'

export interface ImportProgress {
  stage: 'files' | 'pages' | 'commit'
  done: number
  total: number
}

export interface ImportResult {
  rootId: ID | null
  pages: number
  databases: number
  rows: number
  files: number
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  json: 'application/json',
  zip: 'application/zip',
  html: 'text/html',
}
export const mimeOf = (path: string) => MIME[extname(path)] ?? 'application/octet-stream'
const IMAGE = /^image\//

const P_URL = 'https://one.import/p/'
const F_URL = 'https://one.import/f/'

interface SavedFile {
  ref: string
  name: string
  size: number
  image: boolean
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

export async function applyPlan(
  plan: ImportPlan,
  opts: { onProgress?: (p: ImportProgress) => void; containerTitle: string; containerNote?: string; untitled: string },
): Promise<ImportResult> {
  const progress = opts.onProgress ?? (() => {})
  const ids = new Map<string, ID>()
  const byHex = new Map<string, PlanNode>()
  const byKey = new Map<string, PlanNode>()
  for (const n of plan.nodes) {
    ids.set(n.key, newId())
    byKey.set(n.key, n)
    if (n.hex) byHex.set(n.hex, n)
  }

  /* ---------- 1. attachments ---------- */
  const saved = new Map<string, SavedFile>()
  const fileIndex: string[] = []
  const total = plan.files.size
  let done = 0
  for (const [path, bytes] of plan.files) {
    const type = mimeOf(path)
    const ref = await saveFile(new Blob([bytes as BlobPart], { type }), basename(path))
    saved.set(path, { ref, name: basename(path), size: bytes.byteLength, image: IMAGE.test(type) })
    fileIndex.push(path)
    done++
    if (done % 8 === 0 || done === total) {
      progress({ stage: 'files', done, total })
      await tick()
    }
  }

  const nodeFor = (dir: string, href: string): PlanNode | undefined => {
    const p = resolveTarget(dir, href)
    if (p) {
      const key = p.replace(/\.(md|markdown|txt)$/i, '').replace(/(_all)?\.csv$/i, '')
      const hit = byKey.get(key)
      if (hit) return hit
    }
    const hex = hexOf(href)
    return hex ? byHex.get(hex) : undefined
  }

  /* ---------- 2. databases ---------- */
  const dbProps = new Map<string, Array<{ spec: ColumnSpec; def: PropertyDef }>>()
  const databases: Record<ID, Database> = {}
  for (const n of plan.nodes) {
    if (n.kind !== 'database') continue
    const rows = plan.nodes.filter((r) => r.kind === 'row' && r.dbKey === n.key)
    const cols = (n.columns ?? []).map((spec) => {
      const def: PropertyDef = { id: newId(), name: spec.name, type: spec.type }
      if (spec.options) def.options = spec.options
      if (spec.type === 'number' && spec.numberFormat && spec.numberFormat !== 'number') def.numberFormat = spec.numberFormat
      if (spec.type === 'relation') {
        // target = database of the first resolvable referenced row
        let target: string | undefined
        for (const r of rows) {
          for (const tok of splitList(r.cells?.[spec.name] ?? '')) {
            const m = tok.match(RELATION_TOKEN)
            const hit = m ? nodeFor(n.csvDir ?? '', m[2]) : undefined
            if (hit?.kind === 'row') target = hit.dbKey
            if (target) break
          }
          if (target) break
        }
        if (target) def.relationDatabaseId = ids.get(target)
        else def.type = 'text'
      }
      return { spec: { ...spec, type: def.type as ColumnSpec['type'] }, def }
    })
    if (!cols.length || cols[0].def.type !== 'title') cols.unshift({ spec: { name: 'Name', type: 'title' }, def: { id: newId(), name: 'Name', type: 'title' } })
    dbProps.set(n.key, cols)
    const properties = cols.map((c) => c.def)
    const db: Database = { id: ids.get(n.key)!, properties, views: [], nextUniqueId: 1 }
    const views: View[] = [defaultView('table', db, 'Table')]
    const group = properties.find((p) => p.type === 'status') ?? properties.find((p) => p.type === 'select')
    if (group) views.push({ ...defaultView('board', db, 'Board'), groupBy: group.id })
    const date = properties.find((p) => p.type === 'date')
    if (date) views.push({ ...defaultView('calendar', db, 'Calendar'), dateProperty: date.id })
    db.views = views
    databases[db.id] = db
  }

  /* ---------- 3. pages ---------- */
  const t0 = Date.now()
  const pages: Record<ID, Page> = {}
  const siblingIndex = new Map<string | null, number>()
  const state = useWorkspace.getState()
  let rootOrder = 0
  for (const p of Object.values(state.pages)) if (!p.parentId && p.order > rootOrder) rootOrder = p.order

  const multiRoot = plan.roots.length > 1
  const containerId = multiRoot ? newId() : null

  const contentFor = (n: PlanNode): JSONContent | null => {
    const blocks: JSONContent[] = []
    if (n.body.trim()) {
      if (n.format === 'text') {
        for (const para of n.body.split(/\n{2,}/)) {
          const lines = para.split('\n')
          const content: JSONContent[] = []
          lines.forEach((l, i) => {
            if (i) content.push({ type: 'hardBreak' })
            if (l) content.push({ type: 'text', text: l })
          })
          blocks.push(content.length ? { type: 'paragraph', content } : { type: 'paragraph' })
        }
      } else {
        const md = rewriteLinks(n.body, (href) => {
          const p = resolveTarget(n.dir, href)
          if (p && saved.has(p)) return F_URL + fileIndex.indexOf(p)
          const target = nodeFor(n.dir, href)
          if (target) return P_URL + ids.get(target.key)
          return null
        })
        const doc = markdownToDoc(md)
        blocks.push(...fixBlocks(doc.content ?? []))
      }
    }
    if (n.kind === 'folder') {
      for (const c of plan.nodes) if (c.parentKey === n.key && c.kind !== 'row') blocks.push(linkBlock(ids.get(c.key)!, c.kind === 'database'))
    }
    for (const path of n.attachments) {
      const f = saved.get(path)
      if (f) blocks.push(fileNode(f))
    }
    const meaningful = blocks.filter((b) => !(b.type === 'paragraph' && !b.content?.length))
    return meaningful.length ? { type: 'doc', content: blocks } : null
  }

  const fileNode = (f: SavedFile): JSONContent =>
    f.image ? { type: 'image', attrs: { src: f.ref, alt: f.name } } : { type: 'fileBlock', attrs: { src: f.ref, name: f.name, size: f.size } }
  const linkBlock = (id: ID, isDb: boolean): JSONContent => (isDb ? { type: 'databaseBlock', attrs: { databaseId: id, viewId: null } } : { type: 'pageLink', attrs: { pageId: id } })
  const isDbId = (id: ID) => !!databases[id]

  /** Rewrite placeholder URLs: standalone links → page link / database / file blocks; inline links → #/p/<id>. */
  function fixBlocks(nodes: JSONContent[], promote = true): JSONContent[] {
    const out: JSONContent[] = []
    for (const n of nodes) {
      if (promote && n.type === 'paragraph' && n.content?.length) {
        const parts = n.content.filter((c) => !(c.type === 'text' && !c.text?.trim()) && c.type !== 'hardBreak')
        const only = parts.length === 1 ? parts[0] : null
        const href: string | undefined = only?.type === 'text' ? only.marks?.find((m) => m.type === 'link')?.attrs?.href : undefined
        if (href?.startsWith(P_URL)) {
          const id = href.slice(P_URL.length)
          out.push(linkBlock(id, isDbId(id)))
          continue
        }
        if (href?.startsWith(F_URL)) {
          const f = saved.get(fileIndex[Number(href.slice(F_URL.length))])
          if (f) {
            out.push(fileNode(f))
            continue
          }
        }
      }
      if (n.type === 'image' && typeof n.attrs?.src === 'string' && n.attrs.src.startsWith(F_URL)) {
        const f = saved.get(fileIndex[Number(n.attrs.src.slice(F_URL.length))])
        if (f) {
          out.push(f.image ? { ...n, attrs: { ...n.attrs, src: f.ref } } : fileNode(f))
          continue
        }
      }
      out.push(fixInline(n))
    }
    return out
  }

  function fixInline(n: JSONContent): JSONContent {
    const next: JSONContent = { ...n }
    if (n.marks) {
      next.marks = n.marks.flatMap((m) => {
        const href: unknown = m.type === 'link' ? m.attrs?.href : undefined
        if (typeof href !== 'string') return [m]
        if (href.startsWith(P_URL)) return [{ ...m, attrs: { ...m.attrs, href: `#/p/${href.slice(P_URL.length)}`, target: null } }]
        if (href.startsWith(F_URL)) return []
        return [m]
      })
      if (!next.marks.length) delete next.marks
    }
    if (n.type === 'image' && typeof n.attrs?.src === 'string' && n.attrs.src.startsWith(F_URL)) {
      const f = saved.get(fileIndex[Number(n.attrs.src.slice(F_URL.length))])
      next.attrs = { ...n.attrs, src: f?.image ? f.ref : '' }
    }
    if (n.content) next.content = PROMOTE.has(n.type ?? '') ? fixBlocks(n.content) : CONTAINERS.has(n.type ?? '') ? fixBlocks(n.content, false) : n.content.map(fixInline)
    return next
  }

  let processed = 0
  for (const n of plan.nodes) {
    const id = ids.get(n.key)!
    let parentId: ID | null = n.parentKey ? ids.get(n.parentKey)! : containerId
    const sibKey = parentId ?? '__root__'
    const idx = (siblingIndex.get(sibKey) ?? 0) + 1
    siblingIndex.set(sibKey, idx)
    const order = parentId ? idx : rootOrder + idx
    const content = n.kind === 'database' ? null : contentFor(n)
    const properties: Record<ID, PropertyValue> = {}
    let title = n.title
    if (n.kind === 'row') {
      const cols = dbProps.get(n.dbKey!) ?? []
      const db = byKey.get(n.dbKey!)
      for (const { spec, def } of cols) {
        const raw = n.cells?.[spec.name] ?? ''
        if (def.type === 'title') {
          title = n.title || raw.trim()
          continue
        }
        if (!raw.trim()) continue
        if (def.type === 'relation') {
          const rel: ID[] = []
          for (const tok of splitList(raw)) {
            const m = tok.match(RELATION_TOKEN)
            const hit = m ? nodeFor(db?.csvDir ?? '', m[2]) : undefined
            if (hit) rel.push(ids.get(hit.key)!)
          }
          properties[def.id] = rel
        } else if (def.type === 'files') {
          properties[def.id] = splitList(raw)
            .map((tok) => {
              const p = resolveTarget(db?.csvDir ?? '', tok)
              return p && saved.has(p) ? saved.get(p)!.ref : /^https?:/.test(tok) ? tok : ''
            })
            .filter(Boolean)
        } else {
          const v = cellValue(spec, raw)
          if (v !== null && v !== undefined) properties[def.id] = v
        }
      }
      parentId = ids.get(n.dbKey!)!
    }
    pages[id] = {
      id,
      kind: n.kind === 'database' ? 'database' : 'page',
      title: title || (n.kind === 'row' ? '' : opts.untitled),
      icon: null,
      cover: null,
      parentId,
      databaseId: n.kind === 'row' ? parentId : null,
      properties,
      content,
      contentRev: content ? 1 : 0,
      contentOrigin: content ? 'import' : null,
      favorite: false,
      trashed: false,
      trashedAt: null,
      createdAt: t0,
      updatedAt: t0,
      order,
      settings: { ...DEFAULT_PAGE_SETTINGS },
      plain: content ? plainText(content) : '',
    }
    processed++
    if (processed % 6 === 0 || processed === plan.nodes.length) {
      progress({ stage: 'pages', done: processed, total: plan.nodes.length })
      await tick()
    }
  }

  if (containerId) {
    pages[containerId] = {
      id: containerId,
      kind: 'page',
      title: opts.containerTitle,
      icon: { type: 'asset', value: 'import' },
      cover: null,
      parentId: null,
      databaseId: null,
      properties: {},
      content: {
        type: 'doc',
        content: [
          ...(opts.containerNote ? [{ type: 'callout', attrs: { icon: '📦', color: 'gray' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: opts.containerNote }] }] }] : []),
          ...plan.roots.map((k) => linkBlock(ids.get(k)!, byKey.get(k)?.kind === 'database')),
        ],
      },
      contentRev: 1,
      contentOrigin: 'import',
      favorite: false,
      trashed: false,
      trashedAt: null,
      createdAt: t0,
      updatedAt: t0,
      order: rootOrder + 1,
      settings: { ...DEFAULT_PAGE_SETTINGS },
      plain: opts.containerNote ?? '',
    }
  }

  /* ---------- 4. commit (single store update) ---------- */
  progress({ stage: 'commit', done: 1, total: 1 })
  const snap = getWorkspaceSnapshot()
  useWorkspace.getState().replaceAll({
    ...snap,
    pages: { ...snap.pages, ...pages },
    databases: { ...snap.databases, ...databases },
  })

  let nPages = 0
  let nDbs = 0
  let nRows = 0
  for (const n of plan.nodes) {
    if (n.kind === 'database') nDbs++
    else if (n.kind === 'row') nRows++
    else nPages++
  }
  const rootId = containerId ?? (plan.roots[0] ? ids.get(plan.roots[0])! : null)
  return { rootId, pages: nPages + (containerId ? 1 : 0), databases: nDbs, rows: nRows, files: saved.size }
}

/** Containers whose children may become page-link / file blocks */
const PROMOTE = new Set(['doc', 'blockquote', 'callout', 'detailsContent', 'column'])
/** Other block containers (first child must stay a paragraph etc.) */
const CONTAINERS = new Set(['listItem', 'taskItem', 'details', 'columns', 'bulletList', 'orderedList', 'taskList', 'tableCell', 'tableHeader', 'tableRow', 'table'])
