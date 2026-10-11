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
 *  - writeItems(edits, { by, toasts, from }): THE write to tasks outside their editor (live editor first, else
 *      setContent(…, 'items')); refusals 'gone' | 'trash' | 'locked' | 'readonly' | 'outdated' | 'blind' | 'scope' |
 *      'loop' | 'template'; returns { results, unblocked, undo }.
 *  - unblockedBy(index, itemIds) / toastUnblocked(entries): who a finish frees, and the toast saying so.
 */
export { startItems, stopItems, getItemIndex, peekItemIndex, subscribeItems, useItemIndexVersion, useItemView, useNowMinute, canCreateItems } from './live'
export { wouldLoop } from './graph'
export { refOf, itemView, DUP_DELAY, type ItemView, type ItemRef, type RefState } from './view'
export type { ItemIndex, ItemEntry, PageItems } from './itemIndex'
export { memberIds, useMemberIds } from './members'
export { ringsHere, audienceText, joinNames, type AudienceCtx } from './audience'
export { writeItems, type ItemEdit, type WriteResult, type WriteRefusal, type WriteOptions } from './write'
export { unblockedBy } from './unblock'
export { toastUnblocked } from './unblockToast'
// the editor's task pickers and cards (mounted by editor/workitem/ItemPickers.tsx)
export { PeoplePicker } from './PeoplePicker'
export { ItemLinkPicker, pagePath } from './ItemPicker'
export { RefCard, RefList } from './RefCard'
// the e2e seam of Claude's writing path (window.__oneSettle — DEV / ?e2e only)
import './seam'
