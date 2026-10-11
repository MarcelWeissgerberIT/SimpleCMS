/**
 * Task block — the titles a task's Markdown field line writes for its links ("Blocked by: [Draft copy](one:item/wi_…)").
 *
 * Only the one-off Markdown EXPORT writes titles: it runs `docToMarkdown` inside `withItemLabels(() => …)`. Everywhere
 * else (coding trust / refs hashes, AI reads, `pageForAI`, folder / GitHub sync) the label is the itemId, so a page's
 * Markdown stays a function of its own document — renaming a task on another page never changes it, and no title
 * of another page (a private one least of all) leaks into what Claude reads or a synced repository holds.
 *
 * `setItemTitleLookup(fn)` is registered by features/workitems (startItems): the live winner's title when it is
 * not on a private page, null otherwise (the id is written then). The flag is a synchronous scope: nest freely,
 * never across an await.
 */

type TitleLookup = (itemId: string) => string | null

let lookup: TitleLookup | null = null
let depth = 0

/** Register how a linked task's title is found (features/workitems). */
export function setItemTitleLookup(fn: TitleLookup | null): void {
  lookup = fn
}

/** Run `fn` with task titles as link labels in the Markdown it writes (synchronous scope). */
export function withItemLabels<T>(fn: () => T): T {
  depth++
  try {
    return fn()
  } finally {
    depth--
  }
}

/** The label of a link to `itemId`: its title inside `withItemLabels` (and only when the lookup gives one), else null = the id. */
export function itemLabel(itemId: string): string | null {
  if (depth === 0 || !lookup) return null
  const title = lookup(itemId)
  return title && title.trim() ? title.trim() : null
}
