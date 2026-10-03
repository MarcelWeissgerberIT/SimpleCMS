/**
 * Commit an ImportPlan to the workspace: save attachments to IndexedDB, convert Markdown / HTML to
 * TipTap JSON (rewriting internal links → page links / mentions, images → onefile refs), build
 * databases (inferred from CSV, or a known schema like Trello's) and rows, then insert everything
 * with ONE store update — so the whole import lands under one root page (trash it to undo).
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace, getWorkspaceSnapshot, plainText, defaultView, DEFAULT_PAGE_SETTINGS } from '../../../store/store'
import type { Database, ID, Page, Person, PropertyDef, PropertyValue, View } from '../../../store/types'
import { saveFile } from '../../../lib/files'
import { newId } from '../../../lib/ids'
import { useCloud } from '../../../cloud'
import { t } from '../../../i18n'
import { cellValue, RELATION_TOKEN, splitList, type ColumnSpec } from './csv'
import { basename, extname, hexOf, resolveTarget, rewriteLinks, type ImportPlan, type PlanNode } from './plan'
import { FRAG, calloutBlocks, hasCalloutMarker } from './obsidian'
import { warningsToReport, type ReportItem } from './report'
import type { HtmlToDoc } from './htmldoc'

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
  /** what could not be carried over 1:1 (unresolved links, skipped files …) */
  report: ReportItem[]
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
  m4a: 'audio/mp4',
  m4v: 'video/mp4',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  aac: 'audio/aac',
  flac: 'audio/flac',
  json: 'application/json',
  zip: 'application/zip',
  html: 'text/html',
}
export const mimeOf = (path: string) => MIME[extname(path)] ?? 'application/octet-stream'
const IMAGE = /^image\//

const P_URL = 'https://one.import/p/'
const F_URL = 'https://one.import/f/'

/** Placeholder href → id / file number + the planner's fragment ("one-m", "one-h=…"). */
function splitPlaceholder(href: string, prefix: string): { ref: string; frag: string } {
  const rest = href.slice(prefix.length)
  const i = rest.indexOf('#')
  return i < 0 ? { ref: rest, frag: '' } : { ref: rest.slice(0, i), frag: rest.slice(i + 1) }
}
/** Only the planners' own fragments survive the link rewrite (Notion block ids etc. are dropped). */
const keepFrag = (href: string) => {
  const i = href.indexOf('#')
  const frag = i < 0 ? '' : href.slice(i + 1)
  return frag.startsWith('one-') ? `#${frag}` : ''
}
const ANCHOR = '#one-anchor='

interface SavedFile {
  ref: string
  name: string
  size: number
  image: boolean
  /** video / audio files become players */
  media: 'video' | 'audio' | null
}

/** Yield to the browser (MessageChannel: not clamped to 4 ms like nested setTimeouts). */
function yieldNow(): Promise<void> {
  if (typeof MessageChannel === 'undefined') return new Promise((r) => setTimeout(r, 0))
  return new Promise((r) => {
    const ch = new MessageChannel()
    ch.port1.onmessage = () => {
      ch.port1.close()
      r()
    }
    ch.port2.postMessage(null)
  })
}

/** Cooperative scheduling on a time budget: work for ~12 ms, then let the UI paint. */
function budget(ms = 12) {
  let last = performance.now()
  return async (force = false) => {
    if (!force && performance.now() - last < ms) return false
    await yieldNow()
    last = performance.now()
    return true
  }
}

