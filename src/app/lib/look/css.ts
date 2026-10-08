/**
 * The generated stylesheet of a workspace look (pure): the derived colour tokens for Paper and Carbon plus the
 * preview colours of Settings → Appearance's theme cards. Names come only from LOOK_TOKENS, every value must be
 * '#rrggbb' or 'rgba(r, g, b, a)' (anything else is skipped, never emitted), shadows are fixed templates filled
 * with checked rgba values — so the output can never hold url(, @, <, \, quotes or a broken-out declaration.
 *
 * Selectors are always `:root[data-look]…` (0,3,0 beats tokens.css). Never emit a bare `:root` or
 * `:root[data-theme='dark']` rule: the workspace HTML export copies exactly those rules from the page's
 * stylesheets (features/io/export/html.ts tokenCSS), and exports keep One's standard look.
 */
import type { WorkspaceLook } from '../../store/types'
import { sanitizeLook } from '../../store/look'
import { deriveLook, LOOK_TOKENS, type Derived, type LookToken } from './derive'
import { rgba } from './color'

const HEX = /^#[0-9a-f]{6}$/
const RGBA = /^rgba\([0-9]{1,3}, [0-9]{1,3}, [0-9]{1,3}, (0|1|0?\.[0-9]{1,3})\)$/
const ALLOWED = new Set<string>(LOOK_TOKENS)

const safe = (v: unknown): v is string => typeof v === 'string' && (HEX.test(v) || RGBA.test(v))

function declarations(d: Derived, shadows: boolean): string {
  const out: string[] = []
  for (const [name, value] of Object.entries(d.tokens) as Array<[LookToken, string]>) {
    if (ALLOWED.has(name) && safe(value)) out.push(`--${name}:${value}`)
  }
  // light shadows follow the ink (Carbon keeps its black ones)
  const ink = d.tokens.ink
  if (shadows && typeof ink === 'string' && HEX.test(ink)) {
    const a = (x: number) => rgba(ink, x)
    out.push(`--shadow-1:0 1px 0 ${a(0.04)}, 0 1px 2px ${a(0.06)}`)
    out.push(`--shadow-pop:0 0 0 1px var(--rule-strong), 0 16px 40px -12px ${a(0.28)}, 0 2px 6px ${a(0.08)}`)
    out.push(`--shadow-modal:0 0 0 1px var(--rule-strong), 0 40px 80px -20px ${a(0.4)}`)
  }
  return out.join(';')
}

/** The look's stylesheet ('' for a look with One's standard colours — fonts and corners need none). */
export function lookCss(input: WorkspaceLook | null): string {
  const look = sanitizeLook(input)
  if (!look) return ''
  const d = deriveLook(look)
  const light = declarations(d.light, true)
  const dark = declarations(d.dark, false)
  if (!light && !dark) return ''
  const pv: string[] = []
  const put = (name: string, v: string | undefined) => {
    if (safe(v) && HEX.test(v)) pv.push(`--look-pv-${name}:${v}`)
  }
  put('paper-bg', d.light.full.surface)
  put('paper-side', d.light.full['surface-2'])
  put('paper-ink', d.light.full.ink)
  put('paper-signal', d.light.full.signal)
  put('carbon-bg', d.dark.full.surface)
  put('carbon-side', d.dark.full['surface-2'])
  put('carbon-ink', d.dark.full.ink)
  put('carbon-signal', d.dark.full.signal)
  const rules = [`:root[data-look]{background:var(--bg);${pv.join(';')}}`]
  if (light) rules.push(`:root[data-look]:not([data-theme='dark']){color-scheme:light;${light}}`)
  if (dark) rules.push(`:root[data-look][data-theme='dark']{color-scheme:dark;${dark}}`)
  return rules.join('\n')
}
