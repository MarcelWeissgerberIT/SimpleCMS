/**
 * The workspace look (docs/CLOUD.md § Meta document schema → workspace.look; app: Workspace → Look, lib/look):
 * only owners and admins change it — the key `look` of the meta document's `workspace` map, guarded like every key
 * only they change (admin-map.ts: a member's change is put back in a server-origin transaction, an owner's or
 * admin's is stamped `updatedBy` = their account id, the role is looked up for every change, waiting structs and
 * waiting deletes count for every member who left them). The value is cosmetic and every reader sanitizes it (app
 * src/app/store/look.ts); the server does not judge colours.
 */
import type * as Y from 'yjs'
import type { Logger } from '../log.ts'
import { guardAdminKeys } from './admin-map.ts'

/**
 * Watches the shared meta document while it is loaded; returns the function that stops watching.
 * `roleOf` = the member's current role in this workspace (the repo); without it the connection's role counts.
 */
export function guardWorkspaceLook(doc: Y.Doc, opts: { workspaceId: string; log: Logger; roleOf?: (userId: string) => unknown }): () => void {
  return guardAdminKeys(doc, { ...opts, map: 'workspace', key: 'look', what: 'workspace look' })
}

/**
 * The integration profiles (the meta document's `integrations` map, one entry per profile id; app: Workspace →
 * Integrations, src/app/store/integrations.ts): every key is the owners' and admins' — the same rules as the look.
 */
export function guardIntegrations(doc: Y.Doc, opts: { workspaceId: string; log: Logger; roleOf?: (userId: string) => unknown }): () => void {
  return guardAdminKeys(doc, { ...opts, map: 'integrations', what: 'integration profile' })
}
