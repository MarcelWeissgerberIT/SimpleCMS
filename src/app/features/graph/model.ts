/** Graph data: pages → nodes, hierarchy + links/mentions (+ relations) → edges. */
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force'
import { linkedPageIds } from '../../store/store'
import type { Database, ID, Page } from '../../store/types'
import { inTemplate } from '../../store/selectors'

export type NodeKind = 'page' | 'database' | 'row'
export type EdgeKind = 'tree' | 'link'

export interface GNode extends SimulationNodeDatum {
  id: ID
  title: string
  kind: NodeKind
  degree: number
  links: number
  children: number
  r: number
}

export interface GEdge extends SimulationLinkDatum<GNode> {
  source: ID | GNode
  target: ID | GNode
  kind: EdgeKind
}

export interface GraphOptions {
  hierarchy: boolean
  rows: boolean
  orphans: boolean
}

/** Pages whose ancestor chain contains a trashed page are hidden too. */
function liveSet(pages: Record<ID, Page>): Set<ID> {
  const memo = new Map<ID, boolean>()
  const live = (id: ID, depth = 0): boolean => {
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    const p = pages[id]
    let ok = !!p && !p.trashed
    if (ok && p.parentId && depth < 64) ok = pages[p.parentId] ? live(p.parentId, depth + 1) : true
    memo.set(id, ok)
    return ok
  }
  const out = new Set<ID>()
  for (const id in pages) if (live(id)) out.add(id)
  return out
}

/** linkedPageIds per content object — unchanged pages keep their (immutable) content object */
const linkCache = new WeakMap<object, ID[]>()
function linksOf(page: Page): ID[] {
  if (!page.content) return []
  let ids = linkCache.get(page.content)
  if (!ids) {
    ids = linkedPageIds(page.content)
    linkCache.set(page.content, ids)
  }
  return ids
}

/** Everything the layout depends on; equal signatures → the simulation can keep running untouched. */
export function graphSignature(g: { nodes: GNode[]; edges: GEdge[] }): string {
  const parts: string[] = []
  for (const n of g.nodes) parts.push(`${n.id}\u0001${n.kind}\u0001${n.title}\u0001${n.r}`)
  parts.push('|')
  for (const e of g.edges) parts.push(`${e.kind}${e.source as ID}>${e.target as ID}`)
  return parts.join('\u0002')
}

export function buildGraph(pages: Record<ID, Page>, databases: Record<ID, Database>, opts: GraphOptions, untitled: string) {
  const alive = liveSet(pages)
  // template pages (features/templates) are not part of the workspace's network
  const include = (p: Page) => alive.has(p.id) && (opts.rows || !p.databaseId) && !inTemplate(pages, p.id)
  const nodes = new Map<ID, GNode>()
  for (const p of Object.values(pages)) {
    if (!include(p)) continue
    nodes.set(p.id, {
      id: p.id,
      title: p.title.trim() || untitled,
      kind: p.kind === 'database' ? 'database' : p.databaseId ? 'row' : 'page',
      degree: 0,
      links: 0,
      children: 0,
      r: 4,
    })
  }

  const edges: GEdge[] = []
  const seen = new Set<string>()
  const add = (a: ID, b: ID, kind: EdgeKind) => {
    if (a === b || !nodes.has(a) || !nodes.has(b)) return
    const key = kind === 'tree' ? `t:${a}>${b}` : `l:${a < b ? a : b}|${a < b ? b : a}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ source: a, target: b, kind })
  }

  for (const p of Object.values(pages)) {
    if (!nodes.has(p.id)) continue
    if (opts.hierarchy && p.parentId) add(p.parentId, p.id, 'tree')
    for (const target of linksOf(p)) add(p.id, target, 'link')
    // relations between rows are links too (only visible with rows)
    if (opts.rows && p.databaseId) {
      const db = databases[p.databaseId]
      for (const prop of db?.properties ?? []) {
        if (prop.type !== 'relation') continue
        const v = p.properties[prop.id]
        if (Array.isArray(v)) for (const target of v) add(p.id, target, 'link')
      }
    }
  }

  for (const e of edges) {
    const a = nodes.get(e.source as ID)!
    const b = nodes.get(e.target as ID)!
    a.degree++
    b.degree++
    if (e.kind === 'link') {
      a.links++
      b.links++
    } else a.children++
  }

  let list = [...nodes.values()]
  if (!opts.orphans) list = list.filter((n) => n.degree > 0)
  const scale = list.length > 300 ? 0.7 : 1
  for (const n of list) n.r = n.kind === 'row' ? 2.6 : Math.min(17, (4.2 + Math.sqrt(n.degree) * 2.1) * scale)
  const keep = new Set(list.map((n) => n.id))
  return { nodes: list, edges: edges.filter((e) => keep.has(e.source as ID) && keep.has(e.target as ID)) }
}
