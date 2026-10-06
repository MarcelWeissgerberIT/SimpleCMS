import type { Lang, Translate } from '@/shared/i18n'
import type { SiteContent } from './messages'

/** Everything a section needs to render. */
export interface Ctx {
  lang: Lang
  t: Translate
  c: SiteContent
}

/** Sections in page order — drives the top-bar dial and the "§" numbering. */
export const SECTIONS = [
  { id: 'top', num: '00', key: 'sec.hero', tone: 'carbon' },
  { id: 'review', num: '01', key: 'sec.review', tone: 'paper' },
  { id: 'savings', num: '02', key: 'sec.savings', tone: 'paper' },
  { id: 'features', num: '03', key: 'sec.features', tone: 'paper' },
  { id: 'mcp', num: '04', key: 'sec.mcp', tone: 'carbon' },
  { id: 'up-close', num: '05', key: 'sec.deep', tone: 'paper' },
  { id: 'compare', num: '06', key: 'sec.compare', tone: 'paper' },
  { id: 'data-flow', num: '07', key: 'sec.privacy', tone: 'carbon' },
  { id: 'own-it', num: '08', key: 'sec.own', tone: 'signal' },
  { id: 'faq', num: '09', key: 'sec.faq', tone: 'paper' },
] as const

export type SectionId = (typeof SECTIONS)[number]['id']
