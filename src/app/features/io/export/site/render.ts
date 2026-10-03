/**
 * Website export — rendering of one page's body: TipTap HTML post-processed for a static site
 * (relative links, copied media, MathML, static diagrams, read-only databases) and sanitised
 * with DOMPurify; plus formatted property values and the Markdown twin of every page.
 */
import type { JSONContent } from '@tiptap/core'
import type DOMPurifyType from 'dompurify'
import type { Database, DateValue, ID, Page, PropertyDef, SelectOption } from '../../../../store/types'
import type { ExportTree } from '../collect'
import { exportValue } from '../markdown'
import { asciiSlug, rel, type SiteNode, type SitePlan } from './plan'

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

type ToText = (db: Database, prop: PropertyDef, row: Page) => string

interface KatexLike {
  renderToString: (tex: string, options?: Record<string, unknown>) => string
}

export interface RenderCtx {
  plan: SitePlan
  tree: ExportTree
  /** media source (onefile ref / asset path) → site path ("media/…") */
  media: Map<string, string>
  /** block ids some link points at ("#/p/<id>?b=<block>") */
  blockTargets: Set<string>
  lang: 'en' | 'de'
  untitled: string
  toText: ToText
  docToHTML: (doc: JSONContent | null) => string
  docToMarkdown: (doc: JSONContent | null) => string
  purify: typeof DOMPurifyType
  katex: KatexLike | null
  mermaid: ((html: string, idPrefix: string) => Promise<string>) | null
  labels: { rows: (n: number) => string; yes: string; no: string }
}

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

export const titleOf = (ctx: RenderCtx, p: Page | undefined) => (p?.title ?? '').replace(/\s+/g, ' ').trim() || ctx.untitled

/** Link to a page of the site from file `from`, or null when the page is not part of it. */
export function pageHref(ctx: RenderCtx, from: string, id: ID): string | null {
  const n = ctx.plan.nodes.get(id)
  return n ? rel(from, n.file) : null
}

const RASTER_DATA = /^data:image\/(png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/=]+$/i

/** Displayable URL of an image / file source in the site (copied media, web URLs), or null. */
export function mediaHref(ctx: RenderCtx, from: string, src: string): string | null {
  const s = src.trim()
  const local = ctx.media.get(s)
  if (local) return rel(from, local)
  if (/^https?:\/\/[^\s"'<>]+$/i.test(s)) return s
  if (RASTER_DATA.test(s)) return s
  return null
}

/** Page icon (emoji or generated icon) — lucide icons have no static form and are left out. */
export function iconHTML(ctx: RenderCtx, from: string, p: Page | undefined, size = 0): string {
  const i = p?.icon
  if (!i) return ''
  if (i.type === 'emoji') return esc(i.value)
  if (i.type === 'asset') {
    const src = mediaHref(ctx, from, `assets/icons/${i.value}.webp`)
    return src ? `<img src="${esc(src)}" alt=""${size ? ` width="${size}" height="${size}"` : ''}>` : ''
  }
  return ''
}

/** Plain-text excerpt of a page (search cache, else derived from the content). */
export function excerptOf(p: Page, max = 160): string {
  const plain = (p.plain ?? textOf(p.content)).replace(/\s+/g, ' ').trim()
  if (plain.length <= max) return plain
  const cut = plain.slice(0, max)
  const at = cut.lastIndexOf(' ')
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,.;:–—-]+$/, '')}…`
}

function textOf(n: JSONContent | null | undefined): string {
  if (!n) return ''
  if (typeof n.text === 'string') return n.text
  return (n.content ?? []).map(textOf).join(n.type === 'paragraph' || n.type === 'heading' ? '' : ' ')
}

export function wordCount(p: Page): number {
  return (p.plain ?? textOf(p.content)).split(/\s+/).filter(Boolean).length
}

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function fmt(lang: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${lang}|${JSON.stringify(opts)}`
  let f = fmtCache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', opts)
    fmtCache.set(key, f)
  }
  return f
}

