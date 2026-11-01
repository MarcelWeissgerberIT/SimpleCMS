/** Human-requested, bounded source preview. No crawling, model calls or workspace writes. */
import { createHash } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv, Services } from '../context.ts'
import { ApiError, rateLimited } from '../errors.ts'
import { body } from '../http/util.ts'
import { FetchRefused, guardedGet } from '../http/ssrf.ts'
import { access } from './access.ts'

export const SOURCE_FETCH_MAX_BYTES = 2 * 1024 * 1024
const TYPES = new Set(['text/html', 'application/xhtml+xml', 'text/plain', 'text/markdown', 'text/x-markdown', 'application/json'])
const schema = z.object({ url: z.string().trim().min(1).max(4096) }).strict()

export function sourceFetchRoutes(s: Services) {
  const app = new Hono<AppEnv>()
  app.post('/:id/sources/preview', async (c) => {
    const { auth, workspace } = access(s, c, 'member')
    c.header('Cache-Control', 'no-store')
    const input = await body(c, schema)
    for (const [key, limit, window] of [[`source:min:${auth.user.id}`, 10, 60_000], [`source:day:${auth.user.id}`, 100, 86_400_000]] as const) {
      const wait = s.limiter.hit(key, limit, window)
      if (wait) throw rateLimited(wait)
    }
    const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(25_000)])
    let response: Awaited<ReturnType<typeof guardedGet>> | undefined
    try {
      response = await guardedGet(input.url, { hosts: s.config.mediaFetchHosts, signal, accept: 'text/html, text/plain, text/markdown, application/json;q=0.8' })
      if (response.status < 200 || response.status >= 300) throw new ApiError(502, 'source_fetch_failed', `Source answered HTTP ${response.status}`)
      const contentType = String(response.headers['content-type'] ?? '').toLowerCase()
      const mime = contentType.split(';')[0]!.trim()
      if (!TYPES.has(mime)) throw new ApiError(415, 'source_type', 'Use HTML, plain text, Markdown or JSON. Download other documents and use file import.')
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') throw new ApiError(415, 'source_encoding', 'This source did not return an uncompressed document. Save it as HTML or paste its text.')
      const length = Number(response.headers['content-length'])
      if (length > SOURCE_FETCH_MAX_BYTES) throw new ApiError(413, 'source_too_large', 'Sources can be at most 2 MB. Paste a selected passage instead.')
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of response.body as AsyncIterable<Buffer>) {
        size += chunk.length
        if (size > SOURCE_FETCH_MAX_BYTES) throw new ApiError(413, 'source_too_large', 'Sources can be at most 2 MB. Paste a selected passage instead.')
        chunks.push(chunk)
      }
      if (!size) throw new ApiError(422, 'source_empty', 'The source returned no content. Paste the visible text instead.')
      const bytes = Buffer.concat(chunks)
      let text: string
      try { text = new TextDecoder(/charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1] ?? 'utf-8', { fatal: true }).decode(bytes) }
      catch { throw new ApiError(415, 'source_encoding', 'The source text encoding could not be read. Paste its text instead.') }
      // Never log source addresses, queries or content (a pasted URL can carry secrets).
      s.log.info('source preview fetched', { workspace: workspace.id, host: new URL(response.url).hostname, size, mime })
      return c.json({ url: response.url, mime, text, fetchedAt: new Date().toISOString(), sha256: createHash('sha256').update(bytes).digest('hex'), size })
    } catch (error) {
      if (error instanceof ApiError) throw error
      if (error instanceof FetchRefused && error.code === 'url_blocked') throw new ApiError(400, 'url_blocked', 'Use a public HTTPS address without login credentials. Internal addresses cannot be fetched by the team server.')
      throw new ApiError(signal.aborted ? 504 : 502, 'source_fetch_failed', 'The source could not be read. It may need login, block downloads or be unavailable. Paste its text or import a saved file.')
    } finally { response?.body.destroy() }
  })
  return app
}
