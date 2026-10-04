import { helpPath, type HelpLang } from './library'

/** An article (or the index) on the public site, under the Vite base: /help/<id>/, /help/de/<id>/ … */
export function helpPublicUrl(lang: HelpLang, id?: string | null): string {
  return `${import.meta.env.BASE_URL}${helpPath(lang, id)}`
}
