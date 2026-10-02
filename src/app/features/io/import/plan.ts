/**
 * Import planner (pure, no DOM / store — unit-testable in Node).
 *
 * Turns a flat list of files (from a Notion "Markdown & CSV" export ZIP, a dropped folder,
 * or loose .md/.txt/.csv files) into an ordered tree of nodes:
 *   - .md            → page (title from first H1, Notion's trailing " <32-hex>" id stripped)
 *   - folder of a md → its child pages
 *   - .csv           → database (columns inferred), rows = CSV rows enriched with the
 *                      matching .md files in the sibling folder ("Property: value" header lines)
 *   - other files    → attachments (saved to IndexedDB by apply.ts, references rewritten)
 * Folders without an own page become plain container pages.
 */
import { unzip } from 'fflate'
import { inferColumns, parseCSV, splitList, type ColumnSpec } from './csv'

export interface ImportEntry {
  path: string
  data: Uint8Array
}

export type PlanKind = 'page' | 'database' | 'row' | 'folder'

export interface PlanNode {
  key: string
  kind: PlanKind
  title: string
  /** Notion block id (32 hex) if the name carried one */
  hex: string | null
  parentKey: string | null
  /** Directory against which relative links in this node are resolved */
  dir: string
  /** Body (Markdown, or plain text when format = 'text') */
  body: string
  format: 'markdown' | 'text'
  /** database rows: raw cells by column name */
  cells?: Record<string, string>
  /** databases: inferred columns (index 0 = title) */
  columns?: ColumnSpec[]
  /** databases: the CSV's directory (cells with relative paths resolve against it) */
  csvDir?: string
  dbKey?: string
  /** files in this node's folder that no page references (appended as file blocks) */
  attachments: string[]
}

export interface ImportPlan {
  nodes: PlanNode[]
  files: Map<string, Uint8Array>
  roots: string[]
  isNotion: boolean
  warnings: string[]
}

const JUNK = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini|\._[^/]*)(\/|$)/
const HEX = /[0-9a-f]{32}/
const NAME_ID = /\s+([0-9a-f]{32})$/
const TRANSPARENT = /^(Private & Shared|Privat & Geteilt|Export-[0-9a-f-]+|export)$/i

/* ------------------------------------------------------------------ */
/* Paths                                                               */
/* ------------------------------------------------------------------ */

