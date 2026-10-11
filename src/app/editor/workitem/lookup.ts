/**
 * Task block — the lookup registry: what the editor asks about tasks outside its own document (the ids
 * plugin, the creation gate). features/workitems registers the workspace index here at boot
 * (`startItems()` → `setItemLookup`); the editor never imports features.
 *
 * The default is FAIL-CLOSED: nothing taken, nothing gone, nothing private and NO creation — a path that runs
 * before the index registered (or in a build without it) never makes a new task the server could refuse.
 */
import type { WorkItemAttrs } from './attrs'

export interface ItemLookup {
  /** another block of this device holds it (any page but `pageId`, trash and templates included, synced copies not) */
  taken(itemId: string, pageId: string | null): boolean
  /** no block of this device holds it any more (this doc not counted) */
  gone(itemId: string, pageId: string | null): boolean
  /** the live task with this id sits on a private page */
  isPrivate(itemId: string): boolean
  /** new tasks may be created in the active workspace (team: the server's schema gate is on, the tab may write) */
  canCreate(): boolean
  /** how many of the task's blockers are still open (advisory "blocked": marking it done asks once) */
  openBlockers(attrs: WorkItemAttrs, pageId: string | null): number
  /** how many live tasks wait for this one (a task turned into text loses those links) */
  dependents(itemId: string): number
}

const FAIL_CLOSED: ItemLookup = {
  taken: () => false,
  gone: () => false,
  isPrivate: () => false,
  canCreate: () => false,
  openBlockers: () => 0,
  dependents: () => 0,
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

/**
 * Counters for the end-to-end seam (`window.__oneItems`, features/workitems/live.ts — `?e2e` only): placard
 * renders, ids re-minted by a paste / drop, relinks after a cut. Plain numbers, never read by the app itself.
 */
export const itemCounters = { renders: 0, remints: 0, relinks: 0, walks: 0 }

/** What the editor reports about tasks to features/workitems (registered by `startItems()`; no-ops before). */
export interface ItemHooks {
  /** the person finished these tasks in an editor (key, Mod+Enter, menu, picker) — the unblock toast */
  finished(itemIds: readonly string[], pageId: string | null): void
}

const NO_HOOKS: ItemHooks = { finished: () => {} }
let hooks: ItemHooks = NO_HOOKS

export function setItemHooks(h: ItemHooks | null): void {
  hooks = h ?? NO_HOOKS
}

export function itemHooks(): ItemHooks {
  return hooks
}
