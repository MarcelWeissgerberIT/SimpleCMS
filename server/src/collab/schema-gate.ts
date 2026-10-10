/**
 * Schema gate (docs/CLOUD.md § Schema gate). A tab whose editor does not know a node type DELETES that node
 * from a shared document (y-prosemirror drops what its schema cannot read, and the deletion syncs). So
 * only clients that read the current document schema may write: every collab connection sends its schema
 * generation as `?schema=<n>` on the socket URL (the app's DOC_SCHEMA_VERSION, src/app/editor/schema/base.ts).
 *
 *  - missing / unreadable → the connection is read-only (an older build — it cannot even be told why)
 *  - below MIN_CLIENT_SCHEMA → read-only, and the client is told it is outdated (a stateless message,
 *    OUTDATED_NOTICE): it shows "Reload to keep editing"
 *  - at or above the minimum → as the member's role allows
 *
 * Raise MIN_CLIENT_SCHEMA one release after the app's DOC_SCHEMA_VERSION grew — once every tab can load it.
 *   1 = the task block (`workItem`)
 */
export const MIN_CLIENT_SCHEMA = 1

export type SchemaAccess = 'current' | 'missing' | 'outdated'

/** How a connection's `schema` parameter stands against the minimum. */
export function schemaAccess(raw: string | null | undefined, min = MIN_CLIENT_SCHEMA): SchemaAccess {
  const s = (raw ?? '').trim()
  if (!/^\d{1,6}$/.test(s)) return 'missing'
  return Number(s) >= min ? 'current' : 'outdated'
}

/** The stateless message an outdated (but new enough to listen) client gets on each document. */
export const OUTDATED_NOTICE = 'one.schema'

export function outdatedNotice(min = MIN_CLIENT_SCHEMA): string {
  return JSON.stringify({ type: OUTDATED_NOTICE, status: 'outdated', min })
}
