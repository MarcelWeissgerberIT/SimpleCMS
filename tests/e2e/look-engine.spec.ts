/**
 * The workspace look's engine (pure TypeScript, run in Node by the Playwright runner — no browser): colour
 * derivation keeps every contrast promise (WCAG AA) for hundreds of inputs in Paper and Carbon, the paper stays
 * calm enough for the fixed content colours, the stock constants equal tokens.css, the sanitizer drops anything
 * that is not a look, the generated stylesheet can only ever hold allow-listed names and hex / rgba values, and the
 * Look strings exist in EN and DE.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { contrast, mixSrgb, toOklch } from '../../src/app/lib/look/color'
import { darkInputsFrom, deriveLook, deriveMode, lampGlass, LOOK_TOKENS, PAPER_LIMITS, signalFamily, STOCK_TOKENS } from '../../src/app/lib/look/derive'
import { lookCss } from '../../src/app/lib/look/css'
import { LOOK_PRESETS, SWATCHES } from '../../src/app/lib/look/presets'
import { lookMessages } from '../../src/app/shell/workspace/look-messages'
import { LOOK_CORNERS, LOOK_HEADINGS, LOOK_PRESET_IDS, LOOK_TEXT_FONTS, LOOK_UI_FONTS } from '../../src/app/store/types'
import { normalizeHex, sameLook, sanitizeLook, STOCK_COLORS } from '../../src/app/store/look'
import type { LookColors, WorkspaceLook } from '../../src/app/store/types'

const TOKENS = readFileSync(fileURLToPath(new URL('../../src/shared/tokens.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
function block(selector: RegExp): Record<string, string> {
  const m = TOKENS.match(selector)
  const out: Record<string, string> = {}
  for (const d of (m?.[1] ?? '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim()
  return out
}
const LIGHT = block(/:root\s*\{([^}]*)\}/)
const DARK = { ...LIGHT, ...block(/:root\[data-theme='dark'\]\s*\{([^}]*)\}/) }
const contentText = (t: Record<string, string>) => Object.entries(t).filter(([k, v]) => /^--c-\w+-text$/.test(k) && v.startsWith('#')).map(([, v]) => v)

const look = (colors: LookColors, extra: Partial<WorkspaceLook> = {}): WorkspaceLook => ({ preset: 'paper', colors, fonts: { ui: 'archivo', text: 'ui', headings: 'expanded' }, corners: 'standard', updatedAt: 1, ...extra })

/** A deterministic pseudo-random hex triple stream. */
function* triples(n: number) {
  let seed = 20261008
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 0x100000000
  const hex = () => '#' + [0, 0, 0].map(() => Math.floor(rnd() * 256).toString(16).padStart(2, '0')).join('')
  for (let i = 0; i < n; i++) yield { paper: hex(), ink: hex(), signal: hex() }
}
const EDGE: LookColors[] = [
  { paper: '#f2f0ea', ink: '#121210', signal: '#ffe600' },
  { paper: '#f2f0ea', ink: '#121210', signal: '#2f9e44' },
  { paper: '#f2f0ea', ink: '#888888', signal: '#ff4f00' },
  { paper: '#000000', ink: '#121210', signal: '#ffffff' },
  { paper: '#ffffff', ink: '#ffffff', signal: '#ffffff' },
  { paper: '#000000', ink: '#000000', signal: '#000000' },
  { paper: '#ff0000', ink: '#00ff00', signal: '#0000ff' },
]

test('the stock constants are tokens.css', () => {
  expect(STOCK_COLORS.light).toEqual({ paper: LIGHT['--bg'], ink: LIGHT['--ink'], signal: LIGHT['--signal'] })
  expect(STOCK_COLORS.dark).toEqual({ paper: DARK['--bg'], ink: DARK['--ink'], signal: DARK['--signal'] })
  for (const [mode, table] of [['light', LIGHT], ['dark', DARK]] as const) {
    for (const [k, v] of Object.entries(STOCK_TOKENS[mode])) expect(v, `${mode} --${k}`).toBe(table[`--${k}`])
  }
})

test('the standard look derives nothing; near-stock paper reproduces the stock surfaces', () => {
  const d = deriveLook({ colors: STOCK_COLORS.light })
  expect(d.light.tokens).toEqual({})
  expect(d.dark.tokens).toEqual({})
  expect(lookCss(look(STOCK_COLORS.light, { fonts: { ui: 'swiss', text: 'serif', headings: 'mono' }, corners: 'square' }))).toBe('')
  expect(darkInputsFrom(STOCK_COLORS.light)).toEqual(STOCK_COLORS.dark)
  // only the signal changed: One's paper and inks stay exactly (no paper / ink tokens)
  const signalOnly = deriveMode({ ...STOCK_COLORS.light, signal: '#2759db' }, 'light')
  expect(signalOnly.tokens.bg).toBeUndefined()
  expect(signalOnly.tokens.signal).toBeDefined()
  const near = deriveMode({ ...STOCK_COLORS.light, paper: '#f2f0eb' }, 'light')
  expect([near.full.bg, near.full.surface, near.full['surface-2'], near.full['surface-3']]).toEqual(['#f2f0eb', '#faf9f6', '#eae7e0', '#dfdbd3'])
})

