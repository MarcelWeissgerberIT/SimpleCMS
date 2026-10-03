/**
 * Schematic drawings (inline SVG, 1600×1000 like the real screenshots).
 * They are the stand-ins until assets/shots/*.webp exist — drawn like technical
 * line drawings so they look intentional, not like missing images.
 * All colours come from CSS classes (see figures.css) so they follow the theme.
 */
import type { Lang } from '@/shared/i18n'
import { esc } from './util'

const W = 1600
const H = 1000

function svg(body: string, label: string): string {
  return `<svg class="sk" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${esc(label)}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`
}

const bar = (x: number, y: number, w: number, cls = 'sk-bar', h = 10) =>
  `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="2"/>`
const txt = (x: number, y: number, s: string, cls = 'sk-txt', extra = '') =>
  `<text class="${cls}" x="${x}" y="${y}" ${extra}>${esc(s)}</text>`

const T = {
  en: {
    ws: 'Acme Studio',
    search: 'Search',
    pages: 'PAGES',
    side: ['Home', 'Roadmap', 'Meeting notes', 'CRM', 'Journal', 'Reading list', 'Design system', 'Hiring'],
    newPage: '+ New page',
    crumb: 'Roadmap  /  Q4 Launch',
    share: 'Share',
    title: 'Q4 Launch',
    meta: 'REV 14 · 1,204 WORDS · SAVED LOCALLY',
    tasks: 'Tasks',
    cols: ['Name', 'Status', 'Owner', 'Due'],
    status: ['Done', 'Doing', 'Todo', 'Doing', 'Todo'],
    due: ['OCT 03', 'OCT 09', 'OCT 14', 'OCT 21', 'NOV 02'],
    cmd: 'Jump to a page or run a command…',
    cmdRows: ['Roadmap', 'New database', 'Toggle focus mode', 'Import from Notion'],
    ai: 'Claude',
    aiKey: 'YOUR KEY',
    aiAsk: 'Ask about this page…',
    views: ['Table', 'Board', 'List', 'Gallery', 'Calendar', 'Timeline', 'Chart'],
    groups: ['Not started', 'In progress', 'Done'],
    board: 'Product roadmap',
    aiMenu: ['Improve writing', 'Make shorter', 'Summarise', 'Translate to German', 'Ask Claude…'],
    aiDoc: 'Field notes',
    aiOut: 'CLAUDE · STREAMING',
    rule: 'Rule 03 — Won deals to n8n',
    when: 'WHEN',
    whenVal: 'Status changes to  Won',
    then: 'THEN',
    thenVal: 'POST  https://n8n.example.com/webhook/leads',
    and: 'AND',
    andVal: 'Set  Closed on  →  today',
    last: 'LAST RUN  200 OK · 0.21 s',
    enabled: 'ENABLED',
  },
  de: {
    ws: 'Acme Studio',
    search: 'Suchen',
    pages: 'SEITEN',
    side: ['Start', 'Roadmap', 'Besprechungen', 'CRM', 'Journal', 'Leseliste', 'Designsystem', 'Recruiting'],
    newPage: '+ Neue Seite',
    crumb: 'Roadmap  /  Q4-Launch',
    share: 'Teilen',
    title: 'Q4-Launch',
    meta: 'REV 14 · 1.204 WÖRTER · LOKAL GESPEICHERT',
    tasks: 'Aufgaben',
    cols: ['Name', 'Status', 'Zuständig', 'Fällig'],
    status: ['Fertig', 'Läuft', 'Offen', 'Läuft', 'Offen'],
    due: ['03. OKT', '09. OKT', '14. OKT', '21. OKT', '02. NOV'],
    cmd: 'Zu einer Seite springen oder Befehl ausführen…',
    cmdRows: ['Roadmap', 'Neue Datenbank', 'Fokusmodus umschalten', 'Aus Notion importieren'],
    ai: 'Claude',
    aiKey: 'DEIN KEY',
    aiAsk: 'Frag etwas zu dieser Seite…',
    views: ['Tabelle', 'Board', 'Liste', 'Galerie', 'Kalender', 'Zeitleiste', 'Diagramm'],
    groups: ['Offen', 'In Arbeit', 'Fertig'],
    board: 'Produkt-Roadmap',
    aiMenu: ['Text verbessern', 'Kürzer fassen', 'Zusammenfassen', 'Ins Englische übersetzen', 'Claude fragen…'],
    aiDoc: 'Feldnotizen',
    aiOut: 'CLAUDE · STREAMT',
    rule: 'Regel 03 — Gewonnene Deals an n8n',
    when: 'WENN',
    whenVal: 'Status ändert sich zu  Gewonnen',
    then: 'DANN',
    thenVal: 'POST  https://n8n.example.com/webhook/leads',
    and: 'UND',
    andVal: 'Setze  Abgeschlossen  →  heute',
    last: 'LETZTER LAUF  200 OK · 0,21 s',
    enabled: 'AKTIV',
  },
}

