import type { Ctx } from '../context'
import { esc, prefersReducedMotion } from '../util'
import { sectionHead } from './head'

type T = Ctx['t']

const packet = (path: string, dur: number, delay: number, motion: boolean) =>
  motion
    ? `<circle class="pv-packet" r="4"><animateMotion dur="${dur}s" begin="${delay}s" repeatCount="indefinite" path="${path}" keyPoints="0;1" keyTimes="0;1" calcMode="linear"/></circle>`
    : ''

function cylinder(cx: number, top: number, rx: number, h: number): string {
  const ry = rx * 0.2
  return `<path class="pv-db" d="M${cx - rx} ${top} V${top + h} A${rx} ${ry} 0 0 0 ${cx + rx} ${top + h} V${top} Z"/>
    <ellipse class="pv-db-top" cx="${cx}" cy="${top}" rx="${rx}" ry="${ry}"/>
    <path class="pv-db-ring" d="M${cx - rx} ${top + h * 0.22} A${rx} ${ry} 0 0 0 ${cx + rx} ${top + h * 0.22}"/>`
}

function crossedBox(x: number, y: number, w: number, h: number, t: T, idp: string): string {
  return `<g class="pv-none">
    <rect class="pv-hatch-box" x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${idp}-hatch)"/>
    <line class="pv-x" x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}"/><line class="pv-x" x1="${x + w}" y1="${y}" x2="${x}" y2="${y + h}"/>
    <rect class="pv-label-bg" x="${x + w / 2 - 110}" y="${y + h / 2 - 22}" width="220" height="44"/>
    <text class="pv-t pv-strong" x="${x + w / 2}" y="${y + h / 2 - 2}" text-anchor="middle">${esc(t('privacy.servers'))}</text>
    <text class="pv-m pv-sig" x="${x + w / 2}" y="${y + h / 2 + 15}" text-anchor="middle">${esc(t('privacy.serversNote').toUpperCase())}</text>
  </g>`
}

function defs(idp: string): string {
  return `<defs>
    <pattern id="${idp}-hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line class="pv-hatch" x1="0" y1="0" x2="0" y2="10"/></pattern>
    <marker id="${idp}-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="pv-arrow" d="M0 0 L10 5 L0 10 z"/></marker>
    <marker id="${idp}-arr-sig" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="pv-arrow-sig" d="M0 0 L10 5 L0 10 z"/></marker>
  </defs>`
}

function appBox(x: number, y: number, w: number, h: number, t: T): string {
  return `<g class="pv-app">
    <rect class="pv-app-box" x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>
    <rect class="pv-app-tag" x="${x + 18}" y="${y + 18}" width="22" height="22" rx="2"/><circle class="pv-app-hole" cx="${x + 23.5}" cy="${y + 23.5}" r="2"/>
    <text class="pv-t pv-inv pv-strong" x="${x + 52}" y="${y + 35}">${esc(t('privacy.app'))}</text>
    <text class="pv-m pv-inv-dim" x="${x + 18}" y="${y + h - 22}">EDITOR · DB · SEARCH · AI UI</text>
  </g>`
}

function wide(t: T, motion: boolean): string {
  const idp = 'pvw'
  const loopA = 'M314 232 H414'
  const loopB = 'M414 268 H314'
  const toAi = 'M190 168 V112 H818'
  const toHook = 'M190 324 V398 H818'
  return `<svg class="pv-svg pv-wide" viewBox="0 0 1200 610" role="img" aria-label="${esc(t('privacy.alt'))}">
    ${defs(idp)}
    <rect class="pv-frame" x="20" y="40" width="660" height="420" rx="6"/>
    <line class="pv-rule" x1="20" y1="82" x2="680" y2="82"/>
    <text class="pv-m pv-dim" x="44" y="67">${esc(t('privacy.browser').toUpperCase())}</text>
    <text class="pv-m pv-dim" x="656" y="67" text-anchor="end">LOCALHOST: ∅ · CLOUD: ∅</text>
    ${appBox(70, 170, 244, 152, t)}
    <path class="pv-wire-sig" d="${loopA}" marker-end="url(#${idp}-arr-sig)"/>
    <path class="pv-wire-sig" d="${loopB}" marker-end="url(#${idp}-arr-sig)"/>
    ${packet(loopA, 1.6, 0, motion)}${packet(loopB, 1.6, 0.8, motion)}
    ${cylinder(520, 186, 96, 128)}
    <text class="pv-t pv-strong" x="520" y="266" text-anchor="middle">${esc(t('privacy.idb'))}</text>
    <text class="pv-m pv-dim" x="520" y="290" text-anchor="middle">${esc(t('privacy.idbNote').toUpperCase())}</text>
    <path class="pv-wire-opt" d="${toAi}" marker-end="url(#${idp}-arr)"/>
    <path class="pv-wire-opt" d="${toHook}" marker-end="url(#${idp}-arr)"/>
    ${packet(toAi, 3.2, 0.3, motion)}${packet(toHook, 3.2, 1.9, motion)}
    <rect class="pv-ext" x="820" y="62" width="350" height="100" rx="4"/>
    <text class="pv-t pv-strong" x="844" y="102">${esc(t('privacy.anthropic'))}</text>
    <text class="pv-m pv-dim" x="844" y="128">${esc(t('privacy.anthropicNote').toUpperCase())}</text>
    <rect class="pv-ext" x="820" y="348" width="350" height="100" rx="4"/>
    <text class="pv-t pv-strong" x="844" y="388">${esc(t('privacy.hooks'))}</text>
    <text class="pv-m pv-dim" x="844" y="414">${esc(t('privacy.hooksNote').toUpperCase())}</text>
    <path class="pv-wire-dead" d="M350 460 V540 H700"/>
    <path class="pv-cut" d="M708 526 L720 554 M720 526 L732 554"/>
    <path class="pv-wire-dead" d="M740 540 H818"/>
    ${crossedBox(820, 496, 350, 88, t, idp)}
    <g class="pv-legend" transform="translate(20 520)">
      <line class="pv-wire-sig" x1="0" y1="0" x2="36" y2="0"/><text class="pv-m pv-dim" x="46" y="4">${esc(t('privacy.solid').toUpperCase())}</text>
      <line class="pv-wire-opt" x1="0" y1="26" x2="36" y2="26"/><text class="pv-m pv-dim" x="46" y="30">${esc(t('privacy.dashed').toUpperCase())}</text>
      <path class="pv-cut" d="M8 40 L14 60 M18 40 L24 60"/><text class="pv-m pv-dim" x="46" y="56">${esc(t('privacy.none').toUpperCase())}</text>
    </g>
  </svg>`
}

