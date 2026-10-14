/**
 * The Patchbay's allowed paths ("Allow this path" / "Weg zulassen" — docs/CLOUD.md § Meta document schema →
 * fuseSignoffs; app: features/patchbay, src/app/store/fuseSignoffs.ts): the meta document's `fuseSignoffs` map, one entry
 * per path key, is the owners' and admins' — every key guarded like the integration profiles' (admin-map.ts: a member's
 * add, change or removal is put back in a server-origin transaction, an owner's or admin's change is stamped
 * `updatedBy` = their account id so "Allowed by …" cannot be forged, the role is looked up for every change, waiting
 * structs and waiting deletes count for every member who left them). Every reader sanitizes the values; the guard does
 * not judge them (a fuse an allowance does not match stays open in the app). The app writes the map only when
 * /api/config `supports` lists 'signoffs'.
 */
import type * as Y from 'yjs'
import type { Logger } from '../log.ts'
import { guardAdminKeys } from './admin-map.ts'

/** The meta document's map of allowed paths. */
export const FUSE_SIGNOFFS_MAP = 'fuseSignoffs'

/**
 * Watches the shared meta document while it is loaded; returns the function that stops watching.
 * `roleOf` = the member's current role in this workspace (the repo); without it the connection's role counts.
 */
export function guardFuseSignoffs(doc: Y.Doc, opts: { workspaceId: string; log: Logger; roleOf?: (userId: string) => unknown }): () => void {
  return guardAdminKeys(doc, { ...opts, map: FUSE_SIGNOFFS_MAP, what: 'fuse sign-off' })
}
