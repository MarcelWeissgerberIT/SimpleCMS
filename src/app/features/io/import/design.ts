/**
 * "Take over from Claude Design" (pure, no DOM / store): Claude Design has no API to connect to — it exports
 * an HTML file (one file, inline styles), a PowerPoint deck and people take screenshots. This turns what was
 * dropped into ONE import plan:
 *
 *  - the page: the HTML export's content (the import's HTML converter; data: pictures become files, relative
 *    ones resolve inside a dropped ZIP) — or an empty page without an HTML export
 *  - on top of it the style note (style.ts: palette, fonts, type scale, radii, spacing — a closed toggle)
 *  - the deck (deck.ts, one page per deck, presentable) as a sub-page with a card on the page
 *  - the screenshots as image blocks below a heading (alt text, caption and their read-out text when Claude
 *    looked at them — the caller asks first and runs those requests)
 * apply.ts writes it in one store update (one Undo).
 */
import type { JSONContent } from '@tiptap/core'
import { basename, decodeText, dirname, extname, KEY_REF, normPath, resolveTarget, type ImportEntry, type ImportPlan, type PlanNode } from './plan'
import { extractDataImages, htmlTargets, htmlTitle } from './htmltext'
import { deckNodes, deckTitle, type DeckLabels } from './deck'
import { EMPTY_STYLE, htmlStyle, isEmptyStyle, mergeStyles, themeStyle, type DesignStyle } from './style'
import type { PptxDeck } from './pptx'
import type { ReportItem } from './report'

export interface DesignHtml {
  /** the picked file's name (an .html / .htm, or a .zip of the export) */
  name: string
  /** the unpacked files (one for a single HTML file) */
  entries: ImportEntry[]
}

export interface DesignShot {
  name: string
  data: Uint8Array
  /** what Claude said about it (only when the person asked for it) */
  alt?: string
  caption?: string
  /** the text Claude read out of it, as blocks */
  text?: JSONContent[]
}

export interface DesignParts {
  name: string
  html: DesignHtml | null
  deck: { name: string; deck: PptxDeck } | null
  shots: DesignShot[]
}

export interface DesignLabels {
  deck: DeckLabels
  screenshots: string
  /** the toggle with a screenshot's read-out text */
  shotText: string
}

const HTML_EXT = new Set(['html', 'htm', 'xhtml'])
const SHOT_DIR = '__shots__'
const DECK_DIR = '__deck__'

/** The HTML export's main file: index.html (shallowest first), else the first HTML file. */
export function mainHtml(entries: ImportEntry[]): ImportEntry | null {
  const pages = entries.filter((e) => HTML_EXT.has(extname(e.path))).sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path))
  return pages.find((e) => /^index\.html?$/i.test(basename(e.path))) ?? pages[0] ?? null
}

export interface ReadHtml {
  path: string
  html: string
  title: string | null
  style: DesignStyle
  /** files the page references (data: pictures included), keyed by path */
  files: Map<string, Uint8Array>
  /** inline SVG graphics (the converter leaves them out) */
  svgs: number
}

/** Read the HTML export: its text (data: pictures out into files), its title, its style. */
export function readDesignHtml(html: DesignHtml): ReadHtml | null {
  const main = mainHtml(html.entries)
  if (!main) return null
  const path = normPath(main.path)
  const dir = dirname(path)
  const stem = basename(path).replace(/\.[^.]+$/, '')
  const files = new Map<string, Uint8Array>()
  const raw = decodeText(main.data)
  const body = extractDataImages(
    raw,
    (x, i) => `${stem}_files/image-${i}.${x}`,
    (rel, bytes) => files.set(normPath(`${dir}/${rel}`), bytes),
  )
  // the files of a ZIP the page points to (pictures, media)
  const byPath = new Map(html.entries.map((e) => [normPath(e.path), e.data]))
  for (const href of htmlTargets(body)) {
    const p = resolveTarget(dir, href)
    const bytes = p ? byPath.get(p) : undefined
    if (p && bytes && !HTML_EXT.has(extname(p)) && extname(p) !== 'css' && extname(p) !== 'js') files.set(p, bytes)
  }
  return { path, html: body, title: htmlTitle(body), style: htmlStyle(raw), files, svgs: (raw.match(/<svg\b/gi) ?? []).length }
}

