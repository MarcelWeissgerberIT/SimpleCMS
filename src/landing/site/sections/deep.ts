import { BRAND } from '@/shared/brand'
import type { Ctx } from '../context'
import { aiSchematic, automationSchematic, databaseSchematic, websiteSchematic } from '../figures'
import { CROPS, frame, tabbedFrame } from '../frame'
import type { DeepDive } from '../messages'
import { esc } from '../util'
import { dotted } from './hero'
import { sectionHead } from './head'

/**
 * The webhook body, shaped exactly like `buildPayload()` in src/app/features/automations/engine.ts
 * (WebhookPayload) + the `deliveryId` lib/webhook.ts adds when sending: every property value is display
 * text, `changes` is an array. Keep in sync.
 */
const PAYLOAD = {
  event: 'property_changed',
  automation: { id: 'q7m2xk9v4c1d', name: 'Won deals to n8n' },
  database: { id: 'b3n8w5t2pj6r', title: 'Leads' },
  row: {
    id: '8f3k2q7hv5ma',
    title: 'ACME GmbH',
    url: 'https://getonecms.com/app/#/p/8f3k2q7hv5ma',
    properties: { Name: 'ACME GmbH', Status: 'Won', Value: '12,000', Owner: 'Marcel' },
  },
  changes: [{ property: 'Status', from: 'Negotiation', to: 'Won' }],
  timestamp: '2026-10-03T09:41:07.000Z',
  source: 'simplecms-one',
  deliveryId: 'V1StGXR8_Z5jdHi6B-myT',
}

