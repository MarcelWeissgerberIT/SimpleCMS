import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Context, Hono } from 'hono'
import type { AppEnv, Services } from '../context.ts'
import { notFoundPage } from './pages.ts'

/** Vite's content-hashed build output (dist/assets/<name>-<8 char hash>.<ext>): safe to cache forever. */
const HASHED = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/
/** Must be revalidated on every load so a deploy is picked up at once. */
const ALWAYS_FRESH = /(\.html|\/sw\.js|\.webmanifest)$/

function cacheControl(path: string): string {
  if (HASHED.test(path)) return 'public, max-age=31536000, immutable'
  if (path.endsWith('/') || ALWAYS_FRESH.test(path)) return 'no-cache'
  return 'public, max-age=3600'
}

/**
 * The app build (APP_DIR): landing at /, the workspace at /app/ with an SPA fallback.
 * Only GET/HEAD reach this; /api and /collab are handled before.
 */
export function mountStatic(app: Hono<AppEnv>, s: Services) {
  const root = s.config.appDir
  const hasBuild = existsSync(join(root, 'index.html'))
  if (!hasBuild) s.log.warn('no app build found — only the API is served', { APP_DIR: root, hint: 'run "npm run build" in the repository root' })

  const files = serveStatic<AppEnv>({
    root,
    onFound: (_path, c) => {
      c.header('Cache-Control', cacheControl(c.req.path))
    },
  })

  const appShell = serveStatic<AppEnv>({
    root,
    path: 'app/index.html',
    onFound: (_path, c) => {
      c.header('Cache-Control', 'no-cache')
    },
  })

  const notFound = (c: Context<AppEnv>) => {
    c.header('Cache-Control', 'no-cache')
    return c.html(notFoundPage(), 404)
  }

  app.get('/app', (c) => c.redirect('/app/', 301))
  if (hasBuild) {
    app.get('*', files)
    // client-side routes under /app/ (the app uses #hash routes, but deep links must not 404);
    // a missing file with an extension stays a 404 instead of becoming HTML
    app.get('/app/*', async (c, next) => {
      if (/\.[A-Za-z0-9]+$/.test(c.req.path)) return notFound(c)
      return (await appShell(c, next)) ?? undefined
    })
  }
  app.get('*', notFound)
}