export function normPath(p: string): string {
  const out: string[] = []
  for (const part of p.normalize('NFC').replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

export const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
export const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1)
export const extname = (p: string) => {
  const b = basename(p)
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(i + 1).toLowerCase() : ''
}
const stripExt = (p: string) => {
  const i = p.lastIndexOf('.')
  return i > p.lastIndexOf('/') ? p.slice(0, i) : p
}

/** "Meeting notes 0123…cdef" → { title: "Meeting notes", hex: "0123…cdef" } */
export function splitNotionName(name: string): { title: string; hex: string | null } {
  const m = name.match(NAME_ID)
  if (m) return { title: name.slice(0, m.index).trim(), hex: m[1] }
  return { title: name.trim(), hex: null }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** Resolve a link target found in a file inside `fromDir` → normalized path inside the import, or null for externals. */
export function resolveTarget(fromDir: string, href: string): string | null {
  let h = href.trim().replace(/^<|>$/g, '')
  if (!h || h.startsWith('#')) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return null
  h = h.split(/[?#]/)[0]
  return normPath(`${fromDir}/${safeDecode(h)}`)
}

/** Notion id inside any href (notion.so URLs or file names). */
export function hexOf(href: string): string | null {
  const m = safeDecode(href).replace(/-/g, '').match(HEX)
  return m ? m[0] : null
}

/* ------------------------------------------------------------------ */
/* ZIP                                                                 */
/* ------------------------------------------------------------------ */

function unzipAsync(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) =>
    unzip(data, { filter: (f) => !f.name.endsWith('/') && !JUNK.test(f.name) }, (err, out) => (err ? reject(err) : resolve(out))),
  )
}

export const isZip = (data: Uint8Array) => data.length > 4 && data[0] === 0x50 && data[1] === 0x4b && (data[2] === 3 || data[2] === 5)

/** Unzip (recursively: Notion splits big exports into nested "…Part-1.zip" files). */
export async function expandZip(data: Uint8Array, prefix = '', depth = 0): Promise<ImportEntry[]> {
  const files = await unzipAsync(data)
  const out: ImportEntry[] = []
  for (const [name, bytes] of Object.entries(files)) {
    const path = normPath(`${prefix}/${name}`)
    if (extname(path) === 'zip' && depth < 3 && isZip(bytes)) {
      // nested part: its content lives at the same level as the part itself
      out.push(...(await expandZip(bytes, dirname(path), depth + 1)))
    } else out.push({ path, data: bytes })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Markdown helpers                                                    */
/* ------------------------------------------------------------------ */

const LINK_RE = /(!?)\[((?:[^\]\\]|\\.)*)\]\(\s*(<[^>]*>|[^)\s]+(?:\([^)\s]*\)[^)\s]*)*)(\s+"[^"]*")?\s*\)/g

/** All link/image targets in a Markdown string, in order. */
export function linkTargets(md: string): string[] {
  const out: string[] = []
  for (const m of md.matchAll(LINK_RE)) out.push(m[3])
  return out
}

/** Rewrite every link/image target with `fn` (return null to keep). */
export function rewriteLinks(md: string, fn: (href: string, isImage: boolean, text: string) => string | null): string {
  return md.replace(LINK_RE, (all, bang: string, text: string, href: string, title: string | undefined) => {
    const next = fn(href.replace(/^<|>$/g, ''), bang === '!', text)
    return next === null ? all : `${bang}[${text}](${next}${title ?? ''})`
  })
}

/** Split leading "# Title" off a Markdown document. */
export function takeTitle(md: string): { title: string | null; rest: string } {
  const lines = md.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n')
  let i = 0
  while (i < lines.length && lines[i].trim() === '') i++
  const m = lines[i]?.match(/^#\s+(.+?)\s*#*\s*$/)
  if (!m) return { title: null, rest: lines.join('\n') }
  return { title: m[1].trim(), rest: lines.slice(i + 1).join('\n') }
}

/** Split Notion's "Property: value" lines (only known column names) off the top of a row page. */
export function takeProps(md: string, columns: string[]): { props: Record<string, string>; rest: string } {
  const known = new Map(columns.map((c) => [c.toLowerCase(), c]))
  const lines = md.split('\n')
  let i = 0
  while (i < lines.length && lines[i].trim() === '') i++
  const props: Record<string, string> = {}
  let j = i
  for (; j < lines.length; j++) {
    const m = lines[j].match(/^([^:\n]{1,100}?):\s?(.*)$/)
    const col = m ? known.get(m[1].trim().toLowerCase()) : undefined
    if (!m || !col) break
    props[col] = m[2].trim()
  }
  if (j === i) return { props, rest: md }
  return { props, rest: lines.slice(j).join('\n') }
}

/** Notion exports callouts as <aside>…</aside>. Turn them into GitHub alerts (→ callout blocks). */
export function asidesToAlerts(md: string): string {
  return md.replace(/<aside>\s*\n?([\s\S]*?)\n?\s*<\/aside>/g, (_all, inner: string) => {
    const lines = inner.trim().split('\n')
    return ['> [!NOTE] ' + (lines[0] ?? ''), ...lines.slice(1).map((l) => (l.trim() ? `> ${l}` : '>'))].join('\n')
  })
}

/* ------------------------------------------------------------------ */
/* Planner                                                             */
/* ------------------------------------------------------------------ */

const TEXT_EXT = new Set(['md', 'markdown', 'txt'])
const decoder = new TextDecoder('utf-8')
const decode = (b: Uint8Array) => decoder.decode(b)

export function buildPlan(input: ImportEntry[]): ImportPlan {
  const warnings: string[] = []
  let entries = input.map((e) => ({ path: normPath(e.path), data: e.data })).filter((e) => e.path && !JUNK.test(e.path))

  // strip common wrapper directories ("Export-…/", "Private & Shared/")
  for (;;) {
    const firstDirs = new Set(entries.map((e) => (e.path.includes('/') ? e.path.split('/')[0] : '')))
    if (firstDirs.size !== 1) break
    const [d] = [...firstDirs]
    if (!d) break
    entries = entries.map((e) => ({ ...e, path: e.path.slice(d.length + 1) }))
  }
  // a Notion wrapper may also sit next to nothing but other wrappers
  entries = entries.map((e) => {
    const first = e.path.split('/')[0]
    return e.path.includes('/') && TRANSPARENT.test(first) ? { ...e, path: e.path.slice(first.length + 1) } : e
  })

  const pageFiles = entries.filter((e) => TEXT_EXT.has(extname(e.path)))
  const csvAll = entries.filter((e) => extname(e.path) === 'csv')
  const files = new Map<string, Uint8Array>()
  for (const e of entries) if (!TEXT_EXT.has(extname(e.path)) && extname(e.path) !== 'csv') files.set(e.path, e.data)
  const isNotion = [...pageFiles, ...csvAll].some((e) => NAME_ID.test(stripExt(basename(e.path))))

  if (!pageFiles.length && !csvAll.length) {
    if (entries.some((e) => extname(e.path) === 'html')) warnings.push('html-export')
    return { nodes: [], files, roots: [], isNotion, warnings }
  }

  // CSVs: prefer "X_all.csv" (Notion: all rows incl. hidden by view filters) over "X.csv"
  const csvByKey = new Map<string, ImportEntry>()
  for (const e of csvAll) {
    const raw = stripExt(e.path)
    const all = raw.endsWith('_all')
    const key = all ? raw.slice(0, -4) : raw
    if (all || !csvByKey.has(key)) csvByKey.set(key, e)
  }

  const nodes = new Map<string, PlanNode>()
  const fileSet = new Set(files.keys())

  const newNode = (key: string, kind: PlanKind, extra: Partial<PlanNode> = {}): PlanNode => {
    const { title, hex } = splitNotionName(basename(key))
    const node: PlanNode = { key, kind, title, hex, parentKey: null, dir: dirname(key), body: '', format: 'markdown', attachments: [], ...extra }
    nodes.set(key, node)
    return node
  }

  // databases
  for (const [key, e] of csvByKey) {
    const table = parseCSV(decode(e.data))
    const csvDir = dirname(e.path)
    const columns = inferColumns(table, { isFile: (tok) => fileSet.has(resolveTarget(csvDir, tok) ?? '') })
    const db = newNode(key, 'database', { columns, csvDir })
    if (!table.length) warnings.push(`empty-csv:${basename(e.path)}`)
    // CSV rows become row nodes now; md files may enrich them below
    const header = columns.map((c) => c.name)
    table.slice(1).forEach((r, i) => {
      if (r.every((c) => c.trim() === '')) return
      const cells: Record<string, string> = {}
      header.forEach((h, ci) => (cells[h] = r[ci] ?? ''))
      const row = newNode(`${key}/#row${i}`, 'row', { dbKey: key, title: (r[0] ?? '').trim(), hex: null, cells, dir: key })
      row.parentKey = db.key
    })
  }

  // pages (md / txt)
  const rowsByDb = new Map<string, PlanNode[]>()
  for (const n of nodes.values()) if (n.kind === 'row') rowsByDb.set(n.dbKey!, [...(rowsByDb.get(n.dbKey!) ?? []), n])

  // parents before children → deterministic
  pageFiles.sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path))
  for (const e of pageFiles) {
    const key = stripExt(e.path)
    const ext = extname(e.path)
    const text = decode(e.data)
    const dir = dirname(e.path)
    const db = nodes.get(dir)
    const { title: h1, rest } = ext === 'txt' ? { title: null, rest: text.replace(/\r\n?/g, '\n') } : takeTitle(text)
    const { title: fileTitle, hex } = splitNotionName(basename(key))
    const title = h1 ?? fileTitle

    if (db?.kind === 'database') {
      // a row page: match it with its CSV row by title (first unmatched one wins)
      const { props, rest: body } = takeProps(rest, (db.columns ?? []).map((c) => c.name))
      const rows = rowsByDb.get(db.key) ?? []
      const norm = (s: string) => s.trim().toLowerCase()
      const match =
        rows.find((r) => !r.hex && r.title === title) ??
        rows.find((r) => !r.hex && norm(r.title) === norm(title)) ??
        rows.find((r) => !r.hex && r.title && (norm(title).startsWith(norm(r.title)) || norm(r.title).startsWith(norm(fileTitle))))
      const target = match ?? newNode(key, 'row', { dbKey: db.key, cells: {}, title })
      if (match) {
        // re-key the row under the md path so links / child folders resolve
        nodes.delete(match.key)
        match.key = key
        nodes.set(key, match)
      }
      target.hex = hex ?? `row:${key}`
      target.title = title || target.title
      target.body = asidesToAlerts(body)
      target.dir = dir
      target.parentKey = db.key
      for (const [k, v] of Object.entries(props)) if (!target.cells![k]?.trim()) target.cells![k] = v
      if (!match) rowsByDb.set(db.key, [...rows, target])
      continue
    }
    newNode(key, 'page', { title, hex, dir, body: ext === 'txt' ? rest : asidesToAlerts(rest), format: ext === 'txt' ? 'text' : 'markdown' })
  }
  // rows matched by md keep their notion hex; synthetic markers go away
  for (const n of nodes.values()) if (n.hex?.startsWith('row:')) n.hex = splitNotionName(basename(n.key)).hex

  // parents: nearest ancestor directory that is a node; create folder nodes on the way
  const ensureDirNode = (dir: string): string | null => {
    if (!dir) return null
    const existing = nodes.get(dir)
    if (existing) return existing.key
    const folder = newNode(dir, 'folder')
    folder.parentKey = ensureDirNode(dirname(dir))
    return folder.key
  }
  for (const n of [...nodes.values()]) {
    if (n.kind === 'row') continue
    n.parentKey = ensureDirNode(dirname(n.key))
  }

  // orphan attachments → the node owning their folder
  const referenced = new Set<string>()
  for (const n of nodes.values()) {
    for (const href of linkTargets(n.body)) {
      const p = resolveTarget(n.dir, href)
      if (p) referenced.add(p)
    }
    if (n.kind === 'database' && n.columns) {
      const fileCols = n.columns.filter((c) => c.type === 'files').map((c) => c.name)
      for (const r of rowsByDb.get(n.key) ?? [])
        for (const c of fileCols) for (const tok of splitList(r.cells?.[c] ?? '')) referenced.add(resolveTarget(n.csvDir ?? '', tok) ?? '')
    }
  }
  for (const path of files.keys()) {
    if (referenced.has(path)) continue
    const owner = nodes.get(dirname(path)) ?? (dirname(path) ? nodes.get(ensureDirNode(dirname(path))!) : undefined)
    if (owner) owner.attachments.push(path)
  }

  // order: children follow the order in which the parent links them, then alphabetical; rows keep CSV order
  const linkOrder = new Map<string, number>()
  for (const n of nodes.values()) {
    linkTargets(n.body).forEach((href, i) => {
      const p = resolveTarget(n.dir, href)
      if (!p) return
      const k = stripExt(p).replace(/_all$/, '')
      if (!linkOrder.has(k)) linkOrder.set(k, i)
    })
  }
  const children = new Map<string | null, PlanNode[]>()
  for (const n of nodes.values()) children.set(n.parentKey, [...(children.get(n.parentKey) ?? []), n])
  const rowIndex = new Map<string, number>()
  for (const rows of rowsByDb.values()) rows.forEach((r, i) => rowIndex.set(r.key, i))
  const sortKids = (arr: PlanNode[]) =>
    arr.sort((a, b) => {
      if (a.kind === 'row' && b.kind === 'row') return (rowIndex.get(a.key) ?? 0) - (rowIndex.get(b.key) ?? 0)
      const la = linkOrder.get(a.key) ?? Infinity
      const lb = linkOrder.get(b.key) ?? Infinity
      if (la !== lb) return la - lb
      return a.title.localeCompare(b.title, undefined, { numeric: true })
    })

  const ordered: PlanNode[] = []
  const visit = (parent: string | null) => {
    for (const n of sortKids(children.get(parent) ?? [])) {
      ordered.push(n)
      visit(n.key)
    }
  }
  visit(null)

  return { nodes: ordered, files, roots: ordered.filter((n) => !n.parentKey).map((n) => n.key), isNotion, warnings }
}

/** Summary counts for progress / confirmation UI. */
export function planStats(plan: ImportPlan) {
  let pages = 0
  let databases = 0
  let rows = 0
  for (const n of plan.nodes) {
    if (n.kind === 'database') databases++
    else if (n.kind === 'row') rows++
    else pages++
  }
  return { pages, databases, rows, files: plan.files.size }
}
