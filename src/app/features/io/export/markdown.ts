/**
 * Markdown ZIP export (Notion-compatible layout, re-importable):
 *   Page.md + Page/ (subpages) · Database.csv + Database/ (row pages with "Property: value" header) · _files/
 */
import { zipSync, strToU8 } from 'fflate'
import type { ID, Page } from '../../../store/types'
import { docToMarkdown } from '../../../editor'
import { propertyValueToText } from '../../../database'
import { getFile } from '../../../lib/files'
import { collectRefs, relativePath, safeName, uniqueName, type ExportTree } from './collect'

const csvCell = (s: string) => (/[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

export async function buildMarkdownZip(tree: ExportTree, opts: { untitled: string; onProgress?: (done: number, total: number) => void }): Promise<Blob> {
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

  const rewrite = (md: string, from: string) =>
    md
      .replace(/\]\(#\/p\/([\w-]+)(?:\?[^)\s]*)?\)/g, (all, id: string) => {
        const target = pathOf.get(id)
        return target ? `](${relativePath(from, target)})` : all
      })
      .replace(/onefile:[0-9a-z]+/g, (ref) => {
        const target = filePath.get(ref)
        return target ? relativePath(from, target) : ref
      })

  // 3) pages + databases
  for (const p of tree.all) {
    const path = pathOf.get(p.id)
    if (!path) continue
    const db = tree.databases[p.id]
    if (p.kind === 'database' && db) {
      const rows = tree.rows(p.id)
      const lines = [db.properties.map((d) => csvCell(d.name)).join(',')]
      for (const r of rows) lines.push(db.properties.map((d) => csvCell(d.type === 'title' ? r.title : propertyValueToText(db, d, r))).join(','))
      out[path] = strToU8('﻿' + lines.join('\r\n') + '\r\n')
    } else {
      const parts = [`# ${p.title.trim() || opts.untitled}`, '']
      const rowDb = p.databaseId ? tree.databases[p.databaseId] : undefined
      if (rowDb) {
        const props: string[] = []
        for (const d of rowDb.properties) {
          if (d.type === 'title') continue
          const v = propertyValueToText(rowDb, d, p)
          if (v.trim()) props.push(`${d.name}: ${v.replace(/\n/g, ' ')}`)
        }
        if (props.length) parts.push(props.join('\n'), '')
      }
      const body = p.content ? docToMarkdown(p.content) : ''
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
  const zipped = zipSync(out, { level: 6 })
  return new Blob([zipped as BlobPart], { type: 'application/zip' })
}