/* ------------------------------------------------------------------ */
/* Shared chrome: sidebar + top bar of the app                          */
/* ------------------------------------------------------------------ */

function chrome(lang: Lang, active = 1): string {
  const t = T[lang]
  let s = `<rect class="sk-bg" width="${W}" height="${H}"/>`
  s += `<rect class="sk-panel" x="0" y="0" width="300" height="${H}"/><line class="sk-line" x1="300" y1="0" x2="300" y2="${H}"/>`
  s += `<rect class="sk-sig" x="28" y="30" width="26" height="26" rx="3"/><circle class="sk-ink" cx="34.5" cy="36.5" r="2.4"/>`
  s += txt(68, 50, t.ws, 'sk-txt sk-strong')
  s += `<rect class="sk-field" x="20" y="78" width="260" height="36" rx="3"/>`
  s += txt(38, 101, t.search, 'sk-txt sk-dim') + txt(238, 101, '⌘K', 'sk-txt sk-dim')
  s += txt(30, 152, t.pages, 'sk-mono sk-dim')
  t.side.forEach((name, i) => {
    const y = 176 + i * 40
    if (i === active) s += `<rect class="sk-hover" x="14" y="${y - 6}" width="272" height="34" rx="3"/>`
    s += `<rect class="${i === active ? 'sk-sig' : 'sk-bar-2'}" x="30" y="${y + 3}" width="14" height="14" rx="2"/>`
    s += txt(58, y + 16, name, i === active ? 'sk-txt sk-strong' : 'sk-txt')
  })
  s += txt(30, 950, t.newPage, 'sk-txt sk-dim')
  s += txt(340, 44, t.crumb, 'sk-mono sk-dim')
  s += `<rect class="sk-field" x="1440" y="22" width="76" height="30" rx="3"/>` + txt(1458, 43, t.share, 'sk-txt')
  s += txt(1536, 44, '···', 'sk-txt sk-dim')
  s += `<line class="sk-line" x1="300" y1="72" x2="${W}" y2="72"/>`
  return s
}

/* ------------------------------------------------------------------ */
/* Hero: the whole workspace                                            */
/* ------------------------------------------------------------------ */

