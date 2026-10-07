import { createWriteStream } from 'node:fs'
import { link, mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { once } from 'node:events'
import { finished } from 'node:stream/promises'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv, Services } from '../context.ts'
import { fileSealer } from '../crypto/aead.ts'
import { ApiError, notFound, rateLimited } from '../errors.ts'
import { body } from '../http/util.ts'
import { FetchRefused, guardedGet } from '../http/ssrf.ts'
import { extOf, sniff, type MediaFamily } from '../http/sniff.ts'
import { filesDir, sealedPath } from '../storage.ts'
import { newId } from '../tokens.ts'
import { access } from './access.ts'

const MINUTE = 60_000
/** fetches per member per minute / per day */
export const MEDIA_FETCH_PER_MIN = 20
export const MEDIA_FETCH_PER_DAY = 300
/** per kind, capped by MAX_UPLOAD_MB as well */
const KIND_CAP: Record<MediaFamily, number> = { image: 50 * 1024 * 1024, video: 200 * 1024 * 1024, audio: 200 * 1024 * 1024 }
/** the whole download, at most */
const TOTAL_MS = 120_000
const SAFE = 'application/octet-stream'

const fetchSchema = z.object({
  url: z.string().trim().min(1).max(4096),
  /** what the card said it is (the bytes decide) */
  kind: z.enum(['image', 'video', 'audio']).optional(),
  /** an upload from a private page (docs/CLOUD.md § Private pages): served to this member only */
  private: z.boolean().optional(),
})

/**
 * POST /api/workspaces/:id/files/fetch { url, kind?, private? } — "Fetch through the team server" for media an
 * MCP server returned that the member's browser may not load (CORS). The server downloads ONE address for a
 * member (role member+): https only, no private / loopback / link-local addresses after DNS resolution,
 * redirects checked again (http/ssrf.ts), image / video / audio only and the bytes must agree with the type
 * (http/sniff.ts; SVG is stored as application/octet-stream), at most 50 MB (images) / 200 MB (video, audio) and
 * MAX_UPLOAD_MB, 20 a minute and 300 a day per member. Stored like an upload (sealed with the workspace's key) →
 * 201 { id, name, mime, size, kind } — the page references it as "onefile:<id>". docs/API.md § Fetch media.
 */
