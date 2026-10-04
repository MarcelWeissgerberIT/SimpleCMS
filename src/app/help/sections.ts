/**
 * The manual's chapters, in order. Names are translated (help/messages.ts: `help.sec.<id>`); the
 * number is the "§ 03" of the chapter and the prefix of its articles ("§ 03.2"). Shared with the
 * static /help/ build (src/help-site) — keep it free of app imports.
 */
export const HELP_SECTIONS = [
  { id: 'start', num: '01' },
  { id: 'writing', num: '02' },
  { id: 'databases', num: '03' },
  { id: 'calculate', num: '04' },
  { id: 'ai', num: '05' },
  { id: 'mail', num: '06' },
  { id: 'share', num: '07' },
  { id: 'sync', num: '08' },
  { id: 'team', num: '09' },
  { id: 'privacy', num: '10' },
  { id: 'trouble', num: '11' },
] as const

export type HelpSectionId = (typeof HELP_SECTIONS)[number]['id']

export const sectionNum = (id: string): string => HELP_SECTIONS.find((s) => s.id === id)?.num ?? '00'

/** "03.2" for the second article of § 03. */
export const articleNum = (section: string, order: number): string => `${sectionNum(section)}.${order}`
