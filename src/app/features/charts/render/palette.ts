/**
 * Chart colours. Marks use design tokens (CSS custom properties): the live chart, the HTML
 * export and the website follow the reader's theme by themselves. Standalone files (SVG / PNG
 * downloads) get the tokens of one theme written in — read from tokens.css itself, so no colour
 * value lives in this file.
 *
 * Series order (validated for colour-vision deficiencies on Paper): signal, ink, then the
 * content colours blue → yellow → pink → green → purple → brown → gray. Colour follows the
 * entity: series i keeps its colour whatever else is shown.
 */
import tokensCss from '@/shared/tokens.css?raw'
import type { ColorName } from '../../../store/types'

export const SERIES_ORDER = ['var(--signal)', 'var(--ink)', 'var(--c-blue-text)', 'var(--c-yellow-text)', 'var(--c-pink-text)', 'var(--c-green-text)', 'var(--c-purple-text)', 'var(--c-brown-text)', 'var(--c-gray-text)']

/** A ColorName as a mark colour ('default' = ink). */
export function colorVar(c: ColorName): string {
  return c === 'default' ? 'var(--ink)' : `var(--c-${c}-text)`
}

/**
 * The content-colour family of the signal (One's international orange by default). A workspace look with its own
 * signal (lib/look) passes its family: the content colours of that hue move to the end of the order, so a cobalt
 * signal never sits in the same chart as the blue series right behind it. Standalone files pass nothing (they are
 * drawn with the stock tokens).
 */
export type SignalFamily = ColorName | null | undefined
const STOCK_FAMILY: ColorName = 'orange'
/** Hues next to each other on the wheel that read as the same family. */
const NEAR: Partial<Record<ColorName, ColorName[]>> = { orange: ['orange', 'red'], red: ['red', 'orange'], brown: ['brown', 'orange'], yellow: ['yellow', 'brown'] }
const familyOf = (family: SignalFamily) => (family === undefined ? STOCK_FAMILY : family)
const nearVars = (family: SignalFamily): string[] => {
  const f = familyOf(family)
  return f ? (NEAR[f] ?? [f]).map(colorVar) : []
}

const orders = new Map<string, string[]>()
/** The series order for a signal family: that family's content colours last. */
export function seriesOrder(family?: SignalFamily): string[] {
  const key = String(familyOf(family))
  let out = orders.get(key)
  if (!out) {
    const near = nearVars(family)
    out = [...SERIES_ORDER.filter((c) => !near.includes(c)), ...SERIES_ORDER.filter((c) => near.includes(c))]
    orders.set(key, out)
  }
  return out
}

/** Colour of series i: explicit colour (spec.colors[i] ?? series.color; 'default' = automatic) or the fixed order. */
export function seriesColor(i: number, explicit?: ColorName | null, family?: SignalFamily): string {
  if (explicit && explicit !== 'default') return colorVar(explicit)
  const order = seriesOrder(family)
  return order[i % order.length]
}

/** Hues that read as the same colour next to each other (the signal's depend on its family). */
function sameHue(family: SignalFamily): Record<string, string[]> {
  const near = nearVars(family)
  const out: Record<string, string[]> = { 'var(--signal)': near }
  for (const c of near) out[c] = ['var(--signal)']
  return out
}

/**
 * Colours for categories (donut slices, coloured bars): the category's own colour (a select
 * option, a person) when it has one, else the next free colour of the order — never two of
 * the same hue.
 */
export function categoryColors(count: number, own: (ColorName | null | undefined)[] = [], explicit: ColorName[] = [], family?: SignalFamily): string[] {
  const used = new Set<string>()
  const same = sameHue(family)
  const order = seriesOrder(family)
  const taken = (c: string) => used.has(c) || (same[c] ?? []).some((x) => used.has(x))
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const set = explicit[i] && explicit[i] !== 'default' ? explicit[i] : null
    let c = set ? colorVar(set) : own[i] && own[i] !== 'default' ? colorVar(own[i]!) : ''
    if (!c || (taken(c) && !set)) c = order.find((x) => !taken(x)) ?? 'var(--ink-3)'
    used.add(c)
    out.push(c)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Theme tokens for standalone files                                   */
/* ------------------------------------------------------------------ */

export type ChartTheme = 'light' | 'dark'

let parsed: Record<ChartTheme, Record<string, string>> | null = null

function parseBlock(body: string, into: Record<string, string>) {
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of clean.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) into[m[1]] = m[2].trim()
}

/** Custom properties of tokens.css per theme (dark = light overridden by the Carbon block). */
export function themeTokens(theme: ChartTheme): Record<string, string> {
  if (!parsed) {
    const light: Record<string, string> = {}
    const dark: Record<string, string> = {}
    const css = tokensCss.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].replace(/\s+/g, '')
      if (sel === ':root') parseBlock(m[2], light)
      else if (sel === ":root[data-theme='dark']" || sel === ':root[data-theme="dark"]') parseBlock(m[2], dark)
    }
    parsed = { light, dark: { ...light, ...dark } }
  }
  return parsed[theme]
}

/** Replace var(--x) references with one theme's values (nested references resolved). */
export function resolveVars(text: string, theme: ChartTheme): string {
  const tokens = themeTokens(theme)
  const resolve = (name: string, depth = 0): string => {
    const v = tokens[name]
    if (v === undefined) return 'currentColor'
    return depth > 4 ? v : v.replace(/var\((--[\w-]+)\)/g, (_m, n: string) => resolve(n, depth + 1))
  }
  return text.replace(/var\((--[\w-]+)\)/g, (_m, n: string) => resolve(n))
}

/** The theme the app shows right now. */
export function currentTheme(): ChartTheme {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}