/** "3 Oct 2026" */
export function fmtDate(ms: number, lang: string): string {
  return fmt(lang, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ms))
}

/** An ISO date / datetime of a date property as an absolute date (a static site has no "today"). */
function fmtIso(iso: string, lang: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?/.exec(iso)
  if (!m) return iso
  const day = fmtDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime(), lang)
  return m[4] ? `${day} ${m[4]}` : day
}

/* ------------------------------------------------------------------ */
/* property values                                                     */
/* ------------------------------------------------------------------ */

const chip = (o: SelectOption) => `<span class="chip chip--${/^[a-z]{1,16}$/.test(o.color) ? o.color : 'gray'}">${esc(o.name)}</span>`

const SAFE_WEB = /^https?:\/\/[^\s"'<>]+$/i

/** Formatted value of a property as HTML (links relative to `from`). Empty values give ''. */
export function valueHTML(ctx: RenderCtx, from: string, db: Database, prop: PropertyDef, row: Page): string {
  const v = row.properties[prop.id]
  switch (prop.type) {
    case 'title': {
      const href = pageHref(ctx, from, row.id)
      const icon = iconHTML(ctx, from, row, 15)
      const label = `${icon ? `<span class="nav__icon">${icon}</span> ` : ''}${esc(titleOf(ctx, row))}`
      return href ? `<a href="${esc(href)}">${label}</a>` : label
    }
    case 'select':
    case 'status': {
      const o = prop.options?.find((x) => x.id === v)
      return o ? chip(o) : ''
    }
    case 'multi_select': {
      if (!Array.isArray(v)) return ''
      return v
        .map((id) => prop.options?.find((x) => x.id === id))
        .filter((o): o is SelectOption => !!o)
        .map(chip)
        .join('')
    }
    case 'checkbox':
      return v === true ? `<span class="check" data-on title="${esc(ctx.labels.yes)}">✓</span>` : `<span class="check" title="${esc(ctx.labels.no)}">–</span>`
    case 'url': {
      const s = typeof v === 'string' ? v.trim() : ''
      if (!s) return ''
      return SAFE_WEB.test(s) ? `<a href="${esc(s)}" rel="nofollow noopener">${esc(s.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, ''))}</a>` : esc(s)
    }
    case 'email': {
      const s = typeof v === 'string' ? v.trim() : ''
      return s ? (/^[^\s@<>"]+@[^\s@<>"]+$/.test(s) ? `<a href="mailto:${esc(s)}">${esc(s)}</a>` : esc(s)) : ''
    }
    case 'phone': {
      const s = typeof v === 'string' ? v.trim() : ''
      return s ? (/^[+\d][\d\s()./-]{2,}$/.test(s) ? `<a href="tel:${esc(s.replace(/[^\d+]/g, ''))}">${esc(s)}</a>` : esc(s)) : ''
    }
    case 'relation': {
      if (!Array.isArray(v)) return ''
      return v
        .map((id) => {
          const p = ctx.tree.pages[id]
          if (!p || p.trashed) return ''
          const href = pageHref(ctx, from, id)
          return href ? `<a href="${esc(href)}">${esc(titleOf(ctx, p))}</a>` : esc(titleOf(ctx, p))
        })
        .filter(Boolean)
        .join(', ')
    }
    case 'files': {
      if (!Array.isArray(v)) return ''
      return v
        .map((ref) => {
          if (typeof ref !== 'string') return ''
          const href = mediaHref(ctx, from, ref)
          if (!href) return ''
          const name = ref.startsWith('onefile:') ? (ctx.media.get(ref) ?? '').split('/').pop() : ref.replace(/^https?:\/\/(www\.)?/i, '')
          return `<a href="${esc(href)}">${esc(name)}</a>`
        })
        .filter(Boolean)
        .join(', ')
    }
    case 'date': {
      const d = v as DateValue | null | undefined
      if (!d?.start) return ''
      return esc(d.end ? `${fmtIso(d.start, ctx.lang)} → ${fmtIso(d.end, ctx.lang)}` : fmtIso(d.start, ctx.lang))
    }
    case 'created_time':
      return esc(fmtDate(row.createdAt, ctx.lang))
    case 'last_edited_time':
      return esc(fmtDate(row.updatedAt, ctx.lang))
    case 'rating': {
      const max = Math.max(1, Math.min(10, prop.ratingMax ?? 5))
      const n = Math.max(0, Math.min(max, Math.round(Number(v) || 0)))
      return n ? `<span class="stars" title="${n}/${max}">${'★'.repeat(n)}${'☆'.repeat(max - n)}</span>` : ''
    }
    default: {
      let s = ''
      try {
        s = ctx.toText(db, prop, row)
      } catch {
        s = ''
      }
      return esc(s)
    }
  }
}

/** Plain value for Markdown / JSON (dates as ISO, relations as "Title (path)"). */
export function valueText(ctx: RenderCtx, from: string | null, db: Database, prop: PropertyDef, row: Page): string {
  const relation = (id: ID) => {
    const p = ctx.tree.pages[id]
    if (!p || p.trashed) return null
    const n = ctx.plan.nodes.get(id)
    return n && from !== null ? `${titleOf(ctx, p)} (${rel(from, n.md)})` : titleOf(ctx, p)
  }
  const file = (ref: string) => {
    if (!ref.startsWith('onefile:')) return SAFE_WEB.test(ref) ? ref : null
    const path = ctx.media.get(ref)
    return path ? (from !== null ? rel(from, path) : path) : null
  }
  try {
    return exportValue(db, prop, row, ctx.toText, relation, file)
  } catch {
    return ''
  }
}

/** Read-only table of a database: every row, every property, the title linking to the row page. */
export function dbTableHTML(ctx: RenderCtx, from: string, dbId: ID, opts: { heading?: boolean } = {}): string {
  const db = ctx.tree.databases[dbId]
  const dbPage = ctx.tree.pages[dbId]
  if (!db || !dbPage) return ''
  const rows = ctx.tree.rows(dbId)
  const props = [...db.properties.filter((p) => p.type === 'title'), ...db.properties.filter((p) => p.type !== 'title')]
  const head = props.map((p) => `<th scope="col">${esc(p.name)}</th>`).join('')
  const body = rows
    .map((r) => `<tr>${props.map((p) => `<td${p.type === 'number' || p.type === 'unique_id' || p.type === 'formula' ? ' class="num"' : ''}>${valueHTML(ctx, from, db, p, r)}</td>`).join('')}</tr>`)
    .join('')
  let top = ''
  if (opts.heading) {
    const href = pageHref(ctx, from, dbId)
    const icon = iconHTML(ctx, from, dbPage, 16)
    const name = `${icon ? `${icon} ` : ''}${esc(titleOf(ctx, dbPage))}`
    top = `<div class="dbx__head"><span class="dbx__title">${href ? `<a href="${esc(href)}">${name}</a>` : name}</span><span class="label">${esc(ctx.labels.rows(rows.length))}</span></div>`
  } else top = `<div class="dbx__head"><span></span><span class="label">${esc(ctx.labels.rows(rows.length))}</span></div>`
  return `<section class="dbx">${top}<div class="dbt-wrap"><table class="dbt"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></section>`
}

/* ------------------------------------------------------------------ */
/* page content                                                        */
/* ------------------------------------------------------------------ */

const PURIFY_CONFIG = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
  // Mermaid draws its labels as HTML inside <foreignObject>
  ADD_TAGS: ['foreignObject'],
  HTML_INTEGRATION_POINTS: { foreignobject: true, 'annotation-xml': true },
  ADD_ATTR: ['target'],
  FORBID_TAGS: ['form', 'button', 'textarea', 'select', 'option', 'iframe', 'frame', 'object', 'embed', 'base', 'link', 'meta', 'script'],
  FORBID_ATTR: ['contenteditable', 'srcdoc', 'formaction'],
}

