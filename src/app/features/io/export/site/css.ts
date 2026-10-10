/**
 * Website export — the shared stylesheet (assets/site.css) and the bundled fonts.
 *
 * Colours come from the app's own design tokens (src/shared/tokens.css): "Paper" by default,
 * "Carbon" when the reader's system is dark. The fonts are the app's self-hosted Archivo and
 * JetBrains Mono files (Latin + Latin Extended), copied into assets/fonts/.
 */
import tokensCss from '@/shared/tokens.css?raw'
import archivoLatin from '@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2?url'
import archivoLatinExt from '@fontsource-variable/archivo/files/archivo-latin-ext-wdth-normal.woff2?url'
import monoLatin from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url'
import monoLatinExt from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-ext-wght-normal.woff2?url'

const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'

/** Font files of the site: path inside the zip → URL of the app's bundled file. */
export const SITE_FONTS: Array<{ path: string; url: string }> = [
  { path: 'assets/fonts/archivo-latin.woff2', url: archivoLatin },
  { path: 'assets/fonts/archivo-latin-ext.woff2', url: archivoLatinExt },
  { path: 'assets/fonts/jetbrains-mono-latin.woff2', url: monoLatin },
  { path: 'assets/fonts/jetbrains-mono-latin-ext.woff2', url: monoLatinExt },
]

const FONT_FACES = `
@font-face{font-family:'Archivo Variable';font-style:normal;font-display:swap;font-weight:100 900;font-stretch:62% 125%;src:url(fonts/archivo-latin-ext.woff2) format('woff2-variations'),url(fonts/archivo-latin-ext.woff2) format('woff2');unicode-range:${LATIN_EXT}}
@font-face{font-family:'Archivo Variable';font-style:normal;font-display:swap;font-weight:100 900;font-stretch:62% 125%;src:url(fonts/archivo-latin.woff2) format('woff2-variations'),url(fonts/archivo-latin.woff2) format('woff2');unicode-range:${LATIN}}
@font-face{font-family:'JetBrains Mono Variable';font-style:normal;font-display:swap;font-weight:100 800;src:url(fonts/jetbrains-mono-latin-ext.woff2) format('woff2-variations'),url(fonts/jetbrains-mono-latin-ext.woff2) format('woff2');unicode-range:${LATIN_EXT}}
@font-face{font-family:'JetBrains Mono Variable';font-style:normal;font-display:swap;font-weight:100 800;src:url(fonts/jetbrains-mono-latin.woff2) format('woff2-variations'),url(fonts/jetbrains-mono-latin.woff2) format('woff2');unicode-range:${LATIN}}
`

/** The app's tokens with the dark theme bound to the reader's system preference (screens only). */
function tokens(): string {
  return tokensCss
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/:root\[data-theme=['"]dark['"]\]\s*\{([^}]*)\}/, '@media screen and (prefers-color-scheme: dark){:root{$1}}')
    .replace(/\n\s*\n/g, '\n')
    .trim()
}

const COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']

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

const SITE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-padding-top:64px}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 var(--font-sans);-webkit-font-smoothing:antialiased;caret-color:var(--signal)}
img,svg{max-width:100%}
a{color:inherit;text-decoration:underline;text-decoration-color:var(--rule-strong);text-decoration-thickness:1px;text-underline-offset:3px}
a:hover{text-decoration-color:var(--signal)}
:focus-visible{outline:2px solid var(--signal);outline-offset:2px;border-radius:2px}
.label{font:500 10.5px/1.4 var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)}
.skip{position:absolute;left:12px;top:-60px;z-index:20;padding:8px 12px;background:var(--ink);color:var(--ink-inverse);border-radius:2px;font-size:13px;text-decoration:none}
.skip:focus{top:10px}

