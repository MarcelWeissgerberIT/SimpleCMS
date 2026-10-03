/**
 * Inline glyphs, loaded on demand: glyphSet.ts (~290 lucide icons as raw SVG nodes) is a chunk of its
 * own, fetched when the icon picker opens, when a page shows a glyph, and once at idle after the first
 * editor starts (schema/icon.ts) — so exports and copies made later draw glyphs as inline SVG.
 * The editor chunk itself only carries this loader.
 */
import type { DOMOutputSpec } from '@tiptap/pm/model'
import type { LucideIconNode } from 'lucide-react'

type GlyphModule = typeof import('./glyphSet')

let mod: GlyphModule | null = null
let loading: Promise<GlyphModule> | null = null
const waiters = new Set<() => void>()

export function loadGlyphs(): Promise<GlyphModule> {
  loading ??= import('./glyphSet').then(
    (m) => {
      mod = m
      for (const w of [...waiters]) w()
      return m
    },
    (err: unknown) => {
      // offline before the chunk was ever cached: try again next time
      loading = null
      throw err
    },
  )
  return loading
}

/** The registry once it is loaded (null until then). */
export const loadedGlyphs = (): GlyphModule | null => mod

/** Called once the registry is loaded. Returns an unsubscribe. */
export function subscribeGlyphs(cb: () => void): () => void {
  waiters.add(cb)
  return () => {
    waiters.delete(cb)
  }
}

export const SVG_NS = 'http://www.w3.org/2000/svg'

/** lucide's own SVG frame (24 × 24, round 2px strokes in the current text colour). */
export const SVG_FRAME: Record<string, string> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
}

/** Node attributes as SVG attributes (lucide's React `key`s dropped). */
export function svgAttrs(attrs: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(attrs)) if (k !== 'key' && v != null) out[k] = String(v)
  return out
}

/** A glyph as a live SVG element (node view). */
export function glyphElement(node: LucideIconNode[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  for (const [k, v] of Object.entries(SVG_FRAME)) svg.setAttribute(k, v)
  svg.setAttribute('aria-hidden', 'true')
  const add = (parent: Element, nodes: LucideIconNode[]) => {
    for (const [tag, attrs, kids] of nodes) {
      const el = document.createElementNS(SVG_NS, tag)
      for (const [k, v] of Object.entries(svgAttrs(attrs))) el.setAttribute(k, v)
      parent.appendChild(el)
      if (kids) add(el, kids)
    }
  }
  add(svg, node)
  return svg
}

/** The same glyph as a ProseMirror DOM spec (renderHTML: exports, the clipboard). */
export function glyphSpec(node: LucideIconNode[], attrs: Record<string, string>): DOMOutputSpec {
  const kids = (nodes: LucideIconNode[]): DOMOutputSpec[] => nodes.map(([tag, a, c]) => [`${SVG_NS} ${tag}`, svgAttrs(a), ...(c ? kids(c) : [])])
  return [`${SVG_NS} svg`, { ...SVG_FRAME, 'aria-hidden': 'true', ...attrs }, ...kids(node)]
}