test('contrast guarantees hold for 640 random looks and the edge cases, Paper and Carbon', () => {
  const content = { light: contentText(LIGHT), dark: contentText(DARK) }
  expect(content.light.length).toBeGreaterThanOrEqual(8)
  // collected, then asserted once (a hundred thousand expect() calls would be slow)
  const failures: string[] = []
  const atLeast = (v: number, min: number, what: string) => {
    if (!(v >= min)) failures.push(`${what}: ${v.toFixed(2)} < ${min}`)
  }
  let checked = 0
  for (const colors of [...EDGE, ...triples(640)]) {
    const d = deriveLook({ colors })
    for (const mode of ['light', 'dark'] as const) {
      const f = d[mode].full
      const at = `${mode} ${colors.paper} ${colors.ink} ${colors.signal}`
      const text = [f.bg, f.surface, f['surface-2']]
      for (const s of text) {
        atLeast(contrast(f.ink, s), 7, `ink ${at}`)
        atLeast(contrast(f['ink-2'], s), 4.5, `ink-2 ${at}`)
        atLeast(contrast(f['ink-3'], s), 4.5, `ink-3 ${at}`)
        atLeast(contrast(f['signal-ink'], s), 4.5, `signal-ink ${at}`)
        for (const c of content[mode]) atLeast(contrast(c, s), 4.5, `content ${c} ${at}`)
      }
      atLeast(contrast(f['ink-faint'], f.surface), 3, `ink-faint ${at}`)
      atLeast(contrast(f.signal, f.surface), 3, `signal ${at}`)
      for (const k of ['signal', 'signal-hover', 'signal-press']) atLeast(contrast(f['on-signal'], f[k]), 4.5, `on ${k} ${at}`)
      // the toggle's hardware (tokens.css mixes it from these): plate edge = ink-3, lever = ink-2, ball = ink
      const plate = mixSrgb(f.ink, f.surface, mode === 'light' ? 0.13 : 0.14)
      for (const s of [...text, f['surface-3']]) atLeast(contrast(f['ink-3'], s), 3, `plate edge ${at}`)
      atLeast(contrast(f['ink-2'], plate), 3, `lever ${at}`)
      atLeast(contrast(f.ink, plate), 4.5, `ball ${at}`)
      // the paper stays light / dark and calm
      const p = toOklch(f.bg)
      const lim = PAPER_LIMITS[mode]
      if (p.l < lim.l[0] - 0.006 || p.l > lim.l[1] + 0.006) failures.push(`paper L ${p.l.toFixed(3)} ${at}`)
      if (p.c > lim.c + 0.006) failures.push(`paper C ${p.c.toFixed(3)} ${at}`)
      checked++
    }
  }
  expect(failures.slice(0, 20)).toEqual([])
  expect(checked).toBe((EDGE.length + 640) * 2)
})

test('presets: every promise, the lamp visible behind its glass, the series family', () => {
  for (const [id, p] of Object.entries(LOOK_PRESETS)) {
    const d = deriveLook(p)
    for (const mode of ['light', 'dark'] as const) {
      const f = d[mode].full
      expect(contrast(f.signal, lampGlass(mode, f.ink, f.bg)), `${id} ${mode} lamp`).toBeGreaterThanOrEqual(3)
      expect(d[mode].report.ratios.onSignal, `${id} ${mode}`).toBeGreaterThanOrEqual(4.5)
    }
  }
  // the presets themselves are not "adjusted" in Paper (their colours are used as chosen), except ochre's amber
  expect(deriveLook(LOOK_PRESETS.blueprint).light.report.adjusted.signal).toBe(false)
  expect(deriveLook(LOOK_PRESETS.ochre).light.report.adjusted.signal).toBe(true)
  expect(signalFamily('#ff4f00')).toBe('orange')
  expect(signalFamily('#2759db')).toBe('blue')
  expect(signalFamily('#d4006e')).toBe('pink')
  expect(signalFamily('#777777')).toBeNull()
})