/* ---------- top bar ---------- */
.bar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:16px;height:52px;padding:0 20px;border-bottom:1px solid var(--rule-strong);background:var(--bg)}
.bar__brand{display:inline-flex;align-items:center;gap:10px;min-width:0;font-weight:700;font-size:14.5px;letter-spacing:-.01em;text-decoration:none}
.bar__mark{flex:none;position:relative;width:14px;height:14px;border-radius:2px;background:var(--signal)}
.bar__mark::after{content:'';position:absolute;left:3px;top:3px;width:3px;height:3px;border-radius:999px;background:var(--on-signal)}
.bar__title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar__spec{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.bar__sp{flex:1}
.bar__links{display:flex;gap:4px}
.bar__links a,.bar__menu{display:inline-flex;align-items:center;height:28px;padding:0 8px;border:1px solid transparent;border-radius:2px;text-decoration:none;font:500 10.5px/1 var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2)}
.bar__links a:hover,.bar__menu:hover{border-color:var(--rule-strong);color:var(--ink)}
.bar__menu{display:none;border-color:var(--rule-strong)}

/* ---------- layout ---------- */
.layout{display:grid;grid-template-columns:280px minmax(0,1fr);min-height:calc(100vh - 52px)}
.nav{position:sticky;top:52px;align-self:start;max-height:calc(100vh - 52px);overflow:auto;padding:24px 14px 48px 16px;font-size:13.5px;line-height:1.35}
.nav__head{display:flex;justify-content:space-between;padding:0 8px 10px;margin-bottom:6px;border-bottom:1px solid var(--rule)}
.nav ol{list-style:none;margin:0;padding:0}
.nav ol ol{margin:2px 0 4px 15px;padding-left:8px;border-left:1px solid var(--rule)}
.nav__link{display:flex;align-items:baseline;gap:8px;padding:5px 8px;border-radius:2px;text-decoration:none;color:var(--ink-2)}
.nav__link:hover{background:var(--hover);color:var(--ink)}
.nav__link[aria-current]{color:var(--ink);font-weight:650;background:var(--signal-wash);box-shadow:inset 2px 0 0 var(--signal)}
.nav__link.is-open{color:var(--ink)}
.nav__num{flex:none;min-width:22px;font:500 10px/1.6 var(--font-mono);letter-spacing:.04em;color:var(--ink-3)}
.nav__link[aria-current] .nav__num{color:var(--signal-ink)}
.nav__icon{flex:none;width:1.2em;text-align:center}
.nav__icon img{width:15px;height:15px;object-fit:contain;vertical-align:-2px}
.nav__title{flex:1;min-width:0;overflow-wrap:anywhere}
.nav__tag{flex:none;padding:1px 4px;border:1px solid var(--rule-strong);border-radius:2px;font:500 9px/1.3 var(--font-mono);letter-spacing:.06em;color:var(--ink-3)}
.main{min-width:0;background:var(--surface);display:flex;flex-direction:column;border-left:1px solid var(--rule-strong)}

/* ---------- page ---------- */
.cover{height:clamp(150px,26vh,280px);overflow:hidden;background:var(--surface-2);border-bottom:1px solid var(--rule)}
.cover img{display:block;width:100%;height:100%;object-fit:cover}
.sheet{width:100%;max-width:800px;margin:0 auto;padding:44px 40px 24px;flex:1}
.sheet--wide{max-width:1120px}
.crumbs ol{display:flex;flex-wrap:wrap;gap:2px 0;list-style:none;margin:0 0 18px;padding:0}
.crumbs li{display:flex;align-items:center;font:500 10.5px/1.6 var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)}
.crumbs li+li::before{content:'/';margin:0 8px;color:var(--ink-faint)}
.crumbs a{text-decoration:none}
.crumbs a:hover{color:var(--ink)}
.page-icon{font-size:52px;line-height:1;margin:0 0 14px}
.page-icon img{width:60px;height:60px;object-fit:contain;display:block}
.has-cover .page-icon{margin-top:-62px;position:relative}
h1.title{margin:0 0 14px;font-size:clamp(32px,5vw,48px);font-stretch:125%;font-weight:800;letter-spacing:-.02em;line-height:1.04;overflow-wrap:anywhere}
.meta{display:flex;flex-wrap:wrap;gap:4px 0;margin:0 0 30px;padding-bottom:12px;border-bottom:1.5px solid var(--ink)}
.meta>*+*::before{content:'·';margin:0 9px;color:var(--ink-faint)}
.meta a{text-decoration:none;color:var(--signal-ink)}
.meta a:hover{text-decoration:underline}
.meta b{font-weight:500;color:var(--signal-ink)}

