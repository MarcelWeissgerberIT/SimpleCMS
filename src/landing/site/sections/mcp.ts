import { BRAND } from '@/shared/brand'
import { logoMarkSvg } from '@/shared/logo'
import type { Ctx } from '../context'
import { agentSchematic } from '../figures'
import { frame } from '../frame'
import { asset, esc, prefersReducedMotion } from '../util'
import { dotted } from './hero'
import { sectionHead } from './head'

/**
 * § 03 — Agents · MCP: One as an instrument with two ports. Plate 3.1 shows both directions
 * (Claude Desktop → One; One's Claude → your MCP servers). Then the port "in" up close: a schematic
 * of both ways in (local bridge → your tab; remote → your team server), the mode selector of the
 * local bridge (it re-labels the approval gate in the drawing and darkens the write tools), the
 * tool table and the setup: first the one-click Claude Desktop extension (mcp/one.mcpb), then —
 * folded — the bridge file and the snippets for other clients, with copy keys. Last, 3.3: custom
 * agents — a nameplate of an example agent and a real screenshot of a run.
 */

type T = Ctx['t']
export type McpMode = 'ask' | 'apply' | 'read'
const MODES: McpMode[] = ['ask', 'apply', 'read']

/** Survives re-renders (language switch). */
let mode: McpMode = 'ask'

const up = (s: string) => esc(s.toUpperCase())

const packet = (path: string, dur: number, delay: number, motion: boolean) =>
  motion
    ? `<circle class="pv-packet" r="4"><animateMotion dur="${dur}s" begin="${delay}s" repeatCount="indefinite" path="${path}" keyPoints="0;1" keyTimes="0;1" calcMode="linear"/></circle>`
    : ''

function defs(idp: string): string {
  return `<defs>
    <marker id="${idp}-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="pv-arrow" d="M0 0 L10 5 L0 10 z"/></marker>
    <marker id="${idp}-arr-sig" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="pv-arrow-sig" d="M0 0 L10 5 L0 10 z"/></marker>
    <pattern id="${idp}-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line class="mcp-hatch" x1="0" y1="0" x2="0" y2="8"/></pattern>
  </defs>`
}

/** A pair of wires (there and back) with packets, signal orange (local) or dashed (remote). */
function wires(a: string, b: string, idp: string, kind: 'sig' | 'opt', motion: boolean, dur = 1.6): string {
  const cls = kind === 'sig' ? 'pv-wire-sig' : 'pv-wire-opt'
  const mk = kind === 'sig' ? `${idp}-arr-sig` : `${idp}-arr`
  return `<path class="${cls}" d="${a}" marker-end="url(#${mk})"/><path class="${cls}" d="${b}" marker-end="url(#${mk})"/>${packet(a, dur, 0, motion)}${packet(b, dur, dur / 2, motion)}`
}

/** The small keycap with a prompt glyph that marks an MCP client. */
const cap = (x: number, y: number) =>
  `<rect class="mcp-cap" x="${x}" y="${y}" width="26" height="26" rx="2"/><text class="mcp-cap-t" x="${x + 13}" y="${y + 17.5}" text-anchor="middle">&gt;_</text>`

function cylinder(cx: number, top: number, rx: number, h: number): string {
  const ry = rx * 0.2
  return `<path class="pv-db" d="M${cx - rx} ${top} V${top + h} A${rx} ${ry} 0 0 0 ${cx + rx} ${top + h} V${top} Z"/>
    <ellipse class="pv-db-top" cx="${cx}" cy="${top}" rx="${rx}" ry="${ry}"/>
    <path class="pv-db-ring" d="M${cx - rx} ${top + h * 0.22} A${rx} ${ry} 0 0 0 ${cx + rx} ${top + h * 0.22}"/>`
}

/**
 * The approval card inside the tab: three states, one shown per mode (CSS: .sec-mcp[data-mode]).
 * (x, y) is the card's top-left, w its width.
 */
