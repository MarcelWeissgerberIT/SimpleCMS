/**
 * "Publish as website": the workspace (or one page and its sub pages) as a static site in a ZIP.
 *
 *   index.html            home (the scope root, or a generated index of the top-level pages)
 *   <slug>/index.html     one page per page / database / row, + index.md (Markdown twin)
 *   assets/site.css       INSTRUMENT stylesheet (paper / carbon), assets/fonts/*.woff2, favicon
 *   media/                images and files from IndexedDB, covers and icons from the app
 *   sitemap.xml, rss.xml  (with a base URL) · robots.txt · llms.txt · llms-full.txt
 *   content.json · 404.html
 *
 * No scripts in the output; every page works from a web server and straight from the folder.
 * The output is deterministic: the same workspace gives the same files (dates come from the
 * pages, not from the clock).
 */
import { zip, strToU8, type AsyncZippable } from 'fflate'
import type { ID } from '../../../../store/types'
import { getFile, resolveAssetUrl } from '../../../../lib/files'
import { logoMarkSvg } from '@/shared/logo'
import { t } from '../../../../i18n'
import { countOf } from '../../count'
import type { ExportTree } from '../collect'
import { asciiSlug, isAssetPath, planSite, withoutActions, type SitePlan } from './plan'

export { normalizeBaseUrl } from './plan'
import { SITE_FONTS, siteCss } from './css'
import { contentHTML, dbTableHTML, excerptOf, pageMarkdown, valueHTML, type RenderCtx } from './render'
import { homeDocument, notFoundDocument, pageDocument, propsList, type SiteMeta } from './page'
import { contentJson, feedItems, llmsFullTxt, llmsTxt, robotsTxt, rssXml, sitemapXml, type SiteFeed } from './meta'

export type { SiteFeed }

export interface SiteOptions {
  title: string
  /** "https://name.github.io/site/" (normalise with normalizeBaseUrl) or '' */
  baseUrl: string
  feed: SiteFeed
  lang: 'en' | 'de'
  onProgress?: (done: number, total: number) => void
}

export interface SiteResult {
  blob: Blob
  pages: number
  files: number
}

/** Already compressed — deflating them again only costs time. */
const STORED = /\.(png|jpe?g|gif|webp|avif|zip|gz|mp4|webm|mov|mp3|m4a|ogg|woff2?|pdf)$/i

const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
}

/**
 * Files a web server would run or render as a page of the site (HTML, scripts, XML with
 * stylesheets, server scripts …). Attachments of these types are published as inert text files
 * ("page.html" → "page-html.txt"), so an uploaded file can never act as part of the site.
 * SVG is kept as an image, but only after DOMPurify removed scripts, handlers and foreign content.
 */
const ACTIVE_EXT = /^(html?|xhtml|xht|shtml|svgz|xml|xsl|xslt|js|mjs|cjs|jsx|php\d?|phtml|asp|aspx|jsp|cgi|pl|py|rb|sh|swf|wasm|htaccess|appcache|webmanifest)$/i
const ACTIVE_TYPE = /^(text\/html|application\/xhtml\+xml|(text|application)\/(xml|javascript|ecmascript|x-javascript)|application\/wasm)\b/i
const isSvg = (ext: string, type: string) => ext === 'svg' || /^image\/svg\+xml\b/i.test(type)

/** "Quarterly Report (final).PDF" → "quarterly-report-final.pdf" · "report.html" → "report-html.txt" */
function mediaName(name: string, type: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name)
  const ext = (m?.[1] ?? EXT_BY_TYPE[type] ?? 'bin').toLowerCase()
  const base = asciiSlug(m ? name.slice(0, -m[0].length) : name, 48) || 'file'
  if (isSvg(ext, type)) return `${base}.svg`
  if (ACTIVE_EXT.test(ext) || ACTIVE_TYPE.test(type)) return `${base}-${ext}.txt`
  return `${base}.${ext}`
}

