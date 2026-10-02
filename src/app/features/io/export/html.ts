/**
 * Standalone, styled HTML export (one file, images inlined as data URLs, math as MathML,
 * Mermaid as SVG) and PDF via the browser print dialog (same document in a hidden iframe).
 */
import type { JSONContent } from '@tiptap/core'
import type { Database, ID, Page } from '../../../store/types'
import type { propertyValueToText as PropertyValueToText } from '../../../database'
import { getFile, readAsDataUrl, resolveAssetUrl } from '../../../lib/files'
import { collectRefs, type ExportTree } from './collect'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Copy the app's design tokens (light + dark) so the export looks like One without duplicating values. */
function tokenCSS(): string {
  const light: string[] = []
  const dark: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule)) continue
      const sel = rule.selectorText.replace(/\s+/g, '')
      const target = sel === ':root' ? light : sel === ":root[data-theme='dark']" || sel === ':root[data-theme="dark"]' ? dark : null
      if (!target) continue
      for (const prop of Array.from(rule.style)) if (prop.startsWith('--')) target.push(`${prop}:${rule.style.getPropertyValue(prop).trim()}`)
    }
  }
  return `:root{${light.join(';')}}\n@media screen and (prefers-color-scheme: dark){:root{${dark.join(';')}}}`
}

/** @font-face rules of the running app (absolute URLs) — lets the print iframe use the bundled fonts offline. */
function fontFaceCSS(): string {
  const out: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    const base = sheet.href ?? window.location.href
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue
      if (!/Archivo|JetBrains/i.test(rule.style.getPropertyValue('font-family'))) continue
      out.push(rule.cssText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (_m, _q, u: string) => `url("${new URL(u, base).href}")`))
    }
  }
  return out.join('\n')
}

