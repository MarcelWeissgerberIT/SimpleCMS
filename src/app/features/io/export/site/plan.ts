/**
 * Website export — the plan: which page lands at which path, the navigation tree, section
 * numbers and every media file the pages use. Pure and synchronous (no IndexedDB, no DOM),
 * so the export dialog can count pages and files while the user is still choosing options.
 *
 * Paths are pretty and nested: "team-wiki/brand-voice/index.html". Slugs are ASCII, unique
 * among siblings and stable: the same workspace always gives the same paths.
 */
import type { ID, Page } from '../../../../store/types'
import type { ExportTree } from '../collect'
import { iconAssetPaths } from '../../../../editor'

export type SiteKind = 'home' | 'page' | 'database' | 'row'

export interface SiteNode {
  page: Page
  kind: SiteKind
  /** folder of the page, '' for the home page, else "a/b/" */
  dir: string
  /** "a/b/index.html" */
  file: string
  /** Markdown twin "a/b/index.md" */
  md: string
  /** parent inside the site (null: top level, or the home page itself) */
  parent: ID | null
  /** section number "2.1" (pages + databases; '' for the home page and rows) */
  num: string
  /** rows: 1-based position in their database */
  index: number
}

export interface SitePlan {
  /** the scope root rendered as the home page (page scope); null → a generated index page */
  home: SiteNode | null
  nodes: Map<ID, SiteNode>
  /** document order (home first, parents before children) */
  order: SiteNode[]
  /** navigation: top-level entries */
  top: ID[]
  /** navigation: non-row children per page */
  kids: Map<ID, ID[]>
  /** rows per database (inside the site) */
  rows: Map<ID, ID[]>
  /** media sources (onefile refs, public asset paths) in first-use order */
  media: string[]
  /** newest edit in the site — the site's "updated" date (keeps the output deterministic) */
  updatedAt: number
}

/** Top-level names the site itself uses. */
const RESERVED = new Set(['assets', 'media', 'index', '404', 'sitemap', 'robots', 'rss', 'llms', 'llms-full', 'content', 'favicon'])

const TRANSLIT: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss', æ: 'ae', Æ: 'Ae', ø: 'o', Ø: 'O', œ: 'oe', Œ: 'Oe', ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ð: 'd', þ: 'th' }

/** "Über uns & Team" → "ueber-uns-team" (ASCII only; '' when nothing is left). */
export function asciiSlug(s: string, max = 60): string {
  let out = s
    .replace(/[äöüÄÖÜßæÆøØœŒłŁđĐðþ]/g, (c) => TRANSLIT[c] ?? c)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (out.length > max) {
    out = out.slice(0, max)
    const cut = out.lastIndexOf('-')
    if (cut > max * 0.6) out = out.slice(0, cut)
    out = out.replace(/-+$/, '')
  }
  return out
}

/** Public asset paths that may be copied into the site (no traversal, no odd characters). */
export const ASSET_PATH = /^assets\/[\w-]+(?:\/[\w.-]+)+$/
export const isAssetPath = (s: string) => ASSET_PATH.test(s) && !s.includes('..')

const FILE_REF = /onefile:[0-9a-z]+/g
const ASSET_SRC = /"src":"(assets\/[\w./-]+)"/g
const CALLOUT_ASSET = /"icon":"asset:([\w-]{1,64})"/g

/** JSON.stringify replacer that leaves out button actions. */
export const withoutActions = (key: string, value: unknown) => (key === 'actions' ? undefined : value)

/** Every media source a page uses: content images/files, cover, icon, files properties. */
function mediaOf(p: Page): string[] {
  const out: string[] = []
  if (p.cover?.type === 'image') out.push(p.cover.value)
  if (p.icon?.type === 'asset' && /^[\w-]{1,64}$/.test(p.icon.value)) out.push(`assets/icons/${p.icon.value}.webp`)
  if (p.content) {
    // button actions never leave the workspace, nor do files only they reference
    const json = JSON.stringify(p.content, withoutActions)
    for (const m of json.match(FILE_REF) ?? []) out.push(m)
    for (const m of json.matchAll(ASSET_SRC)) out.push(m[1])
    for (const m of json.matchAll(CALLOUT_ASSET)) out.push(`assets/icons/${m[1]}.webp`)
    // inline icons (node `icon`): objects are bundled files too
    out.push(...iconAssetPaths(p.content))
  }
  const props = JSON.stringify(p.properties ?? {})
  for (const m of props.match(FILE_REF) ?? []) out.push(m)
  return out.filter((s) => s.startsWith('onefile:') || isAssetPath(s))
}

