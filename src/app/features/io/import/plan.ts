/**
 * Import planner (pure, no DOM / store — unit-testable in Node).
 *
 * Turns a flat list of files (from a Notion "Markdown & CSV" export ZIP, a dropped folder,
 * or loose .md/.txt/.csv files) into an ordered tree of nodes:
 *   - .md            → page (title from first H1, Notion's trailing " <32-hex>" id stripped)
 *   - .html / .htm   → page (title from <title> / first H1; body converted from HTML by apply.ts)
 *   - folder of a md → its child pages
 *   - .csv           → database (columns inferred), rows = CSV rows enriched with the
 *                      matching .md files in the sibling folder ("Property: value" header lines)
 *   - other files    → attachments (saved to IndexedDB by apply.ts, references rewritten)
 * Folders without an own page become plain container pages.
 * Other sources (Obsidian, Evernote, Trello) produce the same ImportPlan — see sources.ts.
 */
import { unzip } from 'fflate'
import type { JSONContent } from '@tiptap/core'
import type { Person, PropertyDef, PropertyValue } from '../../../store/types'
import { inferColumns, parseCSV, sniffDelimiter, splitList, unguardCell, type ColumnSpec } from './csv'
import { extractDataImages, htmlTargets, htmlTitle } from './htmltext'
import type { ReportItem } from './report'

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
  /** Body (Markdown, plain text when format = 'text', an HTML document when format = 'html', TipTap blocks as JSON when format = 'doc') */
  body: string
  format: 'markdown' | 'text' | 'html' | 'doc'
  /**
   * Blocks around the body (TipTap JSON; PowerPoint / Claude Design): image / video / audio sources and link
   * targets relative to `dir` become the saved files, a pageLink's `pageId` "@key:<node key>" that node's page.
   */
  before?: JSONContent[]
  after?: JSONContent[]
  /** database rows: raw cells by column name */
  cells?: Record<string, string>
  /** databases: inferred columns (index 0 = title) */
  columns?: ColumnSpec[]
  /** databases: the CSV's directory (cells with relative paths resolve against it) */
  csvDir?: string
  dbKey?: string
  /** files in this node's folder that no page references (appended as file blocks) */
  attachments: string[]
  /** YAML front matter fields (shown as a properties callout on top of the page) */
  meta?: Array<[string, string]>
  /** databases embedded inline at the end of this page (a "X.md" next to a "X.csv") */
  embeds?: string[]
  /** original timestamps (Evernote, Trello, Obsidian front matter); default: the import time */
  createdAt?: number
  updatedAt?: number
  /** databases with a known schema (Trello): used as they are instead of inferred `columns` */
  properties?: PropertyDef[]
  /** databases: open this view first ('board' = grouped by the first status property) */
  primaryView?: 'board'
  /** rows of a database with `properties`: stored values by PropertyDef.id */
  values?: Record<string, PropertyValue>
}

/** A pageLink's `pageId` in a node's before / after blocks: "@key:<node key>" → that node's page. */
export const KEY_REF = '@key:'

export type ImportSource = 'notion' | 'markdown' | 'csv' | 'html' | 'obsidian' | 'evernote' | 'trello' | 'pptx' | 'design' | 'mixed'

export interface ImportPlan {
  nodes: PlanNode[]
  files: Map<string, Uint8Array>
  /** source file path → node key (keys are unique; two files may share a stem: "X.md" + "X.csv") */
  pathKeys: Map<string, string>
  roots: string[]
  isNotion: boolean
  warnings: string[]
  /** where the plan came from (container title) and its name (vault, board, file) if any */
  source?: ImportSource
  name?: string
  /** people referenced by person properties — merged into the workspace by name */
  people?: Person[]
  /** what could not be carried over 1:1 (shown in the import report) */
  report?: ReportItem[]
}