function gate(t: T, x: number, y: number, w: number, h: number, idp: string): string {
  const keyW = (w - 44) / 2
  const ky = y + h - 50
  return `<g class="mcp-card">
    <rect class="mcp-card-box" x="${x}" y="${y}" width="${w}" height="${h}" rx="2"/>
    <g class="mcp-gate mcp-gate-ask">
      <text class="pv-m pv-inv-dim" x="${x + 16}" y="${y + 26}">${up(t('mcp.wants'))}</text>
      <text class="pv-t pv-inv mcp-what" x="${x + 16}" y="${y + 52}">${esc(t('mcp.wantsWhat'))}</text>
      <rect class="mcp-key-off" x="${x + 16}" y="${ky}" width="${keyW}" height="34" rx="2"/>
      <text class="pv-m pv-inv mcp-key-t" x="${x + 16 + keyW / 2}" y="${ky + 21.5}" text-anchor="middle">${up(t('mcp.reject'))}</text>
      <rect class="mcp-key-on" x="${x + 28 + keyW}" y="${ky}" width="${keyW}" height="34" rx="2"/>
      <text class="pv-m mcp-key-on-t" x="${x + 28 + keyW * 1.5}" y="${ky + 21.5}" text-anchor="middle">${up(t('mcp.approve'))}</text>
    </g>
    <g class="mcp-gate mcp-gate-apply">
      <text class="pv-m pv-inv-dim" x="${x + 16}" y="${y + 26}">${up(t('mcp.wantsWhat'))}</text>
      <circle class="mcp-led-ok" cx="${x + 22}" cy="${y + h / 2 + 8}" r="5"/>
      <text class="pv-m pv-inv mcp-gate-t" x="${x + 36}" y="${y + h / 2 + 12}">${up(t('mcp.applied'))}</text>
    </g>
    <g class="mcp-gate mcp-gate-read">
      <rect x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${h - 2}" fill="url(#${idp}-hatch)"/>
      <rect class="mcp-gate-plate" x="${x + 16}" y="${y + h / 2 - 16}" width="${w - 32}" height="32" rx="2"/>
      <text class="pv-m pv-inv mcp-gate-t" x="${x + w / 2}" y="${y + h / 2 + 4}" text-anchor="middle">${up(t('mcp.refused'))}</text>
    </g>
  </g>`
}

