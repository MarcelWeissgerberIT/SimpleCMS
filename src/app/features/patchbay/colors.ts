/**
 * Flat colours for the Patchbay's picture (plan §3.4, §6 A31, B5). The static schematic (render.ts renderStatic) is
 * written with design tokens, resolved to one theme's stock values (charts' resolveVars — never getComputedStyle), and
 * what is left are colour FUNCTIONS: tokens.css mixes most hardware colours with `color-mix()` and a few with
 * `oklch()`. A downloaded SVG must open in any viewer, so each of them is flattened to `rgb()` / `rgba()` here.
 *
 * flatColor(css) paints the colour into a 1×1 canvas and reads the pixel back — the browser's own colour engine does
 * the maths (color-mix interpolation, oklch gamut mapping), so nothing is re-implemented. A browser whose canvas does
 * not take a colour function falls back to a detached element's computed colour, painted the same way. Without a DOM
 * (Node) the text comes back unchanged. Used for the picture only (export), never for the page.
 */

/** Colour functions a resolved token may still hold (the longest name first: `color-mix(` before `color(`). */
const FUNCTIONS = /\b(color-mix|oklch|oklab|lch|lab|color|hsla?|hwb|light-dark)\(/g

const cache = new Map<string, string>()
let ctx: CanvasRenderingContext2D | null | undefined

function context(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx
  try {
    const c = document.createElement('canvas')
    c.width = 1
    c.height = 1
    ctx = c.getContext('2d', { willReadFrequently: true })
  } catch {
    ctx = null
  }
  return ctx
}

const SENTINEL = '#010203'

/** Paint a colour the canvas accepts and read it back (null: the canvas refused it). */
function paint(c: CanvasRenderingContext2D, css: string): string | null {
  c.fillStyle = SENTINEL
  c.fillStyle = css
  if (String(c.fillStyle).toLowerCase() === SENTINEL && css.toLowerCase() !== SENTINEL) return null
  c.clearRect(0, 0, 1, 1)
  c.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = c.getImageData(0, 0, 1, 1).data
  if (a === 255) return `rgb(${r}, ${g}, ${b})`
  if (a === 0) return 'rgba(0, 0, 0, 0)'
  return `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 1000) / 1000})`
}

/** The colour as the browser computes it on a detached element (the fallback for a canvas that refuses a function). */
function computed(css: string): string | null {
  try {
    const el = document.createElement('i')
    el.style.color = css
    if (!el.style.color) return null
    el.style.display = 'none'
    document.body.appendChild(el)
    const out = getComputedStyle(el).color
    el.remove()
    return out || null
  } catch {
    return null
  }
}

/** One CSS colour → `rgb(r, g, b)` / `rgba(r, g, b, a)` (unchanged without a DOM or when nobody can read it). */
export function flatColor(css: string): string {
  const key = css.trim()
  const hit = cache.get(key)
  if (hit) return hit
  if (typeof document === 'undefined') return key
  const c = context()
  let out: string | null = null
  if (c) {
    out = paint(c, key)
    if (!out) {
      const via = computed(key)
      if (via) out = paint(c, via)
    }
  }
  out ??= key
  cache.set(key, out)
  return out
}

/** The end of a function call starting at `open` (the index of its "("), counting nested parentheses (-1: none). */
function closing(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const ch = text[i]
    if (ch === '(') depth++
    else if (ch === ')' && --depth === 0) return i
  }
  return -1
}

/**
 * Replace every colour function in a text (an SVG) by its flat value — the outermost call each time, nested ones go
 * with it (`color-mix(in srgb, #121210 82%, color-mix(…))` is one colour).
 */
export function flattenColors(text: string, flat: (css: string) => string = flatColor): string {
  let out = ''
  let at = 0
  FUNCTIONS.lastIndex = 0
  for (let m = FUNCTIONS.exec(text); m; m = FUNCTIONS.exec(text)) {
    const open = m.index + m[0].length - 1
    const end = closing(text, open)
    if (end < 0) break
    out += text.slice(at, m.index) + flat(text.slice(m.index, end + 1))
    at = end + 1
    FUNCTIONS.lastIndex = at
  }
  return out + text.slice(at)
}
