/**
 * The workspace look's colour engine (pure; Node specs import it): three inputs per theme — paper, ink, signal —
 * become the theme tokens, with contrast enforced (WCAG AA):
 *  - ink ≥ 7 : 1 on bg / surface / surface-2; quiet text (ink-2, ink-3) ≥ 4.5 : 1 there; ink-faint ≥ 3 : 1 on surface
 *  - signal ≥ 3 : 1 on surface (the focus ring's halo) and, where possible, on the toggle's lamp glass
 *  - the key label (on-signal) ≥ 4.5 : 1 on signal, signal used as text (signal-ink) ≥ 4.5 : 1 on bg / surface / surface-2
 *    (Carbon: also on the AI terminal's well — ink-inverse and its 5 / 8 % ink mixes)
 *  - signal used as text on an ink surface (signal-on-ink: toasts, the bubble menu, the Paper AI terminal) ≥ 4.5 : 1 on
 *    ink and its 5 / 8 % inverse-ink mixes — lightened on Paper's dark ink, darkened on Carbon's light ink
 *  - the paper stays light and calm (Paper L 0.948 – 0.985, Carbon L 0.13 – 0.26, chroma ≤ 0.025), so the fixed
 *    content colours (--c-*-text) keep ≥ 4.5 : 1 on every surface.
 * Only the groups whose inputs differ from tokens.css are emitted: a look that changes only the signal keeps
 * One's paper and inks exactly. The standard look is never derived. Hardware (toggles, screwed plates) follows
 * by itself: tokens.css mixes it from these tokens.
 *
 * Colour constants: STOCK_TOKENS are tokens.css values the engine computes against when a group is not emitted
 * (data, not styling; tests/e2e/look-engine.spec.ts keeps them equal to tokens.css).
 */
import type { ColorName, LookColors, WorkspaceLook } from '../../store/types'
import { STOCK_COLORS } from '../../store/look'
import { contrast, ensureContrast, fromOklch, hueDistance, mixOklab, mixSrgb, rgba, shiftL, toOklch, withL } from './color'

/** Every token a look may set (css.ts emits nothing else). */
export const LOOK_TOKENS = [
  'bg',
  'surface',
  'surface-2',
  'surface-3',
  'hover',
  'active',
  'ink',
  'ink-2',
  'ink-3',
  'ink-faint',
  'ink-inverse',
  'rule',
  'rule-strong',
  'led-off',
  'scrim',
  'signal',
  'signal-hover',
  'signal-press',
  'on-signal',
  'signal-ink',
  'signal-on-ink',
  'signal-wash',
  'signal-wash-strong',
  'selection',
  'led-on',
  'led-ok',
] as const
export type LookToken = (typeof LOOK_TOKENS)[number]
export type Mode = 'light' | 'dark'

type StockToken = 'bg' | 'surface' | 'surface-2' | 'surface-3' | 'ink' | 'ink-2' | 'ink-3' | 'ink-faint' | 'ink-inverse' | 'signal' | 'signal-ink' | 'signal-on-ink' | 'on-signal'
export const STOCK_TOKENS: Record<Mode, Record<StockToken, string>> = {
  light: { bg: '#f2f0ea', surface: '#faf9f5', 'surface-2': '#eae7df', 'surface-3': '#dfdbd1', ink: '#121210', 'ink-2': '#55524b', 'ink-3': '#67635b', 'ink-faint': '#8d897f', 'ink-inverse': '#faf9f5', signal: '#ff4f00', 'signal-ink': '#b83800', 'signal-on-ink': '#ff4f00', 'on-signal': '#121210' },
  dark: { bg: '#111110', surface: '#181816', 'surface-2': '#151513', 'surface-3': '#22211e', ink: '#ece9e2', 'ink-2': '#a9a59c', 'ink-3': '#8f8b83', 'ink-faint': '#6f6b63', 'ink-inverse': '#121210', signal: '#ff5c1a', 'signal-ink': '#ff7a3d', 'signal-on-ink': '#aa3600', 'on-signal': '#121210' },
}

/** The surfaces of an ink panel (toast, bubble menu; the Paper AI terminal): ink and its 5 / 8 % inverse-ink mixes. */
export function inkPanel(ink: string, inkInverse: string): string[] {
  return [ink, mixSrgb(inkInverse, ink, 0.05), mixSrgb(inkInverse, ink, 0.08)]
}
/** The Carbon AI terminal's well (agent.css: --t-bg = ink-inverse, its panels mix 5 / 8 % ink in). */
export function inkWell(ink: string, inkInverse: string): string[] {
  return [inkInverse, mixSrgb(ink, inkInverse, 0.05), mixSrgb(ink, inkInverse, 0.08)]
}

/** Paper lightness / chroma limits (OKLCH) per theme. */
export const PAPER_LIMITS: Record<Mode, { l: [number, number]; c: number }> = {
  light: { l: [0.948, 0.985], c: 0.025 },
  dark: { l: [0.13, 0.26], c: 0.025 },
}

