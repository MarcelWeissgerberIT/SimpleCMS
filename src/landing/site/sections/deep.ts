import { BRAND } from '@/shared/brand'
import type { Ctx } from '../context'
import { aiSchematic, automationSchematic, databaseSchematic, graphSchematic } from '../figures'
import { CROPS, frame } from '../frame'
import type { DeepDive } from '../messages'
import { esc } from '../util'
import { dotted } from './hero'
import { sectionHead } from './head'

/**
 * The webhook body, shaped exactly like `buildPayload()` in src/app/features/automations/engine.ts
 * (WebhookPayload): every property value is display text, `changes` is an array. Keep in sync.
 */
const PAYLOAD = {
  event: 'property_changed',
  automation: { id: 'q7m2xk9v4c1d', name: 'Won deals to n8n' },
  database: { id: 'b3n8w5t2pj6r', title: 'Leads' },
  row: {
    id: '8f3k2q7hv5ma',
    title: 'ACME GmbH',
    url: 'https://you.github.io/SimpleCMS/app/#/p/8f3k2q7hv5ma',
    properties: { Name: 'ACME GmbH', Status: 'Won', Value: '12,000', Owner: 'Marcel' },
  },
  changes: [{ property: 'Status', from: 'Negotiation', to: 'Won' }],
  timestamp: '2026-10-02T09:41:07.000Z',
  source: 'simplecms-one',
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
        ['01', 'Notion', 'Einstellungen → Export → Markdown & CSV'],
        ['02', 'One', 'Importieren → .zip hineinziehen'],
        ['03', 'Fertig', 'Seiten, Verschachtelung, Datenbanken'],
      ]
    : [
        ['01', 'Notion', 'Settings → Export → Markdown & CSV'],
        ['02', 'One', 'Import → drop the .zip'],
        ['03', 'Done', 'Pages, nesting, databases'],
      ]
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
    </ol>
  </div>
  </div>
  <figcaption class="frame-cap lbl"><span>${esc(d.fig)}</span><span>t ≤ 60 s</span></figcaption>
</figure>`
}

function figureFor(ctx: Ctx, d: DeepDive): string {
  const { lang } = ctx
  switch (d.key) {
    case 'database':
      return frame({ shot: 'assets/shots/database.webp', alt: d.fig, schematic: databaseSchematic(lang, d.fig), caption: d.fig, meta: '1600 × 1000' })
    case 'ai':
      return frame({ shot: 'assets/shots/ai.webp', alt: d.fig, schematic: aiSchematic(lang, d.fig), caption: d.fig, meta: '1600 × 1000' })
    case 'graph':
      return frame({ shot: 'assets/shots/graph.webp', alt: d.fig, schematic: graphSchematic(lang, d.fig), caption: d.fig, meta: '1600 × 1000' })
    case 'automations':
      return `<div class="fig-stack">${frame({
        shot: 'assets/shots/automations.webp',
        alt: d.fig,
        schematic: automationSchematic(lang, d.fig),
        caption: d.fig,
        meta: '1600 × 1000',
        extraClass: 'frame-under',
      })}${codeBlock(ctx)}</div>`
    case 'import':
      return importFigure(ctx, d)
  }
}

export function renderDeep(ctx: Ctx): string {
  const { t, c } = ctx
  const rows = c.deep
    .map(
      (d, i) => `
    <article class="deep-row ${i % 2 ? 'is-flip' : ''} ${d.key === 'automations' ? 'is-tall' : ''}" aria-labelledby="deep-${d.key}">
      <div class="deep-text" data-reveal>
        <p class="lbl deep-idx">§ 03.${i + 1}</p>
        <h3 id="deep-${d.key}" class="deep-h disp">${dotted(d.title)}</h3>
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
