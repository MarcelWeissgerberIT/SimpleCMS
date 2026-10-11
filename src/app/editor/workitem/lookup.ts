/**
 * Task block — the lookup registry: what the editor asks about tasks outside its own document (the ids
 * plugin, the creation gate). features/workitems registers the workspace index here at boot
 * (`startItems()` → `setItemLookup`); the editor never imports features.
 *
 * The default is FAIL-CLOSED: nothing taken, nothing gone, nothing private and NO creation — a path that runs
 * before the index registered (or in a build without it) never makes a new task the server could refuse.
 */

export interface ItemLookup {
  /** another block of this device holds it (any page but `pageId`, trash and templates included, synced copies not) */
  taken(itemId: string, pageId: string | null): boolean
  /** no block of this device holds it any more (this doc not counted) */
  gone(itemId: string, pageId: string | null): boolean
  /** the live task with this id sits on a private page */
  isPrivate(itemId: string): boolean
  /** new tasks may be created in the active workspace (team: the server's schema gate is on, the tab may write) */
  canCreate(): boolean
}

const FAIL_CLOSED: ItemLookup = {
  taken: () => false,
  gone: () => false,
  isPrivate: () => false,
  canCreate: () => false,
}

let current: ItemLookup = FAIL_CLOSED

/** Register the workspace's lookup (null: back to the fail-closed default). */
export function setItemLookup(lookup: ItemLookup | null): void {
  current = lookup ?? FAIL_CLOSED
}

/** The registered lookup (fail-closed until one is registered). */
export function itemLookup(): ItemLookup {
  return current
}
