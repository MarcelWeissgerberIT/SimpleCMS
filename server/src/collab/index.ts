import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { Server as Hocuspocus, type Connection } from '@hocuspocus/server'
import * as Y from 'yjs'
import { cookieFromHeader, SESSION_COOKIE, type Sessions } from '../auth/sessions.ts'
import type { Config } from '../config.ts'
import type { CloseReason, CollabControl } from '../context.ts'
import { isSameOrigin } from '../http/security.ts'
import type { Logger } from '../log.ts'
import type { Repo, Role } from '../repo.ts'
import { parseDocName } from './names.ts'

export const COLLAB_PATH = '/collab'
/** Big enough for the first sync of a large workspace that was built offline. */
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024

interface ConnContext {
  userId: string
  sessionId: string
  workspaceId: string
  role: Role
}

interface Entry extends ConnContext {
  connection: Connection<ConnContext>
}

/** Rejections reach the provider as `authenticationFailed({ reason })`. */
const deny = (reason: 'unauthenticated' | 'forbidden' | 'invalid-document') => Object.assign(new Error(reason), { reason })

export interface Collab extends CollabControl {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void
  destroy(): Promise<void>
}

/**
 * Yjs sync over Hocuspocus 4 on the main HTTP server's /collab path.
 * Our own upgrade gate (path, Origin, session) runs first; accepted sockets are handed to a Hocuspocus
 * `Server` whose own HTTP server never listens — we only borrow its WebSocket upgrade handling.
 */
export function createCollab(deps: { config: Config; log: Logger; repo: Repo; sessions: Sessions }): Collab {
  const { config, log, repo, sessions } = deps
  const live = new Set<Entry>()

  const hocuspocus = new Hocuspocus<ConnContext>({
    name: 'one',
    quiet: true,
    stopOnSignals: false,
    debounce: 2000,
    maxDebounce: 10_000,
    websocketOptions: { maxPayload: MAX_MESSAGE_BYTES },

    async onAuthenticate({ documentName, requestHeaders, connectionConfig }) {
      const doc = parseDocName(documentName)
      if (!doc) throw deny('invalid-document')
      const auth = sessions.resolve(cookieFromHeader(requestHeaders.get('cookie'), SESSION_COOKIE))
      if (!auth) throw deny('unauthenticated')
      const role = repo.memberRole(doc.workspaceId, auth.user.id)
      if (!role) throw deny('forbidden')
      connectionConfig.readOnly = role === 'viewer'
      return { userId: auth.user.id, sessionId: auth.session.id, workspaceId: doc.workspaceId, role } satisfies ConnContext
    },

    async connected({ context, connection }) {
      // membership may have changed while the document was loading
      const role = repo.memberRole(context.workspaceId, context.userId)
      if (role !== context.role) {
        connection.close({ code: 4403, reason: role ? 'role-changed' : 'membership-revoked' })
        return
      }
      const entry: Entry = { ...context, connection }
      live.add(entry)
      connection.onClose(() => live.delete(entry))
    },

    async onLoadDocument({ documentName }) {
      return repo.loadDocument(documentName)
    },

    async onStoreDocument({ documentName, document }) {
      const doc = parseDocName(documentName)
      if (!doc) return
      if (doc.kind === 'page' && repo.isDocumentDeleted(documentName)) {
        // deleted for good: a device that still had it open (or syncs an old copy) must not bring it
        // back — unless the page itself is back (an undo, a restored backup with the same page id)
        if (!(await pageInMeta(doc.workspaceId, doc.pageId))) return
        repo.reviveDocument(documentName)
        log.info('page document revived', { workspace: doc.workspaceId, page: doc.pageId })
      }
      repo.saveDocument(documentName, doc.workspaceId, Y.encodeStateAsUpdate(document))
    },
  })

  /** Does the workspace's meta document list this page? The live copy has the latest changes (stores are debounced). */
  async function pageInMeta(workspaceId: string, pageId: string): Promise<boolean> {
    const name = `ws:${workspaceId}`
    const live = hocuspocus.hocuspocus.documents.get(name) ?? (await hocuspocus.hocuspocus.loadingDocuments.get(name)?.catch(() => undefined))
    if (live) return live.getMap('pages').has(pageId)
    const stored = repo.loadDocument(name)
    if (!stored) return false
    const doc = new Y.Doc()
    try {
      Y.applyUpdate(doc, stored)
      return doc.getMap('pages').has(pageId)
    } finally {
      doc.destroy()
    }
  }

  const close = (match: (e: Entry) => boolean, reason: CloseReason) => {
    let n = 0
    for (const entry of [...live]) {
      if (!match(entry)) continue
      live.delete(entry)
      entry.connection.close({ code: 4403, reason })
      n++
    }
    if (n) log.info('collab connections closed', { reason, count: n })
    return n
  }

  // revoked or expired sessions (logout elsewhere, CLI revoke-sessions) lose their sockets too
  const sweep = setInterval(() => {
    const checked = new Map<string, boolean>()
    close((e) => {
      if (!checked.has(e.sessionId)) checked.set(e.sessionId, sessions.isValid(e.sessionId))
      return !checked.get(e.sessionId)
    }, 'session-ended')
  }, 60_000)
  sweep.unref()

  return {
    handleUpgrade(req, socket, head) {
      socket.on('error', () => socket.destroy())
      const path = (req.url ?? '/').split('?')[0]
      if (path !== COLLAB_PATH) return reject(socket, 404, 'Not Found')
      if (!isSameOrigin(req.headers.origin, req.headers.host, config.publicUrl)) return reject(socket, 403, 'Forbidden')
      // cheap early exit for anonymous sockets; each document is authorised again in onAuthenticate
      if (!sessions.resolve(cookieFromHeader(req.headers.cookie, SESSION_COOKIE))) return reject(socket, 401, 'Unauthorized')
      hocuspocus.httpServer.emit('upgrade', req, socket, head)
    },
    closeUser: (userId, workspaceId, reason) => close((e) => e.userId === userId && e.workspaceId === workspaceId, reason),
    closeWorkspace: (workspaceId, reason) => close((e) => e.workspaceId === workspaceId, reason),
    closeSession: (sessionId, reason) => close((e) => e.sessionId === sessionId, reason),
    pageInMeta,
    async destroy() {
      clearInterval(sweep)
      await hocuspocus.destroy() // closes connections and flushes pending document stores
    },
  }
}

function reject(socket: Duplex, status: number, text: string) {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${text.length}\r\n\r\n${text}`)
  setTimeout(() => socket.destroy(), 1000).unref()
}