/** Minimal JSON syntax colouring → spans. */
function highlightJson(value: unknown): string {
  const json = JSON.stringify(value, null, 2)
  return esc(json).replace(
    /(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(-?\d+(?:\.\d+)?)\b|([{}[\],])/g,
    (m, str: string | undefined, colon: string | undefined, num: string | undefined, punct: string | undefined) => {
      if (str) return colon ? `<span class="j-k">${str}</span><span class="j-p">${colon}</span>` : `<span class="j-s">${str}</span>`
      if (num) return `<span class="j-n">${num}</span>`
      if (punct) return `<span class="j-p">${punct}</span>`
      return m
    },
  )
}

function codeBlock(ctx: Ctx): string {
  const lines = JSON.stringify(PAYLOAD, null, 2).split('\n').length
  const nums = Array.from({ length: lines }, (_, i) => `<span>${String(i + 1).padStart(2, '0')}</span>`).join('')
  return `
<figure class="code tone-carbon">
  <figcaption class="code-head lbl">
    <span><span class="led led-on" aria-hidden="true"></span> POST /webhook/leads</span>
    <span>application/json</span>
  </figcaption>
  <div class="code-body">
    <div class="code-nums" aria-hidden="true">${nums}</div>
    <pre tabindex="0"><code>${highlightJson(PAYLOAD)}</code></pre>
  </div>
  <div class="code-foot lbl"><span>→ n8n · Make · Zapier</span><span>${ctx.lang === 'de' ? '200 OK · 0,21 s' : '200 OK · 0.21 s'}</span></div>
</figure>`
}


/** What a website export of the "Team wiki" page writes (see features/io/export/site/build.ts). */
const SITE_TREE: Array<[string, string?]> = [
  ['index.html', '.md'],
  ['brand-voice/index.html', '.md'],
  ['onboarding/index.html', '.md'],
  ['glossary/index.html', '.md'],
  ['sitemap.xml', 'search engines'],
  ['rss.xml', 'feed readers'],
  ['llms.txt', 'AI assistants'],
  ['llms-full.txt · robots.txt · 404.html'],
  ['assets/  site.css · fonts'],
]

function siteTree(ctx: Ctx): string {
  const de = ctx.lang === 'de'
  const notes: Record<string, string> = de ? { 'search engines': 'Suchmaschinen', 'feed readers': 'Feed-Reader', 'AI assistants': 'KI-Assistenten' } : {}
  const rows = SITE_TREE.map(([file, note], i) => {
    const glyph = i === SITE_TREE.length - 1 ? '└─' : '├─'
    const twin = note === '.md' ? `<span class="j-p"> + .md</span>` : ''
    const comment = note && note !== '.md' ? `<span class="j-p">  # ${esc(notes[note] ?? note)}</span>` : ''
    const cls = /^(sitemap|rss|llms)\.(xml|txt)$/.test(file) ? 'j-s' : 'j-k'
    return `<span class="j-p">${glyph}</span> <span class="${cls}">${esc(file)}</span>${twin}${comment}`
  }).join('\n')
  const count = 23
  return `
<figure class="code code-tree tone-carbon">
  <figcaption class="code-head lbl">
    <span><span class="led led-on" aria-hidden="true"></span> acme-handbook-site.zip</span>
    <span>${de ? `${count} Dateien` : `${count} files`}</span>
  </figcaption>
  <div class="code-body code-body-flat">
    <pre tabindex="0" aria-label="${de ? 'Dateien der exportierten Website' : 'Files of the exported website'}"><code><span class="j-k">handbook.acme.studio/</span>\n${rows}</code></pre>
  </div>
  <div class="code-foot lbl"><span>→ GitHub Pages · Netlify · ${de ? 'jeder Host' : 'any host'}</span><span>${de ? 'Server: 0' : 'Servers: 0'}</span></div>
</figure>`
}

function importFigure(ctx: Ctx, d: DeepDive): string {
  const de = ctx.lang === 'de'
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const a = (i / 60) * Math.PI * 2
    const major = i % 5 === 0
    const r1 = major ? 128 : 136
    const x1 = 160 + Math.sin(a) * r1
    const y1 = 160 - Math.cos(a) * r1
    const x2 = 160 + Math.sin(a) * 146
    const y2 = 160 - Math.cos(a) * 146
    return `<line class="${major ? 'sw-major' : 'sw-minor'}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`
  }).join('')
  const nums = [0, 15, 30, 45]
    .map((n) => {
      const a = (n / 60) * Math.PI * 2
      // r=90: well inside the sweep arc (r=118) so neither the arc nor the hand crosses a numeral.
      return `<text class="sw-num" x="${(160 + Math.sin(a) * 90).toFixed(1)}" y="${(165 - Math.cos(a) * 90).toFixed(1)}">${n === 0 ? 60 : n}</text>`
    })
    .join('')
  const steps = de
    ? [
        ['01', 'Exportieren', 'Aus Notion, Obsidian, Evernote oder Trello'],
        ['02', 'Importieren', '.zip, Vault, .enex oder Board in One ziehen'],
        ['03', 'Fertig', 'Seiten, Verschachtelung, Datenbanken'],
      ]
    : [
        ['01', 'Export', 'From Notion, Obsidian, Evernote or Trello'],
        ['02', 'Import', 'Drop the .zip, vault, .enex or board into One'],
        ['03', 'Done', 'Pages, nesting, databases'],
      ]
  const sources = ['Notion', 'Obsidian', 'Evernote', 'Trello', 'HTML', 'MD', 'CSV']
  return `
<figure class="frame frame-import">
  <div class="frame-box">
  ${CROPS}
  <div class="frame-media import-media">
    <svg class="stopwatch" viewBox="0 0 320 340" role="img" aria-label="${de ? 'Stoppuhr bei 58 Sekunden' : 'Stopwatch at 58 seconds'}">
      <rect class="sw-crown" x="146" y="0" width="28" height="14" rx="2"/>
      <circle class="sw-face" cx="160" cy="160" r="150" transform="translate(0 14)"/>
      <g transform="translate(0 14)">
        ${ticks}${nums}
        <path class="sw-sweep" d="M160 42 A118 118 0 1 1 ${(160 + Math.sin((58 / 60) * Math.PI * 2) * 118).toFixed(1)} ${(160 - Math.cos((58 / 60) * Math.PI * 2) * 118).toFixed(1)}"/>
        <line class="sw-hand" x1="160" y1="160" x2="${(160 + Math.sin((58 / 60) * Math.PI * 2) * 132).toFixed(1)}" y2="${(160 - Math.cos((58 / 60) * Math.PI * 2) * 132).toFixed(1)}"/>
        <circle class="sw-hub" cx="160" cy="160" r="7"/>
        <text class="sw-read" x="160" y="222">00:58</text>
      </g>
    </svg>
    <ol class="import-steps">
      ${steps.map(([n, h, p]) => `<li><span class="lbl">${n}</span><b>${esc(h)}</b><span>${esc(p)}</span></li>`).join('')}
      <li class="import-file"><span class="lbl">notion-export.zip</span><span class="import-bar"><i></i></span><span class="lbl">${de ? '128 Seiten · 6 Datenbanken' : '128 pages · 6 databases'}</span></li>
      <li class="import-src" aria-label="${de ? 'Quellen' : 'Sources'}">${sources.map((x, i) => `<span class="lbl${i === 0 ? ' is-on' : ''}">${x}</span>`).join('')}</li>
    </ol>
  </div>
  </div>
  <figcaption class="frame-cap lbl"><span>${esc(d.fig)}</span><span>t ≤ 60 s</span></figcaption>
</figure>`
}

