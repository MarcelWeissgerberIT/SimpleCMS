/**
 * TEMPLATES — public API for other areas (features/templates; features/index.ts re-exports its own list from the
 * modules directly). Built-in and own templates, repeating database templates.
 *  - nextRun(repeat, now?): the next occurrence of a repeating template (pure; null: none)
 *  - templateRoots(pages): every live own template's root page (a page-map walk — lists only, never a hot path)
 *  - templateName(page): an own template's name as lists show it
 */
export { nextRun, type Occurrence } from './schedule'
export { templateRoots, templateName } from './own'
