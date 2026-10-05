/**
 * HELP AREA — public API (contract). Other areas import ONLY from this file.
 *
 *  - HelpHost { shortcuts? }: the Help panel (right-hand sheet, full screen on phones); mount once — the
 *    shell renders it with its keyboard sheet for the "Keys" tab. Nothing loads before it first opens.
 *  - openHelp(target?) / closeHelp() / toggleHelp(): target = an article id ("formulas"),
 *    { tab: 'keys' }, or { tab: 'ask', question?, run? } ("Ask the help": Claude answers from the articles)
 *  - HelpLink { id, topic? }: a small "?" keycap that opens one article
 *  - useHelpHits(term, lang): help articles for the command palette (loads the manual on first use)
 *  - helpPublicUrl(lang, id?): the article on the public site (/help/, /help/de/<id>/ …, under the Vite base)
 *  - "What's new" (changelog/): openChangelog(id?) opens the list or one entry; HelpNewsLed — the signal LED
 *    for the help entry while an entry is newer than the last one this device opened; useChangelogUnseen();
 *    changelogPublicUrl(lang, id?) — /help/changelog/ (an entry as its #anchor)
 *
 * Articles: src/app/help/articles/{en,de}/<id>.md (front matter + a small Markdown subset, see markdown.ts);
 * the same files build the static pages at /help/ (src/help-site, vite.config.ts). Changelog entries:
 * src/app/help/changelog/{en,de}/<yyyy-mm-dd>-<slug>.md (see changelog/README.md) → /help/changelog/.
 */
export { HelpHost, type HelpHostProps } from './HelpHost'
export { HelpLink, type HelpLinkProps } from './HelpLink'
export { openHelp, closeHelp, toggleHelp, openChangelog, useHelp, type HelpTarget, type HelpLoc, type HelpTab } from './state'
export { useHelpHits, type HelpPaletteHit } from './palette'
export { helpPublicUrl, changelogPublicUrl } from './urls'
export { HelpNewsLed } from './changelog/NewsLed'
export { useChangelogUnseen } from './changelog/seen'
