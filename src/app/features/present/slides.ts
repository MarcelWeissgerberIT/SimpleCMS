/** Split a page into slides: a new slide starts at every H1/H2 and at every horizontal rule. */
import type { JSONContent } from '@tiptap/core'

export interface Slide {
  kind: 'title' | 'content'
  blocks: JSONContent[]
  /** heading text of the slide (for the overview / aria) */
  heading: string
}

const INLINE_PARENTS = new Set(['paragraph', 'heading', 'detailsSummary'])
function textOf(n: JSONContent): string {
  if (n.text) return n.text
  // inline atoms carry their text in attributes
  if (n.type === 'mention') return String(n.attrs?.label ?? '')
  if (n.type === 'inlineMath') return String(n.attrs?.latex ?? '')
  if (n.type === 'hardBreak') return ' '
  return (n.content ?? []).map(textOf).join(INLINE_PARENTS.has(n.type ?? '') ? '' : ' ')
}

/** Replace nodes recursively (used to swap interactive blocks for static ones on slides). */
export function mapBlocks(nodes: JSONContent[], fn: (n: JSONContent) => JSONContent[] | null): JSONContent[] {
  const out: JSONContent[] = []
  for (const n of nodes) {
    const r = fn(n)
    if (r) out.push(...r)
    else out.push(n.content ? { ...n, content: mapBlocks(n.content, fn) } : n)
  }
  return out
}

/** Heading level of a block for slide breaks: headings and toggle headings (0 = none). */
function headingLevel(b: JSONContent): number {
  if (b.type === 'heading') return Number(b.attrs?.level ?? 1)
  const h = Number(b.attrs?.heading)
  return b.type === 'details' && h >= 1 && h <= 3 ? h : 0
}

/** Text of a slide's heading block (a toggle heading's title, not its body). */
const headingText = (b: JSONContent) => textOf(b.type === 'details' ? (b.content?.[0] ?? {}) : b)

function isEmpty(n: JSONContent): boolean {
  return n.type === 'paragraph' && !textOf(n).trim() && !(n.content ?? []).some((c) => c.type !== 'text' && c.type !== 'hardBreak')
}

export function splitSlides(doc: JSONContent | null | undefined): Slide[] {
  const blocks = (doc?.content ?? []).filter(Boolean)
  const groups: JSONContent[][] = [[]]
  for (const b of blocks) {
    if (b.type === 'horizontalRule') {
      groups.push([])
      continue
    }
    const level = headingLevel(b)
    if (level && level <= 2 && groups[groups.length - 1].some((x) => !isEmpty(x))) groups.push([])
    groups[groups.length - 1].push(b)
  }
  const slides: Slide[] = []
  for (const g of groups) {
    const trimmed = g.filter((b, i) => !(isEmpty(b) && (i === 0 || i === g.length - 1)))
    if (!trimmed.some((b) => !isEmpty(b))) continue
    const h = trimmed.find((b) => headingLevel(b) > 0)
    slides.push({ kind: 'content', blocks: trimmed, heading: h ? headingText(h) : textOf(trimmed[0]).slice(0, 60) })
  }
  return slides
}

/**
 * The deck: a title slide (icon + title + a short lede if the page opens with one),
 * followed by the content slides.
 */
export function buildDeck(doc: JSONContent | null | undefined, title: string): { slides: Slide[]; lede: JSONContent[] } {
  const slides = splitSlides(doc)
  let lede: JSONContent[] = []
  const first = slides[0]
  if (first && first.blocks[0]?.type !== 'heading') {
    const chars = first.blocks.map(textOf).join(' ').length
    if (first.blocks.length <= 2 && chars <= 280 && first.blocks.every((b) => b.type === 'paragraph')) {
      lede = first.blocks
      slides.shift()
    }
  }
  return { slides: [{ kind: 'title', blocks: lede, heading: title }, ...slides], lede }
}

/** Plain text of a slide without its headings (for overview cards). */
export function slideText(s: Slide): string {
  return s.blocks
    .filter((b) => b.type !== 'heading')
    .map(textOf)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
