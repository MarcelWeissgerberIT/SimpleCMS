import { Hono } from 'hono'
import type { AppEnv, Services } from '../context.ts'
import { badRequest, conflict } from '../errors.ts'
import { access } from './access.ts'

const PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/

/**
 * DELETE /api/workspaces/:id/documents/:pageId — drop the stored content document of a page that was
 * deleted for good (it is no longer in the workspace's meta document; a page in the trash still is,
 * and can be restored). Members and up. Idempotent: 204 whether or not anything was stored. The
 * document name is tombstoned, so a device that still holds a copy cannot store it again.
 */
export function documentRoutes(s: Services) {
  const app = new Hono<AppEnv>()

  app.delete('/:id/documents/:pageId', async (c) => {
    const { workspace, auth } = access(s, c, 'member')
    const pageId = c.req.param('pageId')
    if (!PAGE_ID.test(pageId)) throw badRequest('invalid_page_id', 'Page ids are 1–64 chars of A–Z a–z 0–9 _ -')
    if (await s.collab.pageInMeta(workspace.id, pageId)) throw conflict('page_exists', 'The page still exists (delete it for good first, e.g. empty the trash)')
    const removed = s.repo.deleteDocument(`ws:${workspace.id}:p:${pageId}`, workspace.id, auth.user.id)
    // audit trail: who removed which page's content
    s.log.info('page document deleted', { workspace: workspace.id, page: pageId, user: auth.user.id, stored: removed })
    return c.body(null, 204)
  })

  return app
}
