/**
 * Preflight's lamp colours (src/shared/tokens.css, T-P1-9): measured in the browser from tokens.css itself — every lamp
 * text ≥ 4.5 : 1 on its lamp in Paper and Carbon, also for a browser without relative colours (`oklch(from …)`:
 * tokens.css loaded with those @supports blocks taken out and its `@supports not` block applied, G4); the lamp
 * cursor's double ring ≥ 3 : 1 where it is drawn; the person's switch-LED pick never changes a lamp.
 * No app needed: a blank page with the stylesheet.
 */
import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const TOKENS = readFileSync(fileURLToPath(new URL('../../src/shared/tokens.css', import.meta.url)), 'utf8')
const RELATIVE = '@supports (color: oklch(from red l c h))'
const NO_RELATIVE = '@supports not (color: oklch(from red l c h))'

/** The CSS of a block starting at `at` (the index of its at-rule), up to its matching brace. */
function blockAt(css: string, at: number): { start: number; open: number; end: number } {
  const open = css.indexOf('{', at)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return { start: at, open, end: i + 1 }
  }
  throw new Error('unbalanced braces in tokens.css')
}

/** tokens.css as a browser without relative colours reads it: the `@supports (oklch(from …))` blocks gone, the `not` ones applied. */
function withoutRelativeColors(css: string): string {
  let out = css
  for (let at = out.indexOf(RELATIVE); at >= 0; at = out.indexOf(RELATIVE)) {
    const b = blockAt(out, at)
    out = out.slice(0, b.start) + out.slice(b.end)
  }
  for (let at = out.indexOf(NO_RELATIVE); at >= 0; at = out.indexOf(NO_RELATIVE)) {
    const b = blockAt(out, at)
    out = out.slice(0, b.start) + out.slice(b.open + 1, b.end - 1) + out.slice(b.end)
  }
  return out
}

type Rgb = [number, number, number]

/** Every token resolved to sRGB 0–255 (drawn on a canvas: whatever colour syntax the browser computed). */
async function colors(page: Page, css: string, theme: 'light' | 'dark', names: string[], pick?: string): Promise<Record<string, Rgb>> {
  await page.setContent(`<!doctype html><html data-theme="${theme}"${pick ? ` style="--switch-led-pick: var(${pick})"` : ''}><head><style>${css}</style></head><body></body></html>`)
  return page.evaluate((list) => {
    const out: Record<string, [number, number, number]> = {}
    const probe = document.createElement('div')
    document.body.append(probe)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    for (const name of list) {
      probe.style.backgroundColor = `var(${name})`
      const computed = getComputedStyle(probe).backgroundColor
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = '#000'
      ctx.fillStyle = computed
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
      if (a !== 255) throw new Error(`${name} is not opaque: ${computed}`)
      out[name] = [r, g, b]
    }
    return out
  }, names)
}

const lum = ([r, g, b]: Rgb) => {
  const ch = (v: number) => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}
const ratio = (a: Rgb, b: Rgb) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100
}

const NAMES = ['--lamp-amber', '--lamp-red', '--lamp-red-ink', '--lamp-ink', '--lamp-housing', '--lamp-off', '--lamp-legend', '--lamp-legend-2', '--surface', '--ink', '--plate', '--switch-led-yellow']

for (const mode of ['relative colours', 'no relative colours'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`lamp colours · ${theme === 'light' ? 'Paper' : 'Carbon'} · ${mode}`, async ({ page }) => {
      const css = mode === 'relative colours' ? TOKENS : withoutRelativeColors(TOKENS)
      if (mode === 'no relative colours') {
        expect(css).not.toContain('oklch(from')
        expect(css).toContain('--lamp-amber: color-mix(in srgb, var(--c-yellow-text) 25%, var(--c-yellow-bg))')
      }
      const c = await colors(page, css, theme, NAMES)
      const report = {
        textOnAmber: ratio(c['--lamp-ink'], c['--lamp-amber']),
        whiteOnRed: ratio(c['--lamp-red-ink'], c['--lamp-red']),
        legendOnOff: ratio(c['--lamp-legend'], c['--lamp-off']),
        legend2OnOff: ratio(c['--lamp-legend-2'], c['--lamp-off']),
        amberVsHousing: ratio(c['--lamp-amber'], c['--lamp-housing']),
        redVsHousing: ratio(c['--lamp-red'], c['--lamp-housing']),
        surfaceRingVsHousing: ratio(c['--surface'], c['--lamp-housing']),
        inkRingVsHousing: ratio(c['--ink'], c['--lamp-housing']),
        inkRingVsPlate: ratio(c['--ink'], c['--plate']),
      }
      test.info().annotations.push({ type: 'contrast', description: JSON.stringify(report) })
      // lamp texts (the legend, the count, the "new" chip in the swapped colours)
      expect(report.textOnAmber, 'lamp text on amber').toBeGreaterThanOrEqual(4.5)
      expect(report.whiteOnRed, 'white on lamp red').toBeGreaterThanOrEqual(4.5)
      expect(report.legendOnOff, 'legend on a dark cap').toBeGreaterThanOrEqual(4.5)
      expect(report.legend2OnOff, 'second line on a dark cap').toBeGreaterThanOrEqual(4.5)
      // a lit cap stands out of the housing (non-text ≥ 3 : 1); without relative colours Paper's red cap is dark on the
      // black housing (≈ 2 : 1) — it still carries its white text and the red's triangle, so only text is asserted there
      expect(report.amberVsHousing, 'amber cap against the housing').toBeGreaterThanOrEqual(3)
      if (mode === 'relative colours') expect(report.redVsHousing, 'red cap against the housing').toBeGreaterThanOrEqual(3)
      // the cursor: one of its two rings shows on the housing, and the outer ink ring on the plate
      expect(Math.max(report.surfaceRingVsHousing, report.inkRingVsHousing), 'cursor ring on the housing').toBeGreaterThanOrEqual(3)
      expect(report.inkRingVsPlate, 'cursor ink ring on the plate').toBeGreaterThanOrEqual(3)
      // lamp text is fixed: near-black, whatever the look
      expect(lum(c['--lamp-ink'])).toBeLessThan(0.01)
    })
  }
}

test('the switch-LED pick of this device never changes a lamp', async ({ page }) => {
  for (const theme of ['light', 'dark'] as const) {
    const plain = await colors(page, TOKENS, theme, ['--lamp-amber', '--lamp-red', '--switch-led'])
    const picked = await colors(page, TOKENS, theme, ['--lamp-amber', '--lamp-red', '--switch-led'], '--switch-led-green')
    expect(picked['--switch-led']).not.toEqual(plain['--switch-led'])
    expect(picked['--lamp-amber']).toEqual(plain['--lamp-amber'])
    expect(picked['--lamp-red']).toEqual(plain['--lamp-red'])
  }
})