export function heroSchematic(lang: Lang, label: string): string {
  const t = T[lang]
  let s = chrome(lang)
  // Page header + text blocks (A)
  s += txt(380, 186, t.title, 'sk-title')
  s += txt(382, 228, t.meta, 'sk-mono sk-dim')
  s += bar(380, 262, 780) + bar(380, 290, 720) + bar(380, 318, 520)
  s += `<rect class="sk-wash" x="380" y="352" width="780" height="66" rx="3"/><rect class="sk-sig" x="380" y="352" width="4" height="66"/>`
  s += bar(410, 380, 540, 'sk-bar-2')
  // Database (B)
  s += txt(380, 482, t.tasks, 'sk-h2')
  const x0 = 380
  const x1 = 1240
  const cx = [396, 760, 930, 1100]
  s += `<line class="sk-line" x1="${x0}" y1="504" x2="${x1}" y2="504"/>`
  t.cols.forEach((c, i) => (s += txt(cx[i], 530, c, 'sk-mono sk-dim')))
  const nameW = [260, 210, 300, 180, 240]
  const chip = ['sk-chip-ok', 'sk-chip-sig', 'sk-chip', 'sk-chip-sig', 'sk-chip']
  for (let r = 0; r < 5; r++) {
    const y = 546 + r * 46
    s += `<line class="sk-line" x1="${x0}" y1="${y}" x2="${x1}" y2="${y}"/>`
    s += `<rect class="sk-bar-2" x="396" y="${y + 17}" width="12" height="12" rx="2"/>` + bar(418, y + 18, nameW[r])
    s += `<rect class="${chip[r]}" x="760" y="${y + 12}" width="96" height="24" rx="2"/>` + txt(772, y + 29, t.status[r], 'sk-chip-txt')
    s += `<circle class="sk-bar-2" cx="944" cy="${y + 23}" r="10"/>` + bar(962, y + 19, 70, 'sk-bar-2', 8)
    s += txt(1100, y + 29, t.due[r], 'sk-mono')
  }
  s += `<line class="sk-line" x1="${x0}" y1="776" x2="${x1}" y2="776"/>`
  for (const x of [740, 910, 1080]) s += `<line class="sk-line" x1="${x}" y1="504" x2="${x}" y2="776"/>`
  // Command bar (C)
  s += `<rect class="sk-shadow" x="830" y="124" width="560" height="250" rx="8"/>`
  s += `<rect class="sk-pop" x="820" y="110" width="560" height="250" rx="8"/>`
  s += `<rect class="sk-key" x="840" y="130" width="46" height="30" rx="3"/>` + txt(849, 151, '⌘K', 'sk-mono sk-strong')
  s += txt(900, 151, t.cmd, 'sk-txt sk-dim')
  s += `<rect class="sk-sig sk-caret" x="900" y="134" width="3" height="24"/>`
  s += `<line class="sk-line" x1="820" y1="176" x2="1380" y2="176"/>`
  t.cmdRows.forEach((row, i) => {
    const y = 190 + i * 42
    if (i === 1) s += `<rect class="sk-hover" x="830" y="${y}" width="540" height="36" rx="3"/><rect class="sk-sig" x="830" y="${y + 6}" width="3" height="24"/>`
    s += `<rect class="sk-bar-2" x="848" y="${y + 11}" width="14" height="14" rx="2"/>` + txt(876, y + 24, row, i === 1 ? 'sk-txt sk-strong' : 'sk-txt')
    if (i === 1) s += txt(1320, y + 24, '↵', 'sk-mono sk-dim')
  })
  // AI panel (D)
  s += `<rect class="sk-shadow" x="1150" y="628" width="400" height="300" rx="8"/>`
  s += `<rect class="sk-pop" x="1140" y="614" width="400" height="300" rx="8"/>`
  s += `<circle class="sk-sig" cx="1166" cy="644" r="6"/>` + txt(1182, 650, t.ai, 'sk-txt sk-strong') + txt(1440, 650, t.aiKey, 'sk-mono sk-dim')
  s += `<line class="sk-line" x1="1140" y1="668" x2="1540" y2="668"/>`
  s += bar(1162, 692, 330) + bar(1162, 716, 350) + bar(1162, 740, 280) + bar(1162, 776, 300, 'sk-bar-2') + bar(1162, 800, 210, 'sk-bar-2')
  s += `<rect class="sk-sig sk-caret" x="1378" y="796" width="3" height="18"/>`
  s += `<rect class="sk-field" x="1158" y="850" width="364" height="44" rx="3"/>` + txt(1174, 878, t.aiAsk, 'sk-txt sk-dim')
  s += `<rect class="sk-key" x="1484" y="858" width="28" height="28" rx="3"/>` + txt(1491, 878, '↵', 'sk-mono')
  return svg(s, label)
}

/** Callout balloons for the hero drawing, in drawing units (1600×1000). Adjust once the real screenshot exists. */
export const HERO_CALLOUTS: Array<{ id: 'A' | 'B' | 'C' | 'D'; tx: number; ty: number; bx: number; by: number }> = [
  // A — block editor: the "Agenda" heading and its list
  { id: 'A', tx: 400, ty: 399, bx: 330, by: 318 },
  // B — databases: the "Projects" database (DB tag) in the page tree
  { id: 'B', tx: 111, ty: 432, bx: 150, by: 740 },
  // C — command bar: Search / Ctrl+K
  { id: 'C', tx: 226, ty: 65, bx: 340, by: 150 },
  // D — AI with your key: the Claude · Opus chip of the AI panel
  { id: 'D', tx: 948, ty: 532, bx: 1100, by: 452 },
]

