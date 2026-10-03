/**
 * The structure of an own (or customised) template, read from its page subtree — the same outline
 * lines the built-in catalogue writes by hand: pages, databases with their views, fields and rows.
 */
import type { Database, ID, Page } from '../../store/types'
import { countOf } from '../io/count'
import type { OutlineLine } from './catalog'

type T = (key: string, vars?: Record<string, string | number>) => string

const MAX_LINES = 14
const MAX_FIELDS = 5

export function treeOutline(pages: Record<ID, Page>, dbs: Record<ID, Database>, rootId: ID, t: T): OutlineLine[] {
  const kids = new Map<ID, Page[]>()
  const rows = new Map<ID, number>()
  for (const id of Object.keys(pages)) {
    const p = pages[id]
    if (p.trashed || !p.parentId) continue
    if (p.databaseId) {
      rows.set(p.databaseId, (rows.get(p.databaseId) ?? 0) + 1)
      continue
    }
    const list = kids.get(p.parentId)
    if (list) list.push(p)
    else kids.set(p.parentId, [p])
  }
  const untitled = t('common.untitled')
  const lines: OutlineLine[] = []
  let hidden = 0
  const add = (line: OutlineLine) => {
    if (lines.length < MAX_LINES) lines.push(line)
    else hidden++
  }
  const visit = (p: Page, depth: number) => {
    const label = p.title.trim() || untitled
    const db = p.kind === 'database' ? dbs[p.id] : undefined
    if (db) {
      add({ depth, kind: 'db', label })
      if (db.views.length) add({ depth: depth + 1, kind: 'views', label: db.views.map((v) => v.name.trim() || untitled).join(' · ') })
      const fields = db.properties.filter((x) => x.type !== 'title').map((x) => x.name.trim() || untitled)
      if (fields.length) add({ depth: depth + 1, kind: 'fields', label: fields.slice(0, MAX_FIELDS).join(' · ') + (fields.length > MAX_FIELDS ? ` · ${t('features.tpl.more', { n: fields.length - MAX_FIELDS })}` : '') })
      const n = rows.get(p.id) ?? 0
      const tpls = db.templates?.length ?? 0
      if (n || tpls) add({ depth: depth + 1, kind: 'rows', label: [n ? countOf(t, 'row', n) : '', tpls ? t(`features.tpl.rowTemplates.${tpls === 1 ? 'one' : 'other'}`, { n: tpls }) : ''].filter(Boolean).join(' + ') })
    } else add({ depth, kind: 'page', label })
    const children = (kids.get(p.id) ?? []).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
    for (const c of children) visit(c, Math.min(depth + 1, 4))
  }
  const root = pages[rootId]
  if (root) visit(root, 0)
  if (hidden) lines.push({ depth: 1, kind: 'rows', label: t('features.tpl.more', { n: hidden }) })
  return lines
}