function wide(t: T, motion: boolean): string {
  const idp = 'mcw'
  return `<svg class="pv-svg pv-wide mcp-svg" viewBox="0 0 1200 640" role="img" aria-label="${esc(t('mcp.alt'))}">
    ${defs(idp)}
    <text class="pv-m pv-sig" x="20" y="24">${up(t('mcp.laneA'))}</text>
    <text class="pv-m pv-dim" x="1180" y="24" text-anchor="end">${up(t('mcp.laneANote'))}</text>
    <rect class="pv-frame" x="20" y="40" width="1160" height="300" rx="6"/>
    <line class="pv-rule" x1="20" y1="80" x2="1180" y2="80"/>
    <text class="pv-m pv-dim" x="44" y="65">${up(t('mcp.computer'))}</text>
    <text class="pv-m pv-dim" x="1156" y="65" text-anchor="end">127.0.0.1 · CLOUD: ∅</text>

    <rect class="mcp-box" x="44" y="118" width="250" height="170" rx="4"/>
    ${cap(62, 136)}
    <text class="pv-t pv-strong" x="62" y="200">${esc(t('mcp.client'))}</text>
    <text class="pv-m pv-dim" x="62" y="268">${up(t('mcp.clientNote'))}</text>

    <text class="pv-m pv-dim" x="322" y="174" text-anchor="middle">STDIO</text>
    ${wires('M294 188 H350', 'M350 222 H294', idp, 'sig', motion, 1.2)}

    <rect class="mcp-module" x="350" y="136" width="204" height="134" rx="4"/>
    <circle class="mcp-jack" cx="350" cy="188" r="5"/><circle class="mcp-jack" cx="350" cy="222" r="5"/>
    <circle class="mcp-jack" cx="554" cy="188" r="5"/><circle class="mcp-jack" cx="554" cy="222" r="5"/>
    <text class="pv-t pv-strong mcp-mono" x="372" y="178">${esc(t('mcp.bridge'))}</text>
    <text class="pv-m pv-dim" x="372" y="204">${up(t('mcp.bridgeNote'))}</text>
    <text class="pv-m pv-sig" x="372" y="250">127.0.0.1:47321</text>

    <text class="pv-m pv-dim" x="597" y="174" text-anchor="middle">WS</text>
    ${wires('M554 188 H640', 'M640 222 H554', idp, 'sig', motion, 1.2)}

    <rect class="pv-app-box" x="640" y="100" width="300" height="214" rx="4"/>
    <rect class="pv-app-tag" x="658" y="116" width="22" height="22" rx="2"/><circle class="pv-app-hole" cx="663.5" cy="121.5" r="2"/>
    <text class="pv-t pv-inv pv-strong" x="692" y="133">${esc(t('mcp.tab'))}</text>
    ${gate(t, 658, 152, 264, 144, idp)}

    ${wires('M940 188 H988', 'M988 222 H940', idp, 'sig', motion, 1)}
    ${cylinder(1080, 136, 92, 132)}
    <text class="pv-t pv-strong" x="1080" y="214" text-anchor="middle">${esc(t('mcp.idb'))}</text>
    <text class="pv-m pv-dim pv-db-note" x="1080" y="238" text-anchor="middle">${up(t('privacy.idbNote'))}</text>

    <text class="pv-m pv-sig" x="20" y="384">${up(t('mcp.laneB'))}</text>
    <text class="pv-m pv-dim" x="1180" y="384" text-anchor="end">${up(t('mcp.laneBNote'))}</text>
    <rect class="pv-ext" x="44" y="426" width="250" height="150" rx="4"/>
    ${cap(62, 444)}
    <text class="pv-t pv-strong" x="62" y="508">${esc(t('mcp.remote'))}</text>
    <text class="pv-m pv-dim" x="62" y="556">${up(t('mcp.remoteNote'))}</text>

    <text class="pv-m pv-dim" x="447" y="470" text-anchor="middle">HTTPS · BEARER TOKEN</text>
    ${wires('M294 486 H636', 'M636 520 H294', idp, 'opt', motion, 2.6)}

    <rect class="pv-frame" x="600" y="400" width="580" height="208" rx="6"/>
    <line class="pv-rule" x1="600" y1="440" x2="1180" y2="440"/>
    <text class="pv-m pv-dim" x="624" y="425">${up(t('mcp.server'))}</text>
    <text class="pv-m pv-dim" x="1156" y="425" text-anchor="end">DOCKER · SQLITE · YJS</text>
    <rect class="mcp-module" x="640" y="462" width="230" height="118" rx="4"/>
    <circle class="mcp-jack" cx="640" cy="486" r="5"/><circle class="mcp-jack" cx="640" cy="520" r="5"/>
    <text class="pv-t pv-strong mcp-mono" x="662" y="504">${esc(t('mcp.endpoint'))}</text>
    <text class="pv-m pv-dim" x="662" y="530">${up(t('mcp.endpointNote'))}</text>
    ${wires('M870 504 H932', 'M932 538 H870', idp, 'opt', motion, 1.4)}
    <rect class="mcp-sheet" x="956" y="458" width="200" height="110" rx="2"/>
    <rect class="mcp-sheet" x="946" y="466" width="200" height="110" rx="2"/>
    <rect class="mcp-sheet mcp-sheet-front" x="936" y="474" width="210" height="110" rx="2"/>
    <text class="pv-t pv-strong" x="954" y="516">${esc(t('mcp.live'))}</text>
    <text class="pv-m pv-dim mcp-small" x="954" y="542">${up(t('mcp.liveNote'))}</text>
  </svg>`
}

