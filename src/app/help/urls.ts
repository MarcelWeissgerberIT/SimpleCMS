import { helpPath, type HelpLang } from './library'
import { CHANGELOG_PATH_ID } from './changelog/entries'

/** An article (or the index) on the public site, under the Vite base: /help/<id>/, /help/de/<id>/ … */
export function helpPublicUrl(lang: HelpLang, id?: string | null): string {
  return `${import.meta.env.BASE_URL}${helpPath(lang, id)}`
}

/** "What's new" on the public site: /help/changelog/ (/help/de/changelog/), an entry as its anchor. */
export function changelogPublicUrl(lang: HelpLang, entryId?: string | null): string {
  return `${helpPublicUrl(lang, CHANGELOG_PATH_ID)}${entryId ? `#${entryId}` : ''}`
}
