/**
 * Website export — the HTML documents: page shell (head, top bar, navigation tree,
 * breadcrumbs, footer), the generated index page and 404.html. No scripts anywhere.
 */
import type { JSONContent } from '@tiptap/core'
import type { ID, Page, PropertyDef } from '../../../../store/types'
import { COLOR_NAMES } from '../../../../store/types'
import { t } from '../../../../i18n'
import { countOf, unitOf } from '../../count'
import { ancestorsOf, rel, type SiteNode } from './plan'
import { esc, excerptOf, fmtDate, iconHTML, mediaHref, titleOf, wordCount, type RenderCtx } from './render'

export interface SiteMeta {
  title: string
  /** normalised "https://host/path/" or '' */
  baseUrl: string
  lang: 'en' | 'de'
}

/** Absolute URL of a site path (pretty: "a/b/index.html" → "https://base/a/b/"), or '' without a base URL. */
export function absUrl(meta: SiteMeta, path: string): string {
  return meta.baseUrl ? `${meta.baseUrl}${path.replace(/(^|\/)index\.html$/, '$1')}` : ''
}

interface HeadOpts {
  title: string
  description: string
  path: string
  /** canonical path (defaults to path) */
  type?: 'website' | 'article'
  image?: string
  md?: string
}

function head(ctx: RenderCtx, meta: SiteMeta, o: HeadOpts): string {
  const up = (to: string) => rel(o.path, to)
  const url = absUrl(meta, o.path)
  const image = o.image && meta.baseUrl && !/^(https?:|data:)/.test(o.image) ? `${meta.baseUrl}${o.image}` : o.image && /^https?:/.test(o.image) ? o.image : ''
  return `<!doctype html>
<html lang="${meta.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<meta name="generator" content="SimpleCMS One">
<meta name="color-scheme" content="light dark">
${url ? `<link rel="canonical" href="${esc(url)}">\n` : ''}<meta property="og:type" content="${o.type ?? 'article'}">
<meta property="og:site_name" content="${esc(meta.title)}">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
${url ? `<meta property="og:url" content="${esc(url)}">\n` : ''}${image ? `<meta property="og:image" content="${esc(image)}">\n` : ''}<link rel="icon" href="${up('assets/favicon.svg')}" type="image/svg+xml">
<link rel="stylesheet" href="${up('assets/site.css')}">
${meta.baseUrl ? `<link rel="alternate" type="application/rss+xml" title="${esc(meta.title)}" href="${up('rss.xml')}">\n` : ''}${o.md ?`<link rel="alternate" type="text/markdown" href="${up(o.md)}">\n` : ''}</head>`
}

function bar(ctx: RenderCtx, meta: SiteMeta, from: string, spec: string, md: string | null, menu = true): string {
  const up = (to: string) => rel(from, to)
  return `<a class="skip" href="#main">${esc(t('features.site.gen.skip'))}</a>
<header class="bar">
<a class="bar__brand" href="${up('index.html')}"><span class="bar__mark" aria-hidden="true"></span><span class="bar__title">${esc(meta.title)}</span></a>
${spec ? `<span class="bar__spec label">${esc(spec)}</span>` : ''}
<span class="bar__sp"></span>
<nav class="bar__links" aria-label="${esc(t('features.site.gen.formats'))}">${md ? `<a href="${up(md)}">${esc(t('features.site.gen.markdown'))}</a>` : ''}${meta.baseUrl ? `<a href="${up('rss.xml')}">RSS</a>` : ''}<a href="${up('llms.txt')}">llms.txt</a></nav>
${menu ? `<a class="bar__menu" href="#nav">${esc(t('features.site.gen.contents'))} ↓</a>` : ''}
</header>`
}

