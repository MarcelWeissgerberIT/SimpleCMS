import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createReadStream, createWriteStream } from 'node:fs'
import { link, mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'
import { Hono } from 'hono'
import type { AppEnv, Services } from '../context.ts'
import { ApiError, badRequest, notFound } from '../errors.ts'
import { newId } from '../tokens.ts'
import { access } from './access.ts'

const FILE_ID = /^[A-Za-z0-9_-]{1,64}$/
/** Shown inline when opened directly. SVG is not here on purpose: it can carry script. */
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])
/**
 * Past the limit we keep reading (and dropping) up to this much, so an honest client reads a clean 413
 * instead of a reset connection. Anything bigger is cut off.
 */
const DRAIN_CAP = 16 * 1024 * 1024

/** PUT/GET /api/workspaces/:id/files/:fileId — bytes live in DATA_DIR/files/<ws>/<id>, never in a served path. */
export function fileRoutes(s: Services) {
  const app = new Hono<AppEnv>()
  const max = s.config.maxUploadBytes
  const dirOf = (ws: string) => join(s.config.dataDir, 'files', ws)

  app.put('/:id/files/:fileId', async (c) => {
    const { workspace, auth } = access(s, c, 'member')
    const fileId = c.req.param('fileId')
    if (!FILE_ID.test(fileId)) throw badRequest('invalid_file_id', 'File ids are 1–64 chars of A–Z a–z 0–9 _ -')
    // ids are client-chosen and content never changes for an id: a repeated upload is a no-op
    if (s.repo.file(workspace.id, fileId)) return c.json({ id: fileId }, 200)
    const declared = Number(c.req.header('content-length') ?? NaN)
    // Node drains an unread body after the response; for huge declared bodies close the connection instead
    if (declared > max) throw tooLarge(max, declared > max + DRAIN_CAP)

    const dir = dirOf(workspace.id)
    await mkdir(dir, { recursive: true })
    const tmp = join(dir, `.upload-${newId()}`)
    let received: Received
    try {
      received = await receive(c.req.raw.body, tmp, max)
    } catch (err) {
      await rm(tmp, { force: true })
      throw err
    }
    if (received.tooLarge) {
      await rm(tmp, { force: true })
      throw tooLarge(max, false)
    }
    const { size, sha256 } = received

    const final = join(dir, fileId)
    try {
      await link(tmp, final) // exclusive: two racing uploads of one id cannot overwrite each other
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      if (s.repo.file(workspace.id, fileId)) {
        await rm(tmp, { force: true })
        return c.json({ id: fileId }, 200)
      }
      await rename(tmp, final) // bytes without a row: left over from a crash, replace them
    }
    await rm(tmp, { force: true })

    const inserted = s.repo.insertFile({
      id: fileId,
      workspace_id: workspace.id,
      name: cleanName(c.req.header('x-file-name')) || fileId,
      mime: cleanMime(c.req.header('content-type')),
      size,
      sha256,
      created_by: auth.user.id,
      created_at: Date.now(),
    })
    if (!inserted && !s.repo.file(workspace.id, fileId)) {
      await rm(final, { force: true }) // the workspace was deleted meanwhile
      throw notFound('workspace_not_found', 'Workspace not found')
    }
    return c.json({ id: fileId }, 201)
  })

  app.get('/:id/files/:fileId', (c) => {
    const { workspace } = access(s, c, 'viewer')
    const fileId = c.req.param('fileId')
    const row = FILE_ID.test(fileId) ? s.repo.file(workspace.id, fileId) : undefined
    if (!row) throw notFound('file_not_found', 'File not found')
    const etag = `"${row.sha256}"`
    const headers: Record<string, string> = {
      'Cache-Control': 'private, max-age=31536000, immutable',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox",
    }
    if (c.req.header('if-none-match') === etag) return c.body(null, 304, headers)
    headers['Content-Type'] = row.mime
    headers['Content-Length'] = String(row.size)
    headers['Content-Disposition'] = `${INLINE_TYPES.has(row.mime) ? 'inline' : 'attachment'}; filename="${asciiName(row.name)}"; filename*=UTF-8''${encodeURIComponent(row.name)}`
    if (c.req.method === 'HEAD') return c.body(null, 200, headers) // no file handle for a body nobody reads
    const stream = Readable.toWeb(createReadStream(join(dirOf(workspace.id), row.id))) as unknown as ReadableStream
    return c.body(stream, 200, headers)
  })

  return app
}

const tooLarge = (max: number, close: boolean) =>
  new ApiError(413, 'file_too_large', `Files can be at most ${Math.round((max / 1024 / 1024) * 10) / 10} MB`, close ? { headers: { Connection: 'close' } } : undefined)

type Received = { tooLarge: true } | { tooLarge: false; size: number; sha256: string }

/** Streams the request body into `file`, hashing on the way; never holds more than one chunk in memory. */
async function receive(body: ReadableStream<Uint8Array> | null, file: string, max: number): Promise<Received> {
  const out = createWriteStream(file, { flags: 'wx', mode: 0o640 })
  const hash = createHash('sha256')
  const reader = body?.getReader()
  let size = 0
  let over = false
  try {
    while (reader) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (over || size > max) {
        over = true
        if (size > max + DRAIN_CAP) {
          await reader.cancel()
          break
        }
        continue
      }
      hash.update(value)
      if (!out.write(value)) await once(out, 'drain')
    }
  } finally {
    out.end()
    await finished(out)
  }
  return over ? { tooLarge: true } : { tooLarge: false, size, sha256: hash.digest('hex') }
}

/** x-file-name is URI-encoded by the client (headers are Latin-1); strip paths and control chars. */
function cleanName(raw: string | undefined): string {
  if (!raw) return ''
  let name = raw
  try {
    name = decodeURIComponent(raw)
  } catch {
    /* keep raw */
  }
  return name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^.*[/\\]/, '')
    .trim()
    .slice(0, 255)
}

function cleanMime(raw: string | undefined): string {
  const mime = (raw ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/.test(mime) ? mime : 'application/octet-stream'
}

const asciiName = (name: string) => name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
