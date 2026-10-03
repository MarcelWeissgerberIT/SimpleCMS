/**
 * Markdown ZIP export (Notion-compatible layout, re-importable):
 *   Page.md + Page/ (subpages) · Database.csv + Database/ (row pages with "Property: value" header) · _files/
 */
import { zip, strToU8, type AsyncZippable } from 'fflate'
import type { Database, DateValue, ID, Page, PropertyDef } from '../../../store/types'
import { getFile } from '../../../lib/files'
import { guardCell } from '../import/csv'
import { toFileMarkdown } from '../import/mentions'
import { collectRefs, relativePath, safeName, uniqueName, type ExportTree } from './collect'

/** Quote when needed; cells a spreadsheet would execute (=, +, -, @) get a leading apostrophe. */
export const csvCell = (raw: string) => {
  const s = guardCell(raw)
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Already compressed — deflating them again only costs time */
const STORED = /\.(png|jpe?g|gif|webp|avif|heic|zip|gz|7z|mp4|webm|mov|mp3|m4a|ogg|woff2?|pdf|docx|xlsx|pptx)$/i

const pad = (n: number) => String(n).padStart(2, '0')
const isoStamp = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

type ValueText = (db: Database, prop: PropertyDef, row: Page) => string

/**
 * Plain value for CSV / "Property: value" lines — dates as ISO so they re-import losslessly;
 * relations as Notion does it: "Title (relative/path.md)" when the target is part of the export;
 * files as relative paths into "_files/" (external URLs as they are).
 */
export function exportValue(
  db: Database,
  prop: PropertyDef,
  row: Page,
  toText: ValueText,
  relation?: (id: ID) => string | null,
  file?: (ref: string) => string | null,
): string {
  if (prop.type === 'title') return row.title
  if (prop.type === 'files' && file) {
    const refs = row.properties[prop.id]
    if (Array.isArray(refs)) return refs.map((r) => (typeof r === 'string' ? file(r) : null)).filter((x): x is string => !!x).join(', ')
  }
  if (prop.type === 'relation' && relation) {
    const ids = row.properties[prop.id]
    if (Array.isArray(ids) && ids.length) {
      const parts = ids.map(relation).filter((x): x is string => !!x)
      if (parts.length) return parts.join(', ')
    }
  }
  if (prop.type === 'date') {
    const v = row.properties[prop.id] as DateValue | null | undefined
    if (!v?.start) return ''
    const f = (s: string) => s.replace('T', ' ')
    return v.end ? `${f(v.start)} → ${f(v.end)}` : f(v.start)
  }
  if (prop.type === 'created_time') return isoStamp(row.createdAt)
  if (prop.type === 'last_edited_time') return isoStamp(row.updatedAt)
  return toText(db, prop, row)
}

/**
 * Page Markdown written into the file at `from`: internal links (`#/p/<id>`) and file refs
 * (`onefile:<id>`) become paths relative to it (targets without a path stay as they are).
 * Shared with the folder / GitHub sync (features/sync).
 */
export function rewriteExportLinks(md: string, from: string, pageTarget: (id: ID) => string | undefined, fileTarget: (ref: string) => string | undefined): string {
  return md
    .replace(/\]\(#\/p\/([\w-]+)(?:\?[^)\s]*)?\)/g, (all, id: string) => {
      const target = pageTarget(id)
      return target ? `](${relativePath(from, target)})` : all
    })
    .replace(/onefile:[0-9a-z]+/g, (ref) => {
      const target = fileTarget(ref)
      return target ? relativePath(from, target) : ref
    })
}