export function mediaFetchRoutes(s: Services) {
  const app = new Hono<AppEnv>()

  app.post('/:id/files/fetch', async (c) => {
    const { workspace, auth } = access(s, c, 'member')
    const input = await body(c, fetchSchema)
    for (const [key, limit, window] of [
      [`media:fetch:min:${auth.user.id}`, MEDIA_FETCH_PER_MIN, MINUTE],
      [`media:fetch:day:${auth.user.id}`, MEDIA_FETCH_PER_DAY, 24 * 60 * MINUTE],
    ] as const) {
      const wait = s.limiter.hit(key, limit, window)
      if (wait) throw rateLimited(wait)
    }
    const key = s.repo.keys.forWorkspace(workspace.id)
    if (!key) throw notFound('workspace_not_found', 'Workspace not found')

    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), TOTAL_MS)
    let host = ''
    try {
      host = new URL(input.url).host
    } catch {
      /* urlProblem says so */
    }
    const fileId = newId()
    const dir = filesDir(s.config.dataDir, workspace.id)
    const tmp = join(dir, `.fetch-${newId()}`)
    try {
      let res
      try {
        res = await guardedGet(input.url, { hosts: s.config.mediaFetchHosts, signal: ac.signal })
      } catch (err) {
        if (err instanceof FetchRefused && err.code === 'url_blocked') throw new ApiError(400, 'url_blocked', `This address can't be fetched: ${err.message}`)
        throw new ApiError(502, 'fetch_failed', 'The address could not be fetched')
      }
      if (res.status < 200 || res.status >= 300) {
        res.body.resume()
        throw new ApiError(502, 'fetch_failed', `The host answered ${res.status}`, { details: { status: res.status } })
      }
      const declared = (String(res.headers['content-type'] ?? '').split(';')[0] ?? '').trim().toLowerCase()
      const family = (declared.split('/')[0] ?? '') as MediaFamily
      if (family !== 'image' && family !== 'video' && family !== 'audio') {
        res.body.resume()
        throw new ApiError(415, 'media_type', 'Only images, videos and audio can be fetched')
      }
      const cap = Math.min(KIND_CAP[family], s.config.maxUploadBytes)
      const length = Number(res.headers['content-length'] ?? NaN)
      if (Number.isFinite(length) && length > cap) {
        res.body.destroy()
        throw new ApiError(413, 'file_too_large', `Files can be at most ${Math.round((cap / 1024 / 1024) * 10) / 10} MB`)
      }

      // stream into a sealed temp file (only ciphertext touches the disk), the head kept to check the bytes
      await mkdir(dir, { recursive: true })
      const sealer = fileSealer(key, workspace.id, fileId)
      const out = createWriteStream(tmp, { flags: 'wx', mode: 0o640 })
      out.write(sealer.header)
      const head: Buffer[] = []
      let headLen = 0
      let size = 0
      let over = false
      try {
        for await (const chunk of res.body as AsyncIterable<Buffer>) {
          size += chunk.length
          if (size > cap) {
            over = true
            res.body.destroy()
            break
          }
          if (headLen < 4096) {
            head.push(chunk)
            headLen += chunk.length
          }
          if (!out.write(sealer.update(chunk))) await once(out, 'drain')
        }
        if (!over) out.write(sealer.final())
      } finally {
        out.end()
        await finished(out).catch(() => {})
      }
      if (ac.signal.aborted) throw new ApiError(504, 'fetch_failed', 'The download took too long')
      if (over) throw new ApiError(413, 'file_too_large', `Files can be at most ${Math.round((cap / 1024 / 1024) * 10) / 10} MB`)
      if (!size) throw new ApiError(502, 'fetch_failed', 'The host sent an empty file')
      const got = sniff(Buffer.concat(head))
      if (!got || !got.kinds.includes(family)) throw new ApiError(415, 'media_mismatch', 'The file is not what its type says')

      const mime = got.svg ? SAFE : got.kinds[0] === family ? got.mime : declared
      const kind = got.svg ? 'file' : family
      const final = sealedPath(s.config.dataDir, workspace.id, fileId)
      try {
        await link(tmp, final)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
        await rename(tmp, final)
      }
      const name = fileName(res.url, got.svg ? 'image/svg+xml' : mime, fileId)
      const inserted = s.repo.insertFile({
        id: fileId,
        workspace_id: workspace.id,
        name,
        mime,
        size,
        sha256: sealer.fingerprint(),
        created_by: auth.user.id,
        created_at: Date.now(),
        private_to: input.private ? auth.user.id : null,
      })
      if (!inserted) {
        await rm(final, { force: true })
        throw notFound('workspace_not_found', 'Workspace not found')
      }
      // never the address itself: a signed link carries its own secret
      s.log.info('media fetched', { workspace: workspace.id, file: fileId, host, size, mime })
      return c.json({ id: fileId, name, mime, size, kind }, 201)
    } catch (err) {
      if (!(err instanceof ApiError)) s.log.warn('media fetch failed', { workspace: workspace.id, host, error: (err as Error).message })
      throw err instanceof ApiError ? err : new ApiError(502, 'fetch_failed', 'The address could not be fetched')
    } finally {
      clearTimeout(timer)
      await rm(tmp, { force: true }).catch(() => {})
    }
  })

  return app
}

/** The file name from the address' last path segment (no paths, no control characters), with the type's extension. */
function fileName(url: string, mime: string, fallback: string): string {
  let base = ''
  try {
    base = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '')
  } catch {
    base = ''
  }
  base = base
    .replace(/[\u0000-\u001f\u007f/\\]/g, '')
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .trim()
    .slice(0, 120)
  const ext = extOf(mime)
  return `${base || `media-${fallback.slice(0, 8)}`}${ext ? `.${ext}` : ''}`
}
