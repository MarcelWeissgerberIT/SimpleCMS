import type { HttpBindings } from '@hono/node-server'
import type { Auth, Sessions } from './auth/sessions.ts'
import type { RateLimiter } from './auth/ratelimit.ts'
import type { Config } from './config.ts'
import type { Db } from './db/index.ts'
import type { Logger } from './log.ts'
import type { Mailer } from './mail/index.ts'
import type { Repo } from './repo.ts'

/** What REST routes may ask the realtime layer to do when membership changes. */
export interface CollabControl {
  closeUser(userId: string, workspaceId: string, reason: CloseReason): number
  closeWorkspace(workspaceId: string, reason: CloseReason): number
  closeSession(sessionId: string, reason: CloseReason): number
  /** Does the workspace's meta document (live copy, else the stored one) still list this page? */
  pageInMeta(workspaceId: string, pageId: string): Promise<boolean>
}

/** Sent to the client as the reason of a per-document close message (provider `close` event). */
export type CloseReason = 'membership-revoked' | 'role-changed' | 'workspace-deleted' | 'session-ended'

export interface Services {
  config: Config
  log: Logger
  db: Db
  repo: Repo
  sessions: Sessions
  mailer: Mailer
  limiter: RateLimiter
  collab: CollabControl
}

export type AppEnv = {
  Bindings: HttpBindings
  Variables: { auth: Auth | null }
}