export async function buildMarkdownZip(tree: ExportTree, opts: { untitled: string; onProgress?: (done: number, total: number) => void }): Promise<Blob> {
  const [{ docToMarkdown }, { propertyValueToText }] = await Promise.all([import('../../../editor'), import('../../../database')])
  const out: Record<string, Uint8Array> = {}
  const pathOf = new Map<ID, string>()

  // 1) paths
  // "X.md" and its folder "X/" share one name; rows and a database's sub pages share the database folder
  const assign = (dir: string, list: Page[], used = new Set<string>()) => {
    for (const p of list) {
      const base = uniqueName(safeName(p.title, opts.untitled), used)
      const folder = `${dir}${base}/`
      if (p.kind === 'database' && tree.databases[p.id]) {
        pathOf.set(p.id, `${dir}${base}.csv`)
        const inFolder = new Set<string>()
        for (const r of tree.rows(p.id)) {
          const rb = uniqueName(safeName(r.title, opts.untitled), inFolder)
          pathOf.set(r.id, `${folder}${rb}.md`)
          assign(`${folder}${rb}/`, tree.children(r.id))
        }
        assign(folder, tree.children(p.id), inFolder)
      } else {
        pathOf.set(p.id, `${dir}${base}.md`)
        assign(folder, tree.children(p.id))
      }
    }
  }
  assign('', tree.roots)

  // 2) files
  const refs = collectRefs(tree)
  const filePath = new Map<string, string>()
  let done = 0
  const total = refs.length + tree.all.length
  const fileNames = new Set<string>()
  for (const ref of refs) {
    const f = await getFile(ref)
    done++
    opts.onProgress?.(done, total)
    if (!f) continue
    const name = uniqueName(safeName(f.name, 'file'), fileNames)
    const path = `_files/${name}`
    out[path] = new Uint8Array(await f.blob.arrayBuffer())
    filePath.set(ref, path)
  }

  const rewrite = (md: string, from: string) => rewriteExportLinks(md, from, (id) => pathOf.get(id), (ref) => filePath.get(ref))

  /** a files value relative to the file it is written into (refs that could not be exported are left out) */
  const fileRef = (from: string) => (ref: string) => {
    if (!ref.startsWith('onefile:')) return /^https?:\/\//.test(ref) ? ref : null
    const target = filePath.get(ref)
    return target ? relativePath(from, target) : null
  }

  /** "Title (path)" for a related row, relative to the file the value is written into */
  const relationRef = (from: string) => (id: ID) => {
    const target = pathOf.get(id)
    const page = tree.pages[id]
    if (!target || !page || page.trashed) return page && !page.trashed ? page.title.trim() || opts.untitled : null
    return `${page.title.trim() || opts.untitled} (${relativePath(from, target)})`
  }

  // 3) pages + databases
  for (const p of tree.all) {
    const path = pathOf.get(p.id)
    if (!path) continue
    const db = tree.databases[p.id]
    if (p.kind === 'database' && db) {
      const rows = tree.rows(p.id)
      const lines = [db.properties.map((d) => csvCell(d.name)).join(',')]
      const rel = relationRef(path)
      const fref = fileRef(path)
      for (const r of rows) lines.push(db.properties.map((d) => csvCell(exportValue(db, d, r, propertyValueToText, rel, fref))).join(','))
      out[path] = strToU8('﻿' + lines.join('\r\n') + '\r\n')
    } else {
      const parts = [`# ${p.title.trim() || opts.untitled}`, '']
      const rowDb = p.databaseId ? tree.databases[p.databaseId] : undefined
      if (rowDb) {
        const props: string[] = []
        for (const d of rowDb.properties) {
          if (d.type === 'title') continue
          const v = exportValue(rowDb, d, p, propertyValueToText, relationRef(path), fileRef(path))
          if (v.trim()) props.push(`${d.name}: ${v.replace(/\n/g, ' ')}`)
        }
        if (props.length) parts.push(props.join('\n'), '')
      }
      // date / person mentions as one: links (they come back as mentions on import)
      const body = p.content ? toFileMarkdown(docToMarkdown, p.content) : ''
      if (body.trim()) parts.push(rewrite(body, path))
      out[path] = strToU8(parts.join('\n').trimEnd() + '\n')
    }
    done++
    if (done % 10 === 0) {
      opts.onProgress?.(done, total)
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  opts.onProgress?.(total, total)
  // compress off the main thread (fflate workers); images and other packed formats are stored as is
  const entries: AsyncZippable = {}
  for (const [path, data] of Object.entries(out)) entries[path] = STORED.test(path) ? [data, { level: 0 }] : data
  const zipped = await new Promise<Uint8Array>((resolve, reject) => zip(entries, { level: 6 }, (err, data) => (err ? reject(err) : resolve(data))))
  return new Blob([zipped as BlobPart], { type: 'application/zip' })
}
