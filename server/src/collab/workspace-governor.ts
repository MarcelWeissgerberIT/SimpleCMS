/**
 * The workspace's governor (Regler: lever, ceiling, day / month budget, saving rules — docs/CLOUD.md § Meta document
 * schema → workspace.governor; app: features/governor, src/shared/ai/governor.ts): key `governor` of the meta document's
 * `workspace` map — owners and admins only, the same rules as the look and the AI rules (admin-map.ts: a member's change
 * is put back in a server-origin transaction, an owner's or admin's is stamped `updatedBy`, the role is looked up for
 * every change). Every reader sanitizes the value (sanitizeGovernor); the guard does not judge it. The app writes it
 * only when /api/config `supports` lists 'governor'.
 */
import type * as Y from 'yjs'
import type { Logger } from '../log.ts'
import { guardAdminKeys } from './admin-map.ts'

/**
 * Watches the shared meta document while it is loaded; returns the function that stops watching.
 * `roleOf` = the member's current role in this workspace (the repo); without it the connection's role counts.
 */
export function guardWorkspaceGovernor(doc: Y.Doc, opts: { workspaceId: string; log: Logger; roleOf?: (userId: string) => unknown }): () => void {
  return guardAdminKeys(doc, { ...opts, map: 'workspace', key: 'governor', what: 'workspace governor' })
}