/* ------------------------------------------------------------------ */
/* Deep dives                                                           */
/* ------------------------------------------------------------------ */

export function databaseSchematic(lang: Lang, label: string): string {
  const t = T[lang]
  let s = chrome(lang, 1)
  s += txt(380, 170, t.board, 'sk-title')
  // view tabs
  let x = 380
  t.views.forEach((v, i) => {
    const w = v.length * 11 + 34
    if (i === 1) s += `<rect class="sk-sig" x="${x}" y="226" width="${w - 14}" height="3"/>`
    s += txt(x, 214, v, i === 1 ? 'sk-txt sk-strong' : 'sk-txt sk-dim')
    x += w
  })
  s += `<line class="sk-line" x1="380" y1="229" x2="1540" y2="229"/>`
  const counts = [3, 2, 4]
  const dots = ['sk-bar-2', 'sk-sig', 'sk-ok']
  for (let g = 0; g < 3; g++) {
    const gx = 380 + g * 390
    s += `<circle class="${dots[g]}" cx="${gx + 8}" cy="${276}" r="6"/>` + txt(gx + 24, 282, t.groups[g], 'sk-txt sk-strong') + txt(gx + 24 + t.groups[g].length * 11 + 12, 282, String(counts[g]), 'sk-mono sk-dim')
    for (let c = 0; c < counts[g]; c++) {
      const y = 310 + c * 150
      const hot = g === 1 && c === 0
      s += `<rect class="${hot ? 'sk-pop sk-lift' : 'sk-card'}" x="${gx}" y="${y}" width="360" height="132" rx="4"/>`
      s += bar(gx + 20, y + 26, 200 + ((c * 53 + g * 31) % 110), 'sk-bar')
      s += bar(gx + 20, y + 50, 140 + ((c * 37 + g * 17) % 90), 'sk-bar-2', 8)
      s += `<rect class="${g === 2 ? 'sk-chip-ok' : g === 1 ? 'sk-chip-sig' : 'sk-chip'}" x="${gx + 20}" y="${y + 80}" width="74" height="22" rx="2"/>`
      s += `<rect class="sk-chip" x="${gx + 102}" y="${y + 80}" width="58" height="22" rx="2"/>`
      s += `<circle class="sk-bar-2" cx="${gx + 330}" cy="${y + 91}" r="11"/>`
    }
  }
  return svg(s, label)
}

export function aiSchematic(lang: Lang, label: string): string {
  const t = T[lang]
  let s = chrome(lang, 4)
  s += txt(380, 170, t.aiDoc, 'sk-title')
  s += bar(380, 220, 820) + bar(380, 248, 760) + bar(380, 276, 640)
  // selection
  s += `<rect class="sk-wash" x="374" y="306" width="830" height="92" rx="2"/>`
  s += bar(380, 318, 800) + bar(380, 346, 780) + bar(380, 374, 420)
  s += bar(380, 680, 780) + bar(380, 708, 700) + bar(380, 736, 560) + bar(380, 790, 740) + bar(380, 818, 380)
  // AI menu
  s += `<rect class="sk-shadow" x="390" y="426" width="360" height="236" rx="6"/>`
  s += `<rect class="sk-pop" x="380" y="414" width="360" height="236" rx="6"/>`
  t.aiMenu.forEach((m, i) => {
    const y = 426 + i * 44
    if (i === 2) s += `<rect class="sk-hover" x="388" y="${y}" width="344" height="38" rx="3"/><rect class="sk-sig" x="388" y="${y + 7}" width="3" height="24"/>`
    s += `<rect class="${i === 4 ? 'sk-sig' : 'sk-bar-2'}" x="404" y="${y + 12}" width="14" height="14" rx="2"/>` + txt(432, y + 25, m, i === 2 ? 'sk-txt sk-strong' : 'sk-txt')
  })
  // streamed answer
  s += `<rect class="sk-shadow" x="790" y="440" width="740" height="226" rx="6"/>`
  s += `<rect class="sk-pop" x="780" y="428" width="740" height="226" rx="6"/>`
  s += `<circle class="sk-sig" cx="806" cy="458" r="6"/>` + txt(822, 464, t.aiOut, 'sk-mono sk-dim')
  s += bar(806, 494, 660) + bar(806, 520, 690) + bar(806, 546, 610) + bar(806, 572, 420)
  s += `<rect class="sk-sig sk-caret" x="1232" y="566" width="3" height="20"/>`
  s += `<rect class="sk-key" x="1302" y="606" width="96" height="30" rx="3"/>` + txt(1318, 627, 'Esc', 'sk-mono')
  s += `<rect class="sk-btn" x="1408" y="606" width="96" height="30" rx="3"/>` + txt(1426, 627, '↵', 'sk-mono sk-on-sig')
  return svg(s, label)
}

