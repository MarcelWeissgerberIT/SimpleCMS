/**
 * Website export — the machine-readable files: sitemap.xml, robots.txt, rss.xml,
 * llms.txt / llms-full.txt (llmstxt.org) and content.json.
 */
import type { DateValue, ID } from '../../../../store/types'
import { t } from '../../../../i18n'
import { ancestorsOf, type SiteNode, type SitePlan } from './plan'
import { absUrl, type SiteMeta } from './page'
import { excerptOf, titleOf, valueText, type RenderCtx } from './render'

export type SiteFeed = { kind: 'recent' } | { kind: 'database'; databaseId: ID }

const xml = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
// eslint-disable-next-line no-control-regex
const xmlText = (s: unknown) => xml(String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''))

const isoDay = (ms: number) => new Date(ms || 0).toISOString().slice(0, 10)
const iso = (ms: number) => new Date(ms || 0).toISOString()

/** URL of a site path for feeds and lists: absolute with a base URL, else relative to the site root. */
const linkOf = (meta: SiteMeta, path: string) => absUrl(meta, path) || path

/**
 * A date property value ("2026-10-03" or "2026-10-03T14:30", stored without a zone) as the
 * moment it means where it was written: local time. NaN when it is not a date.
 */
function localMs(s: string | undefined): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s ?? '')
  if (!m) return NaN
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)).getTime()
}

export function sitemapXml(plan: SitePlan, meta: SiteMeta): string {
  const urls: string[] = []
  if (!plan.home) urls.push(`<url><loc>${xml(meta.baseUrl)}</loc><lastmod>${isoDay(plan.updatedAt)}</lastmod></url>`)
  for (const n of plan.order) urls.push(`<url><loc>${xml(absUrl(meta, n.file))}</loc><lastmod>${isoDay(n.page.updatedAt)}</lastmod></url>`)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
}

export function robotsTxt(meta: SiteMeta): string {
  return `User-agent: *\nAllow: /\n${meta.baseUrl ? `\nSitemap: ${meta.baseUrl}sitemap.xml\n` : ''}`
}

/** Feed entries: the rows of a database (newest date first) or the most recently edited pages. */
export function feedItems(plan: SitePlan, ctx: RenderCtx, feed: SiteFeed, limit = 30): SiteNode[] {
  if (feed.kind === 'database' && plan.rows.has(feed.databaseId)) {
    const db = ctx.tree.databases[feed.databaseId]
    const dateProp = db?.properties.find((p) => p.type === 'date')
    const when = (n: SiteNode) => {
      const v = dateProp ? (n.page.properties[dateProp.id] as DateValue | null | undefined) : null
      const ms = localMs(v?.start)
      return Number.isFinite(ms) ? ms : n.page.createdAt
    }
    return (plan.rows.get(feed.databaseId) ?? [])
      .map((id) => plan.nodes.get(id)!)
      .filter(Boolean)
      .sort((a, b) => when(b) - when(a) || a.file.localeCompare(b.file))
      .slice(0, limit)
  }
  return plan.order
    .filter((n) => n.kind !== 'database')
    .slice()
    .sort((a, b) => b.page.updatedAt - a.page.updatedAt || a.file.localeCompare(b.file))
    .slice(0, limit)
}

