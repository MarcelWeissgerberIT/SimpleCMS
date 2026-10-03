/**
 * Public REST API v1 (docs/API.md): /api/v1/*, `Authorization: Bearer one_…`, one workspace per token.
 * Reads need any token, writes a "write" token. Writes go into the workspace's Yjs documents through
 * the realtime server, so everyone who has the workspace open sees them at once.
 */
import { type Context, Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv, Services } from '../context.ts'
import { badRequest } from '../errors.ts'
import { body, idSchema } from '../http/util.ts'
import { bearer, idempotent, requireWrite } from './auth.ts'
import { MAX_PAGE_SIZE, ROW_SORTS, type RowSort, type WorkspaceModel } from './model.ts'

const titleSchema = z.string().max(2000)
const rowCreateSchema = z.object({
  title: titleSchema.optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  content: z.string().max(200_000).optional(),
})
const rowPatchSchema = z.object({
  title: titleSchema.optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
})
const pageCreateSchema = z.object({
  parentId: idSchema.nullable().optional(),
  title: titleSchema.default(''),
  content: z.string().max(200_000).optional(),
})

/** Ids in paths: anything else is simply not found. */
const param = (raw: string | undefined): string => (raw && idSchema.safeParse(raw).success ? raw : '\u0000')

export function apiRoutes(s: Services, model: WorkspaceModel) {
  const app = new Hono<AppEnv>()
  app.use('*', bearer(s))

  const ws = (c: Context<AppEnv>) => c.get('token').workspace_id
  /** createdBy / updatedBy of what a token writes */
  const actor = (c: Context<AppEnv>) => `api:${c.get('token').id}`

  app.get('/workspace', (c) => {
    const w = s.repo.workspaceById(ws(c))
    return c.json({ id: w?.id ?? ws(c), name: w?.name ?? '', url: `${s.config.publicUrl}/app/?w=${encodeURIComponent(ws(c))}`, scope: c.get('token').scope })
  })

  app.get('/databases', async (c) => c.json(await model.listDatabases(ws(c))))

  app.get('/databases/:id', async (c) => c.json(await model.getDatabase(ws(c), param(c.req.param('id')))))

  app.get('/databases/:id/rows', async (c) => {
    const limit = c.req.query('limit') === undefined ? 50 : Number(c.req.query('limit'))
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) throw badRequest('invalid_request', `limit is a whole number from 1 to ${MAX_PAGE_SIZE}`)
    const sort = (c.req.query('sort') ?? 'order') as RowSort
    if (!ROW_SORTS.includes(sort)) throw badRequest('invalid_request', `sort is one of ${ROW_SORTS.join(', ')}`)
    return c.json(await model.listRows(ws(c), param(c.req.param('id')), { limit, cursor: c.req.query('cursor') || null, sort }))
  })

  app.post('/databases/:id/rows', async (c) => {
    const token = requireWrite(c)
    const input = await body(c, rowCreateSchema)
    const dbId = param(c.req.param('id'))
    return idempotent(s, c, `token:${token.id}`, c.req.header('idempotency-key') ?? null, ws(c), async () => ({
      status: 201,
      body: await model.createRow(ws(c), dbId, input, actor(c)),
    }))
  })

  app.get('/rows/:id', async (c) => c.json(await model.getRow(ws(c), param(c.req.param('id')))))

  app.patch('/rows/:id', async (c) => {
    requireWrite(c)
    const input = await body(c, rowPatchSchema)
    return c.json(await model.updateRow(ws(c), param(c.req.param('id')), input, actor(c)))
  })

  app.get('/pages/:id', async (c) => c.json(await model.getPage(ws(c), param(c.req.param('id')))))

  app.post('/pages', async (c) => {
    const token = requireWrite(c)
    const input = await body(c, pageCreateSchema)
    return idempotent(s, c, `token:${token.id}`, c.req.header('idempotency-key') ?? null, ws(c), async () => ({
      status: 201,
      body: await model.createPage(ws(c), input, actor(c)),
    }))
  })

  return app
}
