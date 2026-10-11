/**
 * The live SettleWorld (settle.ts) — what the gate reads of this workspace: people, the team's member emails, "me",
 * the task index (winners, ids anywhere, titles), the blocks Claude may read on a page, the creation gate. One
 * instance per settle call: its memos (titles, readable tasks per page, names) live for that call only. Writes nothing.
 */
import type { JSONContent } from '@tiptap/core'
import { docToMarkdown, readableBlocks } from '../../editor'
import { localPerson } from '../../database'
import { activeWorkspace, useCloud } from '../../cloud'
import { t } from '../../i18n'
import { newItemId } from '../../lib/itemIds'
import { useWorkspace } from '../../store/store'
import type { ID } from '../../store/types'
import { canCreateItems, getItemIndex } from './live'
import { memberEmails } from './members'
import { foldTitle, type SettleReadLimit, type SettleWorld } from './settle'

const EMPTY: ReadonlyMap<string, string> = new Map()

/** The task ids in a list of blocks (synced references too: what Claude reads of them). Iterative. */
function itemIdsIn(blocks: readonly JSONContent[]): Set<string> {
  const out = new Set<string>()
  const stack: JSONContent[] = [...blocks]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === 'workItem' && typeof n.attrs?.itemId === 'string') out.add(n.attrs.itemId)
    if (Array.isArray(n.content)) for (const c of n.content) if (c && typeof c === 'object' && Array.isArray(c.content)) stack.push(c)
  }
  return out
}

export function settleWorld(): SettleWorld {
  const team = activeWorkspace().kind === 'cloud'
  let titles: Map<string, string[]> | null = null
  const readable = new Map<ID, ReadonlySet<string>>()
  const index = () => getItemIndex()
  return {
    now: () => Date.now(),
    canCreate: () => canCreateItems(),
    newItemId,
    people: () => useWorkspace.getState().people,
    // local: people have no emails — nothing resolves (never "still loading")
    memberEmails: () => (team ? memberEmails() : EMPTY),
    me: () => {
      if (team) return useCloud.getState().user?.id ?? null
      const s = useWorkspace.getState()
      return localPerson({ me: { id: null, name: s.settings.userName ?? '' }, people: s.people, labels: { you: t('database.actor.you') } })?.id ?? null
    },
    entry: (itemId) => {
      const e = index().byId.get(itemId)
      return e ? { itemId: e.itemId, pageId: e.pageId, title: e.title, private: e.private, people: e.attrs.people, blockedBy: e.attrs.blockedBy } : null
    },
    taken: (itemId) => index().everywhere.has(itemId),
    titles: () => {
      if (!titles) {
        titles = new Map()
        for (const [id, e] of index().byId) {
          const k = foldTitle(e.title)
          if (!k) continue
          const list = titles.get(k)
          if (list) list.push(id)
          else titles.set(k, [id])
        }
      }
      return titles
    },
    readableItems: (pageId, limit: SettleReadLimit) => {
      if (limit.mode === 'none') return new Set()
      let hit = readable.get(pageId)
      if (!hit) {
        hit = itemIdsIn(readableBlocks(pageId))
        readable.set(pageId, hit)
      }
      return hit
    },
    sameBlock: (a, b) => a === b || docToMarkdown({ type: 'doc', content: [a] }) === docToMarkdown({ type: 'doc', content: [b] }),
    // model-facing (a refusal names the page): English
    pageTitle: (pageId) => useWorkspace.getState().pages[pageId]?.title || 'Untitled',
  }
}
