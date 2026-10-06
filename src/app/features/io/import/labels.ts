/**
 * The words the PowerPoint / Claude Design readers put into pages, in the UI language — and their errors as
 * messages. (pptx.ts, deck.ts and style.ts stay language-free.)
 */
import { t } from '../../../i18n'
import { PPTX_MAX_BYTES, PPTX_MAX_SLIDES, PptxError, readPptx, type PptxDeck, type PptxLabels } from './pptx'
import type { DeckLabels } from './deck'
import type { DesignStyle, StyleLabels } from './style'

const plural = (n: number) => (n === 1 ? 'one' : 'other')

export const pptxLabels = (): PptxLabels => ({
  category: t('features.imp.pptx.category'),
  chart: (title) => (title ? t('features.imp.pptx.chart', { title }) : t('features.imp.pptx.chartUntitled')),
  chartLost: t('features.imp.pptx.chartLost'),
})

export const deckLabels = (): DeckLabels => ({ notes: t('features.imp.pptx.notes'), slide: (n) => t('features.imp.pptx.slide', { n }) })

/** Read a deck with the labels of the UI language. Throws PptxError. */
export const readDeck = (bytes: Uint8Array): PptxDeck => readPptx(bytes, pptxLabels())

/** A PptxError (or anything else) as a message. */
export function pptxErrorText(e: unknown, lang: string): string {
  const nf = new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-GB')
  if (!(e instanceof PptxError)) return t('features.imp.pptx.err.unreadable')
  if (e.issue === 'too_large') return t('features.imp.pptx.err.too_large', { mb: nf.format(PPTX_MAX_BYTES / 1048576) })
  if (e.issue === 'slides') return t('features.imp.pptx.err.slides', { n: nf.format(e.count ?? 0), max: nf.format(PPTX_MAX_SLIDES) })
  return t(`features.imp.pptx.err.${e.issue}`)
}

/** The style note's words; `name` = the design ("From acme.html · 9 colours …"). */
export function styleLabels(style: DesignStyle, name: string): StyleLabels {
  const count = (key: string, n: number) => (n ? [t(`features.imp.design.note.${key}.${plural(n)}`, { n })] : [])
  const list = [...count('colors', style.colors.length), ...count('fonts', style.fonts.length), ...count('sizes', style.sizes.length), ...count('radii', style.radii.length)].join(' · ')
  return {
    title: t('features.imp.design.tokens'),
    summary: t('features.imp.design.note.summary', { name, list }),
    palette: t('features.imp.design.note.palette'),
    hex: t('features.imp.design.note.hex'),
    role: t('features.imp.design.note.role'),
    token: t('features.imp.design.note.token'),
    roleName: (role, n) => (role === 'accent' && n ? t('features.imp.design.role.accentN', { n }) : t(`features.imp.design.role.${role}`)),
    fonts: t('features.imp.design.note.fonts'),
    fontRole: (role) => t(`features.imp.design.font.${role}`),
    scale: t('features.imp.design.note.scale'),
    size: t('features.imp.design.note.size'),
    usedFor: t('features.imp.design.note.usedFor'),
    radii: t('features.imp.design.note.radii'),
    full: t('features.imp.design.note.full'),
    spacing: t('features.imp.design.note.spacing'),
    base: (n) => t('features.imp.design.note.base', { n }),
  }
}