export function automationSchematic(lang: Lang, label: string): string {
  const t = T[lang]
  let s = chrome(lang, 3)
  s += txt(380, 170, 'CRM', 'sk-title')
  // dimmed table behind
  for (let r = 0; r < 9; r++) {
    const y = 220 + r * 46
    s += `<line class="sk-line" x1="380" y1="${y}" x2="1540" y2="${y}"/>` + bar(400, y + 18, 160 + ((r * 47) % 120), 'sk-bar-2')
  }
  // automation panel
  s += `<rect class="sk-shadow" x="560" y="262" width="820" height="560" rx="8"/>`
  s += `<rect class="sk-pop" x="550" y="248" width="820" height="560" rx="8"/>`
  s += txt(582, 296, t.rule, 'sk-txt sk-strong')
  s += `<rect class="sk-switch" x="1270" y="278" width="52" height="26" rx="13"/><circle class="sk-on-sig-fill" cx="1309" cy="291" r="9"/>` + txt(1180, 297, t.enabled, 'sk-mono sk-dim')
  s += `<line class="sk-line" x1="550" y1="322" x2="1370" y2="322"/>`
  const rows: Array<[string, string]> = [
    [t.when, t.whenVal],
    [t.then, t.thenVal],
    [t.and, t.andVal],
  ]
  rows.forEach(([k, v], i) => {
    const y = 352 + i * 120
    s += `<rect class="sk-card" x="582" y="${y}" width="756" height="88" rx="4"/>`
    s += txt(604, y + 34, k, 'sk-mono sk-sig-txt') + txt(604, y + 66, v, 'sk-txt sk-strong')
    if (i < 2) s += `<line class="sk-line" x1="640" y1="${y + 88}" x2="640" y2="${y + 120}"/>`
  })
  s += `<circle class="sk-ok" cx="590" cy="766" r="6"/>` + txt(606, 772, t.last, 'sk-mono sk-dim')
  return svg(s, label)
}

export function websiteSchematic(lang: Lang, label: string): string {
  const de = lang === 'de'
  let s = chrome(lang, 4)
  s += `<rect class="sk-shadow" x="410" y="74" width="800" height="710" rx="8"/>`
  s += `<rect class="sk-pop" x="400" y="60" width="800" height="710" rx="8"/>`
  s += txt(432, 104, de ? 'EXPORT' : 'EXPORT', 'sk-mono sk-dim')
  s += `<line class="sk-line" x1="400" y1="126" x2="1200" y2="126"/>`
  const fmts = ['SITE', 'MD.ZIP', 'HTML', 'JSON', 'PDF']
  fmts.forEach((f, i) => {
    const x = 418 + i * 155
    s += `<rect class="sk-card" x="${x}" y="260" width="145" height="148" rx="4"/>` + txt(x + 14, 292, f, i === 0 ? 'sk-mono sk-sig-txt' : 'sk-mono')
    s += bar(x + 14, 330, 100, 'sk-bar-2') + bar(x + 14, 352, 80, 'sk-bar-2')
  })
  const files = ['index.html', 'sitemap.xml', 'rss.xml', 'llms.txt']
  files.forEach((f, i) => (s += txt(432, 476 + i * 34, f, 'sk-mono')))
  s += txt(432, 726, de ? 'Website exportieren' : 'Export site', 'sk-txt sk-strong')
  return svg(s, label)
}
