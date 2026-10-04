import type { Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { createAdaptorServer } from '@hono/node-server'
import { AgentService } from './agents/service.ts'
import { WorkspaceModel } from './api/model.ts'
import { buildApp } from './app.ts'
import { RateLimiter } from './auth/ratelimit.ts'
import { Sessions } from './auth/sessions.ts'
import { createCollab } from './collab/index.ts'
import { type Config, isSecureUrl } from './config.ts'
import { Keyring } from './crypto/keyring.ts'
import { plaintextLeft, sealFiles, sealRows } from './crypto/migrate.ts'
import { HEARTBEAT_EVERY, openDb } from './db/index.ts'
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
  // encryption at rest: DATA_KEY must open this database's workspace keys, else refuse to start (exit 78)
  const keyring = new Keyring(db, config.dataKey)
  try {
    keyring.verify()
  } catch (err) {
    db.close()
    throw err
  }
  const repo = new Repo(db, config.secret, keyring)
  // what was stored before encryption is sealed now (rows before listening; files below, in the background)
  const sealed = sealRows(db, keyring)
  if (sealed.keys || sealed.documents || sealed.idempotency) log.info('encryption at rest: sealed stored data', { ...sealed })
  const sessions = new Sessions(repo, isSecureUrl(config.publicUrl))
  const mailer = createMailer(config, log)
  const limiter = new RateLimiter()
  const collab = createCollab({ config, log, repo, sessions })
  const services = { config, log, db, repo, sessions, mailer, limiter, collab }
  const model = new WorkspaceModel(services)
  // custom agents (docs/CLOUD.md § Agents): schedules, triggers and runs in this process
  const agents = new AgentService(services, model)
  const app = buildApp(services, { model, agents })

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
  agents.start()

  // the CLI refuses a key rotation while this heartbeat is fresh (docs/SELF_HOSTING.md § Rotating DATA_KEY)
  const started = Date.now()
  const beat = () => {
    try {
      db.run(
        `INSERT INTO server_state (key, value, updated_at) VALUES ('heartbeat', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        JSON.stringify({ pid: process.pid, started_at: started }), Date.now(),
      )
    } catch (err) {
      log.warn('heartbeat failed', { error: (err as Error).message })
    }
  }
  beat()
  const heartbeat = setInterval(beat, HEARTBEAT_EVERY)
  heartbeat.unref()

  const stopSealing = new AbortController()
  const filesSealed = (async () => {
    try {
      const r = await sealFiles(db, keyring, config.dataDir, stopSealing.signal)
      if (r.files || r.missing) log.info('encryption at rest: sealed stored files', { ...r })
      if (stopSealing.signal.aborted) return
      const left = plaintextLeft(db)
      if (Object.values(left).some((n) => n > 0)) log.warn('encryption at rest: plaintext left (run: node dist/cli.js encrypt-all)', left)
    } catch (err) {
      log.error('encryption at rest: sealing stored files failed (run: node dist/cli.js encrypt-all)', { error: err as Error })
    }
  })()

  log.info('listening', {
    port,
    url: config.publicUrl,
    data: config.dataDir,
    app: config.appDir,
    mail: mailer.mode,
    signup: config.signup.mode,
    agents: config.agents.enabled ? undefined : 'off',
    admins: config.adminEmails.length || undefined,
    // names the master key without revealing it: tells which DATA_KEY this server runs with
    data_key: keyring.kekId,
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
        clearInterval(heartbeat)
        server.close()
        await agents.stop() // running runs end (and are saved) before the documents are flushed
        await collab.destroy()
        server.closeAllConnections()
        limiter.stop()
        mailer.close()
        stopSealing.abort() // between two files; the next start carries on
        await filesSealed
        try {
          db.run("DELETE FROM server_state WHERE key = 'heartbeat'")
        } catch {
          /* closing anyway */
        }
        db.close()
      })()),
  }
}
