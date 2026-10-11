/**
 * Tasks outside the editor — public API of the sub-area (re-exported from features/index.ts).
 *
 *  - startItems(): registers the editor's lookup (the ONE creation gate `canCreate`, taken / gone / isPrivate)
 *      and subscribes to the store; the index itself is built lazily (main.tsx, before the first editor mounts).
 *  - getItemIndex(): the workspace index (ItemIndex: byPage, byId = live winners, everywhere / pagesOf, trashed,
 *      templated, dups, dependents, relatedBack, loopEdges, unloaded) — lazy, incremental; never notifies
 *      synchronously. peekItemIndex(): the index only if built. subscribeItems(fn) / useItemIndexVersion().
 *  - useItemView(attrs, pageId, blockId?): what a placard shows beyond its attrs (ItemView: blockers with state
 *      and title, openBlockers, blocked, afterAll, dependents, related, duplicate, indexed) — cached per component.
 *  - useNowMinute(): one shared minute ticker (overdue). canCreateItems(): the creation gate itself.
 *  - wouldLoop(index, from, to): would "from waits for to" close a loop?
 *  - memberIds() / useMemberIds(): the team workspace's member account ids (null locally / unknown).
 *  - ringsHere(people, ctx) / audienceText(…): who a task's reminder rings for (team: its people; nobody → all).
 */
export { startItems, stopItems, getItemIndex, peekItemIndex, subscribeItems, useItemIndexVersion, useItemView, useNowMinute, canCreateItems } from './live'
export { wouldLoop } from './graph'
export { refOf, itemView, DUP_DELAY, type ItemView, type ItemRef, type RefState } from './view'
export type { ItemIndex, ItemEntry, PageItems } from './itemIndex'
export { memberIds, useMemberIds } from './members'
export { ringsHere, audienceText, joinNames, type AudienceCtx } from './audience'