/** An SVG without scripts, event handlers or embedded HTML — or null when nothing safe is left. */
function safeSvg(purify: typeof import('dompurify').default, text: string): string | null {
  const clean = String(purify.sanitize(text, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['foreignObject', 'script', 'iframe', 'embed', 'object'] })).trim()
  if (!/^<svg[\s>]/i.test(clean)) return null
  return /^<svg[^>]*\sxmlns=/i.test(clean) ? clean : clean.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"')
}

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  try {
    const r = await fetch(url)
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null
  } catch {
    return null
  }
}

/** Every block id that a link points at ("#/p/<page>?b=<block>"). */
function blockTargets(plan: SitePlan): Set<string> {
  const out = new Set<string>()
  for (const n of plan.order) {
    if (!n.page.content) continue
    for (const m of JSON.stringify(n.page.content, withoutActions).matchAll(/#\/p\/[\w-]+\?b=([\w-]{1,64})/g)) out.add(m[1])
  }
  return out
}

const tick = () => new Promise((r) => setTimeout(r, 0))

export async function buildSite(tree: ExportTree, rootId: ID | null, opts: SiteOptions): Promise<SiteResult> {
  const plan = planSite(tree, rootId)
  const meta: SiteMeta = { title: opts.title.trim() || 'One', baseUrl: opts.baseUrl, lang: opts.lang === 'de' ? 'de' : 'en' }
  const usesMath = plan.order.some((n) => n.page.content && /"(block|inline)Math"/.test(JSON.stringify(n.page.content)))
  const usesMermaid = plan.order.some((n) => n.page.content && /"mermaid"/.test(JSON.stringify(n.page.content)))
  // renderers are loaded on demand
  const [{ docToHTML, docToMarkdown, stripButtonActions }, { propertyValueToText, rowsOfView }, purify, katex, share] = await Promise.all([
    import('../../../../editor'),
    import('../../../../database'),
    import('dompurify').then((m) => m.default),
    usesMath ? import('katex').then((m) => m.default).catch(() => null) : Promise.resolve(null),
    usesMermaid ? import('../../../share/html').catch(() => null) : Promise.resolve(null),
  ])

  const out: Record<string, Uint8Array> = {}
  const put = (path: string, data: string | Uint8Array) => {
    out[path] = typeof data === 'string' ? strToU8(data) : data
  }
  const total = plan.media.length + plan.order.length + 4
  let done = 0
  const step = () => opts.onProgress?.(++done, total)

  /* ---------- media ---------- */
  const media = new Map<string, string>()
  const usedNames = new Set<string>()
  for (const src of plan.media) {
    if (src.startsWith('onefile:')) {
      const f = await getFile(src).catch(() => undefined)
      if (f) {
        let name = mediaName(f.name || 'file', f.blob.type || f.type)
        if (usedNames.has(name)) name = name.replace(/(\.[a-z0-9]+)$/, `-${src.slice(8, 14)}$1`)
        for (let n = 2; usedNames.has(name); n++) name = name.replace(/(-\d+)?(\.[a-z0-9]+)$/, `-${n}$2`)
        usedNames.add(name)
        const path = `media/${name}`
        if (name.endsWith('.svg')) {
          const svg = safeSvg(purify, await f.blob.text())
          if (svg) {
            put(path, svg)
            media.set(src, path)
          }
        } else {
          put(path, new Uint8Array(await f.blob.arrayBuffer()))
          media.set(src, path)
        }
      }
    } else if (isAssetPath(src)) {
      const bytes = await fetchBytes(resolveAssetUrl(src))
      if (bytes) {
        const path = `media/${src.slice('assets/'.length)}`
        put(path, bytes)
        media.set(src, path)
      }
    }
    step()
  }

  const ctx: RenderCtx = {
    plan,
    tree,
    media,
    blockTargets: blockTargets(plan),
    lang: meta.lang,
    untitled: t('common.untitled'),
    toText: propertyValueToText,
    docToHTML,
    docToMarkdown,
    stripButtonActions,
    purify,
    katex,
    mermaid: share ? (html, prefix) => share.renderMermaid(html, prefix) : null,
    viewRows: rowsOfView,
    labels: { rows: (n) => countOf(t, 'row', n), yes: t('features.site.gen.yes'), no: t('features.site.gen.no'), private: t('features.site.gen.private') },
  }

  /* ---------- pages ---------- */
  const mds: Array<{ node: (typeof plan.order)[number]; md: string }> = []
  let seq = 0
  for (const node of plan.order) {
    const p = node.page
    const body = await contentHTML(ctx, node, `s${++seq}`)
    const rowDb = p.databaseId ? tree.databases[p.databaseId] : undefined
    const props = rowDb ? propsList(ctx, p, (d) => valueHTML(ctx, node.file, rowDb, d, p)) : ''
    const table = p.kind === 'database' && tree.databases[p.id] ? dbTableHTML(ctx, node.file, p.id) : ''
    put(node.file, pageDocument(ctx, meta, node, body, { props, table }))
    const md = pageMarkdown(ctx, node)
    put(node.md, md)
    mds.push({ node, md })
    step()
    if (seq % 12 === 0) await tick()
  }

  /* ---------- home, feeds, metadata ---------- */
  const summary = plan.home ? excerptOf(plan.home.page, 200) || t('features.site.gen.summary', { title: meta.title }) : t('features.site.gen.summary', { title: meta.title })
  const recent = feedItems(plan, ctx, { kind: 'recent' }, 8)
  if (!plan.home) {
    put('index.html', homeDocument(ctx, meta, { lede: t('features.site.gen.lede'), recent }))
    const top = plan.top.map((id) => plan.nodes.get(id)!).map((n) => `- [${(n.page.title.trim() || ctx.untitled).replace(/[[\]]/g, '\\$&')}](${n.md})`)
    put('index.md', `# ${meta.title}\n\n${top.join('\n')}\n`)
  }
  step()
  put('assets/site.css', siteCss())
  put('assets/favicon.svg', logoMarkSvg(32))
  for (const f of SITE_FONTS) {
    const bytes = await fetchBytes(f.url)
    if (bytes) put(f.path, bytes)
  }
  put('404.html', notFoundDocument(ctx, meta))
  step()
  if (meta.baseUrl) put('sitemap.xml', sitemapXml(plan, meta))
  put('robots.txt', robotsTxt(meta))
  // RSS needs absolute links: without a base URL there is no feed (and no link to one)
  if (meta.baseUrl) {
    const feed = opts.feed.kind === 'database' && plan.rows.has(opts.feed.databaseId) ? opts.feed : ({ kind: 'recent' } as const)
    put('rss.xml', rssXml(plan, ctx, meta, feedItems(plan, ctx, feed), summary, feed))
  }
  put('llms.txt', llmsTxt(plan, ctx, meta, summary))
  put('llms-full.txt', llmsFullTxt(meta, summary, mds))
  put('content.json', contentJson(plan, ctx, meta))
  step()

  /* ---------- zip (off the main thread; packed formats stored as they are) ---------- */
  // fixed timestamps keep the archive byte-identical for identical content (DOS dates start in 1980)
  const mtime = new Date(Math.max(plan.updatedAt, Date.UTC(1980, 0, 2)))
  const entries: AsyncZippable = {}
  for (const [path, data] of Object.entries(out)) entries[path] = [data, { level: STORED.test(path) ? 0 : 6, mtime }]
  const zipped = await new Promise<Uint8Array>((resolve, reject) => zip(entries, { level: 6, mtime }, (err, data) => (err ? reject(err) : resolve(data))))
  step()
  return { blob: new Blob([zipped as BlobPart], { type: 'application/zip' }), pages: plan.order.length + (plan.home ? 0 : 1), files: Object.keys(out).length }
}
