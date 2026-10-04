/**
 * The public help pages (/help/, /help/<id>/, /help/de/, /help/de/<id>/), rendered at build time from the
 * same article files as the in-app Help panel. Pure string rendering — no DOM, no Node APIs; the Vite plugin
 * (plugin.ts) reads the files and writes the pages. No client framework: one small script (help.js) adds
 * the search on the index, platform keycaps and the stored theme.
 */
import { helpLinkId, type Block, type Inline } from '../app/help/markdown.js'
import { HELP_SECTIONS, sectionNum } from '../app/help/sections.js'
import { HELP_LANGS, helpPath, neighbours, relatedArticles, sectionArticles, type HelpArticle, type HelpLang, type HelpLibrary } from '../app/help/library.js'
import { messages } from '../app/help/messages.js'

export interface SiteOptions {
  /** the Vite base: "/" (getonecms.com) or "/SimpleCMS/" (a project page) */
  base: string
  /** absolute origin for canonical / hreflang links, without a trailing slash */
  origin: string
  /** asset paths relative to the base (cache-busted by the plugin) */
  css: string
  script: string
}

export interface HelpPage {
  /** output path relative to the out dir, e.g. "help/de/formulas/index.html" */
  file: string
  html: string
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const esc = (s: string | number): string => String(s).replace(/[&<>"']/g, (c) => ESC[c])

const tr = (lang: HelpLang) => (key: string, vars?: Record<string, string | number>) => {
  const raw = messages[lang][key] ?? messages.en[key] ?? key
  return vars ? raw.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : raw
}

/* ------------------------------------------------------------------ */
/* Article body                                                        */
/* ------------------------------------------------------------------ */

/** "Mod+Shift+K" → "Ctrl+Shift+K" (the script turns it into ⌘⇧K on a Mac). */
function kbdHtml(keys: string): string {
  const combo = /^(Mod|Alt|Shift)\+|\+(Mod|Alt|Shift)\b/.test(keys)
  const text = combo ? keys.replace(/\bMod\b/g, 'Ctrl') : keys
  return combo ? `<kbd data-keys="${esc(keys)}">${esc(text)}</kbd>` : `<kbd>${esc(text)}</kbd>`
}

function inlineHtml(nodes: Inline[], href: (id: string) => string): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case 'text':
          return esc(n.v)
        case 'b':
          return `<strong>${inlineHtml(n.c, href)}</strong>`
        case 'i':
          return `<em>${inlineHtml(n.c, href)}</em>`
        case 'code':
          return `<code>${esc(n.v)}</code>`
        case 'kbd':
          return kbdHtml(n.v)
        case 'link': {
          const id = helpLinkId(n.href)
          if (id) return `<a href="${esc(href(id))}">${inlineHtml(n.c, href)}</a>`
          if (/^https?:\/\//i.test(n.href)) return `<a href="${esc(n.href)}" rel="noopener">${inlineHtml(n.c, href)}</a>`
          return inlineHtml(n.c, href)
        }
      }
    })
    .join('')
}

export function blocksHtml(blocks: Block[], href: (id: string) => string): string {
  return blocks
    .map((b) => {
      const inl = (c: Inline[]) => inlineHtml(c, href)
      switch (b.t) {
        case 'h2':
          return `<h2>${inl(b.c)}</h2>`
        case 'h3':
          return `<h3>${inl(b.c)}</h3>`
        case 'p':
          return `<p>${inl(b.c)}</p>`
        case 'note':
          return `<p class="note"><span class="note-mark" aria-hidden="true">!</span><span>${inl(b.c)}</span></p>`
        case 'ul':
          return `<ul>${b.items.map((it) => `<li>${inl(it)}</li>`).join('')}</ul>`
        case 'ol':
          return `<ol class="steps">${b.items.map((it, i) => `<li><span class="step" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span><span>${inl(it)}</span></li>`).join('')}</ol>`
        case 'pre':
          return `<pre><code>${esc(b.v)}</code></pre>`
      }
    })
    .join('\n')
}