/** The style of everything dropped: the HTML's CSS first, then the deck's theme. */
export function designStyle(html: ReadHtml | null, deck: PptxDeck | null): DesignStyle {
  const a = html?.style ?? EMPTY_STYLE
  const b = deck?.theme ? themeStyle(deck.theme) : EMPTY_STYLE
  if (isEmptyStyle(a)) return b
  if (isEmptyStyle(b)) return a
  return mergeStyles(a, b)
}

const safeName = (name: string, i: number) => `${String(i + 1).padStart(2, '0')}-${basename(name).replace(/[^\w.-]+/g, '-').replace(/^-+/, '') || `screenshot-${i + 1}.png`}`

/** The import plan of a Claude Design take-over. `note` = the style note (null: none). */
export function designPlan(parts: DesignParts, html: ReadHtml | null, note: JSONContent | null, L: DesignLabels): ImportPlan {
  const files = new Map<string, Uint8Array>()
  const nodes: PlanNode[] = []
  const report: ReportItem[] = []
  const rootKey = '__design__'
  const dir = html ? dirname(html.path) : ''
  if (html) for (const [k, v] of html.files) files.set(k, v)
  if (html?.svgs) report.push({ code: 'svg', detail: `${parts.html?.name ?? 'HTML'} · ${html.svgs} SVG` })

  const after: JSONContent[] = []
  // the deck: its own sub-page (presentable), a card on the page
  if (parts.deck) {
    const title = deckTitle(parts.deck.deck, parts.deck.name.replace(/\.pptx$/i, ''))
    const d = deckNodes(parts.deck.deck, { layout: 'page', title, labels: L.deck, prefix: DECK_DIR, parentKey: rootKey })
    for (const [k, v] of d.files) files.set(k, v)
    nodes.push(...d.nodes)
    after.push({ type: 'pageLink', attrs: { pageId: `${KEY_REF}${d.root}` } })
    report.push(...deckReport(parts.deck.deck, parts.deck.name))
  }
  // the screenshots (relative to the page's directory)
  if (parts.shots.length) {
    after.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: L.screenshots }] })
    parts.shots.forEach((s, i) => {
      const rel = `${SHOT_DIR}/${safeName(s.name, i)}`
      files.set(normPath(dir ? `${dir}/${rel}` : rel), s.data)
      after.push({ type: 'image', attrs: { src: rel, alt: (s.alt ?? '').trim() || s.name.replace(/\.[^.]+$/, ''), caption: (s.caption ?? '').trim() } })
      if (s.text?.length) after.push({ type: 'details', attrs: { open: false }, content: [{ type: 'detailsSummary', content: [{ type: 'text', text: L.shotText }] }, { type: 'detailsContent', content: s.text }] })
    })
  }
  const root: PlanNode = {
    key: rootKey,
    kind: 'page',
    title: parts.name,
    hex: null,
    parentKey: null,
    dir,
    body: html ? html.html : '[]',
    format: html ? 'html' : 'doc',
    attachments: [],
    ...(note ? { before: [note] } : {}),
    ...(after.length ? { after } : {}),
  }
  return {
    nodes: [root, ...nodes],
    files,
    pathKeys: new Map(),
    roots: [rootKey],
    isNotion: false,
    warnings: [],
    source: 'design',
    name: parts.name,
    report,
  }
}

/** What a deck could not carry over 1:1 (for the import report). */
export function deckReport(deck: PptxDeck, name: string): ReportItem[] {
  const out: ReportItem[] = []
  for (const s of deck.slides) for (const l of s.lost) out.push({ code: `pptx-${l}` as ReportItem['code'], detail: s.title || `#${s.no}`, where: name })
  return out
}
