/**
 * Document names (docs/CLOUD.md):
 *   ws:<workspaceId>                          the workspace meta document
 *   ws:<workspaceId>:p:<pageId>               the content of one page
 *   ws:<workspaceId>:u:<userId>               one member's private meta document (their Private pages)
 *   ws:<workspaceId>:u:<userId>:p:<pageId>    the content of one of their private pages
 * Anything else is rejected before a document is created. `owner` is the user a private document
 * belongs to (null for the workspace's shared documents) — only that user may ever open it.
 */
const ID = '([A-Za-z0-9_-]{8,64})'
const PAGE_ID = '([A-Za-z0-9_-]{1,64})'
const META = new RegExp(`^ws:${ID}(?::u:${ID})?$`)
const PAGE = new RegExp(`^ws:${ID}(?::u:${ID})?:p:${PAGE_ID}$`)

export type DocName =
  | { kind: 'meta'; workspaceId: string; owner: string | null }
  | { kind: 'page'; workspaceId: string; pageId: string; owner: string | null }

export function parseDocName(name: string): DocName | null {
  if (name.length > 210) return null
  const meta = META.exec(name)
  if (meta?.[1]) return { kind: 'meta', workspaceId: meta[1], owner: meta[2] ?? null }
  const page = PAGE.exec(name)
  if (page?.[1] && page[3]) return { kind: 'page', workspaceId: page[1], pageId: page[3], owner: page[2] ?? null }
  return null
}

/** The meta document that lists the pages of this scope (the workspace's, or one member's private one). */
export const metaName = (workspaceId: string, owner: string | null = null) => (owner ? `ws:${workspaceId}:u:${owner}` : `ws:${workspaceId}`)

/** A page's content document in this scope. */
export const pageName = (workspaceId: string, pageId: string, owner: string | null = null) => `${metaName(workspaceId, owner)}:p:${pageId}`

/** Every private document of one member starts with this. */
export const privatePrefix = (workspaceId: string, userId: string) => `ws:${workspaceId}:u:${userId}`
