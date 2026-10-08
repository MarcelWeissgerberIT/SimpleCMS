/**
 * The workspace look (Workspace.look, lib/look): the shape rules and the sanitizer every copy from outside
 * this tab goes through — stored records, backups, the team meta document, the per-device cache, the store's
 * own writes. Colours are '#rrggbb' only, every other field comes from an allow-list; unknown keys are dropped,
 * fresh objects only. A look that equals the standard one is no look (null): nothing is stored for it.
 *
 * Colour constants: STOCK_COLORS are the three inputs of tokens.css (Paper and Carbon) — data, not styling
 * (the documented exception to "no raw hex outside tokens.css"; tests/e2e/look-engine.spec.ts keeps them
 * equal to tokens.css). Pure: no DOM, no React (Node specs import it).
 */
import {
  LOOK_CORNERS,
  LOOK_HEADINGS,
  LOOK_PRESET_IDS,
  LOOK_TEXT_FONTS,
  LOOK_UI_FONTS,
  type LookColors,
  type LookCorners,
  type LookHeadings,
  type LookPresetId,
  type LookTextFont,
  type LookUiFont,
  type WorkspaceLook,
} from './types'

/** tokens.css --bg / --ink / --signal of Paper (light) and Carbon (dark) */
export const STOCK_COLORS: { light: LookColors; dark: LookColors } = {
  light: { paper: '#f2f0ea', ink: '#121210', signal: '#ff4f00' },
  dark: { paper: '#111110', ink: '#ece9e2', signal: '#ff5c1a' },
}

export const DEFAULT_FONTS: WorkspaceLook['fonts'] = { ui: 'archivo', text: 'ui', headings: 'expanded' }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback)

/** '#rgb' / '#rrggbb' / 'rgb' / 'rrggbb' (any case, trimmed) → '#rrggbb' lower case; anything else → null. */
export function normalizeHex(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 9) return null
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim())
  if (!m) return null
  const h = m[1].toLowerCase()
  return '#' + (h.length === 3 ? h.replace(/./g, (c) => c + c) : h)
}

function colorsOf(v: unknown, fallback: LookColors): { colors: LookColors; complete: boolean } {
  const src = isObj(v) ? v : {}
  const paper = normalizeHex(src.paper)
  const ink = normalizeHex(src.ink)
  const signal = normalizeHex(src.signal)
  return {
    colors: { paper: paper ?? fallback.paper, ink: ink ?? fallback.ink, signal: signal ?? fallback.signal },
    complete: !!(paper && ink && signal),
  }
}

const sameColors = (a: LookColors, b: LookColors) => a.paper === b.paper && a.ink === b.ink && a.signal === b.signal

/** The standard look as a full value (what the Look section starts a draft from). */
export function defaultLook(): WorkspaceLook {
  return { preset: 'paper', colors: { ...STOCK_COLORS.light }, fonts: { ...DEFAULT_FONTS }, corners: 'standard', updatedAt: 0, updatedBy: null }
}

/** One's standard look: stock Paper colours, Carbon not set (or the stock Carbon inputs), default type and corners. */
export function isDefaultLook(l: Pick<WorkspaceLook, 'colors' | 'dark' | 'fonts' | 'corners'>): boolean {
  return (
    sameColors(l.colors, STOCK_COLORS.light) &&
    (!l.dark || sameColors(l.dark, STOCK_COLORS.dark)) &&
    l.fonts.ui === DEFAULT_FONTS.ui &&
    l.fonts.text === DEFAULT_FONTS.text &&
    l.fonts.headings === DEFAULT_FONTS.headings &&
    l.corners === 'standard'
  )
}

/**
 * A clean copy of a stored / received look, or null (not a look, or the standard look). Bad colours fall back
 * to the stock value of that field; `dark` is kept only when all three of its colours are valid.
 */
export function sanitizeLook(v: unknown): WorkspaceLook | null {
  if (!isObj(v)) return null
  const fonts = isObj(v.fonts) ? v.fonts : {}
  const dark = v.dark === undefined || v.dark === null ? null : colorsOf(v.dark, STOCK_COLORS.dark)
  const out: WorkspaceLook = {
    preset: oneOf<LookPresetId>(LOOK_PRESET_IDS, v.preset, 'paper'),
    colors: colorsOf(v.colors, STOCK_COLORS.light).colors,
    fonts: {
      ui: oneOf<LookUiFont>(LOOK_UI_FONTS, fonts.ui, DEFAULT_FONTS.ui),
      text: oneOf<LookTextFont>(LOOK_TEXT_FONTS, fonts.text, DEFAULT_FONTS.text),
      headings: oneOf<LookHeadings>(LOOK_HEADINGS, fonts.headings, DEFAULT_FONTS.headings),
    },
    corners: oneOf<LookCorners>(LOOK_CORNERS, v.corners, 'standard'),
    updatedAt: typeof v.updatedAt === 'number' && Number.isFinite(v.updatedAt) && v.updatedAt >= 0 ? v.updatedAt : 0,
    updatedBy: typeof v.updatedBy === 'string' && v.updatedBy.length >= 1 && v.updatedBy.length <= 128 ? v.updatedBy : null,
  }
  if (dark?.complete) out.dark = dark.colors
  return isDefaultLook(out) ? null : out
}

/**
 * The same look? Compares colours, Carbon, type and corners (and the preset it started from); `meta: true`
 * also compares updatedAt / updatedBy (the binding: did the stored value change at all).
 */
export function sameLook(a: WorkspaceLook | null | undefined, b: WorkspaceLook | null | undefined, opts: { meta?: boolean } = {}): boolean {
  if (!a || !b) return !a && !b
  if (a.preset !== b.preset || !sameColors(a.colors, b.colors)) return false
  if (!!a.dark !== !!b.dark || (a.dark && b.dark && !sameColors(a.dark, b.dark))) return false
  if (a.fonts.ui !== b.fonts.ui || a.fonts.text !== b.fonts.text || a.fonts.headings !== b.fonts.headings || a.corners !== b.corners) return false
  return !opts.meta || (a.updatedAt === b.updatedAt && (a.updatedBy ?? null) === (b.updatedBy ?? null))
}

/** Colours, Carbon, type and corners only (no preset, no stamps): what the screen shows. */
export function sameAppearance(a: WorkspaceLook | null | undefined, b: WorkspaceLook | null | undefined): boolean {
  const x = a ?? defaultLook()
  const y = b ?? defaultLook()
  return sameLook({ ...x, preset: 'paper' }, { ...y, preset: 'paper' })
}

let mayStyle: () => boolean = () => true
/** Who may change the look here (the team binding registers: owners and admins). setLook refuses otherwise. */
export function setLookGuard(fn: () => boolean): void {
  mayStyle = fn
}
export const lookAllowed = (): boolean => mayStyle()
