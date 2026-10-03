import { Hono } from 'hono'
import { pageName } from '../collab/names.ts'
import type { AppEnv, Services } from '../context.ts'
import { badRequest, conflict } from '../errors.ts'
import { access } from './access.ts'

const PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/

/**
 * DELETE /api/workspaces/:id/documents/:pageId — drop the stored content document of a page that was
 * deleted for good (it is no longer in the workspace's meta document; a page in the trash still is,
 * and can be restored). Members and up. Idempotent: 204 whether or not anything was stored. The
 * document name is tombstoned, so a device that still holds a copy cannot store it again.
 *
 * `?scope=private`: the caller's OWN private content document of that page
 * (`ws:<id>:u:<caller>:p:<pageId>`), checked against their private meta document — a page deleted
 * for good or moved to the workspace. There is no way to name another member's private document.
 */
export function documentRoutes(s: Services) {
  const app = new Hono<AppEnv>()

  app.delete('/:id/documents/:pageId', async (c) => {
    const { workspace, auth } = access(s, c, 'member')
    const pageId = c.req.param('pageId')
    if (!PAGE_ID.test(pageId)) throw badRequest('invalid_page_id', 'Page ids are 1–64 chars of A–Z a–z 0–9 _ -')
    const scope = c.req.query('scope') ?? 'workspace'
    if (scope !== 'workspace' && scope !== 'private') throw badRequest('invalid_request', 'scope is workspace or private')
    const owner = scope === 'private' ? auth.user.id : null
    if (await s.collab.pageInMeta(workspace.id, pageId, owner)) throw conflict('page_exists', 'The page still exists (delete it for good first, e.g. empty the trash)')
    const removed = s.repo.deleteDocument(pageName(workspace.id, pageId, owner), workspace.id, auth.user.id)
    // audit trail: who removed which page's content
    s.log.info('page document deleted', { workspace: workspace.id, page: pageId, user: auth.user.id, scope, stored: removed })
    return c.body(null, 204)
  })

  return app
}
