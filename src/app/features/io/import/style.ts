/**
 * A design's style, read from what Claude Design exports (pure — no DOM, unit-testable in Node):
 *  - htmlStyle(html): the CSS of an HTML export (<style> blocks, inline style attributes, Google Fonts links)
 *    → colours (custom properties first, then the most used literal colours; a role guessed from the token
 *    name, then from where the colour is used, then from its lightness), fonts (first family of each stack;
 *    heading / body / mono by selector or token name), the type scale (font sizes in px with what uses
 *    them), radii and the spacing scale (with its base unit)
 *  - themeStyle(theme): a PowerPoint theme's colour slots, its heading / body fonts and the master's sizes
 *  - mergeStyles(a, b) · isEmptyStyle(s)
 *  - styleBlocks(style, labels): the style note as TipTap blocks (a swatch per colour — the nearest of One's
 *    colours —, hex, role, token; fonts; type scale; radii; spacing) — styleNote() wraps them in a closed
 *    toggle "Design tokens" for the top of a page; the memory example keeps the blocks as its pattern
 */
import type { JSONContent } from '@tiptap/core'
import type { ColorName } from '../../../store/types'
import type { PptxTheme } from './pptx'

export type ColorRole =
  | 'background'
  | 'surface'
  | 'text'
  | 'muted'
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'border'
  | 'link'
  | 'success'
  | 'warning'
  | 'danger'
  | 'dark'
  | 'light'
  | 'neutral'

export interface StyleColor {
  /** #rrggbb */
  hex: string
  role: ColorRole
  /** accent 1 … 6 of a theme */
  n?: number
  /** the custom property / theme slot it came from ('' = a literal in the CSS) */
  token: string
  uses: number
  /** the nearest of One's colours (the swatch) */
  tone: ColorName
}

export type FontRole = 'heading' | 'body' | 'mono' | 'other'

export interface StyleFont {
  family: string
  role: FontRole
}

export interface StyleSize {
  value: number
  unit: 'px' | 'pt'
  /** what uses it: "h1", "body", "--text-xl", "Title" … */
  uses: string[]
}

export interface DesignStyle {
  colors: StyleColor[]
  fonts: StyleFont[]
  sizes: StyleSize[]
  /** "4px", "12px", "full" */
  radii: string[]
  /** px, ascending */
  spacing: number[]
  /** the spacing grid (4, 8 …) or null */
  base: number | null
}

export const EMPTY_STYLE: DesignStyle = { colors: [], fonts: [], sizes: [], radii: [], spacing: [], base: null }

export const isEmptyStyle = (s: DesignStyle) => !s.colors.length && !s.fonts.length && !s.sizes.length && !s.radii.length && !s.spacing.length

const MAX_COLORS = 14
const MAX_FONTS = 5
const MAX_SIZES = 8
const MAX_RADII = 6
const MAX_SPACING = 8

/* ------------------------------------------------------------------ */
/* Colours                                                              */
/* ------------------------------------------------------------------ */

const NAMED: Record<string, string> = { white: '#ffffff', black: '#000000' }
const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')

/** A CSS colour → #rrggbb (null: not a colour, or mostly transparent). */
export function toHex(raw: string): string | null {
  const v = raw.trim().toLowerCase()
  if (NAMED[v]) return NAMED[v]
  let m = v.match(/^#([0-9a-f]{3,8})$/)
  if (m) {
    let h = m[1]
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
    if (h.length === 8) return parseInt(h.slice(6, 8), 16) < 128 ? null : `#${h.slice(0, 6)}`
    return h.length === 6 ? `#${h}` : null
  }
  m = v.match(/^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/)
  if (m) {
    const ch = (s: string) => (s.endsWith('%') ? (parseFloat(s) * 255) / 100 : parseFloat(s))
    const a = m[4] ? (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])) : 1
    if (a < 0.5) return null
    return `#${hex2(ch(m[1]))}${hex2(ch(m[2]))}${hex2(ch(m[3]))}`
  }
  m = v.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/)
  if (m) {
    const a = m[4] ? (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])) : 1
    if (a < 0.5) return null
    const [r, g, b] = hslToRgb(parseFloat(m[1]), parseFloat(m[2]) / 100, parseFloat(m[3]) / 100)
    return `#${hex2(r)}${hex2(g)}${hex2(b)}`
  }
  return null
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

