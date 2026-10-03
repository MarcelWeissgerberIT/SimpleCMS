import type { Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { createAdaptorServer } from '@hono/node-server'
import { buildApp } from './app.ts'
import { RateLimiter } from './auth/ratelimit.ts'
import { Sessions } from './auth/sessions.ts'
import { createCollab } from './collab/index.ts'
import { type Config, isSecureUrl } from './config.ts'
import { openDb } from './db/index.ts'
import type { Logger } from './log.ts'
import { createMailer } from './mail/index.ts'
import { Repo } from './repo.ts'
import { HOUR } from './tokens.ts'

export interface RunningServer {
  port: number
  url: string
  close(): Promise<void>
}

/** Wires everything together on one HTTP server: REST + static via Hono, Yjs via /collab upgrades. */
export async function startServer(config: Config, log: Logger): Promise<RunningServer> {
  const db = openDb(join(config.dataDir, 'one.sqlite'))
  const repo = new Repo(db, config.secret)
  const sessions = new Sessions(repo, isSecureUrl(config.publicUrl))
  const mailer = createMailer(config, log)
  const limiter = new RateLimiter()
  const collab = createCollab({ config, log, repo, sessions })
  const app = buildApp({ config, log, db, repo, sessions, mailer, limiter, collab })

  const server = createAdaptorServer({ fetch: app.fetch }) as HttpServer
  server.on('upgrade', (req, socket, head) => collab.handleUpgrade(req, socket, head))
  server.headersTimeout = 30_000
  server.requestTimeout = 10 * 60_000 // large uploads on slow links

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(config.port, config.host, () => resolve())
  })
  const port = (server.address() as AddressInfo).port
  if (!config.publicUrlFromEnv) config.publicUrl = `http://localhost:${port}`

  const housekeeping = setInterval(() => {
    try {
      const purged = repo.purgeExpired()
      if (Object.values(purged).some((n) => n > 0)) log.info('housekeeping', purged)
    } catch (err) {
      log.error('housekeeping failed', { error: err as Error })
    }
  }, HOUR)
  housekeeping.unref()
  repo.purgeExpired()
  void mailer.verify()

  log.info('listening', {
    port,
    url: config.publicUrl,
    data: config.dataDir,
    app: config.appDir,
    mail: mailer.mode,
    signup: config.signup.mode,
    dev: config.devMode || undefined,
  })
  if (mailer.mode === 'dev') log.warn('no SMTP_URL set — sign-in links are only written to this log (dev-mail mode)')

  let closing: Promise<void> | null = null
  return {
    port,
    url: config.publicUrl,
    close: () =>
      (closing ??= (async () => {
        clearInterval(housekeeping)
        server.close()
        await collab.destroy()
        server.closeAllConnections()
        limiter.stop()
        mailer.close()
        db.close()
      })()),
  }
}