const JUNK = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini|\._[^/]*)(\/|$)/
const NAME_ID = /\s+([0-9a-f]{32})$/
const TRANSPARENT = /^(Private & Shared|Privat & Geteilt|Export-[0-9a-f-]+|export)$/i
/** What exporters call a page without a title */
const UNTITLED = /^(untitled|unbenannt|ohne titel|sans titre|sin título|senza titolo|naamloos)$/i

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

const UUID = /([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})/gi
const BOUNDED_HEX = /(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/gi

/**
 * Notion id inside any href (notion.so URLs or file names): the last stand-alone 32-hex run of the
 * path. Only real UUID dashes are collapsed, so a slug like "Write-spec-<id>" keeps its "c".
 * Query and fragment are ignored (they carry view / block ids).
 */
export function hexOf(href: string): string | null {
  const path = safeDecode(href).split(/[?#]/)[0].replace(UUID, '$1$2$3$4$5')
  const all = path.match(BOUNDED_HEX)
  return all ? all[all.length - 1].toLowerCase() : null
}

/* ------------------------------------------------------------------ */
/* ZIP                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Unpacking limits. A crafted or simply huge archive must end in a friendly message, not in a
 * crashed tab: every entry is inflated in memory (nested Notion part zips included).
 */
export const ZIP_MAX_BYTES = 500 * 1024 * 1024
export const ZIP_MAX_ENTRIES = 50_000

export class ArchiveTooLargeError extends Error {
  constructor(
    readonly bytes: number,
    readonly entries: number,
  ) {
    super(`archive too large (${Math.round(bytes / 1048576)} MB, ${entries} entries)`)
    this.name = 'ArchiveTooLargeError'
  }
}

/** Running totals across every archive of one import (top level and nested). */
export interface ZipBudget {
  bytes: number
  entries: number
}
export const zipBudget = (): ZipBudget => ({ bytes: 0, entries: 0 })

const keepEntry = (name: string) => !name.endsWith('/') && !JUNK.test(name)

/** Nested part zips are counted by what they contain, not by their own size. */
const expands = (name: string, depth: number) => extname(name) === 'zip' && depth < 3

function check(budget: ZipBudget) {
  if (budget.entries > ZIP_MAX_ENTRIES || budget.bytes > ZIP_MAX_BYTES) throw new ArchiveTooLargeError(budget.bytes, budget.entries)
}

/** Entries an archive declares (central directory only — nothing is inflated). */
function scanZip(data: Uint8Array): Promise<Array<{ name: string; originalSize: number }>> {
  const list: Array<{ name: string; originalSize: number }> = []
  return new Promise((resolve, reject) =>
    unzip(
      data,
      {
        filter: (f) => {
          if (keepEntry(f.name)) list.push({ name: f.name, originalSize: f.originalSize })
          return false
        },
      },
      (err) => (err ? reject(err) : resolve(list)),
    ),
  )
}

async function unzipAsync(data: Uint8Array, budget: ZipBudget, depth: number): Promise<Record<string, Uint8Array>> {
  // 1) what the archive claims, before anything is inflated
  let claimed = 0
  for (const f of await scanZip(data)) {
    budget.entries++
    if (!expands(f.name, depth)) claimed += f.originalSize
  }
  budget.bytes += claimed
  check(budget)
  // 2) inflate; declared sizes can lie, so the totals continue with what actually came out
  const out = await new Promise<Record<string, Uint8Array>>((resolve, reject) =>
    unzip(data, { filter: (f) => keepEntry(f.name) }, (err, files) => (err ? reject(err) : resolve(files))),
  )
  let actual = 0
  for (const [name, bytes] of Object.entries(out)) if (!expands(name, depth)) actual += bytes.length
  budget.bytes += actual - claimed
  check(budget)
  return out
}

export const isZip = (data: Uint8Array) => data.length > 4 && data[0] === 0x50 && data[1] === 0x4b && (data[2] === 3 || data[2] === 5)

/**
 * Unzip (recursively: Notion splits big exports into nested "…Part-1.zip" files). Throws
 * ArchiveTooLargeError past ZIP_MAX_BYTES / ZIP_MAX_ENTRIES — pass one budget for all archives
 * of an import.
 */
export async function expandZip(data: Uint8Array, prefix = '', depth = 0, budget: ZipBudget = zipBudget()): Promise<ImportEntry[]> {
  const files = await unzipAsync(data, budget, depth)
  const out: ImportEntry[] = []
  for (const [name, bytes] of Object.entries(files)) {
    const path = normPath(`${prefix}/${name}`)
    if (expands(path, depth) && isZip(bytes)) {
      // nested part: its content lives at the same level as the part itself
      out.push(...(await expandZip(bytes, dirname(path), depth + 1, budget)))
    } else {
      // a ".zip" that is no zip after all stays a file: count it
      if (expands(path, depth)) {
        budget.bytes += bytes.length
        check(budget)
      }
      out.push({ path, data: bytes })
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Markdown helpers                                                    */
/* ------------------------------------------------------------------ */

const LINK_RE = /(!?)\[((?:[^\]\\]|\\.)*)\]\(\s*(<[^>]*>|[^)\s]+(?:\([^)\s]*\)[^)\s]*)*)(\s+"[^"]*")?\s*\)/g
/** src="…" of video / audio blocks (One's Markdown writes them as HTML tags, see editor/schema/media.ts). */
const MEDIA_SRC_RE = /(<(?:video|audio|source)\b[^>]*?\ssrc=")([^"]+)(")/gi

/** All link/image targets in a Markdown string, in order (media tag sources after them). */
export function linkTargets(md: string): string[] {
  const out: string[] = []
  for (const m of md.matchAll(LINK_RE)) out.push(m[3])
  for (const m of md.matchAll(MEDIA_SRC_RE)) out.push(m[2].replace(/&amp;/g, '&'))
  return out
}

/** Rewrite every link/image target (and video / audio source) with `fn` (return null to keep). */
export function rewriteLinks(md: string, fn: (href: string, isImage: boolean, text: string) => string | null): string {
  return md
    .replace(LINK_RE, (all, bang: string, text: string, href: string, title: string | undefined) => {
      const next = fn(href.replace(/^<|>$/g, ''), bang === '!', text)
      return next === null ? all : `${bang}[${text}](${next}${title ?? ''})`
    })
    .replace(MEDIA_SRC_RE, (all, open: string, href: string, close: string) => {
      const next = fn(href.replace(/&amp;/g, '&'), true, '')
      // an attribute takes the bare target ("<a b.mp4>" is Markdown's form for link targets)
      return next === null ? all : `${open}${next.replace(/^<|>$/g, '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')}${close}`
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
/* Front matter + wiki links (Obsidian, Jekyll, Hugo, Bear …)          */
/* ------------------------------------------------------------------ */

const unquote = (v: string): string => {
  const s = v.trim()
  if (/^\[.*\]$/.test(s)) return s.slice(1, -1).split(',').map(unquote).filter(Boolean).join(', ')
  return s.replace(/^(['"])([\s\S]*)\1$/, '$2').trim()
}

/** Tiny YAML subset: "key: value", "key: [a, b]", "key:" + "  - item" lists, indented continuations. null = not YAML. */
function parseYamlish(block: string): Array<[string, string]> | null {
  const out: Array<[string, string[]]> = []
  for (const line of block.split('\n')) {
    if (!line.trim() || /^\s*#/.test(line)) continue
    const kv = /^\S/.test(line) ? line.match(/^([^\s:#-][^:]*?)\s*:(?:\s+(.*?)|\s*)$/) : null
    if (kv) {
      const raw = (kv[2] ?? '').trim()
      out.push([unquote(kv[1]), raw && !/^[|>][+-]?$/.test(raw) ? [unquote(raw)] : []])
      continue
    }
    const item = line.match(/^\s*-\s+(.*)$/)
    if (item && out.length) {
      out[out.length - 1][1].push(unquote(item[1]))
      continue
    }
    if (/^\s+\S/.test(line) && out.length) {
      const vals = out[out.length - 1][1]
      if (vals.length) vals[vals.length - 1] += ` ${line.trim()}`
      else vals.push(line.trim())
      continue
    }
    return null
  }
  return out.map(([k, v]) => [k, v.filter(Boolean).join(', ')])
}

/** Split a leading YAML front matter block ("---" … "---") off a Markdown document. */
export function takeFrontMatter(md: string): { meta: Array<[string, string]>; rest: string } {
  const text = md.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const m = text.match(/^---[ \t]*\n([\s\S]*?)\n?(?:---|\.\.\.)[ \t]*(?:\n|$)/)
  if (!m) return { meta: [], rest: text }
  const meta = parseYamlish(m[1])
  // "---" as a horizontal rule followed by ordinary text is not front matter
  if (!meta || (!meta.length && m[1].trim())) return { meta: [], rest: text }
  return { meta, rest: text.slice(m[0].length) }
}

const WIKI = /(!?)\[\[([^[\]\n|#^]*)(#[^[\]\n|]*)?(?:\|([^[\]\n]*))?\]\]/g
const mdLabel = (s: string) => s.replace(/[[\]\\]/g, '\\$&')

/**
 * "[[Note]]", "[[Note|alias]]", "[[folder/Note#Heading]]", "![[image.png]]" → regular Markdown links
 * relative to `fromDir` (unresolvable links become their plain label).
 */
export function rewriteWikiLinks(md: string, fromDir: string, find: (name: string) => string | null): string {
  if (!md.includes('[[')) return md
  const up = fromDir ? '../'.repeat(fromDir.split('/').length) : ''
  return md.replace(WIKI, (all, bang: string, target: string, _anchor: string | undefined, alias: string | undefined) => {
    const name = target.trim()
    const label = (alias ?? '').trim()
    if (!name) return label || all
    const path = find(name)
    const text = bang ? (/^\d+(x\d+)?$/.test(label) ? '' : label) : label || basename(name)
    if (!path) return bang ? all : text
    return `${bang}[${mdLabel(text)}](<${up}${path}>)`
  })
}

/* ------------------------------------------------------------------ */
/* Planner                                                             */
/* ------------------------------------------------------------------ */

const TEXT_EXT = new Set(['md', 'markdown', 'txt'])
/** Tables: comma / semicolon separated (.csv) and tab separated (.tsv) */
const TABLE_EXT = new Set(['csv', 'tsv'])
const isTable = (p: string) => TABLE_EXT.has(extname(p))

let utf8: TextDecoder | null = null
/**
 * Text of an imported file: UTF-8 (BOM optional), UTF-16 with BOM (Excel "Unicode text"),
 * otherwise Windows-1252 — what German / Western Excel writes for "CSV (Trennzeichen-getrennt)".
 */
export function decodeText(b: Uint8Array): string {
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b)
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b)
  try {
    return (utf8 ??= new TextDecoder('utf-8', { fatal: true })).decode(b)
  } catch {
    return new TextDecoder('windows-1252').decode(b)
  }
}
const decode = decodeText

export interface PlanOptions {
  /** Title of the page that collects loose attachments (images / PDFs picked without any page). */
  looseTitle?: string
  /** Obsidian: a note's title is its file name (a front matter title still wins); a leading H1 repeating it is dropped */
  titleFromFile?: boolean
  /** [[wiki links]] were already rewritten by the caller (Obsidian planner) */
  skipWikiLinks?: boolean
}

const HTML_EXT = new Set(['html', 'htm'])
/** Links / images of a node's body, in order */
const targetsOf = (n: PlanNode) => (n.format === 'html' ? htmlTargets(n.body) : linkTargets(n.body))

/** Header props of a row page vs. its CSV row: +1 per equal value, −1 per conflicting one. */
function propScore(cells: Record<string, string> | undefined, props: Record<string, string>): number {
  let score = 0
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
  for (const [k, v] of Object.entries(props)) {
    const a = norm(cells?.[k] ?? '')
    const b = norm(v)
    if (!a || !b) continue
    score += a === b ? 1 : -1
  }
  return score
}

/** "Untitled (2)" → ["Untitled", 2]; plain names get 1 — duplicates exported as X, X (2), X (3)… */
function dupIndex(name: string): [string, number] {
  const m = name.match(/^(.*) \((\d{1,4})\)$/)
  return m ? [m[1], Number(m[2])] : [name, 1]
}

export function buildPlan(input: ImportEntry[], opts: PlanOptions = {}): ImportPlan {
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

  const isPage = (p: string) => TEXT_EXT.has(extname(p)) || HTML_EXT.has(extname(p))
  const pageFiles = entries.filter((e) => isPage(e.path))
  const csvAll = entries.filter((e) => isTable(e.path))
  const files = new Map<string, Uint8Array>()
  for (const e of entries) if (!isPage(e.path) && !isTable(e.path)) files.set(e.path, e.data)
  const isNotion = [...pageFiles, ...csvAll].some((e) => NAME_ID.test(stripExt(basename(e.path))))
  const pathKeys = new Map<string, string>()

  if (!pageFiles.length && !csvAll.length) {
    if (!files.size) return { nodes: [], files, pathKeys, roots: [], isNotion, warnings }
    // only images / PDFs / other attachments → one page that holds them all
    const key = '__loose__'
    const node: PlanNode = { key, kind: 'page', title: opts.looseTitle ?? 'Files', hex: null, parentKey: null, dir: '', body: '', format: 'markdown', attachments: [...files.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) }
    return { nodes: [node], files, pathKeys, roots: [key], isNotion, warnings }
  }

  const nodes = new Map<string, PlanNode>()
  const fileSet = new Set(files.keys())
  /** "X" is taken (e.g. "X.md" next to "X.csv", or "X.md" + "X.txt") → "X#2" */
  const uniqueKey = (key: string) => {
    if (!nodes.has(key)) return key
    let i = 2
    while (nodes.has(`${key}#${i}`)) i++
    return `${key}#${i}`
  }

  const newNode = (key: string, kind: PlanKind, extra: Partial<PlanNode> = {}): PlanNode => {
    const { title, hex } = splitNotionName(basename(key))
    const node: PlanNode = { key, kind, title, hex, parentKey: null, dir: dirname(key), body: '', format: 'markdown', attachments: [], ...extra }
    nodes.set(key, node)
    return node
  }

  // tables: prefer "X_all.csv" (Notion: all rows incl. hidden by view filters) over "X.csv"
  const tableByStem = new Map<string, ImportEntry[]>()
  for (const e of csvAll) {
    const raw = stripExt(e.path)
    const stem = raw.endsWith('_all') ? raw.slice(0, -4) : raw
    const list = tableByStem.get(stem)
    if (list) list.push(e)
    else tableByStem.set(stem, [e])
  }

  // databases
  const rowsByDb = new Map<string, PlanNode[]>()
  for (const [stem, group] of tableByStem) {
    const notionPair = group.length === 2 && group.some((e) => stripExt(e.path).endsWith('_all')) && extname(group[0].path) === extname(group[1].path)
    const tables = notionPair ? [group.find((e) => stripExt(e.path).endsWith('_all'))!] : group
    for (const e of tables) {
      const key = uniqueKey(stem)
      if (notionPair) for (const g of group) pathKeys.set(g.path, key)
      else pathKeys.set(e.path, key)
      const text = decode(e.data)
      // cells exported with a formula guard ("'=…") come back without it
      const table = parseCSV(text).map((r) => r.map(unguardCell))
      const csvDir = dirname(e.path)
      const columns = inferColumns(table, { isFile: (tok) => fileSet.has(resolveTarget(csvDir, tok) ?? ''), delimiter: sniffDelimiter(text) })
      const { title, hex } = splitNotionName(basename(stem))
      const db = newNode(key, 'database', { title, hex, columns, csvDir })
      if (!table.length) warnings.push(`empty-csv:${basename(e.path)}`)
      // CSV rows become row nodes now; md files may enrich them below
      const header = columns.map((c) => c.name)
      const rows: PlanNode[] = []
      table.slice(1).forEach((r, i) => {
        if (r.every((c) => c.trim() === '')) return
        const cells: Record<string, string> = {}
        header.forEach((h, ci) => (cells[h] = r[ci] ?? ''))
        const row = newNode(`${key}/#row${i}`, 'row', { dbKey: key, title: (r[0] ?? '').trim(), hex: null, cells, dir: key })
        row.parentKey = db.key
        rows.push(row)
      })
      rowsByDb.set(key, rows)
    }
  }

  // row lookup by title (exact / case-insensitive) — keeps matching linear for big databases
  const norm = (s: string) => s.trim().toLowerCase()
  const rowIndex = new Map<string, { exact: Map<string, PlanNode[]>; loose: Map<string, PlanNode[]>; blank: PlanNode[] }>()
  for (const [dbKey, rows] of rowsByDb) {
    const idx = { exact: new Map<string, PlanNode[]>(), loose: new Map<string, PlanNode[]>(), blank: [] as PlanNode[] }
    const add = (m: Map<string, PlanNode[]>, k: string, r: PlanNode) => {
      const l = m.get(k)
      if (l) l.push(r)
      else m.set(k, [r])
    }
    for (const r of rows) {
      if (!r.title.trim()) idx.blank.push(r)
      add(idx.exact, r.title, r)
      add(idx.loose, norm(r.title), r)
    }
    rowIndex.set(dbKey, idx)
  }

  // row folders usually carry the database's id ("Tasks <hex>/"), but accept a plain "Tasks/" too
  const dbByFolder = new Map<string, PlanNode>()
  for (const n of nodes.values()) {
    if (n.kind !== 'database') continue
    if (!dbByFolder.has(n.key)) dbByFolder.set(n.key, n)
    if (n.hex) dbByFolder.set(normPath(`${dirname(n.key)}/${n.title}`), n)
  }

  // [[wiki links]]: name → path (shallow paths win, like Obsidian's shortest-path links)
  const wikiIndex = new Map<string, string>()
  const wikiFind = (name: string) => {
    const n = normPath(name).toLowerCase()
    return wikiIndex.get(n) ?? wikiIndex.get(basename(n)) ?? null
  }
  if (!opts.skipWikiLinks && pageFiles.some((e) => e.data.includes(0x5b) && decode(e.data).includes('[['))) {
    const all = [...pageFiles.map((e) => e.path), ...csvAll.map((e) => e.path), ...files.keys()].sort((a, b) => a.split('/').length - b.split('/').length)
    const add = (k: string, p: string) => {
      const key = k.toLowerCase()
      if (!wikiIndex.has(key)) wikiIndex.set(key, p)
    }
    for (const p of all) {
      add(p, p)
      add(basename(p), p)
      if (TEXT_EXT.has(extname(p)) || isTable(p)) {
        add(stripExt(p), p)
        add(stripExt(basename(p)), p)
        const { title } = splitNotionName(stripExt(basename(p)))
        add(title, p)
      }
    }
  }

  // parents before children → deterministic; "X" before "X (2)" before "X (10)" so duplicates keep CSV order
  const sortKey = (p: string) => {
    const [base, n] = dupIndex(stripExt(basename(p)))
    return { dir: dirname(p), base, n }
  }
  pageFiles.sort((a, b) => {
    const da = a.path.split('/').length - b.path.split('/').length
    if (da) return da
    const ka = sortKey(a.path)
    const kb = sortKey(b.path)
    return ka.dir.localeCompare(kb.dir) || ka.base.localeCompare(kb.base) || ka.n - kb.n
  })
  /** database key → page that hosts it inline ("X.md" next to "X.csv") */
  const hosts = new Map<string, string>()
  for (const e of pageFiles) {
    const key = stripExt(e.path)
    const ext = extname(e.path)
    const raw = decode(e.data)
    const dir = dirname(e.path)
    if (HTML_EXT.has(ext)) {
      // inline base64 images become files next to the page ("Page_files/image-1.png")
      const html = extractDataImages(
        raw,
        (x, i) => `${basename(key)}_files/image-${i}.${x}`,
        (rel, bytes) => files.set(normPath(`${dir}/${rel}`), bytes),
      )
      const { title: fileTitle, hex } = splitNotionName(basename(key))
      const pageKey = uniqueKey(key)
      newNode(pageKey, 'page', { title: htmlTitle(html) ?? fileTitle, hex, dir, body: html, format: 'html' })
      pathKeys.set(e.path, pageKey)
      continue
    }
    const db = dbByFolder.get(dir)
    const fm = ext === 'txt' ? { meta: [] as Array<[string, string]>, rest: raw } : takeFrontMatter(raw)
    const parsed = ext === 'txt' ? { title: null, rest: fm.rest.replace(/\r\n?/g, '\n') } : takeTitle(fm.rest)
    const { title: fileTitle, hex } = splitNotionName(basename(key))
    const fmTitle = fm.meta.find(([k]) => k.toLowerCase() === 'title')?.[1].trim() || null
    // a front matter title wins; a different H1 below it is a real heading and stays in the body
    const h1 = parsed.title
    const keepH1 = opts.titleFromFile ? !!h1 && norm(h1) !== norm(fmTitle ?? fileTitle) : !!fmTitle && !!h1 && norm(h1) !== norm(fmTitle)
    const title = opts.titleFromFile ? (fmTitle ?? fileTitle) : (fmTitle ?? h1 ?? fileTitle)
    let rest = keepH1 ? fm.rest : parsed.rest
    if (ext !== 'txt' && !opts.skipWikiLinks) rest = rewriteWikiLinks(rest, dir, wikiFind)
    let meta = fm.meta.filter(([k, v]) => k.toLowerCase() !== 'title' && v.trim())

    if (db?.kind === 'database') {
      // a row page: match it with its CSV row by title; among rows with the same title the one whose
      // cells agree best with the page's "Property: value" header wins (ties → CSV order)
      const colNames = (db.columns ?? []).map((c) => c.name)
      const { props, rest: body } = takeProps(rest, colNames)
      // front matter keys that name a column fill that property too
      const known = new Map(colNames.map((c) => [c.toLowerCase(), c]))
      for (const [k, v] of meta) {
        const col = known.get(k.toLowerCase())
        if (col && !props[col]) props[col] = v
      }
      meta = meta.filter(([k]) => !known.has(k.toLowerCase()))
      const idx = rowIndex.get(db.key)
      const best = (list: PlanNode[]) => {
        let pick: PlanNode | undefined
        let top = -Infinity
        for (const r of list) {
          if (r.hex) continue
          const sc = propScore(r.cells, props)
          if (sc > top) {
            top = sc
            pick = r
          }
        }
        return pick
      }
      let match = best(idx?.exact.get(title) ?? []) ?? best(idx?.loose.get(norm(title)) ?? [])
      if (!match) {
        // file names may be truncated / titles may carry a suffix
        const candidates = (rowsByDb.get(db.key) ?? []).filter((r) => !r.hex && r.title && (norm(title).startsWith(norm(r.title)) || norm(r.title).startsWith(norm(fileTitle))))
        match = best(candidates)
      }
      // untitled rows: the CSV cell is empty while the page is called "Untitled" (in some language)
      let untitledRow = false
      if (!match) {
        const pick = best(idx?.blank ?? [])
        if (pick && (UNTITLED.test(title.trim()) || propScore(pick.cells, props) > 0)) {
          match = pick
          untitledRow = true
        }
      }
      const rowKey = match ? (match.key === key || !nodes.has(key) ? key : uniqueKey(key)) : uniqueKey(key)
      const target = match ?? newNode(rowKey, 'row', { dbKey: db.key, cells: {}, title })
      if (match) {
        // re-key the row under the md path so links / child folders resolve
        nodes.delete(match.key)
        match.key = rowKey
        nodes.set(rowKey, match)
      }
      pathKeys.set(e.path, rowKey)
      target.hex = hex ?? `row:${rowKey}`
      if (!untitledRow) target.title = title || target.title
      target.body = asidesToAlerts(body)
      target.dir = dir
      target.parentKey = db.key
      if (meta.length) target.meta = meta
      for (const [k, v] of Object.entries(props)) if (!target.cells![k]?.trim()) target.cells![k] = v
      if (!match) rowsByDb.get(db.key)?.push(target)
      continue
    }
    const clash = nodes.get(key)
    const pageKey = uniqueKey(key)
    const node = newNode(pageKey, 'page', { title, hex, dir, body: ext === 'txt' ? rest : asidesToAlerts(rest), format: ext === 'txt' ? 'text' : 'markdown' })
    if (meta.length) node.meta = meta
    pathKeys.set(e.path, pageKey)
    // "Reading list.md" + "Reading list.csv": the page hosts its database inline
    if (clash?.kind === 'database' && !hosts.has(clash.key)) {
      hosts.set(clash.key, pageKey)
      node.embeds = [clash.key]
    }
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
    n.parentKey = hosts.get(n.key) ?? ensureDirNode(dirname(n.key))
  }

  // orphan attachments → the node owning their folder
  const referenced = new Set<string>()
  for (const n of nodes.values()) {
    for (const href of targetsOf(n)) {
      const p = resolveTarget(n.dir, href)
      if (p) referenced.add(p)
    }
    if (n.kind === 'database' && n.columns) {
      const fileCols = n.columns.filter((c) => c.type === 'files').map((c) => c.name)
      if (fileCols.length)
        for (const r of rowsByDb.get(n.key) ?? []) for (const c of fileCols) for (const tok of splitList(r.cells?.[c] ?? '')) referenced.add(resolveTarget(n.csvDir ?? '', tok) ?? '')
    }
  }
  const loose: string[] = []
  for (const path of files.keys()) {
    if (referenced.has(path)) continue
    const owner = nodes.get(dirname(path)) ?? (dirname(path) ? nodes.get(ensureDirNode(dirname(path))!) : undefined)
    if (owner) owner.attachments.push(path)
    else loose.push(path)
  }
  // top-level files nobody links to: into the only top-level page, else onto a page of their own
  if (loose.length) {
    const tops = [...nodes.values()].filter((n) => !n.parentKey && n.kind !== 'row')
    const host = tops.length === 1 && tops[0].kind !== 'database' ? tops[0] : newNode(uniqueKey('__loose__'), 'page', { title: opts.looseTitle ?? 'Files', dir: '' })
    host.attachments.push(...loose.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })))
  }

  // order: children follow the order in which the parent links them, then alphabetical; rows keep CSV order
  const keyOfPath = (p: string) => pathKeys.get(p) ?? stripExt(p).replace(/_all$/, '')
  const linkOrder = new Map<string, number>()
  for (const n of nodes.values()) {
    targetsOf(n).forEach((href, i) => {
      const p = resolveTarget(n.dir, href)
      if (!p) return
      const k = keyOfPath(p)
      if (!linkOrder.has(k)) linkOrder.set(k, i)
    })
  }
  const children = new Map<string | null, PlanNode[]>()
  for (const n of nodes.values()) {
    const list = children.get(n.parentKey)
    if (list) list.push(n)
    else children.set(n.parentKey, [n])
  }
  const rowOrder = new Map<string, number>()
  for (const rows of rowsByDb.values()) rows.forEach((r, i) => rowOrder.set(r.key, i))
  const sortKids = (arr: PlanNode[]) =>
    arr.sort((a, b) => {
      if (a.kind === 'row' && b.kind === 'row') return (rowOrder.get(a.key) ?? 0) - (rowOrder.get(b.key) ?? 0)
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

  return { nodes: ordered, files, pathKeys, roots: ordered.filter((n) => !n.parentKey).map((n) => n.key), isNotion, warnings }
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