const DOC_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 var(--font-sans);-webkit-font-smoothing:antialiased;font-variation-settings:'wdth' 100}
a{color:inherit;text-decoration-color:var(--rule-strong);text-underline-offset:3px}
a:hover{text-decoration-color:var(--signal)}
.sheet{max-width:820px;margin:32px auto;padding:48px 64px 64px;background:var(--surface);box-shadow:0 0 0 1px var(--rule-strong)}
.plate{display:flex;flex-wrap:wrap;gap:6px 18px;justify-content:space-between;padding-bottom:10px;margin-bottom:28px;border-bottom:1.5px solid var(--ink);font:500 10.5px/1.3 var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)}
.plate b{color:var(--signal-ink);font-weight:500}
.doc-title{font-size:56px;margin:24px 0 40px}
.index-label{font:500 10.5px/1.4 var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--signal-ink);padding-bottom:8px}
.index{margin:0 0 40px;padding:0;list-style:none;border-top:1.5px solid var(--ink)}
.index li{display:flex;gap:12px;padding:6px 0;border-bottom:1px solid var(--rule);font-size:14px}
.index li span{font:500 10.5px/2 var(--font-mono);color:var(--ink-3);min-width:28px}
.index li.d1{padding-left:20px}.index li.d2{padding-left:40px}.index li.d3{padding-left:60px}
article{padding-top:8px}
article+article{margin-top:56px;padding-top:40px;border-top:1px solid var(--rule-strong)}
.crumbs{font:500 10.5px/1.4 var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);margin-bottom:10px}
.cover{height:180px;margin:-8px 0 28px;border-radius:4px;background-size:cover;background-position:center}
.icon{font-size:44px;line-height:1;margin-bottom:12px}
.icon img{width:56px;height:56px;object-fit:contain}
h1.title{margin:0 0 20px;font-size:42px;line-height:1.04;font-weight:800;font-stretch:125%;letter-spacing:-.02em}
.content h1{font-size:28px;font-weight:750;letter-spacing:-.01em;margin:1.6em 0 .4em;line-height:1.2}
.content h2{font-size:22px;font-weight:700;margin:1.4em 0 .35em;line-height:1.25}
.content h3{font-size:18px;font-weight:650;margin:1.2em 0 .3em}
.content p{margin:.35em 0}
.content ul,.content ol{padding-left:1.4em;margin:.35em 0}
.content li>p{margin:.1em 0}
.content ul[data-type=taskList]{list-style:none;padding-left:.2em}
.content ul[data-type=taskList] li{display:flex;gap:.5em;align-items:baseline}
.content ul[data-type=taskList] li>label{flex:none}
.content ul[data-type=taskList] li[data-checked=true]>div{color:var(--ink-3);text-decoration:line-through}
.content blockquote{margin:.6em 0;padding:.1em 0 .1em 1em;border-left:3px solid var(--ink)}
.content code{font:.88em var(--font-mono);background:var(--surface-2);padding:.1em .35em;border-radius:2px}
.content pre{font:13px/1.55 var(--font-mono);background:var(--surface-2);border:1px solid var(--rule);padding:14px 16px;border-radius:4px;overflow:auto;white-space:pre-wrap}
.content pre code{background:none;padding:0}
.content hr{border:0;border-top:1px solid var(--rule-strong);margin:1.6em 0}
.content img{max-width:100%;height:auto;border-radius:2px}
.content figure{margin:1em 0}
.content figcaption{font-size:13px;color:var(--ink-2);margin-top:6px}
.content table{border-collapse:collapse;width:100%;margin:.8em 0;font-size:14px}
.content th,.content td{border:1px solid var(--rule-strong);padding:6px 9px;vertical-align:top;text-align:left}
.content th{background:var(--surface-2);font-weight:650}
.content mark{padding:0 .1em;border-radius:2px}
.callout{display:flex;gap:12px;padding:14px 16px;margin:.7em 0;border-radius:4px;background:var(--c-gray-bg)}
.callout__icon{flex:none;font-size:18px;line-height:1.5}
.callout__body{flex:1;min-width:0}
${['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'].map((c) => `.callout--${c}{background:var(--c-${c}-bg)}`).join('')}
.callout--default{background:var(--surface-2)}
details{margin:.4em 0;padding:.2em 0 .2em .9em;border-left:1px solid var(--rule-strong)}
summary{cursor:pointer;font-weight:600}
.page-link,.database-block,.file-block,.bookmark,.embed{margin:.4em 0}
.page-link a,.database-block a{display:inline-flex;gap:8px;align-items:center;font-weight:600}
.page-link a::before{content:'↗';font:600 12px var(--font-mono);color:var(--signal-ink)}
.database-block a::before{content:'▦';color:var(--signal-ink)}
.file-block a::before{content:'⎙ ';color:var(--signal-ink)}
.bookmark{display:flex;flex-direction:column;padding:10px 14px;border:1px solid var(--rule-strong);border-radius:4px}
.bookmark__url{font:12px var(--font-mono);color:var(--ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.math-block{margin:.8em 0;text-align:center;overflow:auto}
.mermaid-svg{margin:1em 0;text-align:center}.mermaid-svg svg{max-width:100%;height:auto}
nav.toc{margin:.6em 0;padding:10px 14px;border-left:2px solid var(--signal)}
nav.toc a{display:block;padding:2px 0;font-size:14px;text-decoration:none}
nav.toc a.l2{padding-left:14px}nav.toc a.l3{padding-left:28px}
.mention{font-weight:550}
.props{width:100%;border-collapse:collapse;margin:0 0 24px;font-size:14px}
.props th{width:32%;text-align:left;font:500 10.5px/1.4 var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);padding:6px 10px 6px 0;border-bottom:1px solid var(--rule);vertical-align:top}
.props td{padding:6px 0;border-bottom:1px solid var(--rule)}
.dbt{width:100%;border-collapse:collapse;font-size:13.5px;margin:6px 0 10px}
.dbt th{text-align:left;font:500 10.5px/1.3 var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);padding:8px 10px;border-bottom:1.5px solid var(--ink);white-space:nowrap}
.dbt td{padding:7px 10px;border-bottom:1px solid var(--rule);vertical-align:top;white-space:nowrap}
.dbt td:first-child{white-space:normal;min-width:160px}
.dbt td:first-child{font-weight:600}
.dbt-wrap{overflow:auto}
.count{font:500 10.5px var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)}
footer.colophon{margin-top:64px;padding-top:12px;border-top:1px solid var(--rule);font:500 10.5px/1.4 var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);display:flex;justify-content:space-between}
@media (max-width:720px){.sheet{margin:0;padding:28px 20px 40px;box-shadow:none}h1.title{font-size:32px}.doc-title{font-size:40px}}
@media print{
  :root{color-scheme:light}
  body{background:#fff}
  .sheet{max-width:none;margin:0;padding:0;box-shadow:none;background:none}
  .index{break-after:page}
  .doc-title{margin-top:30mm}
  .dbt td{white-space:normal}
  article+article{break-before:page;margin-top:0;padding-top:0;border-top:0}
  pre,blockquote,.callout,table,figure,img{break-inside:avoid}
  h1,h2,h3{break-after:avoid}
  a{text-decoration:none}
  @page{margin:16mm 15mm 18mm}
}
`

const FONT_LINK =
  '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">'

export interface HtmlOptions {
  title: string
  lang: string
  untitled: string
  /** labels */
  labels: { exported: string; contents: string; generator: string; pages: (n: number) => string; rows: (n: number) => string }
  appUrl: string
  /** print (PDF): use the app's bundled fonts instead of Google Fonts */
  forPrint?: boolean
  onProgress?: (done: number, total: number) => void
}

/** Bundled assets (icons, covers) as data URLs so the file works offline; falls back to an absolute URL. */
const assetCache = new Map<string, Promise<string>>()
function inlineAsset(path: string): Promise<string> {
  const abs = new URL(resolveAssetUrl(path), window.location.href).href
  let hit = assetCache.get(abs)
  if (!hit) {
    hit = fetch(abs)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => readAsDataUrl(b))
      .catch(() => abs)
    assetCache.set(abs, hit)
  }
  return hit
}

async function fileUrlMap(tree: ExportTree): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (const ref of collectRefs(tree)) {
    const f = await getFile(ref)
    if (f) map.set(ref, await readAsDataUrl(f.blob))
  }
  return map
}

function headingsOf(doc: JSONContent | null): Array<{ level: number; text: string }> {
  const out: Array<{ level: number; text: string }> = []
  const text = (n: JSONContent): string => (n.text ?? '') + (n.content ?? []).map(text).join('')
  for (const n of doc?.content ?? []) if (n.type === 'heading') out.push({ level: Number(n.attrs?.level ?? 1), text: text(n) })
  return out
}

/** Post-process TipTap HTML in a detached document. */
async function finishContent(html: string, page: Page, ctx: { files: Map<string, string>; ids: Set<ID>; appUrl: string; katex: KatexLike | null; mermaid: MermaidLike | null }): Promise<string> {
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
  const root = doc.getElementById('root')!
  // internal links
  root.querySelectorAll<HTMLAnchorElement>('a[href^="#/p/"]').forEach((a) => {
    const id = a.getAttribute('href')!.slice(4).split('?')[0]
    a.setAttribute('href', ctx.ids.has(id) ? `#p-${id}` : `${ctx.appUrl}#/p/${id}`)
  })
  // files / images
  root.querySelectorAll<HTMLElement>('[src^="onefile:"], [href^="onefile:"], img[data-src^="onefile:"]').forEach((el) => {
    // the editor keeps local images in data-src (browsers can't fetch "onefile:")
    const attr = el.getAttribute('src')?.startsWith('onefile:') ? 'src' : el.getAttribute('href')?.startsWith('onefile:') ? 'href' : 'data-src'
    const url = ctx.files.get(el.getAttribute(attr)!)
    el.removeAttribute(attr)
    if (url) el.setAttribute(attr === 'data-src' ? 'src' : attr, url)
  })
  for (const img of Array.from(root.querySelectorAll<HTMLImageElement>('img[src]'))) {
    const src = img.getAttribute('src')!
    if (src.startsWith('assets/')) img.setAttribute('src', await inlineAsset(src))
    img.setAttribute('loading', 'lazy')
  }
  // math → MathML
  root.querySelectorAll<HTMLElement>('[data-type="block-math"], [data-type="inline-math"]').forEach((el) => {
    const latex = el.getAttribute('data-latex') ?? ''
    const block = el.getAttribute('data-type') === 'block-math'
    try {
      el.innerHTML = ctx.katex ? ctx.katex.renderToString(latex, { displayMode: block, output: 'mathml', throwOnError: false, strict: false }) : esc(latex)
    } catch {
      el.textContent = latex
    }
    if (block) el.classList.add('math-block')
  })
  // mermaid → SVG
  let n = 0
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-type="mermaid"]'))) {
    const code = el.getAttribute('data-code') ?? el.textContent ?? ''
    if (!ctx.mermaid || !code.trim()) continue
    try {
      const { svg } = await ctx.mermaid.render(`one-export-mm-${page.id}-${n++}`, code)
      el.innerHTML = svg
      el.className = 'mermaid-svg'
    } catch {
      /* keep the source as a code block */
    }
  }
  // documents read top to bottom: unfold toggles
  root.querySelectorAll('details').forEach((d) => d.setAttribute('open', ''))
  // embeds → links (no iframes in a document)
  root.querySelectorAll<HTMLElement>('[data-type="embed"]').forEach((el) => {
    const url = el.getAttribute('data-url') ?? ''
    el.innerHTML = `<a href="${esc(url)}">${esc(url)}</a>`
  })
  // table of contents
  const heads = headingsOf(page.content)
  const hEls = Array.from(root.querySelectorAll('h1, h2, h3'))
  hEls.forEach((h, i) => h.setAttribute('id', `p-${page.id}-h${i}`))
  root.querySelectorAll('nav[data-type="toc"]').forEach((nav) => {
    nav.innerHTML = heads.map((h, i) => `<a class="l${h.level}" href="#p-${page.id}-h${i}">${esc(h.text)}</a>`).join('')
  })
  return root.innerHTML
}

