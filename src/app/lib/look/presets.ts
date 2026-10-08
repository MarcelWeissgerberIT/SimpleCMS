/**
 * Presets and swatches of the workspace look (pure). Colour values here are look INPUTS (data the engine
 * derives tokens from, like a person's own hex) — the documented exception to "no raw hex outside tokens.css".
 * Fonts are only the self-hosted faces (Archivo, Newsreader, JetBrains Mono) and local system stacks, named by
 * the tokens.css variables — never a font URL.
 */
import type { LookHeadings, LookPresetId, LookTextFont, LookUiFont, WorkspaceLook } from '../../store/types'
import { DEFAULT_FONTS, STOCK_COLORS } from '../../store/look'

export type LookPreset = Omit<WorkspaceLook, 'updatedAt' | 'updatedBy'>

export const LOOK_PRESETS: Record<LookPresetId, LookPreset> = {
  paper: { preset: 'paper', colors: { ...STOCK_COLORS.light }, fonts: { ...DEFAULT_FONTS }, corners: 'standard' },
  blueprint: { preset: 'blueprint', colors: { paper: '#edf0f2', ink: '#0e1a2b', signal: '#2759db' }, fonts: { ui: 'archivo', text: 'ui', headings: 'condensed' }, corners: 'standard' },
  ochre: { preset: 'ochre', colors: { paper: '#f3eee2', ink: '#1c1912', signal: '#e0a000' }, fonts: { ...DEFAULT_FONTS }, corners: 'standard' },
  proof: { preset: 'proof', colors: { paper: '#f0eee8', ink: '#151515', signal: '#d4006e' }, fonts: { ui: 'archivo', text: 'serif', headings: 'serif' }, corners: 'standard' },
  swiss: { preset: 'swiss', colors: { paper: '#f4f4f2', ink: '#111111', signal: '#ff4f00' }, fonts: { ui: 'swiss', text: 'ui', headings: 'ui' }, corners: 'square' },
}

export interface Swatch {
  /** i18n key suffix: shell.ws.look.sw.<id> */
  id: string
  hex: string
}

export const SWATCHES: { signal: Swatch[]; paper: Swatch[]; ink: Swatch[]; carbonPaper: Swatch[]; carbonInk: Swatch[] } = {
  signal: [
    { id: 'orange', hex: '#ff4f00' },
    { id: 'vermilion', hex: '#e2401c' },
    { id: 'amber', hex: '#e0a000' },
    { id: 'green', hex: '#00704a' },
    { id: 'teal', hex: '#00838f' },
    { id: 'cobalt', hex: '#2759db' },
    { id: 'magenta', hex: '#d4006e' },
  ],
  paper: [
    { id: 'warm', hex: '#f2f0ea' },
    { id: 'neutral', hex: '#f4f4f2' },
    { id: 'cool', hex: '#edf0f2' },
    { id: 'sand', hex: '#f3eee2' },
    { id: 'newsprint', hex: '#f0eee8' },
    { id: 'sage', hex: '#eef0ea' },
  ],
  ink: [
    { id: 'carbon', hex: '#121210' },
    { id: 'graphite', hex: '#26282b' },
    { id: 'navy', hex: '#0e1a2b' },
    { id: 'sepia', hex: '#2b1d12' },
    { id: 'forest', hex: '#12211a' },
  ],
  carbonPaper: [
    { id: 'carbon', hex: '#111110' },
    { id: 'night', hex: '#0f141b' },
    { id: 'umber', hex: '#14120d' },
    { id: 'graphite', hex: '#121212' },
  ],
  carbonInk: [
    { id: 'paperInk', hex: '#ece9e2' },
    { id: 'cool', hex: '#e6ebf0' },
    { id: 'sand', hex: '#efe8d8' },
  ],
}

/** Font stacks by id (tokens.css variables) — for previews drawn in their own face. */
export const UI_FONT_STACKS: Record<LookUiFont, string> = {
  archivo: 'var(--font-archivo)',
  swiss: 'var(--font-swiss)',
  system: 'var(--font-system)',
}
export const TEXT_FONT_STACKS: Record<LookTextFont, string | null> = {
  ui: null,
  serif: 'var(--font-serif)',
  mono: 'var(--font-mono)',
}

/** The word space a heading choice adds back (look.css --head-word-spacing; 'ui' depends on the interface font). */
export function headWordSpacing(headings: LookHeadings, ui: LookUiFont): string {
  if (headings === 'normal') return '0.09em'
  if (headings === 'condensed') return '0.14em'
  if (headings === 'ui') return ui === 'archivo' ? '0.09em' : '0.02em'
  if (headings === 'serif') return '0.08em'
  return 'normal'
}

/** Heading specimens: the face, width and weight each choice draws (look.css sets the same tokens app-wide). */
export const HEADING_SPECIMENS: Record<LookHeadings, { family: string | null; stretch: string; wdth: number; weight: number; tracking: string }> = {
  expanded: { family: 'var(--font-archivo)', stretch: '125%', wdth: 125, weight: 800, tracking: '-0.02em' },
  normal: { family: 'var(--font-archivo)', stretch: '100%', wdth: 100, weight: 800, tracking: '-0.02em' },
  condensed: { family: 'var(--font-archivo)', stretch: '75%', wdth: 75, weight: 800, tracking: '-0.01em' },
  ui: { family: null, stretch: 'normal', wdth: 100, weight: 750, tracking: '-0.015em' },
  serif: { family: 'var(--font-serif)', stretch: 'normal', wdth: 100, weight: 600, tracking: '-0.015em' },
  mono: { family: 'var(--font-mono)', stretch: 'normal', wdth: 100, weight: 700, tracking: '-0.02em' },
}