/** Navigation tree: top level always, the branch of the current page unfolded. */
function navTree(ctx: RenderCtx, meta: SiteMeta, from: string, currentId: ID | null): string {
  const { plan } = ctx
  const open = new Set<ID>()
  if (currentId) {
    open.add(currentId)
    for (const a of ancestorsOf(plan, currentId)) open.add(a.page.id)
  }
  const item = (id: ID): string => {
    const n = plan.nodes.get(id)
    if (!n) return ''
    const current = id === currentId
    const kids = plan.kids.get(id) ?? []
    const icon = iconHTML(ctx, from, n.page, 15)
    const isOpen = open.has(id) && !current
    return `<li><a class="nav__link${isOpen ? ' is-open' : ''}" href="${esc(rel(from, n.file))}"${current ? ' aria-current="page"' : ''}><span class="nav__num">${esc(n.num)}</span><span class="nav__icon">${icon}</span><span class="nav__title">${esc(titleOf(ctx, n.page))}</span>${n.kind === 'database' ? '<span class="nav__tag">DB</span>' : ''}</a>${open.has(id) && kids.length ? `<ol>${kids.map(item).join('')}</ol>` : ''}</li>`
  }
  const homeCurrent = currentId === null || plan.home?.page.id === currentId
  const homeTitle = plan.home ? titleOf(ctx, plan.home.page) : t('features.site.gen.index')
  const homeIcon = plan.home ? iconHTML(ctx, from, plan.home.page, 15) : ''
  const count = plan.order.filter((n) => n.kind !== 'row').length
  return `<nav id="nav" class="nav" aria-label="${esc(t('features.site.gen.contents'))}">
<div class="nav__head label"><span>${esc(t('features.site.gen.contents'))}</span><span>${String(count).padStart(2, '0')}</span></div>
<ol><li><a class="nav__link" href="${esc(rel(from, 'index.html'))}"${homeCurrent ? ' aria-current="page"' : ''}><span class="nav__num">00</span><span class="nav__icon">${homeIcon}</span><span class="nav__title">${esc(homeTitle)}</span></a></li>${plan.top.map(item).join('')}</ol>
</nav>`
}

function crumbs(ctx: RenderCtx, meta: SiteMeta, node: SiteNode): string {
  if (node.kind === 'home') return ''
  const from = node.file
  const home = ctx.plan.home ? titleOf(ctx, ctx.plan.home.page) : meta.title
  const items = [`<li><a href="${esc(rel(from, 'index.html'))}">${esc(home)}</a></li>`]
  for (const a of ancestorsOf(ctx.plan, node.page.id)) items.push(`<li><a href="${esc(rel(from, a.file))}">${esc(titleOf(ctx, a.page))}</a></li>`)
  items.push(`<li aria-current="page">${esc(titleOf(ctx, node.page))}</li>`)
  return `<nav class="crumbs" aria-label="${esc(t('features.site.gen.breadcrumb'))}"><ol>${items.join('')}</ol></nav>`
}

