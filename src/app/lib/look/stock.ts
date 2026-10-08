/**
 * Every custom property of tokens.css per theme, as the file ships it (values may hold var() references) —
 * the Look section draws its Paper and Carbon preview plates with these, so the plates show a theme whatever
 * theme or look the app shows (inline custom properties resolve on the plate itself).
 */
import tokensCss from '@/shared/tokens.css?raw'

type Mode = 'light' | 'dark'
let parsed: Record<Mode, Record<string, string>> | null = null

function parseBlock(body: string, into: Record<string, string>) {
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) into[m[1]] = m[2].trim()
}

export function stockTokenTable(mode: Mode): Record<string, string> {
  if (!parsed) {
    const light: Record<string, string> = {}
    const dark: Record<string, string> = {}
    const css = tokensCss.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].replace(/\s+/g, '')
      if (sel === ':root') parseBlock(m[2], light)
      else if (sel === ":root[data-theme='dark']" || sel === ':root[data-theme="dark"]') parseBlock(m[2], dark)
    }
    // the plates take colours only: the type and size tokens come from the page (text size, the look's fonts)
    const colours = (t: Record<string, string>) => Object.fromEntries(Object.entries(t).filter(([k]) => !/^--(font|text|tracking|display|condensed|head|radius|sp|z|dur|ease|hairline)/.test(k)))
    parsed = { light: colours(light), dark: colours({ ...light, ...dark }) }
  }
  return parsed[mode]
}
