/** Collect the exported tree (a page subtree or the whole workspace) + shared helpers. */
import { useWorkspace } from '../../../store/store'
import { inTemplate, selectRows, sortPages } from '../../../store/selectors'
import type { Database, ID, Page } from '../../../store/types'

export interface ExportTree {
  roots: Page[]
  pages: Record<ID, Page>
  databases: Record<ID, Database>
  /** non-row children (pages + databases) per parent, sorted */
  children: (id: ID) => Page[]
  /** rows of a database */
  rows: (dbId: ID) => Page[]
  /** every exported page in document order (parents first) */
  all: Page[]
}

export function collectTree(rootId: ID | null): ExportTree {
  const { pages, databases } = useWorkspace.getState()
  // templates (features/templates) only travel when a template page itself is exported
  const skipTemplates = !rootId || !inTemplate(pages, rootId)
  const byParent = new Map<ID | null, Page[]>()
  for (const p of Object.values(pages)) {
    if (p.trashed || p.databaseId || (skipTemplates && inTemplate(pages, p.id))) continue
    const k = p.parentId ?? null
    byParent.set(k, [...(byParent.get(k) ?? []), p])
  }
  for (const list of byParent.values()) sortPages(list)
  const children = (id: ID) => byParent.get(id) ?? []
  const rows = (dbId: ID) => selectRows(pages, dbId)

  const roots = rootId ? (pages[rootId] && !pages[rootId].trashed ? [pages[rootId]] : []) : (byParent.get(null) ?? [])
  const all: Page[] = []
  const visit = (p: Page) => {
    all.push(p)
    if (p.kind === 'database' && databases[p.id]) for (const r of rows(p.id)) visit(r)
    for (const c of children(p.id)) visit(c)
  }
  roots.forEach(visit)
  return { roots, pages, databases, children, rows, all }
}

export function treeStats(tree: ExportTree) {
  let pages = 0
  let dbs = 0
  let rows = 0
  for (const p of tree.all) {
    if (p.kind === 'database') dbs++
    else if (p.databaseId) rows++
    else pages++
  }
  return { pages, dbs, rows }
}

export const FILE_REF_RE = /onefile:[0-9a-z]+/g

/** All onefile refs used by the exported pages (content, covers, files properties). */
export function collectRefs(tree: ExportTree): string[] {
  const set = new Set<string>()
  for (const p of tree.all) {
    const json = JSON.stringify([p.content, p.cover, p.properties])
    for (const m of json.match(FILE_REF_RE) ?? []) set.add(m)
  }
  return [...set]
}

/** File-system-safe name (keeps unicode, strips reserved characters). */
export function safeName(title: string, fallback: string): string {
  const s = title
    .replace(/[\\/:*?"<>|#%{}^~[\]`]/g, '-')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s-]+|[.\s]+$/g, '')
    .slice(0, 80)
    .trim()
  return s || fallback
}

export function uniqueName(base: string, used: Set<string>): string {
  let name = base
  let n = 2
  while (used.has(name.toLowerCase())) name = `${base} (${n++})`
  used.add(name.toLowerCase())
  return name
}

/** "a/b/c.md" → "x/y.md" relative link, each segment URL-encoded. */
export function relativePath(fromFile: string, toFile: string): string {
  const from = fromFile.split('/').slice(0, -1)
  const to = toFile.split('/')
  let i = 0
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++
  const up = from.slice(i).map(() => '..')
  return [...up, ...to.slice(i)].map((seg) => (seg === '..' ? seg : encodeURIComponent(seg))).join('/')
}

export function slugify(s: string): string {
  return (
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'one'
  )
}

export function todayStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.append(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export function formatBytes(n: number, lang: string): string {
  const fmt = (v: number) => new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US', { maximumFractionDigits: 1 }).format(v)
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${fmt(n / 1024)} KB`
  return `${fmt(n / 1024 / 1024)} MB`
}