function tall(t: T, motion: boolean): string {
  const idp = 'mct'
  return `<svg class="pv-svg pv-tall mcp-svg" viewBox="0 0 400 1190" role="img" aria-label="${esc(t('mcp.alt'))}">
    ${defs(idp)}
    <text class="pv-m pv-sig" x="10" y="20">${up(t('mcp.laneA'))}</text>
    <rect class="pv-frame" x="10" y="34" width="380" height="764" rx="6"/>
    <line class="pv-rule" x1="10" y1="74" x2="390" y2="74"/>
    <text class="pv-m pv-dim" x="28" y="60">${up(t('mcp.computer'))}</text>

    <rect class="mcp-box" x="40" y="96" width="320" height="112" rx="4"/>
    ${cap(58, 114)}
    <text class="pv-t pv-strong" x="96" y="134">${esc(t('mcp.client'))}</text>
    <text class="pv-m pv-dim" x="58" y="186">${up(t('mcp.clientNote'))}</text>

    ${wires('M182 208 V262', 'M218 262 V208', idp, 'sig', motion, 1.1)}
    <text class="pv-m pv-dim" x="236" y="241">STDIO</text>

    <rect class="mcp-module" x="70" y="262" width="260" height="104" rx="4"/>
    <text class="pv-t pv-strong mcp-mono" x="90" y="298">${esc(t('mcp.bridge'))}</text>
    <text class="pv-m pv-dim" x="90" y="324">${up(t('mcp.bridgeNote'))}</text>
    <text class="pv-m pv-sig" x="90" y="350">127.0.0.1:47321</text>

    ${wires('M182 366 V420', 'M218 420 V366', idp, 'sig', motion, 1.1)}
    <text class="pv-m pv-dim" x="236" y="399">WS</text>

    <rect class="pv-app-box" x="40" y="420" width="320" height="214" rx="4"/>
    <rect class="pv-app-tag" x="58" y="436" width="22" height="22" rx="2"/><circle class="pv-app-hole" cx="63.5" cy="441.5" r="2"/>
    <text class="pv-t pv-inv pv-strong" x="92" y="453">${esc(t('mcp.tab'))}</text>
    ${gate(t, 56, 472, 288, 146, idp)}

    ${wires('M182 634 V654', 'M218 654 V634', idp, 'sig', motion, 0.8)}
    ${cylinder(200, 678, 112, 56)}
    <text class="pv-t pv-strong" x="200" y="728" text-anchor="middle">${esc(t('mcp.idb'))}</text>
    <text class="pv-m pv-sig" x="200" y="784" text-anchor="middle">${up(t('mcp.laneANote'))}</text>

    <text class="pv-m pv-sig" x="10" y="842">${up(t('mcp.laneB'))}</text>
    <text class="pv-m pv-dim" x="10" y="864">${up(t('mcp.laneBNote'))}</text>
    <rect class="pv-ext" x="40" y="880" width="320" height="84" rx="4"/>
    ${cap(58, 896)}
    <text class="pv-t pv-strong" x="96" y="916">${esc(t('mcp.remote'))}</text>
    <text class="pv-m pv-dim" x="96" y="944">${up(t('mcp.remoteNote'))}</text>

    ${wires('M182 964 V1012', 'M218 1012 V964', idp, 'opt', motion, 1.6)}
    <text class="pv-m pv-dim" x="236" y="993">HTTPS · TOKEN</text>

    <rect class="pv-frame" x="10" y="1012" width="380" height="170" rx="6"/>
    <line class="pv-rule" x1="10" y1="1050" x2="390" y2="1050"/>
    <text class="pv-m pv-dim" x="28" y="1036">${up(t('mcp.server'))}</text>
    <rect class="mcp-module" x="40" y="1066" width="320" height="44" rx="4"/>
    <text class="pv-t pv-strong mcp-mono" x="58" y="1095">${esc(t('mcp.endpoint'))}</text>
    <text class="pv-m pv-dim" x="342" y="1094" text-anchor="end">JSON</text>
    ${wires('M182 1110 V1128', 'M218 1128 V1110', idp, 'opt', motion, 0.8)}
    <rect class="mcp-sheet mcp-sheet-front" x="40" y="1128" width="320" height="40" rx="2"/>
    <text class="pv-t pv-strong" x="58" y="1155">${esc(t('mcp.live'))}</text>
  </svg>`
}

/* ------------------------------------------------------------------ setup snippets */

const DESKTOP_JSON = (path: string) => `{
  "mcpServers": {
    "one": {
      "command": "node",
      "args": ["${path}"]
    }
  }
}`