/** The lamp glass of the toggle switch (tokens.css --toggle-window) for this theme's ink / bg. */
export function lampGlass(mode: Mode, ink: string, bg: string): string {
  return mode === 'light' ? mixSrgb(ink, '#000000', 0.94) : mixSrgb(bg, '#000000', 0.7)
}

export interface LookReport {
  /** contrast ratios the read-out shows */
  ratios: { text: number; quiet: number; signal: number; onSignal: number; signalText: number; signalOnInk: number }
  /** an input was changed to keep the contrast (or the paper calm) */
  adjusted: { paper: boolean; ink: boolean; signal: boolean }
  /** the colours in use (paper = bg) */
  used: LookColors
}

export interface Derived {
  /** what css.ts emits (only the groups whose inputs differ from tokens.css) */
  tokens: Partial<Record<LookToken, string>>
  /** the full table (emitted + stock) — previews and the report */
  full: Record<string, string>
  report: LookReport
  /** emitted: paper / ink group, signal group */
  emits: { paper: boolean; signal: boolean }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const GREEN = '#2f9e44'

/** Carbon inputs derived from Paper ("inverted paper": the ink becomes the background, the paper the text). */
export function darkInputsFrom(c: LookColors): LookColors {
  const L = STOCK_COLORS.light
  if (c.paper === L.paper && c.ink === L.ink) return { ...STOCK_COLORS.dark, signal: c.signal === L.signal ? STOCK_COLORS.dark.signal : c.signal }
  const i = toOklch(c.ink)
  const p = toOklch(c.paper)
  return {
    paper: fromOklch(clamp(i.l, 0.15, 0.22), Math.min(i.c, 0.025), i.h),
    ink: fromOklch(clamp(p.l - 0.025, 0.86, 0.94), Math.min(p.c * 1.2, 0.02), p.h),
    signal: c.signal === L.signal ? STOCK_COLORS.dark.signal : c.signal,
  }
}

/** The key-label colours (dark text / light text on the signal) — the same in both themes, from Paper. */
export interface Labels {
  deep: string
  pale: string
}

/** One theme's tokens from its three inputs. `labels`: Paper's key-label colours (Carbon uses them too). */
export function deriveMode(inputs: LookColors, mode: Mode, labels?: Labels): Derived & { labels: Labels } {
  const stock = STOCK_TOKENS[mode]
  const stockIn = STOCK_COLORS[mode]
  const light = mode === 'light'
  const dir: 1 | -1 = light ? -1 : 1
  const paperGroup = inputs.paper !== stockIn.paper || inputs.ink !== stockIn.ink
  const signalGroup = paperGroup || inputs.signal !== stockIn.signal
  const t: Partial<Record<LookToken, string>> = {}
  const full: Record<string, string> = { ...stock }
  let adjustedPaper = false
  let adjustedInk = false

  if (paperGroup) {
    const p = toOklch(inputs.paper)
    const lim = PAPER_LIMITS[mode]
    const l = clamp(p.l, lim.l[0], lim.l[1])
    const c = Math.min(p.c, lim.c)
    adjustedPaper = Math.abs(l - p.l) > 0.002 || c < p.c - 0.002
    const bg = fromOklch(l, c, p.h)
    const surface = light ? fromOklch(Math.min(l + 0.027, 0.995), c * 0.65, p.h) : fromOklch(l + 0.031, c, p.h)
    const s2 = light ? fromOklch(l - 0.027, c * 1.35, p.h) : fromOklch(l + 0.018, c, p.h)
    const s3 = light ? fromOklch(l - 0.063, c * 1.7, p.h) : fromOklch(l + 0.071, c * 1.4, p.h)
    const text = [bg, surface, s2]
    const ink = ensureContrast(inputs.ink, text, 7, dir)
    adjustedInk = ink !== inputs.ink
    const f = light ? [0.333, 0.413, 0.581, 0.757] : [0.279, 0.391, 0.531, 0.707]
    Object.assign(t, {
      bg,
      surface,
      'surface-2': s2,
      'surface-3': s3,
      ink,
      'ink-2': ensureContrast(mixOklab(ink, bg, f[0]), text, 4.5, dir),
      'ink-3': ensureContrast(mixOklab(ink, bg, f[1]), text, 4.5, dir),
      'ink-faint': ensureContrast(mixOklab(ink, bg, f[2]), [surface], 3, dir),
      'led-off': mixOklab(ink, bg, f[3]),
      'ink-inverse': light ? surface : bg,
      hover: rgba(ink, light ? 0.055 : 0.06),
      active: rgba(ink, light ? 0.09 : 0.1),
      rule: rgba(ink, light ? 0.1 : 0.09),
      'rule-strong': rgba(ink, light ? 0.2 : 0.18),
      ...(light ? { scrim: rgba(ink, 0.32) } : {}),
    } satisfies Partial<Record<LookToken, string>>)
    Object.assign(full, t)
  }

  const surface = full.surface
  const lab: Labels = labels ?? { deep: withL(full.ink, Math.min(toOklch(full.ink).l, 0.2)), pale: surface }
  let s = inputs.signal
  let on = stock['on-signal']
  if (signalGroup) {
    s = ensureContrast(inputs.signal, [surface], 3, dir)
    // the toggle's lamp lights in the signal colour behind dark glass: keep it visible there too, if the surface allows
    const glass = lampGlass(mode, full.ink, full.bg)
    if (contrast(s, glass) < 3) {
      const up = ensureContrast(s, [glass], 3, 1)
      if (contrast(up, surface) >= 3) s = up
    }
    on = contrast(lab.deep, s) >= contrast(lab.pale, s) ? lab.deep : lab.pale
    if (contrast(on, s) < 4.5) {
      // the dead zone between dark-label and light-label keys: move the signal away from the label
      on = light ? lab.pale : lab.deep
      s = ensureContrast(s, [on], 4.5, light ? -1 : 1)
    }
    const away = on === lab.deep ? 1 : -1
    const hover = shiftL(s, away > 0 ? 0.035 : -0.045)
    const press = shiftL(s, away > 0 ? 0.07 : -0.09)
    const text = [full.bg, surface, full['surface-2']]
    const signalInk = light ? ensureContrast(shiftL(s, -0.1), text, 4.5, -1) : ensureContrast(shiftL(s, 0.04), [...text, ...inkWell(full.ink, full['ink-inverse'])], 4.5, 1)
    const signalOnInk = ensureContrast(s, inkPanel(full.ink, full['ink-inverse']), 4.5, light ? 1 : -1)
    const sig: Partial<Record<LookToken, string>> = {
      signal: s,
      'signal-hover': hover,
      'signal-press': press,
      'on-signal': on,
      'signal-ink': signalInk,
      'signal-on-ink': signalOnInk,
      'signal-wash': rgba(s, light ? 0.1 : 0.12),
      'signal-wash-strong': rgba(s, light ? 0.18 : 0.22),
      selection: rgba(s, light ? 0.2 : 0.3),
      'led-on': s,
    }
    // a green signal would make "working" and "fine" LEDs the same colour: "fine" turns ink
    if (hueDistance(s, GREEN) < 35 && toOklch(s).c >= 0.06) sig['led-ok'] = mixOklab(full.ink, full.bg, 0.15)
    Object.assign(t, sig)
    Object.assign(full, sig)
  }
  const quiet = Math.min(contrast(full['ink-3'], full.bg), contrast(full['ink-3'], surface), contrast(full['ink-3'], full['surface-2']))
  const report: LookReport = {
    ratios: {
      text: Math.min(contrast(full.ink, full.bg), contrast(full.ink, surface)),
      quiet,
      signal: contrast(full.signal, surface),
      onSignal: contrast(full['on-signal'], full.signal),
      signalText: Math.min(contrast(full['signal-ink'], full.bg), contrast(full['signal-ink'], surface), contrast(full['signal-ink'], full['surface-2'])),
      signalOnInk: Math.min(...inkPanel(full.ink, full['ink-inverse']).map((x) => contrast(full['signal-on-ink'], x))),
    },
    adjusted: { paper: adjustedPaper, ink: adjustedInk, signal: signalGroup && s !== inputs.signal },
    used: { paper: full.bg, ink: full.ink, signal: full.signal },
  }
  return { tokens: t, full, report, emits: { paper: paperGroup, signal: signalGroup }, labels: lab }
}

export interface DerivedLook {
  light: Derived
  dark: Derived
  /** the Carbon inputs in use (look.dark or derived) */
  darkInputs: LookColors
}

const memo = new Map<string, DerivedLook>()

/** Both themes of a look (memoised, the 16 most recent inputs). */
export function deriveLook(look: Pick<WorkspaceLook, 'colors' | 'dark'>): DerivedLook {
  const key = JSON.stringify([look.colors, look.dark ?? null])
  const hit = memo.get(key)
  if (hit) {
    memo.delete(key)
    memo.set(key, hit)
    return hit
  }
  const light = deriveMode(look.colors, 'light')
  const darkInputs = look.dark ?? darkInputsFrom(look.colors)
  const dark = deriveMode(darkInputs, 'dark', light.labels)
  const out: DerivedLook = { light, dark, darkInputs }
  memo.set(key, out)
  if (memo.size > 16) memo.delete(memo.keys().next().value as string)
  return out
}

/** Hues of the content colours (tokens.css light --c-*-text): which family a signal belongs to. */
const FAMILY_REF: Array<[ColorName, string]> = [
  ['orange', '#b23600'],
  ['red', '#b42318'],
  ['yellow', '#7f5800'],
  ['green', '#256b37'],
  ['blue', '#23629e'],
  ['purple', '#6b4fa0'],
  ['pink', '#a83f73'],
  ['brown', '#8a5a3c'],
]

/** The content colour family nearest to a signal (charts keep the series apart); null for a grey signal. */
export function signalFamily(hex: string): ColorName | null {
  const c = toOklch(hex)
  if (c.c < 0.04) return null
  let best: ColorName = 'orange'
  let dist = 999
  for (const [name, ref] of FAMILY_REF) {
    const d = hueDistance(hex, ref)
    if (d < dist) {
      dist = d
      best = name
    }
  }
  return best
}