/** Cover of a page: copied image, content colour or a gradient (validated). */
function cover(ctx: RenderCtx, from: string, p: Page): { html: string; image: string } {
  const c = p.cover
  if (!c) return { html: '', image: '' }
  const y = Number.isFinite(Number(c.positionY)) ? Math.min(100, Math.max(0, Number(c.positionY))) : 50
  if (c.type === 'image') {
    const src = mediaHref(ctx, from, c.value)
    if (!src) return { html: '', image: '' }
    return { html: `<div class="cover"><img src="${esc(src)}" alt="" style="object-position:center ${y}%"></div>`, image: ctx.media.get(c.value) ?? src }
  }
  if (c.type === 'color') {
    const color = COLOR_NAMES.includes(c.value) ? c.value : 'gray'
    return { html: `<div class="cover" style="background:var(--c-${color}-bg)"></div>`, image: '' }
  }
  const g = String(c.value ?? '')
  const safe = /^[\w\s#%(),./+-]+$/.test(g) && /gradient\(/i.test(g) && !/url\s*\(|expression/i.test(g)
  return { html: safe ? `<div class="cover" style="${esc(`background:${g}`)}"></div>` : '', image: '' }
}

function footer(ctx: RenderCtx, meta: SiteMeta, from: string, updatedAt: number, md: string | null): string {
  const up = (to: string) => rel(from, to)
  return `<footer class="foot label">
<span>${esc(meta.title)} · ${esc(t('features.site.gen.updated', { date: fmtDate(updatedAt, meta.lang) }))}</span>
<nav aria-label="${esc(t('features.site.gen.formats'))}">${md ? `<a href="${up(md)}">${esc(t('features.site.gen.markdown'))}</a>` : ''}${meta.baseUrl ? `<a href="${up('rss.xml')}">RSS</a>` : ''}<a href="${up('llms.txt')}">llms.txt</a></nav>
<span>${esc(t('features.site.gen.publishedWith'))}</span>
</footer>`
}

/** Section spec for the bar / meta line: "§ 2.1", rows "§ 2 · 04". */
function specOf(node: SiteNode): string {
  if (node.kind === 'home') return '§ 00'
  if (node.kind === 'row') return `${node.num ? `§ ${node.num} · ` : ''}${String(node.index).padStart(2, '0')}`
  return `§ ${node.num}`
}

/**
 * Page ids the content itself links in the published page: page-link blocks, page mentions and
 * #/p/<id> links. Button actions ("open page") are not links of a static page and don't count.
 */
function linkedIds(doc: JSONContent | null): Set<ID> {
  const out = new Set<ID>()
  const walk = (n: JSONContent) => {
    if (n.type === 'button') return
    const a = n.attrs
    if (n.type === 'pageLink' && typeof a?.pageId === 'string') out.add(a.pageId)
    if (n.type === 'mention' && a?.kind === 'page' && typeof a.id === 'string') out.add(a.id)
    for (const m of n.marks ?? []) {
      const id = m.type === 'link' ? /^#\/p\/([\w-]+)/.exec(String(m.attrs?.href ?? ''))?.[1] : undefined
      if (id) out.add(id)
    }
    n.content?.forEach(walk)
  }
  if (doc) walk(doc)
  return out
}

/** Sub pages that the content does not already link (page block, mention or link). */
function subpages(ctx: RenderCtx, node: SiteNode, body: string): string {
  const kids = (ctx.plan.kids.get(node.page.id) ?? []).map((id) => ctx.plan.nodes.get(id)!).filter(Boolean)
  const linked = linkedIds(node.page.content)
  const list = kids.filter((k) => !linked.has(k.page.id) && !body.includes(`"${rel(node.file, k.file)}"`))
  if (!list.length) return ''
  const from = node.file
  return `<section class="sub" aria-labelledby="sub-head"><div class="sub__head label" id="sub-head">${esc(t('features.site.gen.subpages'))}</div><ol>${list
    .map((k) => {
      const icon = iconHTML(ctx, from, k.page, 16)
      const ex = excerptOf(k.page, 140)
      return `<li><a href="${esc(rel(from, k.file))}"><span class="sub__num">${esc(k.num)}</span><span class="sub__title">${icon ? `${icon} ` : ''}${esc(titleOf(ctx, k.page))}${k.kind === 'database' ? ' <span class="nav__tag">DB</span>' : ''}</span>${ex ? `<span class="sub__excerpt">${esc(ex)}</span>` : ''}</a></li>`
    })
    .join('')}</ol></section>`
}

/** A complete page document. */
export function pageDocument(ctx: RenderCtx, meta: SiteMeta, node: SiteNode, body: string, extras: { props: string; table: string }): string {
  const p = node.page
  const from = node.file
  const title = titleOf(ctx, p)
  const c = cover(ctx, from, p)
  const icon = iconHTML(ctx, from, p, 60)
  const words = wordCount(p)
  const spec = specOf(node)
  const metaLine = [
    `<b>${esc(spec)}</b>`,
    `<span>${esc(t('features.site.gen.updated', { date: fmtDate(p.updatedAt, meta.lang) }))}</span>`,
    words ? `<span>${esc(t('features.site.gen.words', { n: new Intl.NumberFormat(meta.lang === 'de' ? 'de-DE' : 'en-US').format(words) }))}</span>` : '',
    `<a href="${esc(rel(from, node.md))}">${esc(t('features.site.gen.markdown'))} ↗</a>`,
  ]
    .filter(Boolean)
    .join('')
  const description = excerptOf(p, 160) || `${title} — ${meta.title}`
  const docTitle = node.kind === 'home' ? (title === meta.title ? meta.title : `${title} — ${meta.title}`) : `${title} — ${meta.title}`
  return `${head(ctx, meta, { title: docTitle, description, path: from, image: c.image, md: node.md, type: node.kind === 'home' ? 'website' : 'article' })}
<body${c.html ? ' class="has-cover"' : ''}>
${bar(ctx, meta, from, node.kind === 'home' ? '' : `${spec} — ${title}`, node.md)}
<div class="layout">
${navTree(ctx, meta, from, p.id)}
<main id="main" class="main">
${c.html}
<article class="sheet${extras.table ? ' sheet--wide' : ''}">
${icon ? `<div class="page-icon">${icon}</div>` : ''}
${crumbs(ctx, meta, node)}
<h1 class="title">${esc(title)}</h1>
<div class="meta label">${metaLine}</div>
${extras.props}
${body ? `<div class="doc">${body}</div>` : ''}
${extras.table}
${subpages(ctx, node, body)}
</article>
${footer(ctx, meta, from, p.updatedAt, node.md)}
</main>
</div>
</body>
</html>
`
}

/** Row properties as a definition list. */
export function propsList(ctx: RenderCtx, row: Page, valueHTML: (prop: PropertyDef) => string): string {
  const db = row.databaseId ? ctx.tree.databases[row.databaseId] : undefined
  if (!db) return ''
  const items = db.properties
    .filter((d) => d.type !== 'title')
    .map((d) => [d, valueHTML(d)] as const)
    .filter(([, v]) => v.trim())
  if (!items.length) return ''
  return `<dl class="props">${items.map(([d, v]) => `<dt class="label">${esc(d.name)}</dt><dd>${v}</dd>`).join('')}</dl>`
}

/** Generated index page (whole-workspace sites): top-level pages as cards + recently updated. */
export function homeDocument(ctx: RenderCtx, meta: SiteMeta, opts: { lede: string; recent: SiteNode[] }): string {
  const { plan } = ctx
  const from = 'index.html'
  let pages = 0
  let dbs = 0
  let rows = 0
  for (const n of plan.order) {
    if (n.kind === 'database') dbs++
    else if (n.kind === 'row') rows++
    else pages++
  }
  const stat = (n: number, noun: 'page' | 'db' | 'row') => `<span><b>${n}</b> ${esc(unitOf(t, noun, n))}</span>`
  const cards = plan.top
    .map((id) => plan.nodes.get(id)!)
    .map((n) => {
      const c = n.page.cover
      const img = c?.type === 'image' ? mediaHref(ctx, from, c.value) : null
      const band =
        c?.type === 'color' && COLOR_NAMES.includes(c.value)
          ? `<span class="card__cover" style="background:var(--c-${c.value}-bg)"></span>`
          : img
            ? `<span class="card__cover"><img src="${esc(img)}" alt="" loading="lazy" style="object-position:center ${Math.min(100, Math.max(0, Number(c?.positionY) || 50))}%"></span>`
            : ''
      const icon = iconHTML(ctx, from, n.page, 18)
      const kidCount = (plan.kids.get(n.page.id) ?? []).length
      const rowCount = (plan.rows.get(n.page.id) ?? []).length
      const metaBits = [n.kind === 'database' ? countOf(t, 'row', rowCount) : '', kidCount ? countOf(t, 'subpage', kidCount) : '', fmtDate(n.page.updatedAt, meta.lang)].filter(Boolean)
      const ex = excerptOf(n.page, 150)
      // a database without text of its own previews its first rows
      const preview = !ex && n.kind === 'database' ? (plan.rows.get(n.page.id) ?? []).slice(0, 3).map((id) => `<span>${esc(titleOf(ctx, plan.nodes.get(id)?.page))}</span>`) : []
      const body = ex ? `<span class="card__excerpt">${esc(ex)}</span>` : preview.length ? `<span class="card__rows">${preview.join('')}</span>` : ''
      return `<li><a class="card" href="${esc(rel(from, n.file))}">${band}<span class="card__body"><span class="card__top"><span class="label">§ ${esc(n.num.padStart(2, '0'))}</span><span class="label">${n.kind === 'database' ? 'DB' : '→'}</span></span><span class="card__title">${icon ? `<span>${icon}</span>` : ''}<span>${esc(titleOf(ctx, n.page))}</span></span>${body}<span class="card__meta label">${esc(metaBits.join(' · '))}</span></span></a></li>`
    })
    .join('')
  const recent = opts.recent.length
    ? `<section class="recent" aria-labelledby="recent-head"><div class="recent__head label" id="recent-head">${esc(t('features.site.gen.recent'))}</div><ol>${opts.recent
        .map((n) => {
          const section = ancestorsOf(plan, n.page.id)[0]
          return `<li><a href="${esc(rel(from, n.file))}"><span class="recent__date label">${esc(fmtDate(n.page.updatedAt, meta.lang))}</span><span class="recent__title">${esc(titleOf(ctx, n.page))}</span><span class="label">${section ? esc(titleOf(ctx, section.page)) : ''}</span></a></li>`
        })
        .join('')}</ol></section>`
    : ''
  return `${head(ctx, meta, { title: meta.title, description: opts.lede, path: from, type: 'website', md: 'index.md' })}
<body class="home">
${bar(ctx, meta, from, '', 'index.md')}
<div class="layout">
${navTree(ctx, meta, from, null)}
<main id="main" class="main">
<section class="hero">
<div class="label">§ 00 — ${esc(t('features.site.gen.index'))}</div>
<h1 class="hero__title">${esc(meta.title)}</h1>
${opts.lede ? `<p class="hero__lede">${esc(opts.lede)}</p>` : ''}
<div class="hero__stats label">${stat(pages, 'page')}${dbs ? stat(dbs, 'db') : ''}${rows ? stat(rows, 'row') : ''}<span>${esc(t('features.site.gen.updated', { date: fmtDate(plan.updatedAt, meta.lang) }))}</span></div>
<div class="ruler" aria-hidden="true"></div>
</section>
<ol class="cards">${cards}</ol>
${recent}
${footer(ctx, meta, from, plan.updatedAt, 'index.md')}
</main>
</div>
</body>
</html>
`
}

/** 404.html — served for any missing path, so links resolve against the base URL when there is one. */
export function notFoundDocument(ctx: RenderCtx, meta: SiteMeta): string {
  const from = '404.html'
  const doc = head(ctx, meta, { title: `404 — ${meta.title}`, description: t('features.site.gen.lostText'), path: from, type: 'website' })
  const withBase = meta.baseUrl ? doc.replace('<head>\n', `<head>\n<base href="${esc(meta.baseUrl)}">\n`) : doc
  return `${withBase.replace(/<link rel="canonical"[^>]*>\n/, '').replace(/<meta property="og:url"[^>]*>\n/, '')}
<body>
${bar(ctx, meta, from, '', null, false)}
<main id="main" class="main">
<section class="lost">
<div class="label lost__code">ERR 404 · ${esc(t('features.site.gen.lostCode'))}</div>
<h1>${esc(t('features.site.gen.lostTitle'))}</h1>
<p>${esc(t('features.site.gen.lostText'))}</p>
<a class="btn" href="index.html">${esc(t('features.site.gen.backHome'))} →</a>
</section>
</main>
</body>
</html>
`
}