test('a green signal keeps the "fine" LED apart from the "working" one', () => {
  const d = deriveMode({ ...STOCK_COLORS.light, signal: '#00704a' }, 'light')
  expect(d.tokens['led-ok']).toMatch(/^#[0-9a-f]{6}$/)
  expect(d.tokens['led-ok']).not.toBe(d.tokens['led-on'])
  expect(deriveMode({ ...STOCK_COLORS.light, signal: '#2759db' }, 'light').tokens['led-ok']).toBeUndefined()
})

test('sanitizeLook: hex only, allow-lists only, fresh objects, the standard look is no look', () => {
  expect(normalizeHex('#ABC')).toBe('#aabbcc')
  expect(normalizeHex(' 1F4FD1 ')).toBe('#1f4fd1')
  for (const bad of ['red', 'rgb(1,2,3)', '#12', '#1234567', 'url(x)', 'red;}</style><script>', 12, null]) expect(normalizeHex(bad)).toBeNull()
  const raw = {
    preset: 'blueprint',
    colors: { paper: '#ABC', ink: 'red;}</style><script>', signal: 'url(x)' },
    dark: { paper: '#000', ink: 'nope', signal: '#fff' },
    fonts: { ui: 'comic', text: 'serif', headings: 'mono', extra: 1 },
    corners: 'round',
    updatedAt: 'yesterday',
    updatedBy: 'x'.repeat(500),
    evil: '<script>',
  }
  const clean = sanitizeLook(raw)!
  expect(clean).toEqual({ preset: 'blueprint', colors: { paper: '#aabbcc', ink: STOCK_COLORS.light.ink, signal: STOCK_COLORS.light.signal }, fonts: { ui: 'archivo', text: 'serif', headings: 'mono' }, corners: 'standard', updatedAt: 0, updatedBy: null })
  expect(clean.colors).not.toBe(raw.colors)
  expect(sanitizeLook({ preset: 'swiss', colors: STOCK_COLORS.light, fonts: {}, corners: 'standard' })).toBeNull()
  expect(sanitizeLook('look')).toBeNull()
  expect(sanitizeLook([])).toBeNull()
  expect(sameLook(sanitizeLook({ ...LOOK_PRESETS.ochre, updatedAt: 5 }), sanitizeLook({ ...LOOK_PRESETS.ochre, updatedAt: 9 }))).toBe(true)
  expect(sameLook(sanitizeLook({ ...LOOK_PRESETS.ochre, updatedAt: 5 }), sanitizeLook({ ...LOOK_PRESETS.ochre, updatedAt: 9 }), { meta: true })).toBe(false)
})

test('lookCss: only allow-listed names, hex / rgba values, never a bare :root rule', () => {
  const names = new Set([...LOOK_TOKENS.map((t) => `--${t}`), '--shadow-1', '--shadow-pop', '--shadow-modal'])
  const VALUE = /^(#[0-9a-f]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (0|1|0?\.\d{1,3})\))$/
  const bad: string[] = []
  let rules = 0
  for (const colors of [...EDGE, ...triples(60), LOOK_PRESETS.proof.colors]) {
    const css = lookCss(look(colors, { dark: { paper: '#0f141b', ink: '#e6ebf0', signal: '#ff00aa' } }))
    if (!css) continue
    if (/url\(|@|<|\\|"/.test(css)) bad.push(`forbidden text in ${css}`)
    for (const rule of css.split('\n')) {
      rules++
      const m = rule.match(/^([^{]+)\{(.*)\}$/)
      if (!m) {
        bad.push(`rule shape: ${rule}`)
        continue
      }
      if (!/^:root\[data-look\](:not\(\[data-theme='dark'\]\)|\[data-theme='dark'\])?$/.test(m[1])) bad.push(`selector: ${m[1]}`)
      for (const decl of m[2].split(';')) {
        const [name, ...rest] = decl.split(':')
        const value = rest.join(':')
        const ok =
          name === 'background'
            ? value === 'var(--bg)'
            : name === 'color-scheme'
              ? /^(light|dark)$/.test(value)
              : name.startsWith('--look-pv-')
                ? /^#[0-9a-f]{6}$/.test(value)
                : name.startsWith('--shadow')
                  ? /^[0-9a-z\s,.\-()X]+$/.test(value.replace(/rgba\([^)]*\)/g, 'X'))
                  : names.has(name) && VALUE.test(value)
        if (!ok) bad.push(decl)
      }
    }
  }
  expect(bad.slice(0, 10)).toEqual([])
  expect(rules).toBeGreaterThan(60)
})

test('strings: EN and DE hold the same keys, none empty, and every key the Look UI asks for exists', () => {
  const { en, de } = lookMessages
  expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort())
  expect(Object.entries({ ...en, ...de }).filter(([, v]) => !String(v).trim())).toEqual([])
  const read = (p: string) => readFileSync(fileURLToPath(new URL(`../../src/app/${p}`, import.meta.url)), 'utf8')
  const sources = ['shell/workspace/Look.tsx', 'shell/workspace/Overview.tsx', 'shell/settings/SettingsModal.tsx', 'shell/lib/commands.ts'].map(read).join('\n')
  const literal = [...sources.matchAll(/'(shell\.(?:ws\.look|ws\.cmd\.look|settings\.appearance\.look)[\w.]*)'/g)].map((m) => m[1])
  const swatches = Object.values(SWATCHES).flat().map((s) => s.id)
  const families: [string, readonly string[]][] = [
    ['preset', LOOK_PRESET_IDS],
    ['presetNote', LOOK_PRESET_IDS],
    ['font', LOOK_UI_FONTS],
    ['text', LOOK_TEXT_FONTS],
    ['h', LOOK_HEADINGS],
    ['corners', LOOK_CORNERS],
    ['sw', swatches],
    ['mode', ['paper', 'carbon']],
  ]
  const wanted = [...new Set([...literal, ...families.flatMap(([f, ids]) => ids.map((id) => `shell.ws.look.${f}.${id}`))])]
  expect(literal.length).toBeGreaterThan(30)
  expect(wanted.filter((k) => !(k in en))).toEqual([])
})