/** JSON with keys, strings and punctuation told apart (escaped HTML). */
function jsonHtml(src: string): string {
  return esc(src).replace(/(&quot;[^&]*?&quot;)(\s*:)?|([{}[\],])/g, (_m, str: string | undefined, colon: string | undefined, punct: string | undefined) => {
    if (punct) return `<span class="tk-p">${punct}</span>`
    return colon ? `<span class="tk-k">${str}</span><span class="tk-p">${colon}</span>` : `<span class="tk-s">${str}</span>`
  })
}

/** Shell lines: the command word in signal ink, flags dimmed. */
function shellHtml(lines: string[]): string {
  return lines
    .map((l) => {
      const [cmd, ...rest] = l.split(' ')
      const tail = rest.map((w) => (w.startsWith('-') ? `<span class="tk-f">${esc(w)}</span>` : esc(w))).join(' ')
      return `<span class="sh-line"><span class="tk-c">${esc(cmd ?? '')}</span>${tail ? ` ${tail}` : ''}</span>`
    })
    .join('')
}

/** A titled snippet with a copy key; `text` is exactly what lands in the clipboard. */
function codeBlock(id: string, title: string, text: string, t: T, kind: 'json' | 'sh'): string {
  const body = kind === 'json' ? jsonHtml(text) : shellHtml(text.split('\n'))
  return `
    <div class="mcp-code${kind === 'sh' ? ' is-sh' : ''}">
      <div class="mcp-code-head">
        <span class="lbl" id="${id}-l">${esc(title)}</span>
        <button type="button" class="mcp-copy" data-copy="${id}" data-text="${esc(text)}" data-what="${esc(title)}" aria-label="${esc(t('mcp.copyWhat', { what: title }))}"><span class="mcp-copy-t">${esc(t('mcp.copy'))}</span></button>
      </div>
      <pre id="${id}" tabindex="0" aria-labelledby="${id}-l"><code>${body}</code></pre>
    </div>`
}

/** Where the bridge is served from: this site's own origin and base. */
function bridgeUrl(): string {
  const path = asset('mcp/one-mcp.mjs')
  try {
    return new URL(path, window.location.href).href
  } catch {
    return `https://getonecms.com/mcp/one-mcp.mjs`
  }
}

/* ------------------------------------------------------------------ both ports + agents */

/** Lucide "library" (ISC): the stand-in for a knowledge base behind an MCP server. */
const LIBRARY_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/></svg>'

const oneNode = () => `<span class="mcp-node is-one">${logoMarkSvg(18)}<span>One</span></span>`

/** One port of the two: direction, a one-line wiring (node → wire → node) and a line of text. */
function port(dir: 'in' | 'out', t: T, tools: number, help: string): string {
  const wire = (label: string) => `<span class="mcp-wire"><span class="mcp-wire-t">MCP · ${esc(label)}</span><i class="mcp-wire-pkt"></i></span>`
  const nodes =
    dir === 'in'
      ? `<span class="mcp-node"><span class="mcp-node-cap">&gt;_</span><span>${esc(t('mcp.client'))}</span></span>${wire(t('mcp.inWire'))}${oneNode()}`
      : `${oneNode()}${wire(t('mcp.outWire'))}<span class="mcp-node is-ext"><span class="mcp-node-cap">${LIBRARY_ICON}</span><span>${esc(t('mcp.outNode'))}</span></span>`
  const where =
    dir === 'out'
      ? `<p class="mcp-port-where"><span class="lbl">${esc(t('mcp.outWhere'))}</span><a class="lbl" href="${help}">${esc(t('mcp.outHelp'))} <span aria-hidden="true">→</span></a></p>`
      : `<p class="mcp-port-where"><span class="lbl">${esc(t('mcp.inWhere'))}</span><a class="lbl" href="#mcp-setup">${esc(t('mcp.inSetup'))} <span aria-hidden="true">↓</span></a></p>`
  return `
      <div class="mcp-port is-${dir}">
        <p class="lbl mcp-port-dir"><span class="mcp-port-jack" aria-hidden="true"></span>${esc(t(`mcp.${dir}`))}</p>
        <h3 class="mcp-port-h">${esc(t(`mcp.${dir}Title`))}</h3>
        <div class="mcp-port-wiring" role="img" aria-label="${esc(t(`mcp.${dir}Alt`))}">${nodes}</div>
        <p class="mcp-port-p">${esc(t(`mcp.${dir}Text`, { n: tools }))}</p>
        ${where}
      </div>`
}

