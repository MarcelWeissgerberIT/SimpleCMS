/**
 * The ONE WebSocket of this tab (`/collab`), shared by every document provider (the meta
 * document and each open page). Follows the browser's online/offline state: offline → the socket
 * is closed on purpose (edits stay in IndexedDB), online → reconnect at once.
 */
import { HocuspocusProviderWebsocket, WebSocketStatus } from '@hocuspocus/provider'
import { DOC_SCHEMA_VERSION } from '../editor'

let socket: HocuspocusProviderWebsocket | null = null
let connected = false
const listeners = new Set<(connected: boolean) => void>()

/**
 * The collab socket, with the document schema generation this build reads (docs/CLOUD.md § Schema gate): the
 * server lets a connection write only at or above its minimum — an older tab would delete nodes it cannot read.
 */
export const collabUrl = () => `${window.location.origin.replace(/^http/, 'ws')}/collab?schema=${DOC_SCHEMA_VERSION}`

const browserOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false

export function isConnected(): boolean {
  return connected
}

export function onConnection(fn: (connected: boolean) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function setConnected(v: boolean) {
  if (connected === v) return
  connected = v
  listeners.forEach((l) => l(v))
}

export function getSocket(): HocuspocusProviderWebsocket {
  if (socket) return socket
  const s = new HocuspocusProviderWebsocket({
    url: collabUrl(),
    autoConnect: browserOnline(),
    // reconnect quickly: 1 s, 2 s, 4 s … at most 15 s
    delay: 1000,
    factor: 2,
    maxDelay: 15_000,
    minDelay: 500,
    maxAttempts: 0,
  })
  s.on('status', ({ status }: { status: WebSocketStatus }) => setConnected(status === WebSocketStatus.Connected))
  window.addEventListener('offline', () => {
    s.disconnect()
    setConnected(false)
  })
  window.addEventListener('online', () => {
    void s.connect()
  })
  socket = s
  return s
}

/** Stop talking to the server for good (signed out, removed from the workspace). */
export function closeSocket(): void {
  socket?.disconnect()
  setConnected(false)
}

/** Close and reopen (e.g. after a role change, so every document authenticates again). */
export function reconnectSocket(): void {
  if (!socket) return
  socket.disconnect()
  if (browserOnline()) void socket.connect()
}