/** Replace an element by its children (a link that leads nowhere in the site becomes text). */
function unwrap(el: Element, cls?: string) {
  const span = el.ownerDocument.createElement('span')
  if (cls) span.className = cls
  while (el.firstChild) span.appendChild(el.firstChild)
  el.replaceWith(span)
}

function renameTag(el: Element, tag: string): Element {
  const next = el.ownerDocument.createElement(tag)
  for (const a of Array.from(el.attributes)) next.setAttribute(a.name, a.value)
  while (el.firstChild) next.appendChild(el.firstChild)
  el.replaceWith(next)
  return next
}

const RESERVED_IDS = new Set(['nav', 'main', 'top', 'content'])

/** The page's content as sanitised HTML for the file `node.file`. */
export async function contentHTML(ctx: RenderCtx, node: SiteNode, idPrefix: string): Promise<string> {
  const p = node.page
  if (!p.content) return ''
  const from = node.file
  const html = ctx.docToHTML(p.content)
  if (!html) return ''
  const dom = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
  const root = dom.getElementById('root')!

  // block anchors ("#/p/<id>?b=<block>"), other block ids are noise in a static page
  root.querySelectorAll('[data-id]').forEach((el) => {
    const id = el.getAttribute('data-id') ?? ''
    el.removeAttribute('data-id')
    if (el.getAttribute('data-type') !== 'mention' && ctx.blockTargets.has(id) && /^[\w-]{1,64}$/.test(id)) el.setAttribute('id', `b-${id}`)
  })

  // page link blocks: icon + title of the target, or plain text when it is not part of the site
  root.querySelectorAll('div.page-link').forEach((div) => {
    const id = div.getAttribute('data-page-id') ?? ''
    div.removeAttribute('data-page-id')
    const target = ctx.tree.pages[id]
    const title = target && !target.trashed ? titleOf(ctx, target) : (div.textContent ?? '').trim() || ctx.untitled
    const href = pageHref(ctx, from, id)
    const icon = target ? iconHTML(ctx, from, target, 16) : ''
    const inner = `${icon ? `<span class="nav__icon">${icon}</span>` : ''}<span>${esc(title)}</span>`
    div.innerHTML = href ? `<a href="${esc(href)}">${inner}</a>` : `<span class="page-link__off">${inner}</span>`
  })

  // inline databases: the table itself
  root.querySelectorAll('div.database-block').forEach((div) => {
    const id = div.getAttribute('data-database-id') ?? ''
    const table = dbTableHTML(ctx, from, id, { heading: true })
    if (!table) return div.remove()
    const holder = dom.createElement('div')
    holder.innerHTML = table
    div.replaceWith(...Array.from(holder.childNodes))
  })

  // mentions: plain markup (the link inside is rewritten below)
  root.querySelectorAll('[data-type="mention"]').forEach((el) => {
    el.removeAttribute('data-label')
    el.removeAttribute('data-kind')
  })

  // links
  root.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') ?? ''
    if (href.startsWith('#/p/')) {
      const [id, query = ''] = href.slice(4).split('?')
      const to = pageHref(ctx, from, decodeURIComponent(id))
      const block = new URLSearchParams(query).get('b')
      if (to) a.setAttribute('href', `${to}${block && ctx.blockTargets.has(block) ? `#b-${block}` : ''}`)
      else unwrap(a, 'off')
    } else if (href.startsWith('#/')) unwrap(a, 'off')
    else if (href.startsWith('onefile:')) {
      const to = mediaHref(ctx, from, href)
      if (to) a.setAttribute('href', to)
      else unwrap(a, 'off')
    } else if (/^https?:/i.test(href)) {
      a.setAttribute('rel', 'noopener noreferrer')
    }
  })

  // images: copied media, web images; anything else is dropped
  root.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('data-src') || img.getAttribute('src') || ''
    img.removeAttribute('data-src')
    const url = mediaHref(ctx, from, src)
    if (!url) return (img.closest('figure') ?? img).remove()
    img.setAttribute('src', url)
    img.setAttribute('loading', 'lazy')
    img.setAttribute('decoding', 'async')
  })

  // file blocks: name + size, downloadable from media/
  root.querySelectorAll('div.file-block').forEach((div) => {
    const size = Number(div.getAttribute('data-size')) || 0
    for (const a of ['data-src', 'data-name', 'data-size']) div.removeAttribute(a)
    if (size > 0) {
      const s = dom.createElement('span')
      s.className = 'label'
      s.textContent = size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`
      div.append(' ', s)
    }
  })

  // embeds → link cards (a static page loads nothing from third parties)
  root.querySelectorAll('[data-type="embed"]').forEach((el) => {
    const url = (el.getAttribute('data-url') ?? '').trim()
    if (!SAFE_WEB.test(url)) return el.remove()
    let host = url
    try {
      host = new URL(url).hostname.replace(/^www\./, '')
    } catch {
      /* keep the url */
    }
    const card = dom.createElement('div')
    card.className = 'bookmark'
    card.innerHTML = `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(host)}</a><span class="bookmark__url">${esc(url)}</span>`
    el.replaceWith(card)
  })

  // callouts with a generated icon
  root.querySelectorAll('div.callout').forEach((div) => {
    const icon = div.getAttribute('data-icon') ?? ''
    const m = /^asset:([\w-]{1,64})$/.exec(icon)
    if (m) {
      const src = mediaHref(ctx, from, `assets/icons/${m[1]}.webp`)
      const slot = div.querySelector('.callout__icon')
      if (slot) slot.innerHTML = src ? `<img src="${esc(src)}" alt="">` : '•'
    }
    div.removeAttribute('data-icon')
    div.removeAttribute('data-color')
  })

  // math → MathML (no fonts or scripts needed)
  root.querySelectorAll<HTMLElement>('[data-type="block-math"], [data-type="inline-math"]').forEach((el) => {
    const latex = el.getAttribute('data-latex') ?? ''
    el.removeAttribute('data-latex')
    const block = el.getAttribute('data-type') === 'block-math'
    try {
      el.innerHTML = ctx.katex ? ctx.katex.renderToString(latex, { displayMode: block, output: 'mathml', throwOnError: false, strict: false }) : esc(latex)
    } catch {
      el.textContent = latex
    }
  })

  // task lists are a record, not a form
  root.querySelectorAll('input[type="checkbox"]').forEach((i) => i.setAttribute('disabled', ''))
  root.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'))

  // headings: one level below the page title, with readable anchors
  const used = new Set<string>()
  const heads: Array<{ level: number; id: string; text: string }> = []
  root.querySelectorAll('h1, h2, h3').forEach((h) => {
    const level = Math.min(4, Number(h.tagName[1]) + 1)
    const el = renameTag(h, `h${level}`)
    el.removeAttribute('data-level')
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
    let id = asciiSlug(text, 48) || 'section'
    if (RESERVED_IDS.has(id) || /^b-/.test(id)) id = `${id}-section`
    let n = 2
    const base = id
    while (used.has(id)) id = `${base}-${n++}`
    used.add(id)
    el.setAttribute('id', id)
    heads.push({ level, id, text })
  })
  root.querySelectorAll('nav[data-type="toc"]').forEach((nav) => {
    nav.removeAttribute('data-type')
    nav.innerHTML = heads.map((h) => `<a class="l${h.level}" href="#${esc(h.id)}">${esc(h.text)}</a>`).join('')
  })

  let out = root.innerHTML
  if (ctx.mermaid && root.querySelector('[data-type="mermaid"] pre')) {
    out = await ctx.mermaid(out, idPrefix)
    out = out.replace(/ data-code="[^"]*"/g, '')
  }
  // last line of defence over everything that lands in the page, diagrams included
  return String(ctx.purify.sanitize(out, PURIFY_CONFIG))
}

/* ------------------------------------------------------------------ */
/* Markdown twin                                                       */
/* ------------------------------------------------------------------ */

const MD_LINK = /(!?)\[((?:\\.|[^\]\\])*)\]\(([^)\s]+)(\s+"(?:\\.|[^"\\])*")?\)/g

/** Rewrite workspace links and media references of a Markdown text written to `fromMd`. */
export function rewriteMarkdown(ctx: RenderCtx, md: string, fromMd: string): string {
  return md.replace(MD_LINK, (all, bang: string, label: string, href: string, title: string | undefined) => {
    if (href.startsWith('#/p/')) {
      const id = href.slice(4).split('?')[0]
      const n = ctx.plan.nodes.get(id)
      return n ? `${bang}[${label}](${rel(fromMd, n.md)})` : bang ? label : label
    }
    if (href.startsWith('#/')) return label
    if (href.startsWith('onefile:') || href.startsWith('assets/')) {
      const path = ctx.media.get(href)
      return path ? `${bang}[${label}](${rel(fromMd, path)}${title ?? ''})` : bang ? '' : label
    }
    return all
  })
}

const mdCell = (s: string) => s.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()

/** "# Title" written by the editor's serializer (so "Q&A <draft>" stays text). */
function mdTitle(ctx: RenderCtx, title: string): string {
  const out = ctx.docToMarkdown({ type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] }] }).trim()
  return out || `# ${title}`
}

/** The Markdown twin of a page (index.md next to its index.html). */
export function pageMarkdown(ctx: RenderCtx, node: SiteNode): string {
  const p = node.page
  const from = node.md
  const parts: string[] = [mdTitle(ctx, titleOf(ctx, p))]
  const rowDb = p.databaseId ? ctx.tree.databases[p.databaseId] : undefined
  if (rowDb) {
    const lines: string[] = []
    for (const d of rowDb.properties) {
      if (d.type === 'title') continue
      const v = valueText(ctx, from, rowDb, d, p)
      if (v.trim()) lines.push(`${d.name}: ${v.replace(/\n/g, ' ')}`)
    }
    if (lines.length) parts.push(lines.join('  \n'))
  }
  const body = p.content ? ctx.docToMarkdown(p.content).trim() : ''
  if (body) parts.push(rewriteMarkdown(ctx, body, from))
  const db = ctx.tree.databases[p.id]
  if (p.kind === 'database' && db) {
    const rows = ctx.tree.rows(p.id)
    const props = [...db.properties.filter((d) => d.type === 'title'), ...db.properties.filter((d) => d.type !== 'title' && d.type !== 'files')]
    const head = `| ${props.map((d) => mdCell(d.name)).join(' | ')} |\n| ${props.map(() => '---').join(' | ')} |`
    const body = rows
      .map((r) => {
        const cells = props.map((d) => {
          if (d.type !== 'title') return mdCell(valueText(ctx, null, db, d, r))
          const n = ctx.plan.nodes.get(r.id)
          const t = mdCell(titleOf(ctx, r)).replace(/[[\]]/g, '\\$&')
          return n ? `[${t}](${rel(from, n.md)})` : t
        })
        return `| ${cells.join(' | ')} |`
      })
      .join('\n')
    if (props.length) parts.push(rows.length ? `${head}\n${body}` : head)
  }
  const kids = ctx.plan.kids.get(p.id) ?? []
  if (kids.length) {
    parts.push(
      kids
        .map((id) => ctx.plan.nodes.get(id)!)
        .map((n) => `- [${mdCell(titleOf(ctx, n.page)).replace(/[[\]]/g, '\\$&')}](${rel(from, n.md)})`)
        .join('\n'),
    )
  }
  return parts.join('\n\n').trimEnd() + '\n'
}