/** Plate 3.1: Claude Desktop → One (the schematic below wires it up) and One's Claude → your MCP servers. */
function ports(ctx: Ctx): string {
  const { t, c, lang } = ctx
  const help = `${BRAND.homeHref}help/${lang === 'de' ? 'de/' : ''}mcp-servers/`
  return `
    <figure class="mcp-ports" data-reveal>
      <div class="mcp-port-row">${port('in', t, c.mcpTools.length, help)}${port('out', t, c.mcpTools.length, help)}</div>
      <figcaption class="lbl mcp-ports-cap"><span>${esc(t('mcp.ports'))}</span><span>${esc(t('mcp.portsMeta'))}</span></figcaption>
    </figure>`
}

const AGENT_SPEC = ['job', 'trigger', 'scope', 'mcp', 'changes', 'budget', 'runs'] as const

/** 3.3: custom agents — a riveted nameplate of an example agent next to a real screenshot. */
function agents(ctx: Ctx): string {
  const { t, lang } = ctx
  const help = `${BRAND.homeHref}help/${lang === 'de' ? 'de/' : ''}custom-agents/`
  const spec = AGENT_SPEC.map(
    (k) => `<div class="agent-row${k === 'changes' ? ' is-sig' : ''}"><dt class="lbl">${esc(t(`agents.k.${k}`))}</dt><dd>${esc(t(`agents.v.${k}`))}</dd></div>`,
  ).join('')
  return `
    <div class="mcp-agents" role="group" aria-labelledby="mcp-agents-h">
      <header class="mcp-agents-head" data-reveal>
        <p class="lbl mcp-agents-label">${esc(t('agents.label'))}</p>
        <h3 id="mcp-agents-h" class="mcp-agents-h disp">${dotted(t('agents.title'))}</h3>
        <div class="mcp-agents-copy">
          <p>${esc(t('agents.text'))}</p>
          <p class="mcp-agents-where"><span class="led" aria-hidden="true"></span>${esc(t('agents.where'))}</p>
          <div class="mcp-agents-ctas">
            <a class="btn btn-sig" href="${BRAND.appHref}#/agents" data-agents-open>${esc(t('agents.open'))}<span class="arr" aria-hidden="true">→</span></a>
            <a class="btn btn-ghost" href="${help}">${esc(t('agents.help'))}</a>
          </div>
        </div>
      </header>
      <div class="mcp-agents-body">
        <article class="agent-plate tone-print" aria-label="${esc(`${t('agents.plate')}: ${t('agents.name')}`)}" data-reveal>
          <i class="screw s-tl" aria-hidden="true"></i><i class="screw s-tr" aria-hidden="true"></i><i class="screw s-bl" aria-hidden="true"></i><i class="screw s-br" aria-hidden="true"></i>
          <header class="agent-plate-head">
            <p class="lbl">${esc(t('agents.plate'))} · AG-M</p>
            <p class="lbl agent-plate-state"><span class="led" aria-hidden="true"></span>${esc(t('agents.state'))}</p>
          </header>
          <p class="agent-plate-name disp">${esc(t('agents.name'))}</p>
          <dl class="agent-spec">${spec}</dl>
        </article>
        <div class="mcp-agents-fig" data-reveal>
          ${frame({ shot: 'assets/shots/agents.webp', alt: t('agents.fig'), schematic: agentSchematic(lang, t('agents.fig')), caption: t('agents.fig'), meta: '1600 × 1000', zoom: t('fig.enlarge') })}
        </div>
      </div>
    </div>`
}

