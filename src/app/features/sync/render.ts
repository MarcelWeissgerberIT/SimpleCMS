/**
 * Synced file contents. Page bodies reuse the Markdown exporter (docToMarkdown + its relative
 * link rewrite); on top come YAML front matter (id, title, icon, timestamps, row properties),
 * `_database.md` (schema + views) and `_rows.csv` (the exporter's CSV cells).
 *
 * Renders are cached per file and only redone when their inputs changed (the page object, the
 * database, people, or any title / path in the workspace — links show titles and relative paths).
 */
import type { Database, ID, Page, PageIcon, Person, PropertyDef, PropertyType } from '../../store/types'
import { csvCell, exportValue, rewriteExportLinks } from '../io/export/markdown'
import { relativePath } from '../io/export/collect'
import { DB_FILE, ROWS_FILE, type Layout } from './layout'
import { writeFrontMatter, type YamlValue } from './yaml'
import { gitBlobSha, utf8 } from './hash'
import type { Desired } from './types'

type Editor = typeof import('../../editor')
type DatabaseApi = typeof import('../../database')

export interface RenderCtx {
  pages: Record<ID, Page>
  databases: Record<ID, Database>
  people: Person[]
  layout: Layout
  untitled: string
  /** changes whenever any title or path changes (links render both) */
  sig: string
  editor: Editor
  database: DatabaseApi
}

export interface Rendered {
  data: Uint8Array
  sha: string
}

/* ------------------------------------------------------------------ */
/* Front matter fields                                                 */
/* ------------------------------------------------------------------ */

export const BASE_KEYS = ['id', 'title', 'icon', 'created', 'updated'] as const
/** Not written as properties: computed values (they change without an edit) and the title. */
export const SKIP_PROPS = new Set<PropertyType>(['title', 'formula', 'rollup', 'created_time', 'last_edited_time'])
/** Front matter values a person may edit in the file (read back on pick-up). */
export const EDITABLE_PROPS = new Set<PropertyType>(['text', 'url', 'email', 'phone', 'number', 'rating', 'select', 'status', 'multi_select', 'checkbox', 'date'])

export const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

export function iconText(icon: PageIcon | null): string | null {
  if (!icon) return null
  if (icon.type === 'emoji') return icon.value
  if (icon.type === 'asset') return `asset:${icon.value}`
  return `lucide:${icon.value}${icon.color ? `:${icon.color}` : ''}`
}

export function parseIcon(raw: string): PageIcon | null {
  const s = raw.trim()
  if (!s) return null
  const m = s.match(/^(asset|lucide):([\w-]+)(?::(\w+))?$/)
  if (m?.[1] === 'asset') return { type: 'asset', value: m[2] }
  if (m?.[1] === 'lucide') return m[3] ? { type: 'lucide', value: m[2], color: m[3] as never } : { type: 'lucide', value: m[2] }
  return { type: 'emoji', value: s }
}

/** Front matter key of a property (a name that is one of One's own keys gets a suffix; YAML keys are case-sensitive). */
export function propKey(name: string): string {
  return (BASE_KEYS as readonly string[]).includes(name.trim()) ? `${name} (property)` : name
}