/** #rrggbb → hue (0–360), saturation and lightness (0–1). */
export function hsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60
  return { h, s, l }
}

/** The nearest of One's colour names (for a swatch). */
export function toneOf(hex: string): ColorName {
  const { h, s, l } = hsl(hex)
  // near-black, near-white and pale neutrals (paper, borders) are greys
  if (s < 0.14 || l < 0.08 || l > 0.96 || (l > 0.88 && s < 0.6) || (l > 0.78 && s < 0.35)) return l < 0.25 ? 'default' : 'gray'
  if ((h >= 15 && h < 50 && l < 0.38) || (h >= 15 && h < 45 && s < 0.45)) return 'brown'
  if (h < 12 || h >= 345) return 'red'
  if (h < 38) return 'orange'
  if (h < 65) return 'yellow'
  if (h < 170) return 'green'
  if (h < 250) return 'blue'
  if (h < 290) return 'purple'
  return 'pink'
}

const ROLE_WORDS: Array<[RegExp, ColorRole]> = [
  [/(^|[-_])(bg|background|canvas|page|paper|base)($|[-_\d])/, 'background'],
  [/(^|[-_])(surface|card|panel|elevated|raised|sheet)($|[-_\d])/, 'surface'],
  [/(^|[-_])(muted|subtle|secondary-text|text-2|ink-2|faint|dim|grey|gray)($|[-_\d])/, 'muted'],
  [/(^|[-_])(text|fg|foreground|ink|body|copy|heading)($|[-_\d])/, 'text'],
  [/(^|[-_])(primary|brand|main)($|[-_\d])/, 'primary'],
  [/(^|[-_])(secondary)($|[-_\d])/, 'secondary'],
  [/(^|[-_])(accent|highlight|signal|cta|action)($|[-_\d])/, 'accent'],
  [/(^|[-_])(border|line|rule|stroke|divider|outline)($|[-_\d])/, 'border'],
  [/(^|[-_])(link|href)($|[-_\d])/, 'link'],
  [/(^|[-_])(success|positive|ok|good|green)($|[-_\d])/, 'success'],
  [/(^|[-_])(warning|warn|caution|yellow|amber)($|[-_\d])/, 'warning'],
  [/(^|[-_])(danger|error|negative|destructive|critical|red)($|[-_\d])/, 'danger'],
]

/** A role from a token name ("--color-brand-500" → primary). */
export function roleFromName(token: string): ColorRole | null {
  const n = token.toLowerCase().replace(/^--/, '')
  for (const [re, role] of ROLE_WORDS) if (re.test(n)) return role
  return null
}

/** A literal colour by where it is used most: a background, text, a border. */
function roleFromUse(hex: string, kind: string): ColorRole | null {
  const { s, l } = hsl(hex)
  if (kind === 'bg') return l > 0.9 ? 'background' : s > 0.35 && l < 0.75 ? 'accent' : 'surface'
  if (kind === 'text') return l < 0.3 ? 'text' : l > 0.85 ? 'light' : s > 0.35 ? 'accent' : 'muted'
  if (kind === 'border') return 'border'
  return null
}

/** Without a name: by lightness / saturation. */
function roleFromLook(hex: string): ColorRole {
  const { s, l } = hsl(hex)
  if (l > 0.93) return 'background'
  if (l < 0.18) return 'text'
  if (s > 0.35) return 'accent'
  return 'neutral'
}

/* ------------------------------------------------------------------ */
/* CSS                                                                  */
/* ------------------------------------------------------------------ */

interface Rule {
  selector: string
  decls: Array<[string, string]>
}

function declsOf(body: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const part of body.split(/;(?![^(]*\))/)) {
    const i = part.indexOf(':')
    if (i < 1) continue
    const prop = part.slice(0, i).trim().toLowerCase()
    const value = part.slice(i + 1).replace(/!important/i, '').trim()
    if (prop && value) out.push([prop, value])
  }
  return out
}

/** Every innermost rule of a stylesheet (rules inside @media / @supports included). */
function rulesOf(css: string): Rule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const out: Rule[] = []
  for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push({ selector: m[1].trim().replace(/\s+/g, ' '), decls: declsOf(m[2]) })
  return out
}