export function renderMcp(ctx: Ctx): string {
  const { t, c } = ctx
  const motion = !prefersReducedMotion()
  const spec = [
    [t('mcp.spec.protocol'), 'MCP'],
    [t('mcp.spec.transport'), t('mcp.spec.transportValue')],
    [t('mcp.spec.tools'), String(c.mcpTools.length)],
    [t('mcp.spec.default'), t('mcp.spec.defaultValue')],
  ]
  const tools = c.mcpTools
    .map(
      (x) => `<li class="mcp-tool${x.write ? ' is-w' : ''}"><span class="mcp-led" aria-hidden="true"></span><code>${esc(x.name)}</code><span class="mcp-tool-t">${esc(x.text)}</span><span class="sr"> — ${esc(t(x.write ? 'mcp.write' : 'mcp.read'))}</span></li>`,
    )
    .join('')
  const modes = MODES.map(
    (m) => `<label class="mcp-mode"><input type="radio" name="mcp-mode" value="${m}"${m === mode ? ' checked' : ''} /><span class="mcp-mode-key"><i class="mcp-mode-led" aria-hidden="true"></i>${esc(t(`mcp.mode.${m}`))}</span></label>`,
  ).join('')
  const url = bridgeUrl()
  const guide = `${BRAND.repoUrl}/blob/main/docs/MCP.md`
  return `
<section id="mcp" class="sec sec-mcp tone-carbon" data-tone="carbon" data-mode="${mode}" aria-labelledby="mcp-h">
  <div class="wrap">
    ${sectionHead('mcp', t('mcp.label'), t('mcp.title'), t('mcp.lead'))}
    <dl class="mcp-spec" data-reveal>
      ${spec.map(([k, v]) => `<div><dt class="lbl">${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}
    </dl>
    ${ports(ctx)}
    <figure class="schematic mcp-schematic" data-reveal>
      ${wide(t, motion)}
      ${tall(t, motion)}
      <figcaption class="lbl schematic-cap"><span>${esc(t('mcp.fig'))}</span><span>${esc(t('mcp.figMeta', { n: c.mcpTools.length }))}</span></figcaption>
    </figure>
    <div class="mcp-deck">
      <div class="mcp-left">
        <fieldset class="mcp-modes" data-reveal>
          <legend class="lbl">${esc(t('mcp.modes'))}</legend>
          <div class="mcp-mode-row">${modes}</div>
          <p class="mcp-mode-note" data-mcp-note aria-live="polite">${esc(t(`mcp.modeNote.${mode}`))}</p>
        </fieldset>
        <div class="mcp-tools" data-reveal>
          <div class="mcp-tools-head">
            <h3 class="lbl">${esc(t('mcp.toolTable'))} · ${c.mcpTools.length}</h3>
            <p class="lbl mcp-legend"><span><span class="mcp-led" aria-hidden="true"></span>${esc(t('mcp.read'))}</span><span class="is-w"><span class="mcp-led" aria-hidden="true"></span>${esc(t('mcp.write'))}</span></p>
          </div>
          <ol class="mcp-tool-list">${tools}</ol>
        </div>
      </div>
      <div class="mcp-setup" id="mcp-setup" data-reveal>
        <div class="mcp-setup-head">
          <h3 class="lbl">${esc(t('mcp.setup'))}</h3>
          <p class="lbl">${esc(t('mcp.steps'))}</p>
        </div>
        <ol class="mcp-steps">
          <li>
            <span class="mcp-n disp" aria-hidden="true">01</span>
            <div class="mcp-step">
              <p>${esc(t('mcp.oneClick'))}</p>
              <div class="mcp-install">
                <a class="btn btn-sig mcp-install-key" href="${asset('mcp/one.mcpb')}" download="one.mcpb" aria-describedby="mcp-install-hint" data-mcp-install>${esc(t('mcp.install'))}<span class="arr" aria-hidden="true">↓</span></a>
                <span class="lbl mcp-install-spec">${esc(t('mcp.installSpec'))}</span>
              </div>
              <p class="mcp-hint" id="mcp-install-hint">${esc(t('mcp.installHint'))}</p>
            </div>
          </li>
          <li>
            <span class="mcp-n disp" aria-hidden="true">02</span>
            <div class="mcp-step"><p>${esc(t('mcp.s3'))}</p></div>
          </li>
        </ol>
        <details class="mcp-manual">
          <summary>
            <span class="mcp-manual-t">${esc(t('mcp.manual'))}</span>
            <span class="mcp-manual-pm" aria-hidden="true"></span>
            <span class="mcp-manual-note">${esc(t('mcp.manualNote'))}</span>
          </summary>
          <div class="mcp-manual-body">
            <p>${esc(t('mcp.s1'))}</p>
            <a class="btn btn-ghost" href="${asset('mcp/one-mcp.mjs')}" download="one-mcp.mjs" data-mcp-download>${esc(t('mcp.download'))}<span class="arr" aria-hidden="true">↓</span></a>
            <p>${esc(t('mcp.s2'))}</p>
            ${codeBlock('mcp-code', t('mcp.code'), `curl -fsSL ${url} -o ~/one-mcp.mjs\nclaude mcp add one -- node ~/one-mcp.mjs`, t, 'sh')}
            ${codeBlock('mcp-desktop', t('mcp.desktop'), DESKTOP_JSON('/ABSOLUTE/PATH/one-mcp.mjs'), t, 'json')}
            <p class="mcp-hint">${esc(t('mcp.desktopNote'))}</p>
          </div>
        </details>
        <div class="mcp-team">
          ${codeBlock('mcp-team', t('mcp.team'), 'claude mcp add --transport http one https://team.example.com/mcp --header "Authorization: Bearer one_…"', t, 'sh')}
          <p class="mcp-hint">${esc(t('mcp.teamNote'))}</p>
        </div>
        <a class="mcp-guide lbl" href="${guide}" rel="noopener">${esc(t('mcp.guide'))} <span aria-hidden="true">→</span></a>
      </div>
    </div>
    ${agents(ctx)}
    <p class="sr" aria-live="polite" data-mcp-live></p>
  </div>
</section>`
}

/* ------------------------------------------------------------------ behaviour */

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* below */
  }
  // insecure contexts / older browsers: a selected textarea + execCommand
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  ta.remove()
  return ok
}

/** Mode selector + copy keys. Returns a cleanup. */
export function bindMcp(root: HTMLElement, ctx: Ctx): () => void {
  const sec = root.querySelector<HTMLElement>('#mcp')
  if (!sec) return () => {}
  const { t } = ctx
  const note = sec.querySelector<HTMLElement>('[data-mcp-note]')
  const live = sec.querySelector<HTMLElement>('[data-mcp-live]')
  const timers: number[] = []

  const onMode = (e: Event) => {
    const input = e.target as HTMLInputElement
    if (input.name !== 'mcp-mode' || !MODES.includes(input.value as McpMode)) return
    mode = input.value as McpMode
    sec.dataset.mode = mode
    if (note) note.textContent = t(`mcp.modeNote.${mode}`)
  }

  const onClick = async (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-copy]')
    if (!btn) return
    const pre = sec.querySelector<HTMLElement>(`#${btn.dataset.copy}`)
    if (!pre) return
    const what = btn.dataset.what ?? ''
    const label = btn.querySelector<HTMLElement>('.mcp-copy-t')
    const ok = await writeClipboard(btn.dataset.text ?? pre.textContent ?? '')
    if (!ok) {
      // let the visitor copy by hand: select the snippet
      const range = document.createRange()
      range.selectNodeContents(pre)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
    btn.dataset.state = ok ? 'copied' : 'failed'
    if (label) label.textContent = t(ok ? 'mcp.copied' : 'mcp.copyFailed')
    if (live && ok) live.textContent = t('mcp.copiedLive', { what })
    timers.push(
      window.setTimeout(() => {
        delete btn.dataset.state
        if (label) label.textContent = t('mcp.copy')
      }, 1800),
    )
  }

  sec.addEventListener('change', onMode)
  sec.addEventListener('click', onClick)
  return () => {
    sec.removeEventListener('change', onMode)
    sec.removeEventListener('click', onClick)
    timers.forEach((id) => window.clearTimeout(id))
  }
}