export function planSite(tree: ExportTree, rootId: ID | null): SitePlan {
  const nodes = new Map<ID, SiteNode>()
  const order: SiteNode[] = []
  const kids = new Map<ID, ID[]>()
  const rows = new Map<ID, ID[]>()
  const isDb = (p: Page) => p.kind === 'database' && !!tree.databases[p.id]

  /** a unique slug inside one folder */
  const slugIn = (used: Set<string>, p: Page, topLevel: boolean) => {
    let base = asciiSlug(p.title) || (isDb(p) ? 'database' : 'page')
    if (topLevel && RESERVED.has(base)) base = `${base}-page`
    let slug = base
    if (used.has(slug)) slug = `${base}-${p.id.slice(0, 6).toLowerCase().replace(/[^a-z0-9]/g, '')}`
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`
    used.add(slug)
    return slug
  }

  const add = (p: Page, dir: string, parent: ID | null, kind: SiteKind, num: string, index = 0) => {
    const node: SiteNode = { page: p, kind, dir, file: `${dir}index.html`, md: `${dir}index.md`, parent, num, index }
    nodes.set(p.id, node)
    order.push(node)
    return node
  }

  /** place the children (and rows) of `p`, which lives in folder `dir` */
  const placeChildren = (p: Page, dir: string, num: string) => {
    const used = new Set<string>()
    const top = dir === ''
    const rowIds: ID[] = []
    const kidIds: ID[] = []
    // rows first: they are the body of a database; sub pages of a database share its folder
    if (isDb(p)) {
      tree.rows(p.id).forEach((r, i) => {
        const node = add(r, `${dir}${slugIn(used, r, top)}/`, p.id, 'row', num, i + 1)
        rowIds.push(r.id)
        placeChildren(r, node.dir, num)
      })
      rows.set(p.id, rowIds)
    }
    tree.children(p.id).forEach((c, i) => {
      const cnum = num ? `${num}.${i + 1}` : String(i + 1)
      const node = add(c, `${dir}${slugIn(used, c, top)}/`, p.id, isDb(c) ? 'database' : 'page', cnum)
      kidIds.push(c.id)
      placeChildren(c, node.dir, cnum)
    })
    kids.set(p.id, kidIds)
  }

  let home: SiteNode | null = null
  let top: ID[]
  if (rootId && tree.roots[0]?.id === rootId) {
    const root = tree.roots[0]
    home = add(root, '', null, 'home', '')
    placeChildren(root, '', '')
    // top-level navigation of a page site: the root's sub pages (rows live in the database table)
    top = kids.get(root.id) ?? []
    // children of the home page are top level in the site
    for (const id of top) nodes.get(id)!.parent = null
    for (const id of rows.get(root.id) ?? []) nodes.get(id)!.parent = root.id
  } else {
    const used = new Set<string>()
    top = []
    tree.roots.forEach((r, i) => {
      const num = String(i + 1)
      const node = add(r, `${slugIn(used, r, true)}/`, null, isDb(r) ? 'database' : 'page', num)
      top.push(r.id)
      placeChildren(r, node.dir, num)
    })
  }

  const media: string[] = []
  const seen = new Set<string>()
  let updatedAt = 0
  for (const n of order) {
    updatedAt = Math.max(updatedAt, n.page.updatedAt || 0)
    for (const m of mediaOf(n.page)) {
      if (seen.has(m)) continue
      seen.add(m)
      media.push(m)
    }
  }
  return { home, nodes, order, top, kids, rows, media, updatedAt: updatedAt || 0 }
}

/** "name.github.io/site" → "https://name.github.io/site/"; '' stays ''; null when it is not a web address. */
export function normalizeBaseUrl(raw: string): string | null {
  const s = raw.trim()
  if (!s) return ''
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`
  let u: URL
  try {
    u = new URL(withScheme)
  } catch {
    return null
  }
  if (!/^https?:$/.test(u.protocol) || (!u.hostname.includes('.') && u.hostname !== 'localhost')) return null
  if (u.username || u.password) return null
  const path = u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`
  return `${u.protocol}//${u.host}${path}`
}

/** Relative URL between two site paths ("a/b/index.html" → "c/index.html" = "../../c/index.html"). */
export function rel(fromFile: string, toPath: string): string {
  const from = fromFile.split('/').slice(0, -1)
  const to = toPath.split('/')
  let i = 0
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++
  return [...from.slice(i).map(() => '..'), ...to.slice(i)].join('/')
}

/** Ancestors of a node inside the site, root first (excluding the home page). */
export function ancestorsOf(plan: SitePlan, id: ID): SiteNode[] {
  const out: SiteNode[] = []
  const seen = new Set<ID>()
  let cur = plan.nodes.get(id)?.parent ?? null
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const n = plan.nodes.get(cur)
    if (!n || n.kind === 'home') break
    out.unshift(n)
    cur = n.parent
  }
  return out
}

/** Number of web pages and files the site will contain (media that cannot be read are dropped later). */
export function siteCounts(plan: SitePlan, hasBaseUrl: boolean): { pages: number; files: number } {
  const pages = plan.order.length + (plan.home ? 0 : 1)
  // html + md per page, media, site.css + favicon + 4 fonts, 404, robots, llms, llms-full, content.json
  // (+ sitemap and rss, which need absolute URLs and are only written with a base URL)
  const files = pages * 2 + plan.media.length + 6 + 5 + (hasBaseUrl ? 2 : 0)
  return { pages, files }
}