interface KatexLike {
  renderToString: (tex: string, options?: Record<string, unknown>) => string
}

interface MermaidLike {
  render: (id: string, code: string) => Promise<{ svg: string }>
}

let propertyValueToText: typeof PropertyValueToText = () => ''

function propsTable(db: Database, row: Page): string {
  const cells = db.properties
    .filter((d) => d.type !== 'title')
    .map((d) => [d.name, propertyValueToText(db, d, row)] as const)
    .filter(([, v]) => v.trim())
  if (!cells.length) return ''
  return `<table class="props"><tbody>${cells.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>`
}

function dbTable(db: Database, rows: Page[], ids: Set<ID>, untitled: string, rowsLabel: (n: number) => string): string {
  const props = db.properties.filter((p) => p.type !== 'files')
  const head = props.map((p) => `<th>${esc(p.name)}</th>`).join('')
  const body = rows
    .map((r) => {
      const tds = props.map((p) => {
        if (p.type === 'title') {
          const title = esc(r.title.trim() || untitled)
          return `<td>${ids.has(r.id) && r.content ? `<a href="#p-${r.id}">${title}</a>` : title}</td>`
        }
        return `<td>${esc(propertyValueToText(db, p, r))}</td>`
      })
      return `<tr>${tds.join('')}</tr>`
    })
    .join('')
  return `<div class="count">${esc(rowsLabel(rows.length))}</div><div class="dbt-wrap"><table class="dbt"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
}

export async function buildHTML(tree: ExportTree, opts: HtmlOptions): Promise<string> {
  // editor + database renderers are loaded on demand
  const [{ docToHTML }, database] = await Promise.all([import('../../../editor'), import('../../../database')])
  propertyValueToText = database.propertyValueToText
  const files = await fileUrlMap(tree)
  const usesMath = tree.all.some((p) => p.content && /"(block|inline)Math"/.test(JSON.stringify(p.content)))
  const usesMermaid = tree.all.some((p) => p.content && /"mermaid"/.test(JSON.stringify(p.content)))
  const katex = usesMath ? await import('katex').then((m) => m.default).catch(() => null) : null
  let mermaid: MermaidLike | null = null
  if (usesMermaid) {
    try {
      const m = (await import('mermaid')).default
      m.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict', fontFamily: 'Archivo, sans-serif' })
      mermaid = m
    } catch {
      mermaid = null
    }
  }
  // rows only get their own article when they have content
  const articles = tree.all.filter((p) => !p.databaseId || (p.content && (p.plain ?? '').trim()))
  const ids = new Set(articles.map((p) => p.id))
  const depth = (p: Page) => {
    let d = 0
    let cur = p.parentId ? tree.pages[p.parentId] : undefined
    while (cur && tree.all.includes(cur) && d < 6) {
      d++
      cur = cur.parentId ? tree.pages[cur.parentId] : undefined
    }
    return d
  }
  const crumbs = (p: Page) => {
    const out: string[] = []
    let cur = p.parentId ? tree.pages[p.parentId] : undefined
    while (cur && out.length < 6) {
      out.unshift(cur.title.trim() || opts.untitled)
      cur = cur.parentId ? tree.pages[cur.parentId] : undefined
    }
    return out
  }

  const parts: string[] = []
  let done = 0
  for (const p of articles) {
    const db = tree.databases[p.id]
    const rowDb = p.databaseId ? tree.databases[p.databaseId] : undefined
    const icon = p.icon
      ? p.icon.type === 'emoji'
        ? `<div class="icon">${esc(p.icon.value)}</div>`
        : p.icon.type === 'asset'
          ? `<div class="icon"><img src="${esc(await inlineAsset(`assets/icons/${p.icon.value}.webp`))}" alt=""></div>`
          : ''
      : ''
    let cover = ''
    if (p.cover?.type === 'image') {
      const v = p.cover.value
      const src = v.startsWith('onefile:') ? files.get(v) : /^(https?:|data:)/.test(v) ? v : await inlineAsset(v)
      if (src) cover = `<div class="cover" style="background-image:url('${esc(src)}');background-position:center ${p.cover.positionY}%"></div>`
    } else if (p.cover?.type === 'color') cover = `<div class="cover" style="background:var(--c-${p.cover.value}-bg)"></div>`
    else if (p.cover?.type === 'gradient') cover = `<div class="cover" style="background:${esc(p.cover.value)}"></div>`
    const trail = crumbs(p)
    const content = p.content ? await finishContent(docToHTML(p.content), p, { files, ids, appUrl: opts.appUrl, katex, mermaid }) : ''
    parts.push(
      `<article id="p-${p.id}">${cover}${trail.length ? `<div class="crumbs">${trail.map(esc).join(' / ')}</div>` : ''}${icon}<h1 class="title">${esc(p.title.trim() || opts.untitled)}</h1>${rowDb ? propsTable(rowDb, p) : ''}${content ? `<div class="content">${content}</div>` : ''}${db ? dbTable(db, tree.rows(p.id), ids, opts.untitled, opts.labels.rows) : ''}</article>`,
    )
    done++
    opts.onProgress?.(done, articles.length)
    if (done % 8 === 0) await new Promise((r) => setTimeout(r, 0))
  }

  const date = new Intl.DateTimeFormat(opts.lang === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())
  // the plate counts what the contents list shows (rows with content are articles, not entries)
  const pageCount = articles.filter((p) => !p.databaseId).length
  const index =
    articles.length > 1
      ? `<h1 class="title doc-title">${esc(opts.title)}</h1><div class="index-label">${esc(opts.labels.contents)}</div><ol class="index">${articles
          .filter((p) => !p.databaseId)
          .map((p, i) => `<li class="d${Math.min(3, depth(p))}"><span>${String(i + 1).padStart(2, '0')}</span><a href="#p-${p.id}">${esc(p.title.trim() || opts.untitled)}</a></li>`)
          .join('')}</ol>`
      : ''
  return `<!doctype html>
<html lang="${opts.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="SimpleCMS One">
<title>${esc(opts.title)}</title>
${opts.forPrint ? '' : FONT_LINK}
<style>${opts.forPrint ? fontFaceCSS() : ''}\n${tokenCSS()}\n${DOC_CSS}</style>
</head>
<body>
<main class="sheet">
<div class="plate"><span><b>●</b> SimpleCMS One · ${esc(opts.labels.exported)}</span><span>${esc(date)} · ${esc(opts.labels.pages(pageCount))}</span></div>
${index}
${parts.join('\n')}
<footer class="colophon"><span>${esc(opts.labels.generator)}</span><span>${esc(opts.title)}</span></footer>
</main>
</body>
</html>`
}

/** Print the export via a hidden iframe (user picks "Save as PDF"). */
export function printHTML(html: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none'
    let finished = false
    const cleanup = () => {
      if (finished) return
      finished = true
      window.setTimeout(() => frame.remove(), 1000)
      resolve()
    }
    frame.onload = async () => {
      const win = frame.contentWindow
      if (!win) return cleanup()
      try {
        await Promise.race([win.document.fonts?.ready, new Promise((r) => setTimeout(r, 2500))])
        const imgs = Array.from(win.document.images).filter((i) => !i.complete)
        await Promise.race([Promise.all(imgs.map((i) => new Promise((r) => (i.onload = i.onerror = r)))), new Promise((r) => setTimeout(r, 4000))])
        win.addEventListener('afterprint', cleanup, { once: true })
        win.focus()
        win.print()
      } catch (err) {
        console.warn('[export] print failed', err)
      }
      // browsers without afterprint (or when print() returns immediately)
      window.setTimeout(cleanup, 60_000)
      resolve()
    }
    frame.srcdoc = html
    document.body.append(frame)
  })
}