const SCHEMATIC: Record<Exclude<DeepDive['key'], 'import'>, (lang: Ctx['lang'], label: string) => string> = {
  database: databaseSchematic,
  ai: aiSchematic,
  automations: automationSchematic,
  website: websiteSchematic,
}

function figureFor(ctx: Ctx, d: DeepDive): string {
  if (d.key === 'import') return importFigure(ctx, d)
  const { lang, t } = ctx
  const schematic = SCHEMATIC[d.key](lang, d.fig)
  const zoom = t('fig.enlarge')
  const shots = d.shots.map((s) => ({ shot: s.shot, tab: s.tab, caption: s.fig }))
  const fig =
    shots.length > 1
      ? tabbedFrame({ id: `fig-${d.key}`, shots, schematic, label: `${d.fig} — ${t('fig.views')}`, meta: '1600 × 1000', zoom, extraClass: 'frame-under' })
      : frame({ shot: `assets/shots/${shots[0].shot}.webp`, alt: shots[0].caption, schematic, caption: shots[0].caption, meta: '1600 × 1000', zoom, extraClass: 'frame-under' })
  if (d.key === 'automations') return `<div class="fig-stack">${fig}${codeBlock(ctx)}</div>`
  if (d.key === 'website') return `<div class="fig-stack">${fig}${siteTree(ctx)}</div>`
  return fig
}

/** "\n" marks a line break; only the last line gets the orange full stop (like section titles). */
function titleLines(title: string): string {
  const parts = title.split('\n')
  return parts.map((p, i) => (i === parts.length - 1 ? dotted(p) : esc(p))).join('<br />')
}

export function renderDeep(ctx: Ctx): string {
  const { t, c } = ctx
  const rows = c.deep
    .map(
      (d, i) => `
    <article class="deep-row ${i % 2 ? 'is-flip' : ''} ${d.key === 'automations' || d.key === 'website' ? 'is-tall' : ''}" aria-labelledby="deep-${d.key}">
      <div class="deep-text" data-reveal>
        <p class="lbl deep-idx">§ 03.${i + 1}</p>
        <h3 id="deep-${d.key}" class="deep-h disp">${titleLines(d.title)}</h3>
        <p class="deep-p">${esc(d.text)}</p>
        <ul class="deep-specs">${d.specs.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
        ${d.key === 'import' ? `<a class="btn btn-ink" href="${BRAND.appHref}?import">${esc(t('hero.import'))}<span class="arr" aria-hidden="true">→</span></a>` : ''}
      </div>
      <div class="deep-fig" data-reveal>${figureFor(ctx, d)}</div>
    </article>`,
    )
    .join('')
  return `
<section id="up-close" class="sec sec-deep" data-tone="paper" aria-labelledby="up-close-h">
  <div class="wrap">
    ${sectionHead('up-close', t('deep.label'), t('deep.title'))}
    <div class="deep">${rows}</div>
  </div>
</section>`
}
