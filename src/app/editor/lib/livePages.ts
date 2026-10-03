import type { ID, Page } from '../../store/types'
import { templateScope } from '../../store/selectors'

/**
 * Ids of pages that are really alive: neither trashed nor inside a trashed parent (the subtree
 * goes with its parent on "Empty trash" — see isEffectivelyTrashed in store/selectors).
 * One pass over the workspace, each ancestor chain walked once; compute it when a picker opens.
 */
export function liveIds(pages: Record<ID, Page>): Set<ID> {
  const dead = new Map<ID, boolean>()
  const live = new Set<ID>()
  for (const id of Object.keys(pages)) {
    const chain: ID[] = []
    const seen = new Set<ID>()
    let cur: Page | undefined = pages[id]
    let trashed = false
    while (cur) {
      const known = dead.get(cur.id)
      if (known !== undefined) {
        trashed = known
        break
      }
      if (seen.has(cur.id)) break // parent cycle: stop like selectBreadcrumbs does
      seen.add(cur.id)
      chain.push(cur.id)
      if (cur.trashed) {
        trashed = true
        break
      }
      cur = cur.parentId ? pages[cur.parentId] : undefined
    }
    for (const c of chain) dead.set(c, trashed)
    if (!dead.get(id)) live.add(id)
  }
  return live
}

/**
 * Pages to offer in a picker (link, mention, move to, linked database) opened on page `near`:
 * live ones only, and template pages (features/templates) only from a page of the same template.
 */
export function livePages(pages: Record<ID, Page>, near?: ID | null): Page[] {
  const live = liveIds(pages)
  const scope = templateScope(pages, near)
  return Object.values(pages).filter((p) => live.has(p.id) && scope(p.id))
}
