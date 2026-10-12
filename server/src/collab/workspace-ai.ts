/**
 * The workspace's AI rules (docs/CLOUD.md § Meta document schema → workspace.ai; app: src/app/store/ai.ts): key `ai` of
 * the meta document's `workspace` map — owners and admins only, the same rules as the look (admin-map.ts: a member's
 * change is put back in a server-origin transaction, an owner's or admin's is stamped `updatedBy`, the role is looked
 * up for every change). Every reader sanitizes the value (src/shared/ai/policy.ts sanitizeWorkspaceAI); the guard does
 * not judge it.
 */
import type * as Y from 'yjs'
import type { Logger } from '../log.ts'
import { guardAdminKeys } from './admin-map.ts'

/**
 * Watches the shared meta document while it is loaded; returns the function that stops watching.
 * `roleOf` = the member's current role in this workspace (the repo); without it the connection's role counts.
 */
export function guardWorkspaceAI(doc: Y.Doc, opts: { workspaceId: string; log: Logger; roleOf?: (userId: string) => unknown }): () => void {
  return guardAdminKeys(doc, { ...opts, map: 'workspace', key: 'ai', what: 'workspace AI rules' })
}
