/**
 * Standalone HTML export: one file, styled like a printed One page (paper/carbon follows the
 * reader's system theme). Everything the page needs travels inside the file: local images,
 * cover and icon as data URLs, math pre-rendered with KaTeX (its CSS inlined), Mermaid
 * diagrams pre-rendered to SVG for both themes. Only the web fonts are linked (offline the
 * file falls back to system fonts).
 */
import type { JSONContent } from '@tiptap/core'
import tokensCss from '@/shared/tokens.css?raw'
import { docToHTML } from '../../editor'
import { readAsDataUrl, resolveAssetUrl } from '../../lib/files'
import { plainText } from '../../store/store'
import { t } from '../../i18n'
import { BRAND } from '@/shared/brand'
import { preparePage, type SharePayload } from './codec'

const KATEX_FONTS = 'https://cdn.jsdelivr.net/npm/katex@0.18.10/dist/fonts/'
const FONTS_CSS =
  'https://fonts.googleapis.com/css2?family=Archivo:ital,wdth,wght@0,62..125,100..900;1,62..125,100..900&family=JetBrains+Mono:wght@400..700&display=swap'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function absolute(src: string): string {
  if (/^(https?:|data:|blob:)/.test(src)) return src
  try {
    return new URL(resolveAssetUrl(src), window.location.href).href
  } catch {
    return src
  }
}

/** Bundled assets (covers, icons, images) become data URLs so the file works offline and anywhere. */
const inlined = new Map<string, Promise<string>>()
function inlineAsset(src: string): Promise<string> {
  if (!/^assets\//.test(src)) return Promise.resolve(absolute(src))
  let p = inlined.get(src)
  if (!p) {
    p = fetch(resolveAssetUrl(src))
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => readAsDataUrl(b))
      .catch(() => absolute(src))
    inlined.set(src, p)
  }
  return p
}

async function inlineImages(nodes: JSONContent[] | undefined): Promise<JSONContent[] | undefined> {
  if (!nodes) return nodes
  return Promise.all(
    nodes.map(async (n) => {
      const out: JSONContent = { ...n }
      if (n.type === 'image' && typeof n.attrs?.src === 'string') out.attrs = { ...n.attrs, src: await inlineAsset(n.attrs.src) }
      if (n.content) out.content = await inlineImages(n.content)
      return out
    }),
  )
}