const decodeAttr = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')

/** The stylesheets and inline styles of an HTML document as rules (an inline style's selector is its tag). */
function htmlRules(html: string): { rules: Rule[]; fontLinks: string[] } {
  const rules: Rule[] = []
  const fontLinks: string[] = []
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    rules.push(...rulesOf(m[1]))
    for (const imp of m[1].matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)/gi)) fontLinks.push(imp[1])
  }
  for (const m of html.matchAll(/<([a-z][a-z0-9-]*)\b[^>]*?\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi)) rules.push({ selector: m[1].toLowerCase(), decls: declsOf(decodeAttr(m[3] ?? m[4] ?? '')) })
  for (const m of html.matchAll(/<link\b[^>]*?\shref\s*=\s*["']([^"']+)["'][^>]*>/gi)) if (/fonts\.(googleapis|bunny)\.net|fonts\.googleapis\.com/i.test(m[1])) fontLinks.push(decodeAttr(m[1]))
  return { rules, fontLinks }
}

/** var(--x, fallback) → its value (a few levels deep). */
function resolveVars(value: string, vars: Map<string, string>, depth = 0): string {
  if (depth > 6 || !value.includes('var(')) return value
  return resolveVars(
    value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g, (_all, name: string, fb?: string) => vars.get(name) ?? fb?.trim() ?? ''),
    vars,
    depth + 1,
  )
}

const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(?:white|black)\b/gi
const COLOR_PROPS: Array<[RegExp, 'bg' | 'text' | 'border' | 'other']> = [
  [/^background(-color)?$/, 'bg'],
  [/^color$/, 'text'],
  [/^(border|outline)(-[a-z]+)*(-color)?$/, 'border'],
  [/^(fill|stroke|caret-color|accent-color|text-decoration-color|column-rule-color)$/, 'other'],
]

/** "48px" / "3rem" / "36pt" / clamp(…, 56px) → px (null: relative only). */
export function toPx(raw: string): number | null {
  const v = raw.trim().toLowerCase()
  const fn = v.match(/^(?:clamp|max|min)\((.*)\)$/)
  if (fn) {
    const parts = fn[1].split(',').map((p) => toPx(p)).filter((n): n is number => n !== null)
    return parts.length ? (v.startsWith('min') ? Math.min(...parts) : Math.max(...parts)) : null
  }
  const m = v.match(/^(-?[\d.]+)(px|rem|em|pt)$/)
  if (!m) return null
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return null
  const px = m[2] === 'px' ? n : m[2] === 'pt' ? (n * 4) / 3 : n * 16
  return Math.round(px * 10) / 10
}

const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|ui-rounded|-apple-system|blinkmacsystemfont|inherit|initial|unset|emoji|math|fangsong|segoe ui emoji|apple color emoji)$/i
const MONO = /mono|code|courier|consolas|menlo|fira code|source code/i