/* ------------------------------------------------------------------ */
/* Frame                                                               */
/* ------------------------------------------------------------------ */

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="3" fill="#FF4F00"/><circle cx="7" cy="7" r="2" fill="#121210"/><path d="M13 9.5 18.5 7H21v18h-4.2V12.2L13 13.8z" fill="#121210"/></svg>`

/** Applies the theme the workspace stored (one.theme), else the system's — before the first paint. */
const THEME = `(function(){try{var p=localStorage.getItem('one.theme');var d=p==='dark'||(p!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'}catch(e){}})()`

interface FrameInput {
  lang: HelpLang
  /** article id, or null for the index */
  id: string | null
  title: string
  description: string
  main: string
  opts: SiteOptions
  /** the other language has this page */
  twin: boolean
}

function frame({ lang, id, title, description, main, opts, twin }: FrameInput): string {
  const t = tr(lang)
  const { base, origin } = opts
  const url = (l: HelpLang) => `${origin}${base}${helpPath(l, id)}`
  const local = (l: HelpLang) => `${base}${helpPath(l, twin || l === lang ? id : null)}`
  const alternates = twin
    ? HELP_LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${esc(url(l))}" />`).join('\n    ') + `\n    <link rel="alternate" hreflang="x-default" href="${esc(url('en'))}" />`
    : ''
  const langLink = (l: HelpLang) =>
    `<a href="${esc(local(l))}" hreflang="${l}" lang="${l}"${l === lang ? ' aria-current="true"' : ''}>${l.toUpperCase()}</a>`
  return `<!doctype html>
<html lang="${lang}" data-theme="light">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <link rel="canonical" href="${esc(url(lang))}" />
    ${alternates}
    <meta property="og:site_name" content="SimpleCMS One" />
    <meta property="og:type" content="${id ? 'article' : 'website'}" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:url" content="${esc(url(lang))}" />
    <meta property="og:image" content="${esc(`${origin}${base}assets/og.png`)}" />
    <meta name="theme-color" content="#121210" />
    <link rel="icon" type="image/svg+xml" href="${esc(base)}favicon.svg" />
    <link rel="stylesheet" href="${esc(base + opts.css)}" />
    <script>${THEME}</script>
  </head>
  <body>
    <a class="skip" href="#main">${esc(t('help.site.skip'))}</a>
    <header class="hb">
      <div class="wrap hb-row">
        <a class="hb-brand" href="${esc(`${base}${helpPath(lang)}`)}">${LOGO}<span class="hb-word">One</span><span class="lbl hb-tag">${esc(t('help.title'))}</span></a>
        <nav class="hb-tools" aria-label="${esc(t('help.site.lang'))}">
          <span class="lang" role="group" aria-label="${esc(t('help.site.lang'))}">${HELP_LANGS.map(langLink).join('')}</span>
          <a class="hb-link" href="${esc(base)}">${esc(t('help.site.website'))}</a>
          <a class="btn btn-sig" href="${esc(`${base}app/`)}">${esc(t('help.site.openApp'))}<span aria-hidden="true">→</span></a>
        </nav>
      </div>
    </header>
    <main id="main" tabindex="-1">
${main}
    </main>
    <footer class="hf">
      <div class="wrap hf-row">
        <span class="lbl"><span class="led" aria-hidden="true"></span>${esc(t('help.site.foot'))}</span>
        <span class="lbl">${esc(t('help.site.inApp'))}</span>
      </div>
    </footer>
    <script src="${esc(base + opts.script)}" defer></script>
  </body>
</html>
`
}

/* ------------------------------------------------------------------ */
/* Pages                                                               */
/* ------------------------------------------------------------------ */

function searchForm(lang: HelpLang, opts: SiteOptions, compact = false): string {
  const t = tr(lang)
  return `<form class="hs${compact ? ' hs--compact' : ''}" role="search" action="${esc(`${opts.base}${helpPath(lang)}`)}" method="get" data-search>
          <label class="sr" for="help-q${compact ? '-c' : ''}">${esc(t('help.site.search'))}</label>
          <input id="help-q${compact ? '-c' : ''}" name="q" type="search" autocomplete="off" spellcheck="false" placeholder="${esc(t('help.site.searchPh'))}" />
          <span class="kbd hs-key" aria-hidden="true">/</span>
        </form>`
}

function indexPage(lib: HelpLibrary, lang: HelpLang, opts: SiteOptions): string {
  const t = tr(lang)
  const href = (id: string) => `${opts.base}${helpPath(lang, id)}`
  const chapters = HELP_SECTIONS.map((s) => {
    const list = sectionArticles(lib, lang, s.id)
    if (!list.length) return ''
    return `
        <section class="chap" id="${s.id}" aria-labelledby="chap-${s.id}">
          <h2 class="chap-head" id="chap-${s.id}"><span class="chap-num">§ ${s.num}</span><span class="chap-name">${esc(t(`help.sec.${s.id}`))}</span><span class="chap-rule" aria-hidden="true"></span><span class="lbl">${String(list.length).padStart(2, '0')}</span></h2>
          <ul class="rows">
            ${list.map((a) => `<li><a class="row" href="${esc(href(a.id))}"><span class="row-num">${a.num}</span><span class="row-main"><span class="row-title">${esc(a.title)}</span><span class="row-sum">${esc(a.summary)}</span></span><span class="row-go" aria-hidden="true">→</span></a></li>`).join('\n            ')}
          </ul>
        </section>`
  }).join('')
  // what the search script reads: id, title, number, chapter, keywords, text
  const data = lib[lang].map((a) => ({ i: a.id, t: a.title, n: a.num, s: t(`help.sec.${a.section}`), k: a.keywords.join(' '), m: a.summary, x: a.plain.replace(/\s+/g, ' ').slice(0, 2400) }))
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  const main = `
      <div class="wrap">
        <section class="hero" aria-labelledby="hero-h">
          <p class="lbl hero-kicker">${esc(t('help.site.kicker'))}</p>
          <h1 id="hero-h" class="disp">${esc(t('help.site.heading'))}</h1>
          <p class="hero-lede">${esc(t('help.site.lede'))}</p>
          ${searchForm(lang, opts)}
          <p class="lbl hero-spec">${esc(t('help.spec', { sections: HELP_SECTIONS.length, articles: lib[lang].length }))}</p>
        </section>
        <section class="results" id="results" aria-live="polite" hidden>
          <p class="lbl results-count" data-count data-one="${esc(t('help.search.results.one'))}" data-other="${esc(t('help.search.results.other'))}" data-none="${esc(t('help.site.noResults'))}"></p>
          <ul class="rows" data-list></ul>
        </section>
        <div class="chaps" data-chapters>${chapters}
        </div>
      </div>
      <script type="application/json" id="help-data">${json}</script>`
  return frame({ lang, id: null, title: t('help.site.title'), description: t('help.site.description'), main, opts, twin: true })
}

function articlePage(lib: HelpLibrary, lang: HelpLang, a: HelpArticle, opts: SiteOptions): string {
  const t = tr(lang)
  const href = (id: string) => `${opts.base}${helpPath(lang, id)}`
  const home = `${opts.base}${helpPath(lang)}`
  const chapter = sectionArticles(lib, lang, a.section)
  const related = relatedArticles(lib, lang, a)
  const { prev, next } = neighbours(lib, lang, a)
  const other: HelpLang = lang === 'de' ? 'en' : 'de'
  const twin = lib[other].some((x) => x.id === a.id)
  const toc = chapter
    .map((x) => `<li><a href="${esc(href(x.id))}"${x.id === a.id ? ' aria-current="page"' : ''}><span class="row-num">${x.num}</span>${esc(x.title)}</a></li>`)
    .join('')
  const main = `
      <div class="wrap art-grid">
        <article class="art" aria-labelledby="art-h">
          <nav class="crumbs lbl" aria-label="${esc(t('help.crumbs'))}"><a href="${esc(home)}">${esc(t('help.home'))}</a><span aria-hidden="true">/</span><a href="${esc(`${home}#${a.section}`)}">§ ${sectionNum(a.section)} ${esc(t(`help.sec.${a.section}`))}</a></nav>
          <p class="lbl art-code">§ ${a.num} · ${esc(t('help.minutes', { n: a.minutes }))}</p>
          <h1 id="art-h" class="art-title">${esc(a.title)}</h1>
          ${a.summary ? `<p class="art-sum">${esc(a.summary)}</p>` : ''}
          <div class="doc">
${blocksHtml(a.blocks, href)}
          </div>
          ${
            related.length
              ? `<section class="related" aria-labelledby="rel-h"><h2 class="lbl" id="rel-h">${esc(t('help.related'))}</h2><ul class="rows">${related
                  .map((r) => `<li><a class="row" href="${esc(href(r.id))}"><span class="row-num">${r.num}</span><span class="row-main"><span class="row-title">${esc(r.title)}</span></span><span class="row-go" aria-hidden="true">→</span></a></li>`)
                  .join('')}</ul></section>`
              : ''
          }
          ${
            prev || next
              ? `<nav class="pager" aria-label="${esc(t('help.inSection'))}">${prev ? `<a class="pager-link" href="${esc(href(prev.id))}"><span class="lbl">← ${esc(t('help.prev'))} · ${prev.num}</span><span>${esc(prev.title)}</span></a>` : '<span></span>'}${next ? `<a class="pager-link pager-next" href="${esc(href(next.id))}"><span class="lbl">${esc(t('help.next'))} · ${next.num} →</span><span>${esc(next.title)}</span></a>` : ''}</nav>`
              : ''
          }
        </article>
        <aside class="side" aria-label="${esc(t('help.inSection'))}">
          ${searchForm(lang, opts, true)}
          <p class="lbl side-head">§ ${sectionNum(a.section)} — ${esc(t(`help.sec.${a.section}`))}</p>
          <ol class="side-list">${toc}</ol>
          <a class="lbl side-all" href="${esc(home)}">← ${esc(t('help.site.all'))}</a>
        </aside>
      </div>`
  return frame({ lang, id: a.id, title: `${a.title} — ${t('help.site.title')}`, description: a.summary || t('help.site.description'), main, opts, twin })
}

/** Every page of the public help: the index and each article, in both languages. */
export function renderHelpSite(lib: HelpLibrary, opts: SiteOptions): HelpPage[] {
  const pages: HelpPage[] = []
  for (const lang of HELP_LANGS) {
    pages.push({ file: `${helpPath(lang)}index.html`, html: indexPage(lib, lang, opts) })
    for (const a of lib[lang]) pages.push({ file: `${helpPath(lang, a.id)}index.html`, html: articlePage(lib, lang, a, opts) })
  }
  return pages
}
