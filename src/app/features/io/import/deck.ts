/**
 * A read PowerPoint deck (pptx.ts) → One pages (pure, no DOM / store):
 *
 *  - layout 'page' (default): ONE page — per slide an H2 (its title) with its content, the speaker notes as
 *    a closed toggle "Notes" below, a divider between slides. Presentation mode splits a page at H1 / H2 and
 *    dividers and opens with a title slide (the page title + a short lede), so a clean title slide (the
 *    first slide: a title, at most two short lines, nothing else) becomes the page title + lede — every
 *    PowerPoint slide is then exactly one slide of One's presentation.
 *  - layout 'pages': a parent page (the title slide's lines, then a card per slide) and a sub-page per slide
 *  - deckDoc(deck): the 'page' layout as one doc (Claude for files: "Open as page")
 *  - deckPlan(deck, …): the nodes + files of an ImportPlan (apply.ts saves the pictures and writes it all in
 *    one store update — the whole import goes with one Undo)
 * Pictures stay as `image` blocks whose src is the media path inside the file (relative to the plan node's
 * directory) until apply.ts / the file panel stores them.
 */
import type { JSONContent } from '@tiptap/core'
import { normPath, type ImportPlan, type PlanNode } from './plan'
import type { PptxDeck, PptxSlide } from './pptx'

export type DeckLayout = 'page' | 'pages'

export interface DeckLabels {
  /** the notes toggle ("Notes") */
  notes: string
  /** an untitled slide ("Slide 4") */
  slide: (n: number) => string
}

const LEDE_CHARS = 280

const text = (s: string): JSONContent => ({ type: 'text', text: s })
const plain = (n: JSONContent): string => (n.text ?? '') + (n.content ?? []).map(plain).join(n.type === 'paragraph' ? '' : ' ')

/** The first slide is a clean title slide: its lines can be the page's lede. */
export function foldsTitle(deck: PptxDeck): boolean {
  const s = deck.slides[0]
  if (!s || !s.title || deck.slides.length < 2) return false
  if (!s.titleSlide || s.notes.length || s.images || s.tables || s.lost.length) return false
  if (s.blocks.length > 2 || !s.blocks.every((b) => b.type === 'paragraph')) return false
  return s.blocks.map(plain).join(' ').length <= LEDE_CHARS
}

/** The deck's title: the title slide's, else the file's own (docProps), else the file name. */
export function deckTitle(deck: PptxDeck, fallback: string): string {
  if (foldsTitle(deck)) return deck.slides[0].title
  return deck.title || fallback
}

/** The slides that become sections / pages (without a folded title slide). */
export const contentSlides = (deck: PptxDeck): PptxSlide[] => (foldsTitle(deck) ? deck.slides.slice(1) : deck.slides)

/** The lede on top of the page (a folded title slide's lines). */
export const ledeBlocks = (deck: PptxDeck): JSONContent[] => (foldsTitle(deck) ? deck.slides[0].blocks : [])

export const slideTitle = (s: PptxSlide, L: DeckLabels) => s.title || L.slide(s.no)

/** A slide's content and its notes toggle (no heading). */
export function slideBody(s: PptxSlide, L: DeckLabels): JSONContent[] {
  const out = [...s.blocks]
  if (s.notes.length) out.push({ type: 'details', attrs: { open: false }, content: [{ type: 'detailsSummary', content: [text(L.notes)] }, { type: 'detailsContent', content: s.notes }] })
  return out
}

/** The 'page' layout: lede, then per slide an H2 + content + notes, a divider between slides. */
export function deckBlocks(deck: PptxDeck, L: DeckLabels): JSONContent[] {
  const out: JSONContent[] = [...ledeBlocks(deck)]
  contentSlides(deck).forEach((s, i) => {
    if (i || out.length) out.push({ type: 'horizontalRule' })
    out.push({ type: 'heading', attrs: { level: 2 }, content: [text(slideTitle(s, L))] }, ...slideBody(s, L))
  })
  return out
}

export function deckDoc(deck: PptxDeck, L: DeckLabels): JSONContent {
  const content = deckBlocks(deck, L)
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
}

export interface DeckPlanOptions {
  layout: DeckLayout
  title: string
  labels: DeckLabels
  /** directory / key prefix inside a bigger plan ('' = none) */
  prefix?: string
  /** the plan node this deck hangs under (null = top level) */
  parentKey?: string | null
}

/** The deck as plan nodes + its pictures (files keyed by `<prefix>/<media path>`). Returns the root node's key. */
export function deckNodes(deck: PptxDeck, o: DeckPlanOptions): { nodes: PlanNode[]; files: Map<string, Uint8Array>; root: string } {
  const prefix = o.prefix ?? ''
  const key = (k: string) => normPath(prefix ? `${prefix}/${k}` : k)
  const files = new Map<string, Uint8Array>()
  for (const [p, bytes] of deck.media) files.set(key(p), bytes)
  const base = { hex: null, dir: prefix, format: 'doc' as const, attachments: [] as string[] }
  const root = key('__deck__')
  if (o.layout === 'page') {
    return { nodes: [{ ...base, key: root, kind: 'page', title: o.title, parentKey: o.parentKey ?? null, body: JSON.stringify(deckBlocks(deck, o.labels)) }], files, root }
  }
  const nodes: PlanNode[] = [{ ...base, key: root, kind: 'folder', title: o.title, parentKey: o.parentKey ?? null, body: JSON.stringify(ledeBlocks(deck)) }]
  for (const s of contentSlides(deck)) nodes.push({ ...base, key: key(`__slide__${s.no}`), kind: 'page', title: slideTitle(s, o.labels), parentKey: root, body: JSON.stringify(slideBody(s, o.labels)) })
  return { nodes, files, root }
}

/** A PowerPoint import: the deck as its own plan. */
export function deckPlan(deck: PptxDeck, o: DeckPlanOptions & { name: string }): ImportPlan {
  const { nodes, files, root } = deckNodes(deck, o)
  return { nodes, files, pathKeys: new Map(), roots: [root], isNotion: false, warnings: [], source: 'pptx', name: o.name, report: [] }
}