/** The first real family of a font stack ('' when only generics). */
function familyOf(stack: string): string {
  for (const part of stack.split(',')) {
    const f = part.trim().replace(/^["']|["']$/g, '').trim()
    if (f && !GENERIC.test(f) && !/^var\(/.test(f)) return f
  }
  return ''
}

const fontRoleOf = (label: string, family: string): FontRole => {
  const s = label.toLowerCase()
  if (MONO.test(family) || /\b(code|pre|kbd|mono)\b/.test(s)) return 'mono'
  if (/\bh[1-6]\b|head|title|display|hero/.test(s)) return 'heading'
  if (/(^|[\s,>])(body|html|:root|p|main)\b|body|text|sans|base|copy/.test(s)) return 'body'
  return 'other'
}

const sizeLabel = (selector: string): string => {
  const m = selector.toLowerCase().match(/\b(h[1-6]|body|html|p|small|button|code|label|caption|lead|title|subtitle|display|hero|eyebrow|kicker)\b/)
  return m ? m[1] : selector.length <= 24 ? selector : ''
}

/** The style of an HTML export. */
export function htmlStyle(html: string): DesignStyle {
  const { rules, fontLinks } = htmlRules(html)
  const vars = new Map<string, string>()
  for (const r of rules) for (const [p, v] of r.decls) if (p.startsWith('--') && !vars.has(p)) vars.set(p, v)

  // colours
  const byHex = new Map<string, { token: string; uses: number; kinds: Record<string, number> }>()
  const note = (hex: string, token: string, kind: string | null) => {
    const e = byHex.get(hex) ?? { token: '', uses: 0, kinds: {} }
    if (token && !e.token) e.token = token
    if (kind) {
      e.uses++
      e.kinds[kind] = (e.kinds[kind] ?? 0) + 1
    }
    byHex.set(hex, e)
  }
  for (const [name, raw] of vars) {
    const hex = toHex(resolveVars(raw, vars))
    if (hex) note(hex, name, null)
  }
  for (const r of rules)
    for (const [p, raw] of r.decls) {
      if (p.startsWith('--')) continue
      const kind = COLOR_PROPS.find(([re]) => re.test(p))?.[1]
      if (!kind) continue
      const value = resolveVars(raw, vars)
      for (const lit of value.match(COLOR_LITERAL) ?? []) {
        const hex = toHex(lit)
        if (hex) note(hex, '', kind)
      }
    }
  const tokens = [...byHex.entries()].filter(([, e]) => e.token)
  const literals = [...byHex.entries()].filter(([, e]) => !e.token && e.uses > 0).sort((a, b) => b[1].uses - a[1].uses)
  const colors: StyleColor[] = [...tokens, ...literals].slice(0, MAX_COLORS).map(([hex, e]) => {
    const top = Object.entries(e.kinds).sort((a, b) => b[1] - a[1])[0]?.[0]
    const role = (e.token ? roleFromName(e.token) : null) ?? (top ? roleFromUse(hex, top) : null) ?? roleFromLook(hex)
    return { hex, role, token: e.token, uses: e.uses, tone: toneOf(hex) }
  })

  // fonts
  const fonts: StyleFont[] = []
  const addFont = (family: string, role: FontRole) => {
    if (!family) return
    const hit = fonts.find((f) => f.family.toLowerCase() === family.toLowerCase())
    if (hit) {
      if (hit.role === 'other' && role !== 'other') hit.role = role
      return
    }
    fonts.push({ family, role })
  }
  for (const [name, raw] of vars) if (/font|family|typeface/i.test(name)) addFont(familyOf(resolveVars(raw, vars)), fontRoleOf(name, familyOf(resolveVars(raw, vars))))
  for (const r of rules)
    for (const [p, raw] of r.decls) {
      if (p === 'font-family') {
        const fam = familyOf(resolveVars(raw, vars))
        addFont(fam, r.selector.startsWith('@font-face') ? 'other' : fontRoleOf(r.selector, fam))
      } else if (p === 'font') {
        const fam = familyOf(resolveVars(raw, vars).replace(/^.*?\d[\d.]*(px|rem|em|pt|%)(\/[\d.]+[a-z%]*)?\s+/i, ''))
        addFont(fam, fontRoleOf(r.selector, fam))
      }
    }
  for (const link of fontLinks) {
    for (const m of link.matchAll(/family=([^&:]+)/g)) {
      const fam = decodeURIComponent(m[1].replace(/\+/g, ' ')).trim()
      addFont(fam, MONO.test(fam) ? 'mono' : 'other')
    }
  }

  // type scale
  const sizes = new Map<number, Set<string>>()
  const addSize = (px: number | null, label: string) => {
    if (px === null || px < 8 || px > 200) return
    const set = sizes.get(px) ?? new Set<string>()
    if (label && set.size < 4) set.add(label)
    sizes.set(px, set)
  }
  for (const [name, raw] of vars) if (/font-size|text-|size|fs-|type-/i.test(name) && !/line|leading|tracking|weight/i.test(name)) addSize(toPx(resolveVars(raw, vars)), name)
  for (const r of rules) for (const [p, raw] of r.decls) if (p === 'font-size') addSize(toPx(resolveVars(raw, vars)), sizeLabel(r.selector))

  // radii
  const radii = new Set<string>()
  const addRadius = (raw: string) => {
    const first = raw.trim().split(/\s+/)[0] ?? ''
    if (/^(50%|100%)$/.test(first)) return radii.add('full')
    const px = toPx(first)
    if (px === null || px <= 0) return
    radii.add(px >= 500 ? 'full' : `${px}px`)
  }
  for (const [name, raw] of vars) if (/radius|rounded|corner/i.test(name)) addRadius(resolveVars(raw, vars))
  for (const r of rules) for (const [p, raw] of r.decls) if (/^border(-[a-z]+)*-radius$/.test(p)) addRadius(resolveVars(raw, vars))

  // spacing
  const space = new Map<number, number>()
  const addSpace = (raw: string) => {
    for (const tok of raw.trim().split(/\s+/)) {
      const px = toPx(tok)
      if (px === null || px <= 0 || px > 160 || px % 1) continue
      space.set(px, (space.get(px) ?? 0) + 1)
    }
  }
  for (const [name, raw] of vars) if (/space|spacing|gap|gutter|pad/i.test(name)) addSpace(resolveVars(raw, vars))
  for (const r of rules) for (const [p, raw] of r.decls) if (/^(padding|margin|gap|row-gap|column-gap)(-[a-z]+)*$/.test(p)) addSpace(resolveVars(raw, vars))
  const spacing = [...space.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_SPACING)
    .map(([px]) => px)
    .sort((a, b) => a - b)

  return {
    colors,
    fonts: fonts.slice(0, MAX_FONTS),
    sizes: [...sizes.entries()]
      .sort((a, b) => b[0] - a[0])
      .slice(0, MAX_SIZES)
      .map(([value, uses]) => ({ value, unit: 'px' as const, uses: [...uses] })),
    radii: [...radii].sort(radiusOrder).slice(0, MAX_RADII),
    spacing,
    base: baseOf(spacing),
  }
}

const radiusOrder = (a: string, b: string) => (a === 'full' ? 1 : b === 'full' ? -1 : parseFloat(a) - parseFloat(b))

/** The grid the spacing values sit on (8, 4, 2) — when most of them do. */
function baseOf(values: number[]): number | null {
  if (values.length < 3) return null
  for (const base of [8, 4, 2]) if (values.filter((v) => v % base === 0).length >= Math.ceil(values.length * 0.75)) return base
  return null
}

/* ------------------------------------------------------------------ */
/* PowerPoint theme                                                     */
/* ------------------------------------------------------------------ */

const SLOT_ROLE: Record<string, ColorRole> = { dk1: 'text', lt1: 'background', dk2: 'dark', lt2: 'light', hlink: 'link', folHlink: 'link' }

/** A PowerPoint theme as a style. */
export function themeStyle(theme: PptxTheme): DesignStyle {
  const colors: StyleColor[] = []
  for (const c of theme.colors) {
    if (colors.some((x) => x.hex === c.hex)) continue
    const accent = c.slot.match(/^accent(\d)$/)
    colors.push({ hex: c.hex, role: accent ? 'accent' : (SLOT_ROLE[c.slot] ?? 'neutral'), ...(accent ? { n: Number(accent[1]) } : {}), token: c.slot, uses: 0, tone: toneOf(c.hex) })
  }
  const fonts: StyleFont[] = []
  if (theme.major) fonts.push({ family: theme.major, role: 'heading' })
  if (theme.minor && theme.minor.toLowerCase() !== theme.major?.toLowerCase()) fonts.push({ family: theme.minor, role: 'body' })
  else if (theme.minor && fonts[0]) fonts[0].role = 'body'
  const sizes: StyleSize[] = []
  if (theme.titleSize) sizes.push({ value: theme.titleSize, unit: 'pt', uses: ['title'] })
  theme.bodySizes.forEach((v, i) => {
    const hit = sizes.find((s) => s.value === v)
    if (hit) hit.uses.push(`body ${i + 1}`)
    else sizes.push({ value: v, unit: 'pt', uses: [`body ${i + 1}`] })
  })
  return { colors, fonts, sizes, radii: [], spacing: [], base: null }
}

/** Two colours a reader cannot tell apart (every channel within 12). */
const near = (a: string, b: string) => [1, 3, 5].every((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 12)

/** Two styles → one (the first one's entries win; duplicates and near-duplicates out). */
export function mergeStyles(a: DesignStyle, b: DesignStyle): DesignStyle {
  const colors = [...a.colors]
  for (const c of b.colors) if (!colors.some((x) => near(x.hex, c.hex))) colors.push(c)
  const fonts = [...a.fonts]
  for (const f of b.fonts) if (!fonts.some((x) => x.family.toLowerCase() === f.family.toLowerCase())) fonts.push(f)
  return {
    colors: colors.slice(0, MAX_COLORS + 2),
    fonts: fonts.slice(0, MAX_FONTS + 2),
    sizes: [...a.sizes, ...b.sizes],
    radii: [...new Set([...a.radii, ...b.radii])].sort(radiusOrder),
    spacing: a.spacing.length ? a.spacing : b.spacing,
    base: a.base ?? b.base,
  }
}

/* ------------------------------------------------------------------ */
/* The note                                                             */
/* ------------------------------------------------------------------ */

export interface StyleLabels {
  /** the toggle's title ("Design tokens") */
  title: string
  /** the line on top ("From Claude Design · Acme · 9 colours …") */
  summary: string
  palette: string
  hex: string
  role: string
  token: string
  roleName: (role: ColorRole, n?: number) => string
  fonts: string
  fontRole: (role: FontRole) => string
  scale: string
  size: string
  usedFor: string
  radii: string
  full: string
  spacing: string
  base: (n: number) => string
}

const text = (s: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text: s, ...(marks?.length ? { marks } : {}) })
const p = (...content: JSONContent[]): JSONContent => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' })
const cell = (content: JSONContent[], header = false): JSONContent => ({ type: header ? 'tableHeader' : 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [p(...content)] })
const row = (cells: JSONContent[]): JSONContent => ({ type: 'tableRow', content: cells })
const bold = (s: string) => text(s, [{ type: 'bold' }])
const code = (s: string) => text(s, [{ type: 'code' }])
const fmt = (n: number) => String(Math.round(n * 10) / 10)

/** The style as blocks (no toggle): palette table, fonts, type scale, radii, spacing. */
export function styleBlocks(style: DesignStyle, L: StyleLabels): JSONContent[] {
  const out: JSONContent[] = [p(text(L.summary, [{ type: 'italic' }]))]
  if (style.colors.length) {
    out.push(p(bold(L.palette)))
    out.push({
      type: 'table',
      content: [
        row([cell([text(L.hex)], true), cell([text(L.role)], true), cell([text(L.token)], true)]),
        ...style.colors.map((c) =>
          row([
            // the swatch (the nearest of One's colours) and the real hex code
            cell([text('■■', [{ type: 'textStyle', attrs: { color: c.tone } }]), text(' '), code(c.hex)]),
            cell([text(L.roleName(c.role, c.n))]),
            cell(c.token ? [code(c.token)] : []),
          ]),
        ),
      ],
    })
  }
  if (style.fonts.length) {
    out.push(p(bold(L.fonts)))
    out.push({ type: 'bulletList', content: style.fonts.map((f) => ({ type: 'listItem', content: [p(text(`${L.fontRole(f.role)} — `), text(f.family, [{ type: 'bold' }]))] })) })
  }
  if (style.sizes.length) {
    out.push(p(bold(L.scale)))
    out.push({
      type: 'table',
      content: [row([cell([text(L.size)], true), cell([text(L.usedFor)], true)]), ...style.sizes.map((s) => row([cell([code(`${fmt(s.value)} ${s.unit}`)]), cell(s.uses.length ? [text(s.uses.join(', '))] : [])]))],
    })
  }
  if (style.radii.length) out.push(p(bold(`${L.radii}: `), text(style.radii.map((r) => (r === 'full' ? L.full : r.replace('px', ' px'))).join(' · '))))
  if (style.spacing.length) out.push(p(bold(`${L.spacing}: `), text(`${style.spacing.map(fmt).join(' · ')} px${style.base ? ` — ${L.base(style.base)}` : ''}`)))
  return out
}

/** The style note for the top of a page: a closed toggle "Design tokens" holding the blocks. */
export function styleNote(style: DesignStyle, L: StyleLabels): JSONContent {
  return { type: 'details', attrs: { open: false }, content: [{ type: 'detailsSummary', content: [text(L.title)] }, { type: 'detailsContent', content: styleBlocks(style, L) }] }
}
