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

/** Colour of series i: explicit colour (spec.colors[i] ?? series.color) or the fixed order. */
export function seriesColor(i: number, explicit?: ColorName | null): string {
  if (explicit) return colorVar(explicit)
  return SERIES_ORDER[i % SERIES_ORDER.length]
}

/** Hues that read as the same colour next to each other. */
const SAME_HUE: Record<string, string[]> = {
  'var(--signal)': ['var(--c-orange-text)', 'var(--c-red-text)'],
  'var(--c-orange-text)': ['var(--signal)'],
  'var(--c-red-text)': ['var(--signal)'],
}

/**
 * Colours for categories (donut slices, coloured bars): the category's own colour (a select
 * option, a person) when it has one, else the next free colour of the order — never two of
 * the same hue.
 */
export function categoryColors(count: number, own: (ColorName | null | undefined)[] = [], explicit: ColorName[] = []): string[] {
  const used = new Set<string>()
  const taken = (c: string) => used.has(c) || (SAME_HUE[c] ?? []).some((x) => used.has(x))
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    let c = explicit[i] ? colorVar(explicit[i]) : own[i] && own[i] !== 'default' ? colorVar(own[i]!) : ''
    if (!c || (taken(c) && !explicit[i])) c = SERIES_ORDER.find((x) => !taken(x)) ?? 'var(--ink-3)'
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