/* ---------- row properties ---------- */
.props{display:grid;grid-template-columns:minmax(120px,30%) 1fr;margin:-22px 0 30px;border-bottom:1px solid var(--rule)}
.props dt:first-of-type,.props dt:first-of-type+dd{border-top:0}
.props dt,.props dd{margin:0;padding:7px 0;border-top:1px solid var(--rule)}
.props dt{padding-right:12px}
.props dd{font-size:14.5px;min-width:0;overflow-wrap:anywhere}
.chip{display:inline-block;margin:1px 4px 1px 0;padding:1px 7px;border-radius:2px;font-size:12.5px;line-height:1.6;background:var(--c-gray-bg);color:var(--ink);white-space:nowrap}
${COLORS.map((c) => `.chip--${c}{background:var(--c-${c}-bg)}`).join('')}
.check{font-family:var(--font-mono);color:var(--ink-3)}
.check[data-on]{color:var(--signal-ink)}
.stars{letter-spacing:.08em;color:var(--signal-ink)}

/* ---------- content ---------- */
.doc{font-size:16.5px;line-height:1.7}
.doc>*:first-child{margin-top:0}
.doc p{margin:0 0 .75em}
.doc h2,.doc h3,.doc h4{line-height:1.2;margin:1.7em 0 .5em;scroll-margin-top:64px}
.doc h2{font-size:1.65em;font-stretch:112%;font-weight:800;letter-spacing:-.015em}
.doc h3{font-size:1.3em;font-weight:750;letter-spacing:-.01em}
.doc h4{font-size:1.1em;font-weight:700}
.doc a{text-decoration-color:var(--signal)}
.doc ul,.doc ol{padding-left:1.4em;margin:0 0 .8em}
.doc li>p{margin:0 0 .25em}
.doc li::marker{color:var(--ink-3)}
.doc ul[data-type="taskList"]{list-style:none;padding-left:.1em}
.doc ul[data-type="taskList"] li{display:flex;gap:.6em;align-items:flex-start}
.doc ul[data-type="taskList"] li>label{flex:none;margin-top:.3em}
.doc ul[data-type="taskList"] li>label>span{display:none}
.doc ul[data-type="taskList"] li>div{flex:1;min-width:0}
.doc ul[data-type="taskList"] input{accent-color:var(--signal);width:14px;height:14px;margin:0}
.doc li[data-checked="true"]>div{color:var(--ink-3);text-decoration:line-through}
.doc blockquote{margin:0 0 1em;padding:.1em 0 .1em 1em;border-left:3px solid var(--ink);color:var(--ink-2);font-size:1.08em}
.doc code{font:.86em var(--font-mono);background:var(--surface-2);padding:.12em .35em;border-radius:2px;border:1px solid var(--rule)}
.doc pre{font:13.5px/1.6 var(--font-mono);background:var(--bg);border:1px solid var(--rule-strong);border-radius:4px;padding:14px 16px;overflow:auto;margin:0 0 1.1em}
.doc pre code{background:none;border:0;padding:0;font-size:inherit}
.doc hr{border:0;height:1px;background:var(--rule-strong);margin:2.2em 0}
.doc img{max-width:100%;height:auto;border-radius:2px;display:block;margin:0 auto}
.doc figure{margin:1.4em 0}
.doc figure[data-align="left"] img{margin-left:0}
.doc figure[data-align="right"] img{margin-right:0}
.doc figcaption{font-size:13px;color:var(--ink-3);text-align:center;margin-top:6px}
.doc table{border-collapse:collapse;width:100%;margin:0 0 1.1em;font-size:.92em;display:block;overflow-x:auto}
.doc th,.doc td{border:1px solid var(--rule-strong);padding:6px 10px;text-align:left;vertical-align:top;min-width:80px}
.doc th{background:var(--surface-2);font-weight:650}
.doc td p,.doc th p{margin:0}
.doc mark{background:var(--c-yellow-bg);color:inherit;padding:0 .12em;border-radius:2px}
${COLORS.map((c) => `.doc mark[data-color="${c}"]{background:var(--c-${c}-bg)}.doc span[data-color="${c}"]{color:var(--c-${c}-text)}`).join('')}
.doc .callout{display:flex;gap:12px;padding:14px 16px;margin:0 0 1.1em;border-radius:4px;background:var(--c-gray-bg)}
.doc .callout__icon{flex:none;font-size:1.15em;line-height:1.5}
.doc .callout__icon img{width:22px;height:22px;object-fit:contain;display:block;margin-top:2px}
.doc .callout__body{flex:1;min-width:0}
.doc .callout__body>:last-child{margin-bottom:0}
${COLORS.map((c) => `.doc .callout--${c}{background:var(--c-${c}-bg)}`).join('')}
.doc .columns{display:grid;grid-template-columns:repeat(var(--cols,2),minmax(0,1fr));gap:28px;margin:0 0 1em}
.doc details{margin:0 0 .8em;padding:2px 0 2px 12px;border-left:1px solid var(--rule-strong)}
.doc details>summary{cursor:pointer;font-weight:650}
.doc details>summary::marker{color:var(--signal-ink)}
.doc details[open]>summary{margin-bottom:.5em}
.doc details[data-heading]{margin-top:1.4em}
.doc details[data-heading]>summary>:is(h2,h3,h4){display:inline;margin:0}
.doc .media-block{max-width:100%}
.doc .media-block[data-align="center"]{margin-left:auto;margin-right:auto}
.doc .media-block[data-align="right"]{margin-left:auto}
.doc .media-block video{display:block;width:100%;height:auto;border:1px solid var(--rule-strong);border-radius:4px;background:var(--surface-2)}
.doc .media-block audio{display:block;width:100%}
${tabsCss('.doc')}
.doc .katex{font-size:1.05em}
.doc [data-type="block-math"]{display:block;margin:1.2em 0;overflow-x:auto;text-align:center}
.doc math[display="block"]{font-size:1.15em}
.doc .bookmark{display:flex;flex-direction:column;gap:2px;padding:12px 14px;border:1px solid var(--rule-strong);border-radius:4px;margin:0 0 1em}
.doc .bookmark a{font-weight:650;text-decoration:none}
.doc .bookmark a:hover{text-decoration:underline}
.doc .bookmark__url{font:11px var(--font-mono);color:var(--ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.doc .page-link,.doc .file-block{margin:0 0 .5em}
.doc .page-link a,.doc .page-link span,.doc .file-block a,.doc .file-block span{display:inline-flex;align-items:center;gap:8px;font-weight:600}
.doc .page-link a{text-decoration:none;border-bottom:1px solid var(--rule-strong)}
.doc .page-link a:hover{border-color:var(--signal)}
.doc .page-link a::after{content:'→';font:600 12px var(--font-mono);color:var(--signal-ink)}
.doc .page-link__off{color:var(--ink-2)}
.doc .file-block a::before,.doc .file-block span::before{content:'⎙';color:var(--signal-ink)}
.doc .mention a{font-weight:550}
.doc .one-button{margin:0 0 1em}
.doc .one-button__key{display:inline-flex;align-items:center;height:34px;padding:0 15px;border:1px solid var(--signal-press);border-bottom-width:3px;border-radius:2px;background:var(--signal);color:var(--on-signal);font-weight:650;font-size:14.5px}
.doc .one-button--ink .one-button__key{background:var(--ink);border-color:var(--ink);color:var(--ink-inverse)}
.doc .one-button--ghost .one-button__key{background:var(--surface);border-color:var(--ink-faint);color:var(--ink)}
.doc .toc{margin:0 0 1.4em;padding:10px 14px;border-left:2px solid var(--signal);background:var(--bg)}
.doc .toc:empty{display:none}
.doc .toc a{display:block;padding:2px 0;font-size:14px;text-decoration:none}
.doc .toc a:hover{color:var(--signal-ink)}
.doc .toc .l3{padding-left:14px}.doc .toc .l4{padding-left:28px}
.doc [data-type="mermaid"]{margin:0 0 1.2em}
.doc pre.mermaid{text-align:left}
.doc figure.diagram{margin:0;overflow-x:auto;text-align:center}
.doc figure.diagram svg{max-width:100%;height:auto}
.doc .diagram--dark{display:none}
@media screen and (prefers-color-scheme: dark){.doc .diagram--dark{display:block}.doc .diagram--light{display:none}}

/* ---------- databases ---------- */
.dbx{margin:0 0 1.4em}
.dbx__head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 0 6px}
.dbx__title{font-weight:700;font-size:15px}
.dbx__title a{text-decoration:none}
.dbx__title a:hover{text-decoration:underline}
.dbt-wrap{overflow-x:auto;border-top:1.5px solid var(--ink)}
.dbt{width:100%;border-collapse:collapse;font-size:13.5px;display:table !important;margin:0 !important}
.dbt th{text-align:left;font:500 10px/1.3 var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);padding:9px 10px;border:0 !important;border-bottom:1px solid var(--rule-strong) !important;background:none !important;white-space:nowrap}
.dbt td{padding:8px 10px;border:0 !important;border-bottom:1px solid var(--rule) !important;vertical-align:top;white-space:nowrap;min-width:0 !important}
.dbt td:first-child{white-space:normal;min-width:180px !important;font-weight:600}
.dbt td:first-child a{text-decoration:none}
.dbt td:first-child a:hover{text-decoration:underline;text-decoration-color:var(--signal)}
.dbt tbody tr:hover td{background:var(--hover)}
.dbt .num{font-variant-numeric:tabular-nums}

