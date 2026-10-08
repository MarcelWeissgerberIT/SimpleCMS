/**
 * Colour maths for the workspace look (pure; Node specs import it): sRGB hex ⇄ OKLab / OKLCH (Björn Ottosson),
 * WCAG 2 relative luminance and contrast, gamut mapping by chroma reduction (a darkened orange stays orange
 * instead of turning red), and a contrast search along OKLCH lightness.
 */
export type RGB = [number, number, number]

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

export function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, '0')).join('')
}

const toLinear = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const fromLinear = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)

/** WCAG 2 relative luminance (0 … 1). */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2 contrast ratio (1 … 21). */
export function contrast(a: string, b: string): number {
  const x = luminance(a)
  const y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** sRGB hex → OKLab [L, a, b]. */
export function toOklab(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map(toLinear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

/** OKLab → linear sRGB (may lie outside 0 … 1). */
function oklabToLinear(L: number, a: number, b: number): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
}

const inGamut = (rgb: RGB) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4)

export interface Lch {
  l: number
  c: number
  /** hue in degrees (0 … 360) */
  h: number
}

export function toOklch(hex: string): Lch {
  const [l, a, b] = toOklab(hex)
  const h = (Math.atan2(b, a) * 180) / Math.PI
  return { l, c: Math.hypot(a, b), h: h < 0 ? h + 360 : h }
}

/** OKLCH → sRGB hex; outside sRGB the chroma is reduced (24-step binary search) so the hue holds. */
export function fromOklch(l: number, c: number, h: number): string {
  const L = clamp(l, 0, 1)
  const rad = (h * Math.PI) / 180
  const at = (chroma: number) => oklabToLinear(L, chroma * Math.cos(rad), chroma * Math.sin(rad))
  let rgb = at(c)
  if (!inGamut(rgb)) {
    let lo = 0
    let hi = c
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(at(mid))) lo = mid
      else hi = mid
    }
    rgb = at(lo)
  }
  return rgbToHex(rgb.map((v) => fromLinear(clamp(v, 0, 1))) as RGB)
}

/** The same colour at OKLCH lightness `l`. */
export function withL(hex: string, l: number): string {
  const c = toOklch(hex)
  return fromOklch(l, c.c, c.h)
}

/** Lighter (d > 0) or darker (d < 0) by `d` OKLCH lightness. */
export function shiftL(hex: string, d: number): string {
  const c = toOklch(hex)
  return fromOklch(clamp(c.l + d, 0, 1), c.c, c.h)
}

/** `t` of the way from `a` to `b`, mixed in OKLab. */
export function mixOklab(a: string, b: string, t: number): string {
  const x = toOklab(a)
  const y = toOklab(b)
  const lab = x.map((v, i) => v + (y[i] - v) * t) as [number, number, number]
  return rgbToHex(oklabToLinear(...lab).map((v) => fromLinear(clamp(v, 0, 1))) as RGB)
}

/** CSS color-mix(in srgb, a p%, b) — the mix tokens.css uses for the hardware colours. */
export function mixSrgb(a: string, b: string, p: number): string {
  const x = hexToRgb(a)
  const y = hexToRgb(b)
  return rgbToHex(x.map((v, i) => v * p + y[i] * (1 - p)) as RGB)
}

/** 'rgba(r, g, b, a)' — the only non-hex value the look emits. */
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  const a = Math.round(clamp(alpha, 0, 1) * 1000) / 1000
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

/** Hue distance in degrees (0 … 180). */
export function hueDistance(a: string, b: string): number {
  const d = Math.abs(toOklch(a).h - toOklch(b).h) % 360
  return d > 180 ? 360 - d : d
}

/**
 * `hex` moved along OKLCH lightness (dir −1 darker, +1 lighter; steps of 0.005, ≤ 200) until it reaches `min`
 * contrast against every colour of `against`. Returns the closest step that does (or the end of the range).
 */
export function ensureContrast(hex: string, against: string[], min: number, dir: 1 | -1): string {
  const ok = (h: string) => against.every((x) => contrast(h, x) >= min)
  if (ok(hex)) return hex
  const c = toOklch(hex)
  let out = hex
  for (let i = 1; i <= 200; i++) {
    const l = clamp(c.l + dir * 0.005 * i, 0, 1)
    out = fromOklch(l, c.c, c.h)
    if (ok(out) || l === 0 || l === 1) break
  }
  return out
}