async function renderMath(html: string): Promise<{ html: string; css: string }> {
  if (!/data-type="(block|inline)-math"/.test(html)) return { html, css: '' }
  try {
    const [katex, css] = await Promise.all([import('katex').then((m) => m.default), import('katex/dist/katex.min.css?raw').then((m) => m.default as string)])
    const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
    doc.querySelectorAll<HTMLElement>('[data-type="block-math"], [data-type="inline-math"]').forEach((el) => {
      const latex = el.getAttribute('data-latex') ?? ''
      el.innerHTML = katex.renderToString(latex, { displayMode: el.dataset.type === 'block-math', throwOnError: false, output: 'html' })
    })
    // layout CSS travels inline; the glyph fonts load from the CDN when online
    return { html: doc.getElementById('root')!.innerHTML, css: css.replace(/url\(fonts\//g, `url(${KATEX_FONTS}`) }
  } catch {
    return { html, css: '' }
  }
}

/* ---------------- Mermaid → static SVG ---------------- */

const MERMAID_VARS = [
  '--surface',
  '--surface-2',
  '--ink',
  '--ink-2',
  '--ink-3',
  '--signal',
  '--signal-wash',
  '--c-yellow-bg',
] as const

/** Read the design tokens of one theme without a visible flash (switch, read, restore in one task). */
function themeTokens(theme: 'light' | 'dark'): Record<string, string> {
  const html = document.documentElement
  const before = html.dataset.theme
  html.dataset.theme = theme
  const cs = getComputedStyle(html)
  const out: Record<string, string> = {}
  for (const v of MERMAID_VARS) out[v] = cs.getPropertyValue(v).trim() || '#000'
  if (before === undefined) delete html.dataset.theme
  else html.dataset.theme = before
  return out
}

let mermaidSeq = 0
/**
 * Mermaid sources → static SVG for both themes (figure.diagram--light / --dark).
 * idPrefix: deterministic SVG ids (website export) instead of a running counter.
 */
export async function renderMermaid(html: string, idPrefix?: string): Promise<string> {
  if (!/class="mermaid"/.test(html)) return html
  try {
    const mermaid = (await import('mermaid')).default
    const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
    const blocks = [...doc.querySelectorAll<HTMLElement>('[data-type="mermaid"]')]
    let local = 0
    for (const theme of ['light', 'dark'] as const) {
      const c = themeTokens(theme)
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        // dagre: mermaid 12 defaults to ELK, a large extra chunk the export does not need
        layout: 'dagre',
        theme: 'base',
        fontFamily: 'Archivo, system-ui, sans-serif',
        // a fixed seed draws identical shapes on every export (deterministic website builds)
        ...(idPrefix ? { handDrawnSeed: 1 } : {}),
        themeVariables: {
          fontSize: '14px',
          background: c['--surface'],
          primaryColor: c['--surface'],
          primaryTextColor: c['--ink'],
          primaryBorderColor: c['--ink'],
          secondaryColor: c['--surface-2'],
          tertiaryColor: c['--surface-2'],
          lineColor: c['--ink-2'],
          textColor: c['--ink'],
          mainBkg: c['--surface'],
          nodeBorder: c['--ink'],
          clusterBkg: c['--surface-2'],
          clusterBorder: c['--ink-3'],
          edgeLabelBackground: c['--surface'],
          noteBkgColor: c['--c-yellow-bg'],
          noteTextColor: c['--ink'],
          noteBorderColor: c['--ink-3'],
          actorBkg: c['--surface'],
          actorBorder: c['--ink'],
          signalColor: c['--ink'],
          signalTextColor: c['--ink'],
          labelBoxBkgColor: c['--surface-2'],
          activationBkgColor: c['--signal-wash'],
          git0: c['--signal'],
          pie1: c['--signal'],
        },
      })
      for (const el of blocks) {
        const code = el.querySelector('pre')?.textContent ?? ''
        if (!code.trim()) continue
        try {
          const id = idPrefix ? `one-export-${idPrefix}-${theme}-${++local}` : `one-export-${theme}-${++mermaidSeq}`
          const { svg } = await mermaid.render(id, code)
          const fig = doc.createElement('figure')
          fig.className = `diagram diagram--${theme}`
          fig.innerHTML = svg
          el.appendChild(fig)
        } catch {
          /* keep the source as a code block */
        }
      }
    }
    // the rendered diagrams replace their source; failed ones keep it
    for (const el of blocks) if (el.querySelector('figure.diagram')) el.querySelector('pre')?.remove()
    // mermaid can leave its scratch nodes in the page when a diagram fails
    document.querySelectorAll('body > [id*="one-export-"]').forEach((n) => n.remove())
    return doc.getElementById('root')!.innerHTML
  } catch {
    return html
  }
}

async function coverHTML(p: SharePayload): Promise<string> {
  const c = p.cover
  if (!c) return ''
  const y = Number.isFinite(Number(c.positionY)) ? Math.min(100, Math.max(0, Number(c.positionY))) : 50
  if (c.type === 'image') return `<div class="cover"><img src="${esc(await inlineAsset(c.value))}" alt="" style="object-position:center ${y}%"></div>`
  if (c.type === 'gradient') return `<div class="cover" style="background:${esc(c.value)}"></div>`
  return `<div class="cover" style="background:var(--c-${esc(c.value)}-bg)"></div>`
}

async function iconHTML(p: SharePayload): Promise<string> {
  const i = p.icon
  if (!i) return ''
  if (i.type === 'emoji') return `<div class="icon">${esc(i.value)}</div>`
  if (i.type === 'asset') return `<div class="icon"><img src="${esc(await inlineAsset(`assets/icons/${i.value}.webp`))}" alt="" width="64" height="64"></div>`
  return ''
}

/** Tabs block (radio inputs + labels, see editor/schema/tabs.ts): panels switch with CSS, no script. */
const tabsCss = (s: string) =>
  `${s} .tabs{margin:.8em 0;border-bottom:1px solid var(--rule)}` +
  `${s} .tabs__bar{display:flex;flex-wrap:wrap;gap:2px;border-bottom:1px solid var(--rule-strong)}` +
  `${s} .tabs__tab{position:relative;display:inline-flex;align-items:center;gap:7px;padding:7px 12px 7px 9px;cursor:pointer;font-weight:600;font-size:.9em;color:var(--ink-2)}` +
  `${s} .tabs__radio{position:absolute;opacity:0;width:1px;height:1px;margin:0}` +
  `${s} .tabs__n{font:500 10.5px var(--font-mono);letter-spacing:.08em;color:var(--ink-3)}` +
  `${s} .tabs__tab:has(:checked){color:var(--ink)}${s} .tabs__tab:has(:checked) .tabs__n{color:var(--signal-ink)}` +
  `${s} .tabs__tab:has(:checked)::after{content:'';position:absolute;left:7px;right:7px;bottom:-1px;height:2px;background:var(--signal)}` +
  `${s} .tabs__tab:has(:focus-visible){outline:2px solid var(--signal);outline-offset:-2px}` +
  `${s} .tabs__panels{padding:.6em 0 .2em}` +
  `${s} .tabs:has(>.tabs__bar :checked)>.tabs__panels>.tab-panel{display:none}` +
  Array.from({ length: 24 }, (_, i) => `${s} .tabs:has(>.tabs__bar>.tabs__tab:nth-child(${i + 1}) :checked)>.tabs__panels>.tab-panel:nth-child(${i + 1})`).join(',') +
  '{display:block}' +
  `@media print{${s} .tabs__bar{display:none}${s} .tabs .tabs__panels>.tab-panel{display:block!important}${s} .tab-panel::before{content:attr(data-title);display:block;font-weight:700;margin:.8em 0 .3em}}`

const READING_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font-sans);font-size:17px;line-height:1.7;-webkit-font-smoothing:antialiased;caret-color:var(--signal)}
::selection{background:var(--selection)}
.bar{display:flex;align-items:center;gap:10px;max-width:760px;margin:0 auto;padding:18px 24px 0;font-family:var(--font-mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)}
.bar .led{width:6px;height:6px;border-radius:999px;background:var(--signal)}
.bar .sp{flex:1}
.cover{height:min(34vh,300px);margin-top:18px;background:var(--surface-2);overflow:hidden}
.cover img{width:100%;height:100%;object-fit:cover;display:block}
main{max-width:760px;margin:0 auto;padding:40px 24px 96px}
.has-cover main{padding-top:0}
.icon{font-size:64px;line-height:1;margin:0 0 14px}
.has-cover .icon{margin-top:-36px;position:relative}
.icon img{width:72px;height:72px;object-fit:contain}
h1.title{margin:0 0 10px;font-size:clamp(32px,5.4vw,46px);font-stretch:125%;font-weight:800;letter-spacing:-.02em;line-height:1.04}
.meta{margin:0 0 36px;padding-bottom:14px;border-bottom:1px solid var(--rule);font-family:var(--font-mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)}
.doc>*:first-child{margin-top:0}
.doc p{margin:0 0 .75em}
.doc h1,.doc h2,.doc h3{line-height:1.2;letter-spacing:-.01em;margin:1.6em 0 .5em}
.doc h1{font-size:1.9em;font-stretch:115%;font-weight:800}
.doc h2{font-size:1.45em;font-weight:750}
.doc h3{font-size:1.18em;font-weight:700}
.doc a{color:inherit;text-decoration:underline;text-decoration-color:var(--signal);text-underline-offset:3px;text-decoration-thickness:1px}
.doc ul,.doc ol{padding-left:1.4em;margin:0 0 .75em}
.doc li>p{margin:0 0 .25em}
.doc li::marker{color:var(--ink-3)}
.doc ul[data-type="taskList"]{list-style:none;padding-left:.2em}
.doc ul[data-type="taskList"] li{display:flex;gap:.6em;align-items:flex-start}
.doc ul[data-type="taskList"] li>label{flex:none;margin-top:.32em}
.doc ul[data-type="taskList"] li>div{flex:1;min-width:0}
.doc ul[data-type="taskList"] input{accent-color:var(--signal);width:14px;height:14px;margin:0}
.doc li[data-checked="true"]>div{color:var(--ink-3);text-decoration:line-through}
.doc blockquote{margin:0 0 .9em;padding:.1em 0 .1em 1em;border-left:3px solid var(--ink);color:var(--ink-2)}
.doc code{font-family:var(--font-mono);font-size:.86em;background:var(--surface-2);padding:.12em .35em;border-radius:2px}
.doc pre{font-family:var(--font-mono);font-size:13.5px;line-height:1.6;background:var(--surface);border:1px solid var(--rule);border-radius:4px;padding:14px 16px;overflow:auto;margin:0 0 1em}
.doc pre code{background:none;padding:0;font-size:inherit}
.doc hr{border:0;height:1px;background:var(--rule-strong);margin:2em 0}
.doc img{max-width:100%;height:auto;border-radius:2px;display:block;margin:0 auto}
.doc figure{margin:1.2em 0}
.doc figcaption{font-size:13px;color:var(--ink-3);text-align:center;margin-top:6px}
.doc table{border-collapse:collapse;width:100%;margin:0 0 1em;font-size:.92em;display:block;overflow-x:auto}
.doc th,.doc td{border:1px solid var(--rule-strong);padding:6px 10px;text-align:left;vertical-align:top;min-width:80px}
.doc th{background:var(--surface-2);font-weight:650}
.doc td p,.doc th p{margin:0}
.doc mark{background:var(--c-yellow-bg);color:inherit;padding:0 .1em;border-radius:2px}
.doc .callout{display:flex;gap:12px;padding:14px 16px;margin:0 0 1em;border-radius:4px;background:var(--c-gray-bg)}
.doc .callout__icon{flex:none;font-size:1.15em;line-height:1.5}
.doc .callout__body{flex:1;min-width:0}
.doc .callout__body>:last-child{margin-bottom:0}
${['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'].map((c) => `.doc .callout--${c}{background:var(--c-${c}-bg)}`).join('')}
.doc .columns{display:grid;grid-template-columns:repeat(var(--cols,2),minmax(0,1fr));gap:24px}
@media (max-width:640px){.doc .columns{grid-template-columns:1fr}}
.doc details{margin:0 0 .75em}
.doc details>summary{cursor:pointer;font-weight:600}
.doc details[data-heading]>summary{font-stretch:115%;font-weight:800;line-height:1.2;letter-spacing:-.01em;margin-top:1.4em}
.doc details[data-heading="1"]>summary{font-size:1.9em}
.doc details[data-heading="2"]>summary{font-size:1.45em}
.doc details[data-heading="3"]>summary{font-size:1.18em}
.doc .media-block{margin:1.2em 0;max-width:100%}
.doc .media-block[data-align="center"]{margin-left:auto;margin-right:auto}
.doc .media-block[data-align="right"]{margin-left:auto}
.doc .media-block video{display:block;width:100%;height:auto;border:1px solid var(--rule-strong);border-radius:4px;background:var(--surface-2)}
.doc .media-block audio{display:block;width:100%}
.doc [data-type="block-math"]{margin:1em 0;overflow-x:auto;text-align:center}
.doc .bookmark{display:flex;flex-direction:column;gap:2px;padding:12px 14px;border:1px solid var(--rule-strong);border-radius:4px;margin:0 0 1em}
.doc .bookmark a{font-weight:600;text-decoration:none}
.doc .bookmark__url{font-family:var(--font-mono);font-size:11px;color:var(--ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.doc .embed{margin:0 0 1em}
.doc .embed iframe{width:100%;aspect-ratio:16/9;border:0;border-radius:4px}
.doc .file-block,.doc .page-link,.doc .database-block{padding:8px 12px;border:1px solid var(--rule);border-radius:4px;margin:0 0 .75em}
.doc .toc:empty{display:none}
${tabsCss('.doc')}
.doc .one-button{margin:0 0 1em}
.doc .one-button__key{font:650 15px var(--font-sans);padding:7px 15px;border:1px solid var(--signal-press);border-radius:2px;background:var(--signal);color:var(--on-signal);opacity:1}
.doc .one-button--ink .one-button__key{background:var(--ink);border-color:var(--ink);color:var(--ink-inverse)}
.doc .one-button--ghost .one-button__key{background:var(--surface);border-color:var(--ink-faint);color:var(--ink)}
.doc pre.mermaid{background:none;border:0;text-align:center}
.doc [data-type="mermaid"]{margin:0 0 1.2em}
.doc figure.diagram{margin:0;overflow-x:auto;text-align:center}
.doc figure.diagram svg{max-width:100%;height:auto}
.doc .diagram--dark{display:none}
[data-theme="dark"] .doc .diagram--dark{display:block}
[data-theme="dark"] .doc .diagram--light{display:none}
${['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'].map((c) => `.doc span[data-color="${c}"]{color:var(--c-${c}-text)}.doc mark[data-color="${c}"]{background:var(--c-${c}-bg);color:inherit}`).join('')}
footer{max-width:760px;margin:0 auto;padding:0 24px 48px;display:flex;justify-content:space-between;gap:12px;font-family:var(--font-mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)}
footer a{color:inherit}
@media print{.bar{display:none}body{background:var(--surface)}main{padding-top:0}}
`

/** Build a complete standalone HTML document for a page. */
export async function buildStandaloneHTML(pageId: string, lang: string): Promise<{ html: string; filename: string; title: string }> {
  const { payload } = await preparePage(pageId, Infinity)
  const content = payload.content ? { ...payload.content, content: await inlineImages(payload.content.content) } : null
  const math = await renderMath(docToHTML(content))
  const body = await renderMermaid(math.html)
  const [cover, icon] = await Promise.all([coverHTML(payload), iconHTML(payload)])
  const title = payload.title.trim() || 'Untitled'
  const date = new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())
  const words = plainText(content, 5_000_000).split(/\s+/).filter(Boolean).length
  const html = `<!doctype html>
<html lang="${lang === 'de' ? 'de' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${esc(BRAND.name)}">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS_CSS}">
<script>try{if(matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.dataset.theme='dark'}catch(e){}</script>
<style>${tokensCss}
:root{--font-sans:'Archivo','Archivo Variable',ui-sans-serif,system-ui,sans-serif;--font-mono:'JetBrains Mono','JetBrains Mono Variable',ui-monospace,monospace}
${READING_CSS}
${math.css}</style>
</head>
<body class="${payload.cover ? 'has-cover' : ''}">
<div class="bar"><span class="led"></span><span>${esc(BRAND.name)}</span><span class="sp"></span><span>${esc(date)}</span></div>
${cover}
<main>
${icon}
<h1 class="title">${esc(title)}</h1>
<div class="meta">${esc(date)} · ${esc(t('features.share.export.words', { count: words }))}</div>
<article class="doc">
${body}
</article>
</main>
<footer><span>${esc(t('features.share.export.from', { name: BRAND.name }))}</span><a href="${esc(BRAND.repoUrl)}">${esc(BRAND.repoUrl.replace(/^https:\/\//, ''))}</a></footer>
</body>
</html>`
  const filename = `${title.replace(/[\\/:*?"<>|#%]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'page'}.html`
  return { html, filename, title }
}

export function downloadText(filename: string, text: string, type = 'text/html') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}
