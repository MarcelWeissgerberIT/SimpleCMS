/**
 * Document names (docs/CLOUD.md):
 *   ws:<workspaceId>              the workspace meta document
 *   ws:<workspaceId>:p:<pageId>   the content of one page
 * Anything else is rejected before a document is created.
 */
const META = /^ws:([A-Za-z0-9_-]{8,64})$/
const PAGE = /^ws:([A-Za-z0-9_-]{8,64}):p:([A-Za-z0-9_-]{1,64})$/

export type DocName = { kind: 'meta'; workspaceId: string } | { kind: 'page'; workspaceId: string; pageId: string }

export function parseDocName(name: string): DocName | null {
  if (name.length > 160) return null
  const meta = META.exec(name)
  if (meta?.[1]) return { kind: 'meta', workspaceId: meta[1] }
  const page = PAGE.exec(name)
  if (page?.[1] && page[2]) return { kind: 'page', workspaceId: page[1], pageId: page[2] }
  return null
}