const headingKey = (s: string) => s.replace(/[*_`~=[\]]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
const blockId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)

export async function applyPlan(
  plan: ImportPlan,
  opts: {
    onProgress?: (p: ImportProgress) => void
    containerTitle: string
    containerNote?: string
    untitled: string
    /** localized names for the generated views */
    viewNames?: { table: string; board: string; calendar: string }
  },
): Promise<ImportResult> {
  if (useCloud.getState().readOnly) throw new Error(t('features.io.err.viewOnly'))
  const progress = opts.onProgress ?? (() => {})
  // the editor's converters (and the HTML sanitizer) are loaded on demand
  const { markdownToDoc } = await import('../../../editor')
  const htmlToDoc: HtmlToDoc | null = plan.nodes.some((n) => n.format === 'html' && n.body.trim()) ? await (await import('./htmldoc')).htmlConverter() : null
  const viewName = opts.viewNames ?? { table: 'Table', board: 'Board', calendar: 'Calendar' }
  const ids = new Map<string, ID>()
  const byHex = new Map<string, PlanNode>()
  const byKey = new Map<string, PlanNode>()
  for (const n of plan.nodes) {
    ids.set(n.key, newId())
    byKey.set(n.key, n)
    if (n.hex) byHex.set(n.hex, n)
  }

  const pause = budget()

  /* ---------- 1. attachments ---------- */
  const saved = new Map<string, SavedFile>()
  const fileIndex: string[] = []
  const fileNo = new Map<string, number>()
  const total = plan.files.size
  let done = 0
  for (const [path, bytes] of plan.files) {
    const type = mimeOf(path)
    const ref = await saveFile(new Blob([bytes as BlobPart], { type }), basename(path))
    saved.set(path, { ref, name: basename(path), size: bytes.byteLength, image: IMAGE.test(type), media: /^video\//.test(type) ? 'video' : /^audio\//.test(type) ? 'audio' : null })
    fileNo.set(path, fileIndex.length)
    fileIndex.push(path)
    done++
    if ((await pause()) || done === total) progress({ stage: 'files', done, total })
  }
  const fileOf = (ref: string) => saved.get(fileIndex[Number(ref)])

  const nodeFor = (dir: string, href: string): PlanNode | undefined => {
    const p = resolveTarget(dir, href)
    if (p) {
      const key = plan.pathKeys?.get(p) ?? p.replace(/\.(md|markdown|txt|html?)$/i, '').replace(/(_all)?\.(csv|tsv)$/i, '')
      const hit = byKey.get(key)
      if (hit) return hit
    }
    const hex = hexOf(href)
    return hex ? byHex.get(hex) : undefined
  }

  /** Link / image target inside node `n` → placeholder URL (file, page) or null (leave as is). */
  const placeholder = (n: PlanNode, href: string): string | null => {
    const p = resolveTarget(n.dir, href)
    if (p && saved.has(p)) return F_URL + fileNo.get(p) + keepFrag(href)
    const target = nodeFor(n.dir, href)
    if (target) return P_URL + ids.get(target.key) + keepFrag(href)
    return null
  }

  // children per parent (folder pages list theirs; databases need their rows)
  const kids = new Map<string, PlanNode[]>()
  for (const n of plan.nodes) {
    const k = n.kind === 'row' ? `row:${n.dbKey}` : `kid:${n.parentKey}`
    const list = kids.get(k)
    if (list) list.push(n)
    else kids.set(k, [n])
  }

  /* ---------- 2. databases ---------- */
  const dbProps = new Map<string, Array<{ spec: ColumnSpec; def: PropertyDef }>>()
  const databases: Record<ID, Database> = {}
  for (const n of plan.nodes) {
    if (n.kind !== 'database') continue
    const rows = kids.get(`row:${n.key}`) ?? []
    let properties: PropertyDef[]
    if (n.properties?.length) {
      // a known schema (Trello): taken as is
      properties = n.properties.map((p) => ({ ...p, ...(p.options ? { options: p.options.map((o) => ({ ...o })) } : {}) }))
      dbProps.set(n.key, [])
    } else {
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
              const hit = m ? (nodeFor(n.csvDir ?? '', m[2]) ?? nodeFor(r.dir, m[2])) : undefined
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
      properties = cols.map((c) => c.def)
    }
    const db: Database = { id: ids.get(n.key)!, properties, views: [], nextUniqueId: 1 }
    const views: View[] = [defaultView('table', db, viewName.table)]
    const group = properties.find((p) => p.type === 'status') ?? properties.find((p) => p.type === 'select')
    if (group) {
      const board: View = { ...defaultView('board', db, viewName.board), groupBy: group.id }
      if (n.primaryView === 'board') views.unshift(board)
      else views.push(board)
    }
    const date = properties.find((p) => p.type === 'date')
    if (date) views.push({ ...defaultView('calendar', db, viewName.calendar), dateProperty: date.id })
    db.views = views
    databases[db.id] = db
  }

  /* ---------- people (person properties): reuse workspace people by name ---------- */
  const people: Person[] = [...getWorkspaceSnapshot().people]
  const personId = new Map<string, string>()
  for (const p of plan.people ?? []) {
    const hit = people.find((x) => x.name.trim().toLowerCase() === p.name.trim().toLowerCase())
    if (hit) personId.set(p.id, hit.id)
    else {
      people.push({ ...p })
      personId.set(p.id, p.id)
    }
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
  /** pages whose content links to headings of other pages (resolved once every page exists) */
  const anchored: ID[] = []

  const contentFor = (n: PlanNode, id: ID): JSONContent | null => {
    const blocks: JSONContent[] = []
    if (n.meta?.length) blocks.push(metaCallout(n.meta))
    if (n.body.trim()) {
      if (n.format === 'text') {
        for (const para of n.body.replace(/\s+$/, '').replace(/^\n+/, '').split(/\n{2,}/)) {
          const lines = para.split('\n')
          const content: JSONContent[] = []
          lines.forEach((l, i) => {
            if (i) content.push({ type: 'hardBreak' })
            if (l) content.push({ type: 'text', text: l })
          })
          blocks.push(content.length ? { type: 'paragraph', content } : { type: 'paragraph' })
        }
      } else if (n.format === 'html') {
        const doc = htmlToDoc!(n.body, { title: n.title, rewrite: (href) => placeholder(n, href) })
        blocks.push(...fixBlocks(doc.content ?? []))
      } else {
        const md = rewriteLinks(n.body, (href) => placeholder(n, href))
        let content = markdownToDoc(md).content ?? []
        if (hasCalloutMarker(md)) content = calloutBlocks(content)
        blocks.push(...fixBlocks(content))
      }
    }
    if (n.kind === 'folder') {
      const list = (kids.get(`kid:${n.key}`) ?? []).filter((c) => c.kind !== 'row')
      // page cards for a normal folder; a big one (an Evernote notebook with 1,000 notes) gets a light
      // link index — 25 links per paragraph, one per line (renders several times faster than cards or a list)
      if (list.length <= BIG_FOLDER) for (const c of list) blocks.push(linkBlock(ids.get(c.key)!, c.kind === 'database'))
      else
        for (let i = 0; i < list.length; i += 25)
          blocks.push({
            type: 'paragraph',
            content: list.slice(i, i + 25).flatMap((c, j) => [
              ...(j ? [{ type: 'hardBreak' }] : []),
              { type: 'text', text: c.title || opts.untitled, marks: [{ type: 'link', attrs: { href: `#/p/${ids.get(c.key)}` } }] },
            ]),
          })
    }
    // a database that shares the page's name ("X.md" + "X.csv") sits inline at the end, unless linked already
    for (const k of n.embeds ?? []) {
      const dbId = ids.get(k)
      if (dbId && !JSON.stringify(blocks).includes(`"databaseId":"${dbId}"`)) blocks.push(linkBlock(dbId, true))
    }
    for (const path of n.attachments) {
      const f = saved.get(path)
      if (f) blocks.push(fileNode(f))
    }
    const meaningful = blocks.filter((b) => !(b.type === 'paragraph' && !b.content?.length))
    if (!meaningful.length) return null
    const doc: JSONContent = { type: 'doc', content: blocks }
    if (JSON.stringify(doc).includes(ANCHOR)) anchored.push(id)
    return doc
  }

  const fileNode = (f: SavedFile): JSONContent =>
    f.image
      ? { type: 'image', attrs: { src: f.ref, alt: f.name } }
      : f.media
        ? { type: f.media, attrs: { src: f.ref, name: f.name } }
        : { type: 'fileBlock', attrs: { src: f.ref, name: f.name, size: f.size } }
  const linkBlock = (id: ID, isDb: boolean): JSONContent => (isDb ? { type: 'databaseBlock', attrs: { databaseId: id, viewId: null } } : { type: 'pageLink', attrs: { pageId: id } })
  const isDbId = (id: ID) => !!databases[id]
  /** image from a file placeholder ("…/f/3#one-w=300" → width 300) */
  const imageAttrs = (attrs: Record<string, unknown>, f: SavedFile, frag: string) => {
    const w = frag.startsWith(FRAG.width) ? Number(frag.slice(FRAG.width.length)) : 0
    return { ...attrs, src: f.ref, ...(w > 0 ? { width: w } : {}) }
  }

  /** Rewrite placeholder URLs: standalone links → page link / database / file blocks; inline links → #/p/<id> or mentions. */
  function fixBlocks(nodes: JSONContent[], promote = true): JSONContent[] {
    const out: JSONContent[] = []
    for (const n of nodes) {
      if (promote && n.type === 'paragraph' && n.content?.length) {
        const parts = n.content.filter((c) => !(c.type === 'text' && !c.text?.trim()) && c.type !== 'hardBreak')
        const only = parts.length === 1 ? parts[0] : null
        const href: string | undefined = only?.type === 'text' ? only.marks?.find((m) => m.type === 'link')?.attrs?.href : undefined
        if (href?.startsWith(P_URL)) {
          const { ref, frag } = splitPlaceholder(href, P_URL)
          // wiki links ([[Note]], [[Note|alias]], [[Note#H]]) stay inline; ![[Note]] and plain links become blocks
          if (!frag || frag === FRAG.embed) {
            out.push(linkBlock(ref, isDbId(ref)))
            continue
          }
        }
        if (href?.startsWith(F_URL)) {
          const f = fileOf(splitPlaceholder(href, F_URL).ref)
          if (f) {
            out.push(fileNode(f))
            continue
          }
        }
      }
      if (n.type === 'image' && typeof n.attrs?.src === 'string' && n.attrs.src.startsWith(F_URL)) {
        const { ref, frag } = splitPlaceholder(n.attrs.src, F_URL)
        const f = fileOf(ref)
        if (f) {
          out.push(f.image ? { ...n, attrs: imageAttrs(n.attrs, f, frag) } : fileNode(f))
          continue
        }
      }
      out.push(fixInline(n))
    }
    return out
  }

  function fixInline(n: JSONContent): JSONContent {
    let next: JSONContent = { ...n }
    if (n.marks) {
      let mention: { id: string } | null = null
      next.marks = n.marks.flatMap((m) => {
        const href: unknown = m.type === 'link' ? m.attrs?.href : undefined
        if (typeof href !== 'string') return [m]
        if (href.startsWith(P_URL)) {
          const { ref, frag } = splitPlaceholder(href, P_URL)
          if (frag === FRAG.mention && n.type === 'text') {
            mention = { id: ref }
            return []
          }
          const anchor = frag.startsWith(FRAG.heading) ? `${ANCHOR}${frag.slice(FRAG.heading.length)}` : ''
          return [{ ...m, attrs: { ...m.attrs, href: `#/p/${ref}${anchor}`, target: null } }]
        }
        if (href.startsWith(F_URL)) return []
        return [m]
      })
      if (!next.marks.length) delete next.marks
      if (mention) next = { type: 'mention', attrs: { id: (mention as { id: string }).id, label: n.text ?? '', kind: 'page' }, ...(next.marks ? { marks: next.marks } : {}) }
    }
    if (n.type === 'image' && typeof n.attrs?.src === 'string' && n.attrs.src.startsWith(F_URL)) {
      const { ref, frag } = splitPlaceholder(n.attrs.src, F_URL)
      const f = fileOf(ref)
      next.attrs = f?.image ? imageAttrs(n.attrs, f, frag) : { ...n.attrs, src: '' }
    }
    if ((n.type === 'video' || n.type === 'audio') && typeof n.attrs?.src === 'string' && n.attrs.src.startsWith(F_URL)) {
      const f = fileOf(splitPlaceholder(n.attrs.src, F_URL).ref)
      next.attrs = { ...n.attrs, src: f ? f.ref : null, name: n.attrs.name || f?.name || '' }
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
    const content = n.kind === 'database' ? null : contentFor(n, id)
    const properties: Record<ID, PropertyValue> = {}
    let title = n.title
    if (n.kind === 'row') {
      if (n.values) {
        // typed values (Trello): person ids follow the people merge
        const defs = databases[ids.get(n.dbKey!)!]?.properties ?? []
        for (const [pid, v] of Object.entries(n.values)) {
          const def = defs.find((d) => d.id === pid)
          if (!def || v === null || v === undefined) continue
          properties[pid] = def.type === 'person' && Array.isArray(v) ? v.map((x) => personId.get(x) ?? x) : v
        }
      }
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
            // CSV cells are relative to the CSV; values from a row page's header to that page
            const hit = m ? (nodeFor(db?.csvDir ?? '', m[2]) ?? nodeFor(n.dir, m[2])) : undefined
            if (hit && !rel.includes(ids.get(hit.key)!)) rel.push(ids.get(hit.key)!)
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
    const createdAt = n.createdAt ?? t0
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
      createdAt,
      updatedAt: Math.max(n.updatedAt ?? createdAt, createdAt),
      order,
      settings: { ...DEFAULT_PAGE_SETTINGS },
      plain: content ? plainText(content) : '',
    }
    processed++
    if ((await pause()) || processed === plan.nodes.length) progress({ stage: 'pages', done: processed, total: plan.nodes.length })
  }

  /* ---------- 3b. [[Note#Heading]] → link to that heading's block ---------- */
  for (const id of anchored) {
    const walk = (n: JSONContent) => {
      for (const m of n.marks ?? []) {
        const href = m.type === 'link' ? m.attrs?.href : undefined
        if (typeof href !== 'string' || !href.includes(ANCHOR)) continue
        const [base, raw] = href.split(ANCHOR)
        const target = pages[base.slice('#/p/'.length)]
        let heading: JSONContent | undefined
        const want = headingKey(decodeURIComponent(raw))
        const find = (x: JSONContent) => {
          if (heading) return
          if (x.type === 'heading' && headingKey(plainText(x)) === want) heading = x
          else x.content?.forEach(find)
        }
        if (target?.content) find(target.content)
        if (heading) {
          heading.attrs = { ...heading.attrs, id: (heading.attrs?.id as string | undefined) || blockId() }
          m.attrs = { ...m.attrs, href: `${base}?b=${heading.attrs.id}` }
        } else m.attrs = { ...m.attrs, href: base }
      }
      n.content?.forEach(walk)
    }
    if (pages[id].content) walk(pages[id].content!)
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
    people: [...snap.people, ...people.filter((p) => !snap.people.some((x) => x.id === p.id))],
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
  // the container page is not counted: the numbers match the note inside it
  return { rootId, pages: nPages, databases: nDbs, rows: nRows, files: saved.size, report: [...(plan.report ?? []), ...warningsToReport(plan.warnings)] }
}

/** YAML front matter → a quiet properties callout ("tags: a, b" per line). */
function metaCallout(meta: Array<[string, string]>): JSONContent {
  const content: JSONContent[] = []
  meta.forEach(([k, v], i) => {
    if (i) content.push({ type: 'hardBreak' })
    content.push({ type: 'text', text: `${k}: `, marks: [{ type: 'bold' }] }, { type: 'text', text: v })
  })
  return { type: 'callout', attrs: { icon: '🏷️', color: 'gray' }, content: [{ type: 'paragraph', content }] }
}

/** Folders with more children than this list them as links instead of page cards (render cost) */
const BIG_FOLDER = 60

/** Containers whose children may become page-link / file blocks */
const PROMOTE = new Set(['doc', 'blockquote', 'callout', 'detailsContent', 'column'])
/** Other block containers (first child must stay a paragraph etc.) */
const CONTAINERS = new Set(['listItem', 'taskItem', 'details', 'columns', 'bulletList', 'orderedList', 'taskList', 'tableCell', 'tableHeader', 'tableRow', 'table'])