export function rssXml(plan: SitePlan, ctx: RenderCtx, meta: SiteMeta, items: SiteNode[], description: string, feed: SiteFeed): string {
  const db = feed.kind === 'database' ? ctx.tree.databases[feed.databaseId] : undefined
  const dateProp = db?.properties.find((p) => p.type === 'date')
  const pubDate = (n: SiteNode) => {
    const v = dateProp ? (n.page.properties[dateProp.id] as DateValue | null | undefined) : null
    // the same local reading as the feed order (feedItems), written as RFC 822 in GMT
    const ms = localMs(v?.start)
    return new Date(Number.isFinite(ms) ? ms : feed.kind === 'database' ? n.page.createdAt : n.page.updatedAt).toUTCString()
  }
  const self = meta.baseUrl ? `\n<atom:link href="${xml(`${meta.baseUrl}rss.xml`)}" rel="self" type="application/rss+xml"/>` : ''
  const entries = items
    .map(
      (n) =>
        `<item>\n<title>${xmlText(titleOf(ctx, n.page))}</title>\n<link>${xml(linkOf(meta, n.file))}</link>\n<guid isPermaLink="false">one:${xml(n.page.id)}</guid>\n<pubDate>${pubDate(n)}</pubDate>\n<description>${xmlText(excerptOf(n.page, 300))}</description>\n</item>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${xmlText(meta.title)}</title>
<link>${xml(meta.baseUrl || 'index.html')}</link>
<description>${xmlText(description)}</description>
<language>${meta.lang}</language>
<lastBuildDate>${new Date(plan.updatedAt || 0).toUTCString()}</lastBuildDate>
<generator>SimpleCMS One</generator>${self}
${entries}
</channel>
</rss>
`
}

/** llms.txt (llmstxt.org): title, one-line summary, then one section per top-level branch. */
export function llmsTxt(plan: SitePlan, ctx: RenderCtx, meta: SiteMeta, summary: string): string {
  const entry = (n: SiteNode) => {
    const ex = excerptOf(n.page, 110)
    return `- [${titleOf(ctx, n.page).replace(/[[\]]/g, '\\$&')}](${linkOf(meta, n.md)})${ex ? `: ${ex.replace(/\s+/g, ' ')}` : ''}`
  }
  const out: string[] = [`# ${meta.title}`, '', `> ${summary.replace(/\s+/g, ' ').trim()}`, '']
  out.push(t('features.site.gen.llmsIntro', { full: linkOf(meta, 'llms-full.txt') }), '')
  const branch = new Map<ID, SiteNode[]>()
  const loose: SiteNode[] = []
  const tops = new Set(plan.top)
  for (const n of plan.order) {
    if (n.kind === 'home') continue
    const top = n.parent === null && tops.has(n.page.id) ? n : ancestorsOf(plan, n.page.id)[0]
    if (!top) {
      loose.push(n)
      continue
    }
    const list = branch.get(top.page.id)
    if (list) list.push(n)
    else branch.set(top.page.id, [n])
  }
  // one push per line (no spreading: a branch can hold thousands of rows)
  const section = (heading: string, nodes: SiteNode[], first?: SiteNode) => {
    out.push(`## ${heading}`, '')
    if (first) out.push(entry(first))
    for (const n of nodes) out.push(entry(n))
    out.push('')
  }
  if (plan.home) section(titleOf(ctx, plan.home.page), loose, plan.home)
  else if (loose.length) section(t('features.site.gen.index'), loose)
  for (const id of plan.top) {
    const list = branch.get(id)
    if (list?.length) section(titleOf(ctx, list[0].page), list)
  }
  return out.join('\n').trimEnd() + '\n'
}

/** llms-full.txt: every page's Markdown, in site order. */
export function llmsFullTxt(meta: SiteMeta, summary: string, pages: Array<{ node: SiteNode; md: string }>): string {
  const head = `# ${meta.title}\n\n> ${summary.replace(/\s+/g, ' ').trim()}\n`
  return [head, ...pages.map(({ node, md }) => `---\n\nSource: ${linkOf(meta, node.file)}\n\n${md.trim()}\n`)].join('\n')
}

/** content.json: the site's pages as data (properties as plain values). */
export function contentJson(plan: SitePlan, ctx: RenderCtx, meta: SiteMeta): string {
  const pages = plan.order.map((n) => {
    const p = n.page
    const db = p.databaseId ? ctx.tree.databases[p.databaseId] : undefined
    const properties: Record<string, string> = {}
    if (db) for (const d of db.properties) if (d.type !== 'title') properties[d.name] = valueText(ctx, null, db, d, p)
    return {
      id: p.id,
      title: titleOf(ctx, p),
      kind: n.kind,
      slug: n.dir.split('/').filter(Boolean).pop() ?? '',
      path: n.file,
      markdown: n.md,
      ...(meta.baseUrl ? { url: absUrl(meta, n.file) } : {}),
      parent: n.parent,
      database: p.databaseId ?? null,
      section: n.num || null,
      createdAt: iso(p.createdAt),
      updatedAt: iso(p.updatedAt),
      properties,
    }
  })
  return JSON.stringify({ site: { title: meta.title, baseUrl: meta.baseUrl || null, lang: meta.lang, updatedAt: iso(plan.updatedAt), generator: 'SimpleCMS One' }, pages }, null, 2) + '\n'
}
