import type { HttpBindings } from '@hono/node-server'
import type * as Y from 'yjs'
import type { Auth, Sessions } from './auth/sessions.ts'
import type { RateLimiter } from './auth/ratelimit.ts'
import type { Config } from './config.ts'
import type { Db } from './db/index.ts'
import type { Logger } from './log.ts'
import type { Mailer } from './mail/index.ts'
import type { ApiTokenRow, Repo } from './repo.ts'

/** What REST routes may ask the realtime layer to do when membership changes. */
export interface CollabControl {
  closeUser(userId: string, workspaceId: string, reason: CloseReason): number
  closeWorkspace(workspaceId: string, reason: CloseReason): number
  closeSession(sessionId: string, reason: CloseReason): number
  /**
   * Does the workspace's meta document (live copy, else the stored one) still list this page? With
   * `owner`: that member's private meta document (docs/CLOUD.md § Private pages).
   */
  pageInMeta(workspaceId: string, pageId: string, owner?: string | null): Promise<boolean>
  /**
   * Read a document: the live copy when it is loaded (it has the latest changes), else the stored one
   * (a throwaway copy). `fn` must not change it.
   */
  read<T>(documentName: string, fn: (doc: Y.Doc) => T): Promise<T>
  /**
   * Change a document the way a client would (public API, incoming webhooks): one transaction through
   * a Hocuspocus direct connection, so connected clients receive it live and it is stored at once.
   * `fn` must validate before it changes anything — a throw after a change keeps that change.
   * Private documents (`ws:<id>:u:…`) are refused: the server never writes them.
   */
  write<T>(documentName: string, fn: (doc: Y.Doc) => T, actor: string): Promise<T>
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
  /** auth: the session (cookie routes) · token: the bearer token (/api/v1 only, never a cookie) */
  Variables: { auth: Auth | null; token: ApiTokenRow }
}