/* ---------- sub pages ---------- */
.sub{margin:44px 0 0}
.sub__head{padding-bottom:8px;border-bottom:1.5px solid var(--ink)}
.sub ol{list-style:none;margin:0;padding:0}
.sub li a{display:grid;grid-template-columns:44px 1fr;gap:2px 10px;padding:12px 0;border-bottom:1px solid var(--rule);text-decoration:none}
.sub li a:hover .sub__title{text-decoration:underline;text-decoration-color:var(--signal)}
.sub__num{font:500 10.5px/1.9 var(--font-mono);color:var(--ink-3)}
.sub__title{font-weight:650}
.sub__excerpt{grid-column:2;color:var(--ink-2);font-size:14px;line-height:1.5}

/* ---------- home (index) ---------- */
.hero{padding:56px 40px 30px;max-width:1080px;width:100%;margin:0 auto}
.hero__title{margin:14px 0 14px;font-size:clamp(42px,8vw,88px);font-stretch:125%;font-weight:850;letter-spacing:-.03em;line-height:.96;overflow-wrap:anywhere}
.hero__lede{max-width:60ch;margin:0 0 26px;color:var(--ink-2);font-size:18px;line-height:1.55}
.hero__stats{display:flex;flex-wrap:wrap;gap:6px 26px;padding:12px 0 0;border-top:1.5px solid var(--ink)}
.hero__stats b{color:var(--ink);font-weight:600}
.ruler{height:9px;margin-top:6px;background-image:repeating-linear-gradient(to right,var(--rule-strong) 0 1px,transparent 1px 8px);background-size:100% 5px;background-repeat:no-repeat;position:relative}
.ruler::before{content:'';position:absolute;left:0;top:0;width:40px;height:9px;border-left:2px solid var(--signal)}
.cards{list-style:none;margin:0 auto;padding:10px 40px 20px;max-width:1080px;width:100%;display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}
.card{display:flex;flex-direction:column;height:100%;border:1px solid var(--rule-strong);border-radius:4px;background:var(--surface);text-decoration:none;overflow:hidden;transition:border-color 90ms,transform 90ms}
.card:hover{border-color:var(--ink)}
.card:active{transform:translateY(1px)}
.card__cover{height:96px;background:var(--surface-2);border-bottom:1px solid var(--rule)}
.card__cover img{width:100%;height:100%;object-fit:cover;display:block}
.card__body{display:flex;flex-direction:column;gap:6px;padding:12px 14px 14px;flex:1}
.card__top{display:flex;justify-content:space-between;align-items:center}
.card__top .label:last-child{color:var(--signal-ink)}
.card__title{display:flex;gap:8px;align-items:baseline;font-weight:750;font-size:17px;line-height:1.25;letter-spacing:-.01em}
.card__title img{width:18px;height:18px;object-fit:contain;vertical-align:-3px}
.card__excerpt{margin:0;color:var(--ink-2);font-size:13.5px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.card__rows{display:flex;flex-direction:column;border-top:1px solid var(--rule);margin-top:2px}
.card__rows span{padding:5px 0;border-bottom:1px solid var(--rule);font-size:13px;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card__meta{margin-top:auto;padding-top:6px}
.recent{max-width:1080px;width:100%;margin:0 auto;padding:26px 40px 10px}
.recent__head{padding-bottom:8px;border-bottom:1.5px solid var(--ink)}
.recent ol{list-style:none;margin:0;padding:0}
.recent li a{display:grid;grid-template-columns:110px 1fr auto;gap:12px;align-items:baseline;padding:10px 0;border-bottom:1px solid var(--rule);text-decoration:none}
.recent li a:hover .recent__title{text-decoration:underline;text-decoration-color:var(--signal)}
.recent__title{font-weight:600}
.lost{max-width:620px;margin:0 auto;padding:12vh 40px}
.lost__code{color:var(--signal-ink)}
.lost h1{margin:10px 0 12px;font-size:clamp(36px,6vw,56px);font-stretch:125%;font-weight:850;letter-spacing:-.025em;line-height:1}
.lost p{color:var(--ink-2)}
.btn{display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 14px;border-radius:2px;background:var(--ink);color:var(--ink-inverse);font-weight:600;font-size:14px;text-decoration:none}
.btn:active{transform:translateY(1px)}

/* ---------- footer ---------- */
.foot{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px 20px;max-width:800px;width:100%;margin:40px auto 0;padding:16px 40px 40px;border-top:1px solid var(--rule)}
.home .foot,.sheet--wide+.foot{max-width:1120px}
.foot a{text-decoration:none}
.foot a:hover{color:var(--ink)}
.foot nav{display:flex;gap:14px}

/* ---------- small screens ---------- */
@media (max-width:900px){
  .layout{grid-template-columns:minmax(0,1fr)}
  .nav{position:static;order:2;max-height:none;border-top:1.5px solid var(--ink);padding:22px 16px 36px;background:var(--bg)}
  .main{order:1;border-left:0}
  .bar__menu{display:inline-flex}
  .bar__links,.bar__spec{display:none}
}
@media (max-width:640px){
  .bar{padding:0 12px 0 16px;gap:10px}
  .sheet{padding:28px 16px 16px}
  .hero{padding:36px 16px 22px}
  .cards{padding:8px 16px 16px;grid-template-columns:minmax(0,1fr)}
  .recent{padding:20px 16px 8px}
  .recent li a{grid-template-columns:minmax(0,1fr) auto}
  .recent li a .recent__date{grid-column:1 / -1}
  .foot{padding:14px 16px 32px;margin-top:28px}
  .lost{padding:10vh 16px}
  .props{grid-template-columns:minmax(0,1fr)}
  .props dd{border-top:0;padding-top:0}
  .doc{font-size:16px}
  .doc .columns{grid-template-columns:minmax(0,1fr);gap:4px}
  .has-cover .page-icon{margin-top:-48px}
  .page-icon{font-size:44px}
}
@media print{
  .bar,.nav,.skip,.foot nav,.ruler{display:none !important}
  body,.main{background:none}
  .layout{display:block}
  .sheet,.hero,.cards,.recent{max-width:none;padding:0}
  .cover{height:180px;border:0}
  .meta a{color:inherit}
  a{text-decoration:none}
  .doc pre,.doc blockquote,.doc .callout,.doc table,.doc figure,.doc img,.card{break-inside:avoid}
  .doc h2,.doc h3,.doc h4{break-after:avoid}
  .dbt td{white-space:normal}
  .dbt-wrap{overflow:visible}
  @page{margin:16mm 15mm 18mm}
}
@media (prefers-reduced-motion:reduce){*{transition:none !important}}
`

/** The complete assets/site.css. `extra`: CSS the editor contributes for its blocks (the task placard). */
export function siteCss(extra = ''): string {
  return `/* Published with SimpleCMS One — INSTRUMENT */\n${FONT_FACES.trim()}\n${tokens()}\n${SITE_CSS.trim()}\n${extra ? `${extra.trim()}\n` : ''}`
}