/** A row's value as One writes it into the front matter (friendly: option names, ISO dates …). */
export function propYaml(ctx: Pick<RenderCtx, 'pages' | 'people' | 'database' | 'layout' | 'untitled'>, db: Database, d: PropertyDef, row: Page, fromPath: string): YamlValue {
  const v = row.properties[d.id]
  switch (d.type) {
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return typeof v === 'string' && v ? v : null
    case 'number':
    case 'rating':
      return typeof v === 'number' && Number.isFinite(v) ? v : null
    case 'checkbox':
      return v === true
    case 'select':
    case 'status':
      return d.options?.find((o) => o.id === v)?.name ?? null
    case 'multi_select':
      return Array.isArray(v) ? v.map((id) => d.options?.find((o) => o.id === id)?.name).filter((x): x is string => !!x) : []
    case 'person':
      return Array.isArray(v) ? v.map((id) => ctx.people.find((p) => p.id === id)?.name).filter((x): x is string => !!x) : []
    case 'relation':
      return Array.isArray(v) ? v.map((id) => ctx.pages[id]).filter((p): p is Page => !!p && !p.trashed).map((p) => p.title.trim() || ctx.untitled) : []
    case 'files':
      return Array.isArray(v)
        ? v
            .map((ref) => {
              if (typeof ref !== 'string') return null
              if (/^https?:\/\//.test(ref)) return ref
              const target = ctx.layout.pathOfRef.get(ref)
              return target ? relativePath(fromPath, target) : null
            })
            .filter((x): x is string => !!x)
        : []
    case 'date': {
      const text = exportValue(db, d, row, ctx.database.propertyValueToText)
      return text || null
    }
    default: {
      const text = ctx.database.propertyValueToText(db, d, row)
      return text || null
    }
  }
}

function frontMatter(ctx: RenderCtx, p: Page, path: string): string {
  const entries: Array<[string, YamlValue]> = [
    ['id', p.id],
    ['title', p.title.trim() || ctx.untitled],
  ]
  const icon = iconText(p.icon)
  if (icon) entries.push(['icon', icon])
  entries.push(['created', iso(p.createdAt)], ['updated', iso(p.updatedAt)])
  const db = p.databaseId ? ctx.databases[p.databaseId] : undefined
  if (db) for (const d of db.properties) if (!SKIP_PROPS.has(d.type)) entries.push([propKey(d.name), propYaml(ctx, db, d, p, path)])
  return writeFrontMatter(entries)
}

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

/** The page body as Markdown with links relative to `path` (the exporter's conversion). */
export function pageBody(ctx: Pick<RenderCtx, 'editor' | 'layout'>, p: Page, path: string): string {
  const body = p.content ? ctx.editor.docToMarkdown(p.content) : ''
  return rewriteExportLinks(
    body,
    path,
    (id) => ctx.layout.pathOfId.get(id),
    (ref) => ctx.layout.pathOfRef.get(ref),
  )
}

export function renderPage(ctx: RenderCtx, p: Page, path: string): string {
  const body = pageBody(ctx, p, path).trim()
  return `${frontMatter(ctx, p, path)}\n# ${p.title.trim() || ctx.untitled}\n${body ? `\n${body}\n` : ''}`
}

const VIEW_DETAIL = (db: Database, v: Database['views'][number]) => {
  const name = (id: ID | null | undefined) => db.properties.find((p) => p.id === id)?.name
  const parts: string[] = [v.type]
  if (v.groupBy && name(v.groupBy)) parts.push(`group: ${name(v.groupBy)}`)
  if (v.dateProperty && name(v.dateProperty)) parts.push(`date: ${name(v.dateProperty)}`)
  if (v.sorts.length) parts.push(`sort: ${v.sorts.map((s) => `${name(s.propertyId) ?? '?'} ${s.direction}`).join(', ')}`)
  if (v.filter?.items.length) parts.push(`${v.filter.items.length} filter${v.filter.items.length === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')

export function renderDatabase(ctx: RenderCtx, p: Page, db: Database, path: string): string {
  const rows = ctx.layout.files.filter((f) => f.kind === 'row' && f.path.startsWith(path.slice(0, -DB_FILE.length)) && ctx.pages[f.id!]?.databaseId === db.id)
  const lines = [frontMatter(ctx, p, path), `# ${p.title.trim() || ctx.untitled}`, '']
  const body = pageBody(ctx, p, path).trim()
  if (body) lines.push(body, '')
  lines.push('## Properties', '', '| Property | Type | Options |', '| --- | --- | --- |')
  for (const d of db.properties) {
    const extra =
      d.options?.map((o) => o.name).join(' · ') ??
      (d.type === 'relation' ? (ctx.pages[d.relationDatabaseId ?? '']?.title ?? '') : d.type === 'formula' ? (d.formula ?? '') : d.type === 'unique_id' ? (d.idPrefix ?? '') : '')
    lines.push(`| ${cell(d.name)} | ${d.type} | ${cell(extra)} |`)
  }
  lines.push('', '## Views', '')
  for (const v of db.views) lines.push(`- **${cell(v.name)}** — ${VIEW_DETAIL(db, v)}`)
  lines.push('', `## Rows (${rows.length})`, '')
  for (const r of rows) {
    const page = ctx.pages[r.id!]
    lines.push(`- [${cell(page?.title.trim() || ctx.untitled)}](${relativePath(path, r.path)})`)
  }
  lines.push('', `Rows as a table: [${ROWS_FILE}](${ROWS_FILE})`)
  return lines.join('\n') + '\n'
}

export function renderRowsCsv(ctx: RenderCtx, db: Database, path: string, rows: Page[]): string {
  const rel = (id: ID) => {
    const page = ctx.pages[id]
    if (!page || page.trashed) return null
    const target = ctx.layout.pathOfId.get(id)
    const title = page.title.trim() || ctx.untitled
    return target ? `${title} (${relativePath(path, target)})` : title
  }
  const file = (ref: string) => {
    if (!ref.startsWith('onefile:')) return /^https?:\/\//.test(ref) ? ref : null
    const target = ctx.layout.pathOfRef.get(ref)
    return target ? relativePath(path, target) : null
  }
  const lines = [db.properties.map((d) => csvCell(d.name)).join(',')]
  for (const r of rows) lines.push(db.properties.map((d) => csvCell(exportValue(db, d, r, ctx.database.propertyValueToText, rel, file))).join(','))
  return '﻿' + lines.join('\r\n') + '\r\n'
}

/* ------------------------------------------------------------------ */
/* Cache                                                               */
/* ------------------------------------------------------------------ */

interface CacheEntry {
  inputs: unknown[]
  out: Rendered
}
const cache = new Map<string, CacheEntry>()

const sameInputs = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => x === b[i])

async function cached(key: string, inputs: unknown[], make: () => string): Promise<Rendered> {
  const hit = cache.get(key)
  if (hit && sameInputs(hit.inputs, inputs)) return hit.out
  const data = utf8(make())
  const out = { data, sha: await gitBlobSha(data) }
  cache.set(key, { inputs, out })
  return out
}

/** Text files of the layout (pages, rows, databases, CSVs). Attachments are read by the writer. */
export async function renderFile(ctx: RenderCtx, f: Desired): Promise<Rendered | null> {
  const p = f.id ? ctx.pages[f.id] : undefined
  if (!p) return null
  if (f.kind === 'page') return cached(f.path, [p, ctx.sig], () => renderPage(ctx, p, f.path))
  const db = ctx.databases[f.kind === 'row' ? (p.databaseId ?? '') : p.id]
  if (f.kind === 'row') return db ? cached(f.path, [p, db, ctx.people, ctx.sig], () => renderPage(ctx, p, f.path)) : cached(f.path, [p, ctx.sig], () => renderPage(ctx, p, f.path))
  if (!db) return null
  if (f.kind === 'database') return cached(f.path, [p, db, ctx.sig], () => renderDatabase(ctx, p, db, f.path))
  if (f.kind === 'csv') {
    // formulas and rollups read other rows and databases: the table follows every change
    const rows = ctx.layout.files.filter((x) => x.kind === 'row' && ctx.pages[x.id!]?.databaseId === db.id && x.trashed === f.trashed).map((x) => ctx.pages[x.id!])
    return cached(f.path, [ctx.pages, ctx.databases, ctx.people, ctx.sig], () => renderRowsCsv(ctx, db, f.path, rows))
  }
  return null
}

/** Signature of everything links render: titles and paths. */
export function layoutSig(pages: Record<ID, Page>, layout: Layout): string {
  let h = 2166136261
  const add = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
  }
  for (const [id, path] of layout.pathOfId) {
    add(id)
    add(path)
    add(pages[id]?.title ?? '')
  }
  for (const [ref, path] of layout.pathOfRef) {
    add(ref)
    add(path)
  }
  return `${(h >>> 0).toString(36)}:${layout.pathOfId.size}:${layout.pathOfRef.size}`
}