function tall(t: T, motion: boolean): string {
  const idp = 'pvt'
  const loopA = 'M182 204 V268'
  const loopB = 'M218 268 V204'
  const toAi = 'M60 204 V556'
  const toHook = 'M340 204 V556'
  return `<svg class="pv-svg pv-tall" viewBox="0 0 400 846" role="img" aria-label="${esc(t('privacy.alt'))}">
    ${defs(idp)}
    <rect class="pv-frame" x="10" y="16" width="380" height="440" rx="6"/>
    <line class="pv-rule" x1="10" y1="56" x2="390" y2="56"/>
    <text class="pv-m pv-dim" x="28" y="42">${esc(t('privacy.browser').toUpperCase())}</text>
    ${appBox(40, 84, 320, 120, t)}
    <path class="pv-wire-sig" d="${loopA}" marker-end="url(#${idp}-arr-sig)"/>
    <path class="pv-wire-sig" d="${loopB}" marker-end="url(#${idp}-arr-sig)"/>
    ${packet(loopA, 1.4, 0, motion)}${packet(loopB, 1.4, 0.7, motion)}
    ${cylinder(200, 290, 122, 120)}
    <text class="pv-t pv-strong" x="200" y="366" text-anchor="middle">${esc(t('privacy.idb'))}</text>
    <text class="pv-m pv-dim" x="200" y="390" text-anchor="middle">${esc(t('privacy.idbNote').toUpperCase())}</text>
    <path class="pv-wire-opt" d="${toAi}" marker-end="url(#${idp}-arr)"/>
    <path class="pv-wire-opt" d="${toHook}" marker-end="url(#${idp}-arr)"/>
    ${packet(toAi, 3, 0.2, motion)}${packet(toHook, 3, 1.6, motion)}
    <rect class="pv-ext" x="10" y="560" width="178" height="116" rx="4"/>
    <text class="pv-t pv-strong" x="24" y="592">${esc(t('privacy.anthropic'))}</text>
    <foreignObject x="22" y="604" width="160" height="68"><p xmlns="http://www.w3.org/1999/xhtml" class="pv-fo">${esc(t('privacy.anthropicNote'))}</p></foreignObject>
    <rect class="pv-ext" x="212" y="560" width="178" height="116" rx="4"/>
    <text class="pv-t pv-strong" x="226" y="592">${esc(t('privacy.hooks'))}</text>
    <foreignObject x="224" y="604" width="160" height="68"><p xmlns="http://www.w3.org/1999/xhtml" class="pv-fo">${esc(t('privacy.hooksNote'))}</p></foreignObject>
    <path class="pv-wire-dead" d="M200 456 V688"/>
    <path class="pv-cut" d="M188 692 L212 702 M188 704 L212 714"/>
    <path class="pv-wire-dead" d="M200 718 V738"/>
    ${crossedBox(10, 742, 380, 96, t, idp)}
  </svg>`
}

export function renderPrivacy(ctx: Ctx): string {
  const { t } = ctx
  const motion = !prefersReducedMotion()
  const points = ['p1', 'p2', 'p3', 'p4']
    .map((k, i) => `<li data-reveal><span class="lbl">${String(i + 1).padStart(2, '0')}</span><p>${esc(t(`privacy.${k}`))}</p></li>`)
    .join('')
  return `
<section id="data-flow" class="sec sec-privacy tone-carbon" data-tone="carbon" aria-labelledby="data-flow-h">
  <div class="wrap">
    ${sectionHead('data-flow', t('privacy.label'), t('privacy.title'), t('privacy.lead'))}
    <figure class="schematic" data-reveal>
      ${wide(t, motion)}
      ${tall(t, motion)}
      <figcaption class="lbl schematic-cap"><span>${ctx.lang === 'de' ? 'Schaltplan 5.1 — Datenfluss' : 'Schematic 5.1 — Data flow'}</span><span>${ctx.lang === 'de' ? 'Server: 0' : 'Servers: 0'}</span></figcaption>
    </figure>
    <ol class="pv-points">${points}</ol>
  </div>
</section>`
}
