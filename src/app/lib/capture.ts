/**
 * The capture Inbox's identity (shell/capture keeps the page; the Patchbay draws "Clippings" into it): the Inbox is a
 * root page recognised by its id prefix — it survives renames and moves, no setting needed. Pure: the page map and the
 * trash answer are passed in.
 */
import type { ID, Page } from '../store/types'

/** The id prefix of the capture Inbox page (shell/capture creates it on demand with `inbx` + a fresh id). */
export const INBOX_ID_PREFIX = 'inbx'

/** Is this id one an Inbox page carries? (an id alone: a row or a database never counts — see findInboxIn) */
export const isInboxId = (id: string): boolean => id.startsWith(INBOX_ID_PREFIX)

/**
 * The Inbox page in `pages`: the oldest live page (not a row, not a database) whose id has the prefix; null when
 * there is none (yet) or it is in the trash. `trashed(id)`: the page or a page above it is in the trash.
 */
export function findInboxIn(pages: Record<ID, Page>, trashed: (id: ID) => boolean): ID | null {
  let best: Page | null = null
  for (const id in pages) {
    if (!isInboxId(id)) continue
    const p = pages[id]
    if (p.kind !== 'page' || p.databaseId || trashed(p.id)) continue
    if (!best || p.createdAt < best.createdAt) best = p
  }
  return best?.id ?? null
}
