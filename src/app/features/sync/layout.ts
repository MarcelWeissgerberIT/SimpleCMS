/**
 * The synced file layout — one Markdown file per page, a folder tree mirroring the page tree:
 *
 *   Team wiki.md                 page (YAML front matter: id, title, icon, created, updated)
 *   Team wiki/Brand voice.md     its sub pages
 *   Tasks/_database.md           a database: schema + views summary
 *   Tasks/_rows.csv              all rows as a table
 *   Tasks/Write spec.md          one file per row (front matter carries the properties)
 *   Tasks/Write spec/…           a row's sub pages
 *   _files/diagram.png           attachments (onefile: refs become relative paths)
 *   .trash/…                     pages in the trash (emptying the trash removes them)
 *
 * Names are file-system safe and collision-safe per folder ("X", "X (2)"). A page keeps the name
 * it was written under while its title still fits it, so a new sibling never renames an old one.
 */
import type { Database, ID, Page } from '../../store/types'
import { sortPages } from '../../store/selectors'
import { getFile } from '../../lib/files'
import { safeName, uniqueName } from '../io/export/collect'
import type { Desired, Manifest } from './types'

export const TRASH_DIR = '.trash'
export const FILES_DIR = '_files'
export const DB_FILE = '_database.md'
export const ROWS_FILE = '_rows.csv'
const FILE_REF = /onefile:[0-9a-z]+/g

export interface Layout {
  files: Desired[]
  byPath: Map<string, Desired>
  /** page / row → its .md · database → its _database.md */
  pathOfId: Map<ID, string>
  /** folder that holds a page's children ("Team wiki/") */
  folderOfId: Map<ID, string>
  /** onefile ref → _files/… */
  pathOfRef: Map<string, string>
}

/** onefile refs a page uses (content, cover, files properties) — cached per page object. */
const refCache = new WeakMap<Page, string[]>()
export function refsOf(p: Page): string[] {
  let refs = refCache.get(p)
  if (!refs) {
    refs = [...new Set(JSON.stringify([p.content, p.cover, p.properties]).match(FILE_REF) ?? [])]
    refCache.set(p, refs)
  }
  return refs
}

const lower = (s: string) => s.toLowerCase()
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const fits = (name: string, base: string) => name === base || new RegExp(`^${escapeRe(base)} \\(\\d+\\)$`).test(name)

/** Where each page / database was written last time: id → { dir, name }. */
function previousNames(prev: Manifest): Map<ID, { dir: string; name: string }> {
  const out = new Map<ID, { dir: string; name: string }>()
  for (const [path, e] of Object.entries(prev.entries)) {
    if (!e.id) continue
    if (e.kind === 'page' || e.kind === 'row') {
      const i = path.lastIndexOf('/')
      out.set(e.id, { dir: path.slice(0, i + 1), name: path.slice(i + 1).replace(/\.md$/, '') })
    } else if (e.kind === 'database') {
      const folder = path.slice(0, -DB_FILE.length - 1)
      const i = folder.lastIndexOf('/')
      out.set(e.id, { dir: folder.slice(0, i + 1), name: folder.slice(i + 1) })
    }
  }
  return out
}

