/**
 * The manual as data: every article in both languages, numbered and ordered by chapter. Pure — shared
 * by the in-app panel (help/content.ts feeds it the bundled files) and the static /help/ build.
 */
import { parseArticle, type ParsedArticle } from './markdown'
import { HELP_SECTIONS, articleNum } from './sections'

export type HelpLang = 'en' | 'de'
export const HELP_LANGS: HelpLang[] = ['en', 'de']

export interface HelpArticle extends ParsedArticle {
  lang: HelpLang
  /** "03.2" */
  num: string
  /** reading time in minutes (≥ 1) */
  minutes: number
}

export type HelpLibrary = Record<HelpLang, HelpArticle[]>

export interface HelpFile {
  lang: HelpLang
  /** file name without .md */
  id: string
  raw: string
}

const sectionIndex = (id: string) => {
  const i = HELP_SECTIONS.findIndex((s) => s.id === id)
  return i < 0 ? HELP_SECTIONS.length : i
}

/** Parse, number and sort. Problems (missing twin, unknown related id …) go to `warn`. */
export function buildLibrary(files: HelpFile[], warn: (msg: string) => void = () => {}): HelpLibrary {
  const lib: HelpLibrary = { en: [], de: [] }
  for (const f of files) {
    const a = parseArticle(f.raw, f.id)
    if (a.id !== f.id) warn(`help: ${f.lang}/${f.id}.md declares id "${a.id}"`)
    if (sectionIndex(a.section) >= HELP_SECTIONS.length) warn(`help: ${f.lang}/${f.id}.md has an unknown section "${a.section}"`)
    const words = a.plain.split(/\s+/).filter(Boolean).length
    lib[f.lang].push({ ...a, id: f.id, lang: f.lang, num: articleNum(a.section, a.order), minutes: Math.max(1, Math.round(words / 200)) })
  }
  for (const lang of HELP_LANGS) {
    lib[lang].sort((a, b) => sectionIndex(a.section) - sectionIndex(b.section) || a.order - b.order || a.id.localeCompare(b.id))
    const ids = new Set(lib[lang].map((a) => a.id))
    for (const a of lib[lang]) for (const r of a.related) if (!ids.has(r)) warn(`help: ${lang}/${a.id}.md relates to unknown "${r}"`)
  }
  const en = new Set(lib.en.map((a) => a.id))
  const de = new Set(lib.de.map((a) => a.id))
  for (const id of en) if (!de.has(id)) warn(`help: "${id}" has no German version`)
  for (const id of de) if (!en.has(id)) warn(`help: "${id}" has no English version`)
  return lib
}

export function findArticle(lib: HelpLibrary, lang: HelpLang, id: string): HelpArticle | undefined {
  return lib[lang].find((a) => a.id === id) ?? lib[lang === 'de' ? 'en' : 'de'].find((a) => a.id === id)
}

export function sectionArticles(lib: HelpLibrary, lang: HelpLang, section: string): HelpArticle[] {
  return lib[lang].filter((a) => a.section === section)
}

export function relatedArticles(lib: HelpLibrary, lang: HelpLang, a: HelpArticle): HelpArticle[] {
  return a.related.map((id) => findArticle(lib, lang, id)).filter((x): x is HelpArticle => !!x)
}

/** Previous / next article in the same chapter. */
export function neighbours(lib: HelpLibrary, lang: HelpLang, a: HelpArticle): { prev?: HelpArticle; next?: HelpArticle } {
  const list = sectionArticles(lib, lang, a.section)
  const i = list.findIndex((x) => x.id === a.id)
  return { prev: i > 0 ? list[i - 1] : undefined, next: i >= 0 ? list[i + 1] : undefined }
}

/** Path of an article on the public site, relative to the site root: help/<id>/ (English), help/de/<id>/ (German). */
export function helpPath(lang: HelpLang, id?: string | null): string {
  return `help/${lang === 'de' ? 'de/' : ''}${id ? `${id}/` : ''}`
}