export async function computeLayout(pages: Record<ID, Page>, databases: Record<ID, Database>, prev: Manifest, untitled: string): Promise<Layout> {
  const files: Desired[] = []
  const pathOfId = new Map<ID, string>()
  const folderOfId = new Map<ID, string>()
  const prevNames = previousNames(prev)

  const kids = new Map<ID | null, Page[]>()
  const rowsOf = new Map<ID, Page[]>()
  for (const p of Object.values(pages)) {
    if (p.databaseId) {
      const list = rowsOf.get(p.databaseId)
      if (list) list.push(p)
      else rowsOf.set(p.databaseId, [p])
      continue
    }
    // a parent that is gone: the page shows up at the top level
    const key = p.parentId && pages[p.parentId] ? p.parentId : null
    const list = kids.get(key)
    if (list) list.push(p)
    else kids.set(key, [p])
  }
  for (const list of kids.values()) sortPages(list)
  for (const list of rowsOf.values()) sortPages(list)

  const trashedUp = (p: Page): boolean => {
    const seen = new Set<ID>()
    let cur: Page | undefined = p
    while (cur && !seen.has(cur.id)) {
      if (cur.trashed) return true
      seen.add(cur.id)
      const parentId: ID | null = cur.databaseId ?? cur.parentId
      cur = parentId ? pages[parentId] : undefined
    }
    return false
  }

  /** Names for a group of siblings in `dir`: previous names that still fit first, then the rest. */
  const names = (dir: string, list: Page[], used: Set<string>) => {
    const out = new Map<ID, string>()
    for (const p of list) {
      const prevName = prevNames.get(p.id)
      const base = safeName(p.title, untitled)
      if (prevName && prevName.dir === dir && fits(prevName.name, base) && !used.has(lower(prevName.name))) {
        used.add(lower(prevName.name))
        out.set(p.id, prevName.name)
      }
    }
    for (const p of list) if (!out.has(p.id)) out.set(p.id, uniqueName(safeName(p.title, untitled), used))
    return out
  }

  const visited = new Set<ID>()
  const place = (dir: string, list: Page[], used: Set<string>, inTrash: boolean) => {
    const group = list.filter((p) => !visited.has(p.id) && (inTrash || !p.trashed))
    const named = names(dir, group, used)
    for (const p of group) {
      visited.add(p.id)
      const name = named.get(p.id)!
      const folder = `${dir}${name}/`
      folderOfId.set(p.id, folder)
      if (p.kind === 'database' && databases[p.id]) {
        pathOfId.set(p.id, `${folder}${DB_FILE}`)
        files.push({ path: `${folder}${DB_FILE}`, kind: 'database', id: p.id, trashed: inTrash || undefined })
        files.push({ path: `${folder}${ROWS_FILE}`, kind: 'csv', id: p.id, trashed: inTrash || undefined })
        const inFolder = new Set([lower(DB_FILE.replace(/\.md$/, '')), lower(ROWS_FILE.replace(/\.csv$/, ''))])
        const rows = (rowsOf.get(p.id) ?? []).filter((r) => inTrash || !r.trashed)
        const rowNames = names(folder, rows, inFolder)
        for (const r of rows) {
          if (visited.has(r.id)) continue
          visited.add(r.id)
          const rn = rowNames.get(r.id)!
          pathOfId.set(r.id, `${folder}${rn}.md`)
          folderOfId.set(r.id, `${folder}${rn}/`)
          files.push({ path: `${folder}${rn}.md`, kind: 'row', id: r.id, trashed: inTrash || undefined })
          place(`${folder}${rn}/`, kids.get(r.id) ?? [], new Set(), inTrash)
        }
        place(folder, kids.get(p.id) ?? [], inFolder, inTrash)
      } else {
        pathOfId.set(p.id, `${dir}${name}.md`)
        files.push({ path: `${dir}${name}.md`, kind: p.databaseId ? 'row' : 'page', id: p.id, trashed: inTrash || undefined })
        place(folder, kids.get(p.id) ?? [], new Set(), inTrash)
      }
    }
  }

  place('', kids.get(null) ?? [], new Set([lower(FILES_DIR)]), false)
  // the trash: every trashed page whose parent is not in the trash, with everything below it
  const containerTrashed = (p: Page) => {
    const c = p.databaseId ?? p.parentId
    const cp = c ? pages[c] : undefined
    return cp ? trashedUp(cp) : false
  }
  const trashRoots = sortPages(Object.values(pages).filter((p) => p.trashed && !visited.has(p.id) && !containerTrashed(p)))
  place(`${TRASH_DIR}/`, trashRoots, new Set(), true)

  /* ---------- attachments ---------- */
  const pathOfRef = new Map<string, string>()
  const used = new Set<string>()
  const prevRef = new Map<string, string>()
  for (const [path, e] of Object.entries(prev.entries)) if (e.kind === 'file' && e.ref) prevRef.set(e.ref, path)
  const refs = new Set<string>()
  for (const id of visited) for (const r of refsOf(pages[id])) refs.add(r)
  const fresh: string[] = []
  for (const ref of refs) {
    const p = prevRef.get(ref)
    const name = p?.slice(FILES_DIR.length + 1)
    if (p && name && !used.has(lower(name))) {
      used.add(lower(name))
      pathOfRef.set(ref, p)
    } else fresh.push(ref)
  }
  for (const ref of fresh) {
    const f = await getFile(ref).catch(() => undefined)
    if (!f) continue
    pathOfRef.set(ref, `${FILES_DIR}/${uniqueName(safeName(f.name, 'file'), used)}`)
  }
  for (const [ref, path] of pathOfRef) files.push({ path, kind: 'file', ref })

  return { files, byPath: new Map(files.map((f) => [f.path, f])), pathOfId, folderOfId, pathOfRef }
}
